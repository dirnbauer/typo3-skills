#!/usr/bin/env bash
# Generate a raster reference, then redraw it as a TYPO3 SVG.
# Exit 0: PNG saved; 1: usage/output error; 3: use SVG fallback; 4: safety refusal.
set -euo pipefail
die() { echo "ERROR: $*" >&2; exit 1; }
fallback() { echo "FALLBACK: $* Complete every requested icon as native SVG from matching TYPO3 Core references; run verify-icon.sh. No reference saved." >&2; exit 3; }
usage() { echo 'Usage: generate-icon-reference.sh "concept" [out.png] [--provider auto|openai|gemini] [--type module|small|content] [--accent "detail"] [--family "style references"] [--no-fallback]'; }
[ $# -gt 0 ] || { usage >&2; exit 1; }
if [ "$1" = --help ]; then usage; exit 0; fi
concept="$1"; shift
[ -n "$concept" ] || die 'empty concept'
out=icon-reference.png
provider=auto
kind=module
accent='one purple/lilac detail matching the installed backend'
family='match the neighboring TYPO3 icons, balanced optical size and spacing'
allow_fallback=1
if [ $# -gt 0 ] && [[ "$1" != --* ]]; then out="$1"; shift; fi
while [ $# -gt 0 ]; do
  case "$1" in
    --provider|--type|--accent|--family)
      [ $# -ge 2 ] && [[ "$2" != --* ]] || die "missing value for $1"
      case "$1" in
        --provider) provider="$2";; --type) kind="$2";;
        --accent) accent="$2";; --family) family="$2";;
      esac
      shift 2;;
    --no-fallback) allow_fallback=0; shift;;
    --transparent) echo 'NOTE: using flat white reference; the final SVG is transparent. No model downgrade.' >&2; shift;;
    *) die "unknown argument: $1";;
  esac
done
case "$provider" in auto|openai|gemini) ;; *) die 'invalid provider';; esac
case "$kind" in
  module) grid='64x64 canvas, 4-unit strokes, geometry within 12..52, readable at 32px';;
  small) grid='16x16 canvas, minimal 1-unit strokes, readable at 16px';;
  content) grid='square Content Blocks thumbnail matching the content icon family';;
  *) die 'invalid type';;
esac
[[ "$out" = *.png ]] || die 'output must end in .png'
for dependency in curl jq base64 od; do
  command -v "$dependency" >/dev/null 2>&1 || fallback "Missing $dependency."
done
prompt="Design one pictographic icon representing: ${concept}. Match neighboring TYPO3 icons: ${family}. ${grid}. Flat geometric line art on a plain white reference background. Accent: ${accent}. No colored tile, gradients, shadows, 3D, background scene or labels. Preserve the meaning, keep details readable at actual size. This raster guides a transparent SVG using currentColor and the backend accent token."
mkdir -p "$(dirname "$out")" || die 'cannot create output directory'
scratch=$(mktemp -d "$(dirname "$out")/.icon-reference.XXXXXX") || die 'cannot create temporary directory'
trap 'rm -rf "$scratch"' EXIT
request() {
  local engine="$1" model key endpoint status
  if [ "$engine" = openai ]; then
    key="${OPENAI_API_KEY:-}"
    [ -n "$key" ] || { echo 'OpenAI unavailable: no API key.' >&2; return 1; }
    model="${OPENAI_IMAGE_MODEL:-gpt-image-2.5-flare}"
    endpoint=https://api.openai.com/v1/images/generations
    jq -n --arg model "$model" --arg prompt "$prompt" '{model:$model,prompt:$prompt,size:"1024x1024",quality:"high",output_format:"png",n:1}' > "$scratch/request.json"
    printf 'Authorization: Bearer %s\nContent-Type: application/json\n' "$key" > "$scratch/headers"
  else
    key="${GEMINI_API_KEY:-${GOOGLE_API_KEY:-}}"
    [ -n "$key" ] || { echo 'Nano Banana unavailable: no API key.' >&2; return 1; }
    model="${GEMINI_IMAGE_MODEL:-gemini-3.1-flash-image}"
    [[ "$model" =~ ^[A-Za-z0-9._-]+$ ]] || { echo 'Invalid Gemini model ID.' >&2; return 1; }
    endpoint="https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent"
    jq -n --arg prompt "$prompt" '{contents:[{parts:[{text:$prompt}]}],generationConfig:{responseModalities:["IMAGE"]}}' > "$scratch/request.json"
    printf 'x-goog-api-key: %s\nContent-Type: application/json\n' "$key" > "$scratch/headers"
  fi
  echo "Generating with $engine ($model)." >&2
  if ! status=$(curl -sS --connect-timeout 15 --max-time 180 -o "$scratch/response.json" -w '%{http_code}' -H "@$scratch/headers" --data-binary "@$scratch/request.json" "$endpoint"); then
    echo "$engine transport failure." >&2; return 1
  fi
  # Never route around safety refusals or print raw responses/credentials.
  if jq -e '(.error.code == "content_policy_violation") or (.error.code == "moderation_blocked") or (.promptFeedback.blockReason? != null) or any(.candidates[]?; .finishReason == "SAFETY" or .finishReason == "IMAGE_SAFETY" or .finishReason == "PROHIBITED_CONTENT")' "$scratch/response.json" >/dev/null 2>&1; then
    echo "$engine refused the request. No provider fallback attempted." >&2; exit 4
  fi
  case "$status" in 2??) ;; *) echo "$engine HTTP $status." >&2; return 1;; esac
  if [ "$engine" = openai ]; then
    jq -er '.data[0].b64_json | select(type == "string" and length > 0)' "$scratch/response.json" > "$scratch/image.b64" 2>/dev/null || return 1
  else
    jq -er '[.candidates[]?.content.parts[]? | .inlineData? | select(.mimeType == "image/png") | .data | select(type == "string" and length > 0)][0] // empty' "$scratch/response.json" > "$scratch/image.b64" 2>/dev/null || return 1
  fi
  base64 --decode < "$scratch/image.b64" > "$scratch/image.png" 2>/dev/null || return 1
  [ "$(wc -c < "$scratch/image.png" | tr -d ' ')" -gt 100 ] || return 1
  [ "$(od -An -tx1 -N8 "$scratch/image.png" | tr -d ' \n')" = 89504e470d0a1a0a ] || return 1
  mv "$scratch/image.png" "$out" || die 'cannot save reference'
  echo "Reference saved: $out ($engine / $model). Inspect, redraw as SVG, and run verify-icon.sh." >&2
}
case "$provider" in auto|openai) engines=(openai gemini);; gemini) engines=(gemini openai);; esac
if [ "$allow_fallback" -eq 0 ]; then
  if [ "$provider" = auto ] && [ -z "${OPENAI_API_KEY:-}" ]; then engines=(gemini); else engines=("${engines[0]}"); fi
fi
for engine in "${engines[@]}"; do
  if request "$engine"; then exit 0; fi
done
fallback 'No available provider returned a valid PNG.'
