# Design-system artifact contract

Read this reference before creating `design.md`, `tokens.json`, generated imagery, or the PDF.

## `design.md`

Make `design.md` the human- and machine-readable policy source. Include:

- identity, version, owner, scope, and reviewed date;
- positioning, main message, voice, claim/evidence policy, and forbidden phrasing;
- master logo asset, variants, clear space, size, backgrounds, and prohibited changes;
- semantic color roles, contrast decisions, and print conversions when approved;
- typography roles, hierarchy, weights, fallbacks, files, licences, and embedding rights;
- spacing, grid, layout, surfaces, shape, border, icon, and motion rules;
- imagery subjects, art direction, treatments, alternatives, and avoid-list;
- component and Content Block principles;
- accessibility, localization, responsive, reduced-motion, print, and PDF/UA requirements;
- source paths, generation commands, ownership, review workflow, and change policy.

Start from `assets/design.template.md`. Do not put secrets, private licences, or inaccessible binary
data into the public document.

## `tokens.json`

Use semantic names and valid JSON. At minimum provide:

```text
meta
colors
color_ramp (50,100,200,300,400,500,600,700,800,900,950)
contrast_evidence[]
typography.display and typography.body
spacing
components
```

Set `meta.color_ramp_status` to one of:

- `approved`: a formally approved brand ramp whose shades are authoritative tokens;
- `audited_existing`: every value already exists in project code or computed styles, arranged by
  brightness for documentation without claiming it is a single-hue brand ramp;
- `proposed`: a derived candidate that must be labelled as proposed on the page and PDF and must
  not be consumed as an approved production token.

Trace every ramp value to an approved source or mark the entire ramp `proposed`. Never fill missing
50–950 steps by interpolation and silently present them as brand decisions.

Each `contrast_evidence` item contains `foreground`, `background`, `minimum`, `purpose`, and
`allowed`. The foreground/background may reference a key in `colors` or use a hex value. The audit
script calculates the ratio and verifies that `allowed` agrees with the threshold.

Treat `assets/tokens.example.json` as a shape, never as brand defaults. Replace every value and set
`meta.example_only` to `false` before publishing.

For every self-hosted font, preserve a public licence/copyright notice and record whether web use,
print use, and PDF embedding are allowed. If evidence is missing, mark the right unresolved instead
of inferring it from the file format.

## AI visual

Generate one new supporting bitmap with the built-in image generator unless an approved project
visual already serves the same purpose. Use this prompt frame:

```text
Use case: scientific-educational or ads-marketing
Asset type: supporting visual for a one-page landscape A4 design-system overview
Primary request: <brand-relevant subject derived from design.md>
Composition/framing: wide landscape; usable quiet area plus one clear focal area
Color palette: <audited project palette>
Constraints: image only; no text, numbers, logos, UI, diagrams, or watermark
Avoid: <project-specific visual clichés and forbidden treatments>
```

Save the exact final prompt and selected output path. Do not use generated logos, token swatches,
type specimens, contrast numbers, or body copy.

## One-page PDF

Compose a deterministic landscape A4 page around the generated visual. Include only the decisions
needed for a useful overview:

- identity, version, main message, and logo;
- one visual/brand signature;
- essential contrast evidence;
- semantic roles and brightness ramp;
- display/body type pairing;
- key foundation and component measurements;
- source/download pointer and creator credit.

Use original logo files and licensed fonts. Avoid screenshots of the webpage as the PDF source.
Verify one page with `pdfinfo`, render it to a bitmap, inspect clipping and legibility, and record
whether PDF/UA tagging is present. A visually correct untagged PDF is not digitally accessible.

## Synchronization

Generate on-page formatted document partials from the approved source files when the Content Block
cannot safely read public Markdown/JSON at runtime. Make the generation idempotent and fail if the
source is missing. Every page, PDF, and source file must carry the same version.
