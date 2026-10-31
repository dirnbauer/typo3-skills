# Phase 5b: Background Music (Suno AI)

Continues `webconsulting-create-documentation` from [full guide](full-guide.md).

## Phase 5b: Background Music (Suno AI)

### Setup

1. Get an API key from a third-party Suno music API such as [api.box](https://www.api.box)
2. Add to `.env`: `SUNO_API_KEY=your-key`

**Provider and licence status (verified 2026-10-31):**
- Suno publishes no self-serve REST API. Its only official programmatic route is the
  [Suno MCP beta](https://suno.com/release-notes/suno-mcp-beta) (early access, sign-in with a
  Suno account, uses that account's credits), which is not a key-based API for scripts.
- api.box is a third-party service, not Suno; its site points to suno.com for official access.
  Its [docs](https://docs.api.box/suno-api/generate-music) list the accepted models.
- Suno's [Terms of Service](https://suno.com/terms) restrict outputs from Free/Basic plans to
  personal, non-commercial use; Pro/Premier subscribers receive Suno's rights for commercial
  use, and Suno gives no assurance that copyright vests in any output. The same terms forbid
  reaching the service by means it does not make available. Before using third-party output in
  client or commercial videos, get the user's decision and check the provider's own terms; when
  in doubt, use licensed stock music (see "Without Suno API key" below).

### Generate music

```bash
npm run music:generate
# Output: public/music/background.mp3
# Config: remotion/music-config.ts (HAS_BACKGROUND_MUSIC = true)
```

The script:
1. Sends a prompt to the provider's generate endpoint (instrumental only), with a current model
   from the provider's docs: api.box lists the V6 series as current and V4_5ALL as deprecated
   (verified 2026-10-31)
2. Polls for completion (typically 30-60 seconds)
3. Downloads the MP3 to `public/music/background.mp3`
4. Writes `remotion/music-config.ts` so the video knows music exists

### Music prompt (adapt for your product)

```
Uplifting neoclassical underscore for a modern technology product video.
Bright piano arpeggios in a major key over gentle pizzicato strings and
a soft cello melody. Light, optimistic, and forward-moving — like a TED
talk opening or an Apple product reveal. Subtle modern electronic texture
underneath the classical instruments. No heavy drums, no vocals, no sudden
drops. Tempo around 100 BPM. Engaging but never distracting — true
background music that lifts the mood without competing with narration.
Think Max Richter meets Ólafur Arnalds with a hint of Nils Frahm.
Duration should be around 90 seconds.
```

**Key prompt principles:**
- Specify **major key** to avoid melancholic/minor tonality
- Name **classic instruments** (piano, strings, cello) for warmth and sophistication
- Add **modern electronic texture** to keep it contemporary
- Reference **real composers** (Max Richter, Ólafur Arnalds, Nils Frahm) for style anchoring
- Emphasize **"background music"** and **"never distracting"** — Suno tends to overpower otherwise
- Set **tempo** (100 BPM) — too slow feels sad, too fast feels hectic

### Volume ducking

The `BackgroundMusic` component in `ProductTour.tsx` handles automatic
volume ducking — music plays at 0.15 volume between scenes and ducks to
0.06 when narration is active. Transitions are smooth 0.5s ramps.

- Fade in: first 2s of video
- Fade out: last 3s of video
- Loop: music loops if shorter than the video

### Without Suno API key

If no key is set, the video renders without background music (narration only).
You can also manually place any MP3 at `public/music/background.mp3` and set
`HAS_BACKGROUND_MUSIC = true` in `remotion/music-config.ts`.
