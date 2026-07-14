# 🎧 Steerable MusicGen

Continuous AI music you steer in real time. Chunks generate ~8s at a time, each
conditioned on the previous one (MusicGen continuation), buffered ahead, and
crossfaded together in the Web Audio API. Edit the prompt or toggle instruments
to steer the next chunk.

## Run locally
```bash
npm install
cp .env.local.example .env.local   # add your REPLICATE_API_TOKEN
npm run dev
```

## Deploy (do this in the first 20 min, not the last)
```bash
npm i -g vercel          # already installed here
vercel                   # link + first deploy
vercel env add REPLICATE_API_TOKEN     # paste token, choose Production
vercel --prod            # deploy live URL
```

## Architecture (two risky parts, solved first)
- `app/api/generate/route.ts` — serverless Replicate call. Blocks on the
  prediction (maxDuration=60), proxies audio back as a base64 mp3 data URI so the
  client has same-origin bytes AND a reusable continuation seed.
- `lib/audioEngine.ts` — `CrossfadePlayer`: lookahead scheduler that crossfades
  consecutive AudioBuffers and resyncs cleanly if the buffer runs dry.
- `lib/generator.ts` — `MusicGenerator`: sequential generate-ahead loop; feeds
  each chunk back as the next chunk's seed.
- `lib/fallback.ts` — `FallbackGenerator`: same player, pre-generated clips. Insurance.
- `lib/prompt.ts` — base prompt + instrument tags → final prompt.
- `app/page.tsx` — prompt box + instrument chips + transport + buffer meter.

## Knobs to tune live
- `CHUNK_SECONDS` (app/page.tsx) — bigger = more runway per call. Start 8, not 2.
- `MODEL_VERSION` (route.ts) — `large` is fastest; `stereo-*` is prettier but slower.
- `xfade` (audioEngine.ts) — crossfade length at the seams.
- `TARGET_QUEUE` — how many chunks to keep buffered ahead.
