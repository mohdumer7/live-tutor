# Live AI Tutor

Voice-driven AI tutor with a shared canvas. The tutor talks, draws, writes equations, plots functions, generates images, and points at things on a tldraw whiteboard while teaching — like a real human tutor scribbling on paper.

Built with LiveKit (realtime audio + data channel), Gemini 2.5 Live (voice + vision), Claude Sonnet 4.6 (deep reasoning), and tldraw (canvas).

## Repository layout

```
apps/
  web/      # Next.js 15 frontend + LiveKit token API
  agent/    # Node.js LiveKit agent worker
packages/
  schema/   # Shared Zod schemas (tools, shapes, scene digest)
  tsconfig/ # Shared tsconfig presets
```

## Quickstart

```bash
# 1. Install dependencies
pnpm install

# 2. Copy and fill in env vars
cp .env.example .env

# 3. Run everything (frontend + agent)
pnpm dev
```

Open http://localhost:3030.

## Required services

| Service | What for | Where to sign up |
|---|---|---|
| LiveKit Cloud | WebRTC audio + data channel | https://cloud.livekit.io |
| Google AI Studio | Gemini 2.5 Live (voice model) | https://aistudio.google.com |
| Anthropic | Claude Sonnet 4.6 (`think` tool) | https://console.anthropic.com |
| fal.ai | Flux Schnell image generation | https://fal.ai |

See [.env.example](.env.example) for required keys.

## Status

Phase 0 — repo skeleton. See [/Users/mohammedumer/.claude/plans/we-are-going-to-calm-karp.md](../../.claude/plans/we-are-going-to-calm-karp.md) for the full plan.
