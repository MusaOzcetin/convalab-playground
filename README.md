# ConvALab Prompt Playground

A small playground to test how an editable **system prompt** changes an LLM-powered chat agent.

- **Free mode (default):** Calls Gemini 2.5 Flash using the server API key and enforces quotas:
	- 5 messages per browser session (24h sliding window)
	- 20 messages per IP per day (24h sliding window)
- **BYOK mode:** Bring your own API key (OpenAI / Anthropic / Google). Stored only in `sessionStorage` (no server persistence) and **no rate limits**.

## Requirements

- Node.js 20.9+

## Environment variables

Copy the template and fill it in:

```bash
cp .env.local.example .env.local
```

Required for **Free mode**:

- `GOOGLE_GENERATIVE_AI_API_KEY` (Gemini API key)
- `FREE_QUOTA_COOKIE_SECRET` (random secret used to sign the 5-prompt free quota cookie)

Optional (enables Upstash-backed rate limits; otherwise dev falls back to in-memory limits):

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000

## Deploy (Vercel)

- Create a new Vercel project from this repo.
- Set the same environment variables in Vercel Project Settings.
- Deploy.

Notes:

- Free mode uses Google Gemini; messages may be used by Google to improve their models.
- BYOK keys are never persisted server-side.
