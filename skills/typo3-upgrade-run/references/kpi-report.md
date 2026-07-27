# The KPI report

A Word document in the webconsulting corporate design, produced in phase P15. Written in the
language recorded in `config/run.yml` (`reporting.language`, default German).

Write the report as Markdown first — it stays the single source of truth and is what gets reviewed
— then render it:

```bash
python3 scripts/md2docx-webconsulting.py \
  .typo3-update/report/KPI-REPORT.md \
  .typo3-update/report/TYPO3-14-Update-Bericht.docx \
  "<Kunde> · Run <run_id>"
```

The renderer applies the `webconsulting-branding` tokens directly (primary `#1b7a95`, accent
`#66c4e1`, ink `#171a1d`, muted `#5e6870`, Hanken Grotesk, borderless square surfaces, brand
notice in the header only, quiet footer). It needs `python-docx`; the `document-processing` skill
covers the wider DOCX/PDF/XLSX toolkit if a task needs more than this.

**Check the output, do not assume it.** Re-read the generated file and assert no raw Markdown
survived — nested inline spans (`` **`code`** ``, ``[`label`](path)``) and soft-wrapped bold are
the constructs that leak:

```bash
python3 - <<'EOF'
from docx import Document
d = Document('.typo3-update/report/TYPO3-14-Update-Bericht.docx')
bad = [p.text for p in d.paragraphs if '**' in p.text or '`' in p.text]
bad += [c.text for t in d.tables for r in t.rows for c in r.cells if '**' in c.text]
print('stray markdown:', len(bad))
EOF
```

## The single rule

**Every figure comes from `state.json` or a loop `report.json`.** The document is *assembled* from
evidence, never written from memory.

A number that appears in the KPI report and nowhere in the run directory is a fabrication, however
plausible it looks and however confident the sentence around it sounds. If a figure is wanted and no
measurement produced it, either measure it or leave it out and say why.

Use the `share` redaction profile: hostnames and path segments hashed, query values removed.

## Structure

### 1. Before and after the update

| Row | Source |
|---|---|
| TYPO3 version | `state.target.typo3_from` → `typo3_to` |
| PHP version | `state.target.php_from` → `php_to`, plus the recorded 8.5 attempt and its blockers |
| Extension set changes | `manifests/extensions.json`, grouped by resolution |
| Visual differences | loop 300 `findings_by_class`, ending at zero |
| Backend module sweep | loop 310 coverage and result |
| Accessibility | loop 040 and the loop 300 re-audit, automated and manual **shown separately** |
| Lighthouse and Core Web Vitals | loop 500, medians with min/max |

### 2. Data

Sitemap coverage per language · the persisted sample lists · response codes · **coverage actually
achieved**, including every URL not pixel-compared and why · image formats and modern-format share ·
PHPStan level and baseline delta · test and audit results · every URL excluded from the invariance
claim with its ADR.

### 3. Recommendations

Information architecture with concrete examples and the reasoning behind each · design improvements
shown as before/after pairs from the regression screenshots · easy wins such as correct
ImageMagick/GraphicsMagick `GFX` configuration · anything else worth flagging: caching, security
headers, SEO, content quality.

**Recommendations are proposals for the user, not changes this skill made.** Keep observations,
assumptions and recommendations visually separate — a reader must be able to tell what was measured
from what is suggested.

## Local measurement caveats are mandatory

Every absolute score from a DDEV run carries its caveat **next to the number**, not in a footnote
nobody reads. The wording matters because these documents get forwarded:

- Lighthouse scores: indicative; local network and warm caches. The *improvement* is the evidence.
- TBT presented as an INP **proxy** — never "INP passing".
- TTFB: unrealistically low locally; not transferable.
- HSTS: present locally, meaningful only on the production layer.
- Observatory-equivalent grade: computed offline from the header set, not issued by Mozilla.
- JSON-LD: syntax and vocabulary validated offline; rich-result eligibility not checked.
- AVIF share: depends on the local image processor; production may differ.

## What the report must not do

- Claim WCAG 2.2 AA conformance from a green axe run. Automation reaches roughly a third of the
  criteria; automated and manual evidence stay separate.
- Present a local score as a field measurement.
- Report full coverage when a capture budget was exhausted. When `coverageDegraded` is true, the
  document says so **in the summary**, not only in an appendix.
- Include a generic recommendation that no measurement produced. The previous harness padded its
  reports with five hardcoded tips that reached the KPI document indistinguishable from measured
  findings — every recommendation now carries the evidence it came from.


## Run statistics — what it actually took

The KPI table says what the site looks like at the end. It does not say what the run cost, and that
is the part a reader needs to plan the next one. Every figure below comes from `journal.jsonl` and
the per-loop `report.json` files, so it is recorded fact rather than recollection.

### Per loop

| Column | From |
|---|---|
| Loop id and track | the loop directory name |
| Iterations run | `03-iterations.md` entries, one per pass |
| Verdict | `06-exit.md` — `passed`, `aborted`, `superseded` |
| Abort trigger, if any | which condition fired: max iterations, no progress, oscillation, fingerprint drift, time budget, budget breach, unclassifiable |
| Findings by class | `findings_by_class`, all eight buckets including `unclassified` |
| Wall-clock | first and last journal entry for that loop |

A loop that needed six iterations and one that passed first time both read as "green" in a summary.
They are not the same run, and the difference is usually where the next estimate comes from.

### Across the run

- **Total loops, and how many were retried or superseded.** A superseded loop keeps its directory
  and its id; it is not deleted, so the count is honest.
- **Total iterations against total loops.** The ratio is the single most useful number for
  estimating the next upgrade of a comparable site.
- **Re-runs of the determinism self-test**, and what each one cost. A self-test that had to run
  five times before it went green is a fact about the site *and* about the harness, and it belongs
  in the record — the reason it failed each time is worth more than the final green.
- **Wall-clock per phase**, and where it actually went. Capture and comparison usually dominate;
  if something else did, say what.
- **Findings that were repaired against findings that were approved as declared changes.** These
  are different outcomes and must never be merged into one number.
- **What was not covered**: URLs omitted by sampling, carousel slides beyond the first, quarantined
  captures below the dust floor, third-party integrations blocked during capture. Each with its
  count and its reason.

### Honesty rules for this section

Report the aborts, the retries and the dead ends, not only the closing state. A run that reached
green after two rollbacks and a re-baselined self-test is a *different* piece of evidence from one
that walked through — and the next person planning an upgrade needs the first number, not the
second.

Where a tool was fixed mid-run, say so and say what it had been reporting before. A harness defect
that produced false findings for three loops is part of what happened, and burying it makes every
figure above it unverifiable.
