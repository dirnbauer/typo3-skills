# Generate icon designs, then author SVGs

Use **GPT Image 2.5** or **Google Nano Banana** for new and redesigned icons,
including simple module, extension, plugin, record and action glyphs. A coherent
family sheet can guide related icons. Follow the host tool's rules for separate
asset requests. Registration-only changes and unchanged Core reuse need no generation.

## Match the actual backend

Inspect two or three neighboring icons and the matching TYPO3.Icons catalog.
Supply screenshots or rendered SVGs to a tool that accepts visual references.
For the text-only API helper, describe actual shapes, grid, padding, stroke width
and colors in `--family`. "Modern" alone is insufficient. Module designs match
TYPO3's transparent line-art and the installation's accent without the old colored tiles.

Inspect the generated geometry, then redraw it as minimal SVG. Use `currentColor`
and `var(--icon-color-accent, #ff8700)` so the active TYPO3 theme supplies the accent
in both schemes. Never ship the raster or blindly trace it. Content Blocks thumbnails keep
their own family; do not force module density into all contexts.

## Provider selection and fallback for every icon

1. Prefer the host's built-in image generator; it does not need a shell API key.
   Choose GPT Image 2.5 or Nano Banana where model selection is exposed. Otherwise
   report the tool without inventing its model. Honor user provider preferences.
2. For technical failure, try the other available authorized provider once. Missing
   credentials, inaccessible model, quota, timeout, server error, empty response
   and invalid image use this path. Do not silently downgrade to older models.
   Respect host tool rules and explicit provider restrictions. Do not obtain keys
   or transmit private material to a new destination to make fallback possible.
3. If no generator works, report the limitation and finish **all requested icons**
   as native SVG using the observed Core family. Keep semantics, identifiers,
   viewBox, theme tokens and verification. No placeholders or unfinished set.
4. A safety refusal ends the generation attempt; do not switch providers to evade
   it. Resolve the request itself before proceeding.

## API helper

```bash
scripts/generate-icon-reference.sh "SEO crawler, circular arrow" crawler.ref.png \
  --provider auto --type module --accent "lavender arrowhead" \
  --family "like adjacent TYPO3 list and dashboard icons: 64 grid, 4px strokes, 12px padding"

scripts/generate-icon-reference.sh "record approval check" record.ref.png \
  --provider gemini --type small --family "match the current 16px record icons"

# Respect an explicit restriction to one provider.
scripts/generate-icon-reference.sh "extension document tool" extension.ref.png \
  --provider openai --no-fallback
```

The helper needs `curl`, `jq`, `base64`, and `od`. It makes at most one request
per provider with connection/request timeouts of 15/180 seconds. Use a yielding
execution tool so a long request does not prevent progress updates.

| Setting | Default / purpose |
|---|---|
| `OPENAI_API_KEY` | OpenAI authentication |
| `OPENAI_IMAGE_MODEL` | `gpt-image-2.5-flare`; `gpt-image-2.5-sunburst` is an explicit alternative |
| `GEMINI_API_KEY` or `GOOGLE_API_KEY` | Google authentication |
| `GEMINI_IMAGE_MODEL` | `gemini-3.1-flash-image` (Nano Banana 2) |
| `--provider auto` | OpenAI first, Google as fallback |
| `--provider openai` / `gemini` | Preferred provider, then the other provider |
| `--no-fallback` | Only the selected provider, then native SVG fallback status |
| `--type module` | Module and extension: 64x64 source, 32px menu rendering |
| `--type small` | Plugin, record and action: 16x16 unless the real context differs |
| `--type content` | Square Content Blocks wizard reference |

`--transparent` is accepted for compatibility, but uses a flat white reference
without changing models. The SVG redraw supplies the transparent background.

Exit `0` saves a PNG; `1` means a usage/output error; `3` requests native SVG
fallback; `4` reports a safety refusal. Failure preserves an existing output.
The helper checks base64, minimum size and PNG signature, not complete decoding or
visual quality. Inspect successful output before redrawing.

## Verified API references

Model IDs checked on 2026-09-16; consult official docs before changing them.

- [GPT Image 2.5 Flare](https://developers.openai.com/api/docs/models/gpt-image-2.5-flare):
  `POST https://api.openai.com/v1/images/generations`, Bearer authentication,
  model and prompt; decode `data[0].b64_json`. The helper uses high-quality
  1024-square PNG and omits `response_format`.
- [Nano Banana](https://ai.google.dev/gemini-api/docs/image-generation) and
  [Generate Content API](https://ai.google.dev/gemini-api/docs/generate-content):
  the helper uses `v1beta/models/{model}:generateContent`, `x-goog-api-key`,
  `contents[].parts[].text`, `responseModalities:["IMAGE"]`, and PNG
  `candidates[].content.parts[].inlineData.data`. Google also documents its newer
  Interactions API. Generated images carry SynthID; do not remove it.

## Inspect, redraw and verify

- Compare the generated shape with its actual neighbors at render size. Correct a
  materially wrong design with one focused refinement. Do not reproduce raster
  artifacts, extra detail, backgrounds, labels or shadows in the SVG.
- Author the chosen geometry with the correct viewBox, transparent background and
  theme tokens. Run `scripts/verify-icon.sh <file> module|small|content`.
- Register in `Configuration/Icons.php`, wire consumers, clear relevant stale
  caches and check the actual backend in light and dark schemes.
- Report the generator or fallback actually used and the final SVG locations.
