# Python / pip Supply Chain

Pinning Python dependencies for a build that a scanner will accept and an
auditor can reproduce. The npm/pnpm equivalent is
`references/npm-pnpm-supply-chain.md`.

## Version pinning is not integrity pinning

`requirements.txt` with `torch==2.13.0` fixes *which release* is requested. It
does not fix *which bytes* arrive. A re-published artifact, a compromised mirror
or a poisoned cache satisfies the pin and installs different code.

This is also why version pinning alone does **not** clear SonarQube/SonarCloud
`docker:S8544` ("dependencies should be locked to verified versions"), nor the
OpenSSF Scorecard `Pinned-Dependencies` check. Both want the digest. Expect the
finding to survive an otherwise-thorough pinning pass, and do not spend a review
round arguing it is a false positive.

The integrity pin is `--require-hashes`:

```dockerfile
COPY requirements.txt requirements.lock ./
RUN pip install --require-hashes --only-binary :all: -r requirements.lock
```

```
# requirements.lock — generated, do not hand-edit
torch==2.13.0+cpu \
    --hash=sha256:2ba9f5e6a8bd0f2a1f0b1c7d...
filelock==3.20.0 \
    --hash=sha256:8bb3b0a1c1d1cbf1b7c8a6e2...
```

## Two files, two jobs

Keep the human-edited direct dependencies separate from the resolved graph:

| File | Contents | Edited by |
|---|---|---|
| `requirements.txt` | direct dependencies only | humans |
| `requirements.lock` | every resolved package + hashes | `pip-compile` / `pip download` |

The image installs from the lock. The `.txt` exists so the next person can tell
which dependencies are *intended* rather than transitive.

## `--require-hashes` changes resolution — the lock must be complete

Hash mode is strict in ways plain installs are not:

- **Every** package needs a hash, including transitive ones. A missing entry is
  a hard error, not a warning.
- Every requirement must be pinned with `==`. Ranges are rejected outright.
- Nothing may be resolved at install time, so the lock has to be closed over the
  full graph.

Consequence: **verify with a real install, not `--dry-run`.** A dry run can
resolve happily and the real install still fail, because the strictness applies
during the actual download/verify phase.

```bash
docker run --rm -v "$PWD:/w" -w /w python:3.14-slim \
  pip install --require-hashes --only-binary :all: -r requirements.lock
```

Pair it with `--only-binary :all:` so pip cannot fall back to building an sdist,
which would execute arbitrary `setup.py` code at build time.

## Generating the lock

`pip-compile --generate-hashes` (from `pip-tools`, or `uv pip compile
--generate-hashes`) is the normal path:

```bash
uv pip compile requirements.txt --generate-hashes -o requirements.lock
```

**When the index publishes no digests, hash the artifacts yourself.** Some
indexes — notably the PyTorch CPU wheel index
(`https://download.pytorch.org/whl/cpu`) — serve packages whose metadata carries
no `sha256`, and `--generate-hashes` then produces an incomplete lock. This is
not a dead end: `--require-hashes` verifies the downloaded file against the
listed digest, so a digest computed locally from that same file is exactly what
it needs.

```bash
pip download --only-binary :all: \
  --extra-index-url https://download.pytorch.org/whl/cpu \
  -r requirements.txt -d wheels/
sha256sum wheels/*                       # -> the entries for the lock
```

Record where each hash came from in the lock header, so a later reader can tell
a locally-computed digest from an index-published one.

## Regeneration must be documented in the file

A lock nobody can regenerate becomes unmaintainable the first time a CVE lands.
Put the exact command in the header:

```
# Regenerate:
#   uv pip compile requirements.txt --generate-hashes \
#     --extra-index-url https://download.pytorch.org/whl/cpu -o requirements.lock
# Wheels without index-published digests are hashed locally; see
# references/python-pip-supply-chain.md.
```

## Verification

```bash
# every requirement carries a hash
grep -c -- '--hash=sha256:' requirements.lock
grep -E '^[A-Za-z0-9_.-]+(==|@)' requirements.lock | grep -v '\\$' && echo 'unhashed entry'

# no unpinned or range specifiers
grep -E '[><~!]=|>|<' requirements.lock && echo 'non-== specifier present'

# the install actually works (not a dry run)
docker run --rm -v "$PWD:/w" -w /w python:3.14-slim \
  sh -c 'pip install --require-hashes --only-binary :all: -r /w/requirements.lock && python -c "import torch; print(torch.__version__)"'
```

## Related

- `references/npm-pnpm-supply-chain.md` — the JS equivalent
- `references/reproducible-builds.md` — verifying build *output* digests
- `references/slsa-provenance.md` — attesting what produced the artifact
