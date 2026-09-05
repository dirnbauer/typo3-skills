#!/usr/bin/env python3
"""Gold-standard TYPO3 v14 conformance checker.

Scores a site project against the deduped 76-rule ruleset (rules.json). The gold
template must score 100 % on every *repo*-scope rule; *advisory*-scope rules
(architecture / estate / runtime / base-image) are reported but not scored.

Usage:  python3 tools/conformance/check.py [PROJECT_ROOT]
Exit 0 iff no repo-scope rule fails.
"""

from __future__ import annotations

import json
import os
import pathlib
import re
import subprocess
import sys

import yaml


# --------------------------------------------------------------------------- #
# Permissive YAML loader (compose overrides use the !reset compose-spec tag).
# --------------------------------------------------------------------------- #
class _Loader(yaml.SafeLoader):
    pass


_Loader.add_multi_constructor("!", lambda loader, suffix, node: None)


def _expand_placeholders(text: str, lookup) -> str:
    """Expand ${VAR} / ${VAR:-default} with POSIX ``:-`` semantics — the default
    applies when the variable is unset OR empty, not only when it is missing."""

    def _sub(m):
        val = lookup(m.group(1), "")
        if not val and m.group(2) is not None:
            return m.group(2)
        return val

    return re.sub(r"\$\{(\w+)(?::-([^}]*))?\}", _sub, text)


# --------------------------------------------------------------------------- #
# Context: load every artefact once.
# --------------------------------------------------------------------------- #
JOB_SERVICES = {"app", "setup", "backup"}  # one-shot / idle runners (exempt)
# restart values that do NOT mark a long-running service; any other value
# (including the `on-failure:<max>` retry form) means the service is meant to stay
# running and is therefore treated as persistent regardless of its name.
_NO_RESTART = (None, "", "no")


def _is_job_service(name: str, svc) -> bool:
    """A one-shot / idle runner, exempt from the healthcheck + restart-policy
    rules. Name-based by default, but a service that declares a restart policy is
    treated as long-running regardless of its name, so a daemon cannot dodge the
    persistent-service rules merely by being named app/setup/backup (CONF-05).
    Residual: a restart-less daemon given such a name still escapes — a degenerate
    config, not a realistic one — so this narrows the heuristic, it does not close
    it."""
    svc = svc if isinstance(svc, dict) else {}
    return name in JOB_SERVICES and svc.get("restart") in _NO_RESTART


class Ctx:
    def __init__(self, root: pathlib.Path) -> None:
        self.root = root
        # The Composer project may live at the repo root OR under an `app/`
        # wrapper (the Netresearch de-facto layout: infra at root, project in
        # app/). Detect it once; project-scoped reads use self.proj, while
        # infra (compose / ci / Dockerfile / .gitlab-ci) stays at the repo root.
        self.proj = root / "app" if (root / "app" / "composer.json").is_file() else root
        self.compose = self._yaml("compose.yaml") or {}
        self.override_text = self._text("compose.override.yaml")
        self.override = self._yaml("compose.override.yaml", _Loader) or {}
        self.composer = self._json("composer.json", base="proj") or {}
        self.settings = self._text("config/system/settings.php", base="proj")
        self.additional = self._text("config/system/additional.php", base="proj")
        self.dockerfile = self._text("Dockerfile")
        self.gitlabci = self._text(".gitlab-ci.yml")
        self.pipeline = self._text("ci/pipeline.yml")
        self.pipeline_code = _strip_yaml_comments(self.pipeline)
        self.pipeline_doc = self._yaml("ci/pipeline.yml", _Loader) or {}
        self.gitignore = self._text(".gitignore")
        self.envdist = self._parse_env(".env.dist")
        self.ci_text = self._collect_ci_text()
        self.services = self.compose.get("services", {}) or {}

    # ---- loaders ----
    def _base(self, base: str) -> pathlib.Path:
        return self.proj if base == "proj" else self.root

    def _text(self, rel: str, base: str = "root") -> str:
        p = self._base(base) / rel
        return p.read_text(encoding="utf-8") if p.is_file() else ""

    def _yaml(self, rel: str, loader=yaml.SafeLoader):
        p = self.root / rel
        if not p.is_file():
            return None
        try:
            return yaml.load(p.read_text(encoding="utf-8"), Loader=loader)
        except yaml.YAMLError:
            return None

    def _json(self, rel: str, base: str = "root"):
        p = self._base(base) / rel
        if not p.is_file():
            return None
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return None

    def _parse_env(self, rel: str) -> dict[str, str]:
        env: dict[str, str] = {}
        for line in self._text(rel).splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key, val = key.strip(), val.strip()
            val = _expand_placeholders(val, env.get)
            env[key] = val
        return env

    def _collect_ci_text(self) -> dict[str, str]:
        out = {}
        ci = self.root / "ci"
        if ci.is_dir():
            for p in ci.rglob("*.yml"):
                out[str(p.relative_to(self.root))] = p.read_text(encoding="utf-8")
        return out

    # ---- helpers ----
    def exists(self, rel: str) -> bool:
        return (self.root / rel).exists()

    def proj_exists(self, rel: str) -> bool:
        """Existence check relative to the Composer project root (app/ or repo root)."""
        return (self.proj / rel).exists()

    def git_tracked(self, rel: str):
        """True/False whether `rel` is tracked in git; None if git is unavailable
        (then callers fall back to the .gitignore-text heuristic). The CI gate
        installs git so the strong check runs there — see .gitlab-ci.yml."""
        try:
            r = subprocess.run(
                ["git", "-C", str(self.root), "ls-files", "--error-unmatch", rel],
                capture_output=True,
                text=True,
                timeout=10,
                check=False,
            )
            return r.returncode == 0
        except (FileNotFoundError, OSError, subprocess.SubprocessError):
            return None

    def git_ls_files(self):
        """All git-tracked paths, or None if git is unavailable (same contract
        as git_tracked; SC-016 skips rather than walking the dirty tree)."""
        cached = getattr(self, "_ls_files_cache", "unset")
        if cached != "unset":
            return cached
        try:
            r = subprocess.run(
                ["git", "-C", str(self.root), "ls-files"],
                capture_output=True,
                text=True,
                timeout=30,
                check=False,
            )
            self._ls_files_cache = r.stdout.splitlines() if r.returncode == 0 else None
        except (OSError, subprocess.SubprocessError):
            self._ls_files_cache = None
        return self._ls_files_cache

    def resolve_image(self, img: str) -> str:
        if not img:
            return ""
        return _expand_placeholders(img, self.envdist.get)

    def service_image(self, name: str) -> str:
        svc = self.services.get(name, {}) or {}
        return self.resolve_image(svc.get("image", ""))

    def persistent_services(self) -> list[str]:
        return [n for n, svc in self.services.items() if not _is_job_service(n, svc)]

    def cache_service(self):
        for name, svc in self.services.items():
            img = self.resolve_image((svc or {}).get("image", ""))
            if "valkey" in img or re.match(r"redis(:|$|/)", img):
                return name, svc
        return None, None


def _is_first_party(image: str) -> bool:
    """True iff the image's registry HOST is exactly registry.netresearch.de. A
    substring test is bypassable (evil.com/registry.netresearch.de/x, or
    registry.netresearch.de.attacker.com/x), so compare the registry component —
    everything before the first '/'."""
    return image.strip().split("/", 1)[0] == "registry.netresearch.de"


def pinned(image: str) -> bool:
    """An image is acceptably pinned if it carries a digest, an explicit
    non-floating tag, or is a first-party Netresearch-registry image. First-party
    images are internal and trusted and may track a floating tag (e.g. :latest) so
    security fixes flow without a digest bump; third-party images must still carry
    a digest or a non-floating version tag."""
    if "@sha256:" in image:
        return True
    if _is_first_party(image):
        return True
    ref = image.split("@")[0]
    name = ref.rsplit("/", 1)[-1]
    if ":" not in name:
        return False  # bare third-party image, implicit :latest
    tag = name.rsplit(":", 1)[1]
    return tag not in ("latest", "edge", "")


# A committed credential is any password/secret/key/token-shaped key whose value
# is a non-empty STRING LITERAL (either quote style) rather than an environment
# reference. Detect by value SHAPE, not by an exact key token or single quotes —
# `'transport_smtp_password' => "literal"` and a non-hex encryptionKey must both
# be caught. settings.php must be 100 % environment-sourced for every secret.
_SECRET_KEY = re.compile(
    r"""['"](\w*(?:password|secret|encryptionkey|installtoolpassword|api[_-]?key|token))['"]"""
    r"""\s*=>\s*(['"])(.*?)\2""",
    re.IGNORECASE | re.DOTALL,
)


def settings_secret_free(text: str) -> bool:
    for m in _SECRET_KEY.finditer(text):
        val = m.group(3).strip()
        if not val:
            continue  # empty default — fine
        if val.startswith(("%env", "$")):
            continue  # environment-sourced, not committed
        return False
    return True


def _strip_yaml_comments(text: str) -> str:
    """Drop full-line and inline `#` comments so substring checks cannot be
    satisfied by a magic word that only appears in a comment."""
    out = []
    for line in text.splitlines():
        if re.match(r"\s*#", line):
            continue
        out.append(re.sub(r"\s+#.*$", "", line))
    return "\n".join(out)


def additional_prod_safe(text: str) -> tuple[bool, str]:
    """additional.php may enable dev-only switches ONLY behind an
    `isDevelopment()` guard — never a constant-true guard or at top level."""
    dev_flags = [
        r"\['displayErrors'\]\s*=\s*1\b",
        r"\['debug'\]\s*=\s*true\b",
        r"\['devIPmask'\]\s*=\s*'\*'",  # literal wildcard, not $env(...,'*')
    ]
    if not any(re.search(p, text) for p in dev_flags):
        return True, "no dev-mode flags in additional.php"
    if re.search(r"if\s*\(\s*(?:true|1)\s*\)", text):
        return False, "dev flags behind constant-true guard"
    if "isDevelopment()" not in text:
        return False, "dev flags not guarded by isDevelopment()"
    return True, "dev flags guarded by isDevelopment()"


# --------------------------------------------------------------------------- #
# Checks: code -> function(ctx) -> (bool|"ADVISORY", detail)
# --------------------------------------------------------------------------- #
def c_struct001(x):
    return (
        not x.proj_exists("build/config/system/settings.php")
        and x.proj_exists("config/system/settings.php"),
        "config/ at composer-project root, no build/config",
    )


def c_struct002(x):
    return (settings_secret_free(x.settings), "no secret values in settings.php")


def c_struct003(x):
    return (
        x.proj_exists("config/system/additional.php") and "$_SERVER" in x.additional,
        "additional.php sources $_SERVER",
    )


def c_struct004(x):
    return (
        x.composer.get("type") == "project" and x.proj_exists("composer.lock"),
        "type:project + committed composer.lock",
    )


def c_struct005(x):
    return (
        len(list((x.proj / "config/sites").glob("*/config.yaml"))) > 0,
        "config/sites/*/config.yaml present",
    )


def c_struct007(x):
    # Assert the .gitignore excludes the COMPOSER PROJECT's vendor/var/public at
    # their actual path for this layout — `app/...` under the app-wrapper layout,
    # root-level otherwise. Matching the project path (not a bare `/vendor`
    # substring) catches an ignore that names the wrong location: a root-anchored
    # `/vendor/` does not protect `app/vendor/`.
    g = x.gitignore
    prefix = "app/" if x.proj != x.root else ""

    def _ignored(directory: str) -> bool:
        # Accept the layout-aware path with the leading slash optional and the
        # entry being the directory or its contents — `/app/vendor/`,
        # `app/vendor`, `/app/public/*` all qualify. Reject a non-layout entry
        # (`/vendor/`, bare `vendor/`) that does not name the project path.
        pat = rf"(?m)^/?{re.escape(prefix)}{directory}(/.*)?\s*$"
        return bool(re.search(pat, g))

    ok = (
        _ignored("vendor")
        and _ignored("var")
        and _ignored("public")
        and bool(re.search(r"\.(prod|stage)\.env|\.env\.(production|staging)", g))
    )
    return (ok, f".gitignore excludes {prefix}vendor/var/public + live-env")


def c_struct008(x):
    return (not x.proj_exists("build/config"), "no legacy build/config")


def _live_env_files(x):
    pats = re.compile(r"(\.env\.(production|staging|live)$|\.(prod|stage)\.env$)")
    found = []
    for dirpath, dirnames, filenames in os.walk(x.root):
        if ".git" in dirnames:
            dirnames.remove(".git")
        for f in filenames:
            if pats.search(f):
                found.append(f)
    return found


def c_struct006(x):
    found = _live_env_files(x)
    if found:
        return (False, f"found {found}")
    # Also catch a bare `.env` (the most common live-secret file) tracked in git.
    if x.git_tracked(".env") is True:
        return (False, ".env is git-tracked")
    return (True, "no committed live-env files")


def c_ciimg001(x):
    return ("alpine:edge" not in x.dockerfile, "no alpine:edge")


def c_ciimg002(x):
    _name, svc = x.cache_service()
    img = x.resolve_image((svc or {}).get("image", "")) if svc else ""
    return (img.startswith("valkey/valkey"), f"cache image = {img or 'none'}")


def c_ciimg003(x):
    app, db = x.service_image("app"), x.service_image("db")
    return (pinned(app) and pinned(db), f"app={app or '-'} db pinned={pinned(db)}")


def c_ciimg004(x):
    return c_struct002(x)


def c_ciimg005(x):
    s = x.settings
    ok = (
        re.search(r"'displayErrors'\s*=>\s*0", s)
        and re.search(r"'debug'\s*=>\s*false", s)
        and not re.search(r"'devIPmask'\s*=>\s*'\*'", s)
        and not re.search(r"'trustedHostsPattern'\s*=>\s*'\.\*'", s)
    )
    prod_ok, detail = additional_prod_safe(x.additional)
    return (bool(ok) and prod_ok, "no debug/wildcard defaults; " + detail)


def c_ciimg006(x):
    return (":latest" not in x.service_image("ofelia"), "ofelia not :latest")


def c_ciimg007(x):
    targets = set(x.persistent_services()) | {"backup"}
    missing = [
        n
        for n in targets
        if n in x.services
        and not (
            ((x.services[n] or {}).get("deploy", {}) or {}).get("resources", {}) or {}
        )
        .get("limits", {})
        .get("memory")
    ]
    return (
        not missing,
        "resource limits on all long-running services"
        if not missing
        else f"missing limits: {missing}",
    )


def c_ciimg008(x):
    for n in ("db", "valkey"):
        if not (x.services.get(n, {}) or {}).get("healthcheck"):
            return (False, f"{n} missing healthcheck")
    return (True, "db & valkey have healthchecks")


def c_ciimg009(x):
    offenders = []
    for n, svc in x.services.items():
        for v in (svc or {}).get("volumes", []) or []:
            if (
                isinstance(v, str)
                and "/var/run/docker.sock" in v
                and n != "socket-proxy"
            ):
                offenders.append(n)
    return (
        not offenders,
        "docker.sock only via socket-proxy"
        if not offenders
        else f"direct mount: {offenders}",
    )


def c_ciimg010(x):
    dev = x.override.get("services", {}) or {}
    bad = []
    for n in ("pma", "mailpit"):
        img = x.resolve_image((dev.get(n, {}) or {}).get("image", ""))
        if img and not pinned(img):
            bad.append(n)
    return (not bad, "dev images pinned" if not bad else f"unpinned dev images: {bad}")


def c_ciimg011(x):
    return (
        x.exists("compose.yaml")
        and x.exists("compose.override.yaml")
        and not x.exists("docker-compose.yml"),
        "canonical compose.yaml",
    )


def c_ciimg012(x):
    for line in x._text(".env.dist").splitlines():
        s = line.strip()
        if not s.startswith("#") and re.match(r"COMPOSE_FILE\s*=", s):
            return (False, "COMPOSE_FILE overlay chain present")
    return (True, "no COMPOSE_FILE overlay chain")


def c_ciimg013(x):
    has_g = "g+s" in x.dockerfile
    bad = bool(re.search(r"chmod[^\n]*\bug\+s", x.dockerfile)) or bool(
        re.search(r"chmod[^\n]*\bu\+s\b", x.dockerfile)
    )
    return (has_g and not bad, "SGID (g+s) on writable dirs")


def c_ciimg014(x):
    text = x._text(".env.dist") + x.pipeline
    has_82 = (
        ":82" in re.sub(r"[0-9]:82\b", "", text)
        or "=:82" in text
        or 'tag: "82"' in text
        # Standard PHP image tags use the dotted form (e.g. php:8.2-fpm-alpine),
        # not just the NR registry's bare :82 convention. Anchor to a tag
        # boundary and forbid a preceding digit so unrelated versions such as
        # node:18.2-alpine do not false-positive on the "8.2" substring.
        or bool(re.search(r"(?<!\d)8\.2(?=[-.\s\"']|$)", text))
    )
    return (not has_82, "no PHP 8.2 runtime")


def c_ciimg015(x):
    d = x.dockerfile
    ok = all(
        f"org.opencontainers.image.{k}" in d for k in ("version", "source", "vendor")
    )
    return (ok, "OCI labels (version/source/vendor)")


def c_dro001(x):
    missing = [
        n
        for n in x.persistent_services()
        if not (x.services[n] or {}).get("healthcheck")
    ]
    return (
        not missing,
        "all persistent services healthchecked"
        if not missing
        else f"no healthcheck: {missing}",
    )


def c_dro002(x):
    for n, svc in x.services.items():
        dep = (svc or {}).get("depends_on")
        if not dep:
            continue
        if isinstance(dep, list):
            return (False, f"{n} uses list-form depends_on")
        for target, spec in dep.items():
            cond = (spec or {}).get("condition") if isinstance(spec, dict) else None
            if not cond:
                return (False, f"{n}->{target} missing condition")
            if _is_job_service(target, x.services.get(target)):
                if cond not in ("service_completed_successfully", "service_started"):
                    return (False, f"{n}->{target} bad job condition {cond}")
            elif cond != "service_healthy":
                return (False, f"{n}->{target} not service_healthy ({cond})")
    return (True, "depends_on conditions correct")


def c_dro003(x):
    bad = [
        n
        for n in x.persistent_services()
        if (x.services[n] or {}).get("restart")
        not in ("unless-stopped", "on-failure", "always")
    ]
    return (
        not bad,
        "restart policy on persistent services"
        if not bad
        else f"missing restart: {bad}",
    )


def c_dro015(x):
    cfg = x._text("ofelia/config.ini")
    return ("webhook" in cfg.lower(), "ofelia failure webhook configured")


def c_dro020(x):
    return (
        x.exists("compose.yaml") and not x.exists("docker-compose.yml"),
        "compose.yaml canonical",
    )


def c_ci001(x):
    return (
        not re.search(r"ofelia[^\n]*:latest", x._text("compose.yaml")),
        "ofelia not :latest",
    )


def c_ci002(x):
    return (
        "mount=type=secret" in x.dockerfile
        and not re.search(r"^ARG\s+COMPOSER_AUTH", x.dockerfile, re.MULTILINE),
        "COMPOSER_AUTH via BuildKit secret",
    )


def c_dro013(x):
    return (
        any(
            "restore-verify" in t or ("restore" in t and "verify" in t)
            for t in x.ci_text.values()
        ),
        "restore-verify job present",
    )


def _pipeline_jobs_text(x) -> str:
    """Serialized text of the PARSED Concourse job graph. YAML resolves `*alias`
    references into the jobs that use them, so a supply-chain step wired into a
    real job's plan appears here while one defined only in an UNREFERENCED anchor
    does not. ANDed with the comment-stripped text match, this narrows CONF-03 (a
    step must live in a job, not a stray anchor); it does not deep-walk the plan,
    so it stays robust to legitimate pipeline refactors. Cached on `x` because the
    four supply-chain checks each call it."""
    cached = getattr(x, "_jobs_text_cache", None)
    if cached is None:
        doc = x.pipeline_doc if isinstance(x.pipeline_doc, dict) else {}
        jobs = doc.get("jobs", [])
        cached = json.dumps(jobs if isinstance(jobs, list) else [])
        x._jobs_text_cache = cached
    return cached


def c_sc001(x):
    return (
        "composer audit" in x.pipeline_code
        and "composer audit" in _pipeline_jobs_text(x),
        "composer audit wired into a build job",
    )


def c_sc002(x):
    return (
        "trivy" in x.pipeline_code
        and "--exit-code 1" in x.pipeline_code
        and "trivy" in _pipeline_jobs_text(x),
        "trivy gate --exit-code 1 wired into a build job",
    )


def c_sc003(x):
    # Declared beats scanned: the BOM must be derived from committed lockfiles
    # (sbom-toolbox or cyclonedx-php-composer). A scanner (syft/spdx output)
    # alone is a completeness diff, not the SBOM.
    declared = r"sbom-app|sbom-toolbox|cyclonedx[-_]?php[-_]?composer"
    if re.search(declared, x.pipeline_code) and re.search(
        declared, _pipeline_jobs_text(x)
    ):
        return (True, "declared lockfile-derived SBOM wired into a build job")
    if re.search(r"cyclonedx|spdx|syft", x.pipeline_code):
        return (
            False,
            "scanner-only SBOM (syft/spdx) — declared lockfile-derived BOM required",
        )
    return (False, "no SBOM generation in pipeline")


def c_sc007(x):
    """Each Concourse task image_resource is pinned (version tag or digest comment).
    Resources (push targets) and anchors resolved separately."""
    for fname, text in x.ci_text.items():
        lines = text.splitlines()
        # index anchor blocks for alias resolution
        anchors = _anchor_blocks(lines)
        i = 0
        while i < len(lines):
            m = re.match(r"^(\s*)image_resource:\s*(\*\S+|\&\S+)?\s*$", lines[i])
            if m:
                indent = len(m.group(1))
                ref = (m.group(2) or "").strip()
                block = lines[max(0, i - 2) : i]
                k = i + 1
                while k < len(lines) and (
                    not lines[k].strip()
                    or lines[k].lstrip().startswith("#")
                    or (len(lines[k]) - len(lines[k].lstrip())) > indent
                ):
                    block.append(lines[k])
                    k += 1
                btext = "\n".join(block)
                if ref.startswith("*"):
                    btext += "\n" + anchors.get(ref[1:], "")
                if not _block_pinned(btext):
                    return (
                        False,
                        f"{fname}: unpinned image_resource near line {i + 1}",
                    )
                i = k
                continue
            i += 1
    return (True, "all task image_resources pinned")


def c_sc008(x):
    return ("sha256sum -c" in x.gitlabci, "fly download checksum-verified")


def c_sc009(x):
    has_update = "update-packages" in x.pipeline
    via_mr = x.exists("renovate.json") or any(
        "merge_request" in t for t in x.ci_text.values()
    )
    return ((not has_update) or via_mr, "dependency updates via MR / Renovate")


def c_sc010(x):
    return (
        "Secret-Detection.gitlab-ci.yml" in x.gitlabci,
        "GitLab secret detection enabled",
    )


def c_sc011(x):
    # Assert the actual gate, not a keyword: a `test` job that genuinely runs the
    # suite, AND a `build-and-sign` job whose plan is gated on it (`passed: [test]`).
    # The old substring search passed on a `phpunit` mention anywhere — even a
    # comment or an orphaned/disabled job disconnected from the build DAG.
    # Defensive against malformed YAML: a non-dict document, or `jobs`/`plan`/
    # `passed` holding an unexpected type, must yield a clean failure, not a crash.
    doc = x.pipeline_doc if isinstance(x.pipeline_doc, dict) else {}
    job_list = doc.get("jobs")
    jobs = {
        j.get("name"): j
        for j in (job_list if isinstance(job_list, list) else [])
        if isinstance(j, dict)
    }
    test_job = jobs.get("test")
    sign_job = jobs.get("build-and-sign")
    if not isinstance(test_job, dict) or not isinstance(sign_job, dict):
        return (False, "test gate: missing 'test' or 'build-and-sign' job")
    runs_tests = bool(re.search(r"phpunit|functional|smoke", str(test_job)))
    plan = sign_job.get("plan")
    gated = any(
        isinstance(step, dict)
        and isinstance(step.get("passed"), list)
        and "test" in step["passed"]
        for step in (plan if isinstance(plan, list) else [])
    )
    return (
        runs_tests and gated,
        "build-and-sign gated on the test job (passed: [test])",
    )


def c_sc012(x):
    return (x.proj_exists("composer.lock"), "composer.lock committed")


def c_sc013(x):
    # Strip inline comments first so `image: redis # note` cannot slip past the
    # end-anchored regexes.
    text = _strip_yaml_comments(x._text("compose.yaml") + "\n" + x.override_text)
    if re.search(r"image:\s*redis\s*$", text, re.MULTILINE):
        return (False, "runtime images pinned (bare redis)")
    # :latest is acceptable only on a first-party Netresearch-registry image;
    # any third-party :latest is a floating, non-reproducible pin.
    for m in re.finditer(r"image:\s*(\S+:latest)\s*$", text, re.MULTILINE):
        if not _is_first_party(m.group(1)):
            return (False, f"third-party :latest image ({m.group(1)})")
    return (True, "runtime images pinned (first-party :latest allowed)")


def c_sc014(x):
    sig = r"stack-sbom|sbom-stack|collect-stack-boms"
    return (
        bool(re.search(sig, x.pipeline_code))
        and bool(re.search(sig, _pipeline_jobs_text(x))),
        "stack-level SBOM produced per release",
    )


def c_sc015(x):
    unpinned = []
    for m in re.finditer(r"pecl\s+install\s+([^\n&|;]+)", x.dockerfile):
        for pkg in m.group(1).split():
            if pkg.startswith("-"):
                continue
            if not re.search(r"-\d[\w.]*$", pkg):
                unpinned.append(pkg)
    if unpinned:
        return (False, f"unpinned pecl install: {', '.join(sorted(set(unpinned)))}")
    return (True, "pecl installs pinned (or no pecl usage)")


def c_sc016(x):
    files = x.git_ls_files()
    if files is None:
        # No git available (e.g. exported tree). The on-disk tree also holds
        # build artefacts (vendor/, node_modules/ from installs), so a
        # filesystem walk would false-positive; skip rather than guess.
        return (True, "vendoring check skipped (git unavailable)")
    nm = [f for f in files if "node_modules/" in f]
    if nm:
        return (
            False,
            f"committed node_modules ({len(nm)} tracked files, e.g. {nm[0]})",
        )
    pat = re.compile(r"Resources/Public/.*(?:/vendor/|/libs/|(?:\.min\.js$))")
    vendored = [f for f in files if pat.search(f)]
    if vendored and not any(f.endswith("sbom-vendored.cdx.json") for f in files):
        return (
            False,
            f"vendored assets without sbom-vendored.cdx.json fragment ({len(vendored)} tracked files, e.g. {vendored[0]})",
        )
    return (True, "no undeclared vendoring")


def c_deploy002(x):
    return (not x.exists("ansible"), "no colocated ansible/")


def _cache_cmd(x):
    _, svc = x.cache_service()
    cmd = (svc or {}).get("command", [])
    return " ".join(cmd) if isinstance(cmd, list) else str(cmd)


def c_dro004(x):
    # Auth may be set on the CLI (`--requirepass <pw>`) or via a config-file /
    # entrypoint form that keeps the secret out of argv and the process list (the
    # `requirepass` directive written into a config file by the entrypoint).
    # Assert the invariant — auth is required — not one specific argv shape.
    # NB: this couples to the `requirepass` token appearing in the command or
    # entrypoint; a different config-writing mechanism would need it widened.
    _, svc = x.cache_service()
    svc = svc if isinstance(svc, dict) else {}
    ep = svc.get("entrypoint") or ""  # explicit null entrypoint -> "" not "None"
    ep_text = " ".join(ep) if isinstance(ep, list) else str(ep)
    auth = "requirepass" in (_cache_cmd(x) + " " + ep_text)
    return (auth, "cache requires auth")


def c_dro005(x):
    cmd = _cache_cmd(x)
    return (
        "--save" in cmd and "--appendonly yes" not in cmd,
        "cache persistence disabled",
    )


def c_dro006(x):
    cmd = _cache_cmd(x)
    return ("--maxmemory" in cmd and "allkeys-lru" in cmd, "cache eviction bounded")


def c_dro008(x):
    return c_ciimg002(x)


def c_dro009(x):
    bad = [n for n in x.persistent_services() if not pinned(x.service_image(n))]
    return (not bad, "persistent images pinned" if not bad else f"unpinned: {bad}")


def c_dro010(x):
    froms = re.findall(r"^FROM\s+(\S+)", x.dockerfile, re.MULTILINE)
    if not froms:
        return (False, "no FROM line")
    last = froms[-1]
    return (pinned(last) and ":edge" not in last, f"final FROM pinned ({last})")


def c_dro012(x):
    s = x.settings
    bad = (
        re.search(r"'displayErrors'\s*=>\s*1", s)
        or re.search(r"'debug'\s*=>\s*true", s)
        or re.search(r"'trustedHostsPattern'\s*=>\s*'\.\*'", s)
    )
    prod_ok, detail = additional_prod_safe(x.additional)
    return (not bad and prod_ok, "no dev-mode flags; " + detail)


def c_dro014(x):
    sched = "scheduler:run" in x._text("compose.yaml")
    cron = bool(
        re.search(
            r"(entrypoint|command)[^\n]*\b(crond|dcron)\b", x._text("compose.yaml")
        )
    )
    return (sched and not cron, "ofelia scheduler, no in-image dcron")


def c_dro016(x):
    s = x.settings
    if "FileWriter" not in s:
        return (True, "no FileWriter")
    # Every FileWriter must log to a php:// stream, never a disk path.
    # Anchor to the TYPO3 FileWriter class — a preceding letter means it is a
    # different class (e.g. MyCustomFileWriter), which we must not match.
    for m in re.finditer(
        r"(?<![A-Za-z])FileWriter(?:::class)?['\"]?\s*=>\s*\[(.*?)\]", s, re.DOTALL
    ):
        block = m.group(1)
        lf = re.search(r"""['"]logFile['"]\s*=>\s*['"]([^'"]+)['"]""", block)
        if not lf or not lf.group(1).startswith("php://"):
            return (False, "FileWriter not pointed at php:// stream")
    return (True, "logs routed to php://stderr")


def c_dep001(x):
    c = x.composer
    return (
        bool(c.get("require", {}).get("php"))
        and bool((c.get("config", {}).get("platform", {}) or {}).get("php")),
        "php require + platform set",
    )


def c_dep002(x):
    req = json.dumps(x.composer.get("require", {})) + json.dumps(
        x.composer.get("require-dev", {})
    )
    return (not re.search(r'"dev-[a-z0-9_\-]+"', req), "no dev-branch constraints")


def c_dep003(x):
    return (
        x.composer.get("minimum-stability", "stable") == "stable",
        "minimum-stability stable",
    )


def c_dep004(x):
    return (x.proj_exists("composer.lock"), "composer.lock present")


def c_dro007(x):
    ofelia = x.services.get("ofelia", {}) or {}
    vols = ofelia.get("volumes", []) or []
    no_sock = not any("docker.sock" in str(v) for v in vols)
    env = ofelia.get("environment", []) or []
    env_text = " ".join(env) if isinstance(env, list) else json.dumps(env)
    via_proxy = "socket-proxy" in env_text and "tcp://" in env_text
    proxy = any(
        "docker-socket-proxy" in x.resolve_image((s or {}).get("image", ""))
        for s in x.services.values()
    )
    return (no_sock and via_proxy and proxy, "ofelia via socket-proxy, no direct sock")


def c_dro011(x):
    # Strong check: a git-tracked .env (gitignored yet force-added) with live
    # secrets is the exact attack (CONF-02). Fall back to the .gitignore-text
    # heuristic only when git is unavailable.
    if x.git_tracked(".env") is True:
        return (False, ".env is git-tracked (committed-secret risk)")
    base = (
        settings_secret_free(x.settings)
        and ".env" in x.gitignore
        and x.exists(".env.dist")
    )
    note = (
        " [git unavailable: .gitignore-text fallback]"
        if x.git_tracked(".env") is None
        else ""
    )
    return (base, "no committed creds; .env ignored; .env.dist schema" + note)


def c_sc004(x):
    signed = "cosign" in x.pipeline_code and "cosign" in _pipeline_jobs_text(x)
    attested = bool(re.search(r"sbom-attest|cosign\s+attest", x.pipeline_code))
    if signed and attested:
        return (True, "cosign signing + SBOM attestation wired into a build job")
    if signed:
        return (
            False,
            "cosign signing present but no SBOM attestation (cosign attest --type cyclonedx)",
        )
    return (False, "no cosign signing in pipeline")


def c_sc005(x):
    return c_ci002(x)


def c_sc006(x):
    return c_struct002(x)


def c_sec001(x):
    text = x._text("compose.yaml")
    return (
        not re.search(r"image:\s*redis\s*$", text, re.MULTILINE)
        and not re.search(r"image:\s*redis:latest", text),
        "no bare/latest redis image",
    )


def c_sec002(x):
    return (
        not re.search(r"'installToolPassword'\s*=>\s*'\$argon", x.settings),
        "no hardcoded installToolPassword",
    )


def c_sec003(x):
    return ("TYPO3_ENCRYPTION_KEY" in x.additional, "encryptionKey env-driven")


def c_sec004(x):
    return c_struct006(x)


def c_sec005(x):
    s_ok = not re.search(r"'devIPmask'\s*=>\s*'\*'", x.settings)
    prod_ok, _ = additional_prod_safe(x.additional)
    return (s_ok and prod_ok, "devIPmask not wildcard (settings + additional)")


def c_sec006(x):
    return (
        not re.search(r"'trustedHostsPattern'\s*=>\s*'\.\*'", x.settings),
        "trustedHostsPattern not wildcard",
    )


def c_doc001(x):
    return (x.exists("AGENTS.md"), "AGENTS.md present")


def c_doc002(x):
    p = x.root / "CLAUDE.md"
    return (
        p.is_symlink() and os.readlink(p) == "AGENTS.md",
        "CLAUDE.md -> AGENTS.md symlink",
    )


def c_doc003(x):
    r = x._text("README.md")
    return (
        "make install" in r and ("COMPOSER_AUTH" in r or ".env" in r),
        "README documents setup/env/make",
    )


def _anchor_blocks(lines: list[str]) -> dict[str, str]:
    out, i = {}, 0
    while i < len(lines):
        m = re.match(r"^(\w[\w\-]*):\s*\&(\S+)", lines[i])
        if m:
            indent = len(lines[i]) - len(lines[i].lstrip())
            block, k = [lines[i]], i + 1
            while k < len(lines) and (
                not lines[k].strip()
                or lines[k].lstrip().startswith("#")
                or (len(lines[k]) - len(lines[k].lstrip())) > indent
            ):
                block.append(lines[k])
                k += 1
            out[m.group(2)] = "\n".join(block)
            i = k
            continue
        i += 1
    return out


def _block_pinned(btext: str) -> bool:
    # Strip comments first: a digest in a `# ...@sha256:` comment beside
    # `tag: latest` is NOT a pin (AUTO-03). The digest must be effective — in the
    # repository ref or a native `version: { digest: sha256:... }` field.
    code = _strip_yaml_comments(btext)
    if re.search(r"sha256:[0-9a-f]{64}", code):
        return True
    tag = re.search(r'tag:\s*"?([\w.\-]+)"?', code)
    return bool(tag) and tag.group(1) not in ("latest", "edge")


CHECKS = {
    "STRUCT-001": c_struct001,
    "STRUCT-002": c_struct002,
    "STRUCT-003": c_struct003,
    "STRUCT-004": c_struct004,
    "STRUCT-005": c_struct005,
    "STRUCT-006": c_struct006,
    "STRUCT-007": c_struct007,
    "STRUCT-008": c_struct008,
    "CI-IMG-001": c_ciimg001,
    "CI-IMG-002": c_ciimg002,
    "CI-IMG-003": c_ciimg003,
    "CI-IMG-004": c_ciimg004,
    "CI-IMG-005": c_ciimg005,
    "CI-IMG-006": c_ciimg006,
    "CI-IMG-007": c_ciimg007,
    "CI-IMG-008": c_ciimg008,
    "CI-IMG-009": c_ciimg009,
    "CI-IMG-010": c_ciimg010,
    "CI-IMG-011": c_ciimg011,
    "CI-IMG-012": c_ciimg012,
    "CI-IMG-013": c_ciimg013,
    "CI-IMG-014": c_ciimg014,
    "CI-IMG-015": c_ciimg015,
    "DRO-001": c_dro001,
    "DRO-002": c_dro002,
    "DRO-003": c_dro003,
    "DRO-015": c_dro015,
    "DRO-020": c_dro020,
    "CI-001": c_ci001,
    "CI-002": c_ci002,
    "DRO-013": c_dro013,
    "SC-001": c_sc001,
    "SC-002": c_sc002,
    "SC-003": c_sc003,
    "SC-007": c_sc007,
    "SC-008": c_sc008,
    "SC-009": c_sc009,
    "SC-010": c_sc010,
    "SC-011": c_sc011,
    "SC-012": c_sc012,
    "SC-013": c_sc013,
    "SC-014": c_sc014,
    "SC-015": c_sc015,
    "SC-016": c_sc016,
    "DEPLOY-002": c_deploy002,
    "DRO-004": c_dro004,
    "DRO-005": c_dro005,
    "DRO-006": c_dro006,
    "DRO-008": c_dro008,
    "DRO-009": c_dro009,
    "DRO-010": c_dro010,
    "DRO-012": c_dro012,
    "DRO-014": c_dro014,
    "DRO-016": c_dro016,
    "DEP-001": c_dep001,
    "DEP-002": c_dep002,
    "DEP-003": c_dep003,
    "DEP-004": c_dep004,
    "DRO-007": c_dro007,
    "DRO-011": c_dro011,
    "SC-004": c_sc004,
    "SC-005": c_sc005,
    "SC-006": c_sc006,
    "SEC-001": c_sec001,
    "SEC-002": c_sec002,
    "SEC-003": c_sec003,
    "SEC-004": c_sec004,
    "SEC-005": c_sec005,
    "SEC-006": c_sec006,
    "DOC-001": c_doc001,
    "DOC-002": c_doc002,
    "DOC-003": c_doc003,
}

ADVISORY_NOTE = {
    "DRO-019": "template is intentionally a single repo; production sites split app/deploy/infra",
    "DEPLOY-001": "template colocates ci/ to demonstrate; production sites use a deploy repo",
    "DRO-017": "php-fpm status endpoint is configured in the shared t3re image, not this repo",
    "DRO-018": "uptime monitoring is registered per deployed site, not in the template",
}

GREEN, RED, YEL, DIM, RST = "\033[32m", "\033[31m", "\033[33m", "\033[2m", "\033[0m"


def main() -> int:
    root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    rules = json.loads((pathlib.Path(__file__).with_name("rules.json")).read_text())[
        "rules"
    ]
    ctx = Ctx(root)

    max_possible = penalty = 0
    failures = []
    rows = []
    for rule in rules:
        code, sev, scope, weight = (
            rule["code"],
            rule["severity"],
            rule["scope"],
            rule["weight"],
        )
        if scope == "advisory":
            rows.append((code, sev, "ADVISORY", ADVISORY_NOTE.get(code, "")))
            continue
        fn = CHECKS.get(code)
        if fn is None:
            rows.append((code, sev, "SKIP", "no check implemented"))
            continue
        ok, detail = fn(ctx)
        max_possible += weight
        if ok:
            rows.append((code, sev, "PASS", detail))
        else:
            penalty += weight
            failures.append(code)
            rows.append((code, sev, "FAIL", detail))

    score = round(100 * (max_possible - penalty) / max_possible) if max_possible else 0

    print(f"\n  TYPO3 14 Gold — conformance report ({root.name})\n")
    for code, sev, status, detail in rows:
        color = {"PASS": GREEN, "FAIL": RED, "ADVISORY": DIM, "SKIP": YEL}[status]
        print(f"  {color}{status:<8}{RST} {code:<11} {DIM}{sev:<7}{RST} {detail}")

    band = GREEN if score >= 90 else (YEL if score >= 70 else RED)
    print(
        f"\n  repo-scope score: {band}{score}%{RST}  "
        f"({(max_possible - penalty)}/{max_possible} pts, {len(failures)} failing)"
    )
    if failures:
        print(f"  {RED}FAILING:{RST} {', '.join(failures)}")
    print()
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
