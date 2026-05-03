# WhatsApp archive + configurable AI agent (RAG-style)

Node service using [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js) to sync messages into SQLite, embed them via **[OpenRouter](https://openrouter.ai/)** (embeddings + chat over HTTP), and draft replies. You control **when** the bot sends on its own versus when it queues a draft for your approval (with optional edit before send).

## Railway-only workflow (no local run)

1. **Create a Railway project** from this repo and use the **Dockerfile** (default when `Dockerfile` is present).
2. **Add a volume**: create a volume and mount it at **`/data`** on the service. The image sets `DATA_ROOT=/data`, so both **`app.db`** and **`.wwebjs_auth`** (WhatsApp session) persist across deploys.
3. **Set variables** in Railway:
   - **`OPENROUTER_API_KEY`** — from [OpenRouter keys](https://openrouter.ai/keys); required for embeddings and reply drafts.
   - **`API_TOKEN`** — **required on Railway**: a long random secret. The dashboard stores it in your browser and sends `Authorization: Bearer …` to `/api/*`. Without it, the API returns 503 so the pairing QR and your chats are not exposed publicly.
   - **`PORT`** — Railway injects this automatically; do not override unless you know what you are doing.
4. **Deploy**, open your Railway **public URL** (root `/`).
5. In the **Connection** section, paste **`API_TOKEN`** → **Save token**. When WhatsApp needs pairing, a **QR image** appears there; scan with **WhatsApp → Settings → Linked devices → Link a device**.
6. Use **Agent configuration** and **Pending replies** on the same page.

Optional: **`ALLOW_OPEN_API=1`** disables the Railway requirement for `API_TOKEN` (not recommended on a public URL).

## How to verify which commit Railway is running

After deploy, open **`https://<your-service>.up.railway.app/version`** (no API token needed). You should see JSON including:

- **`gitCommitSha`** — full SHA when Railway sets `RAILWAY_GIT_COMMIT_SHA` (GitHub-triggered deploys), or **`gitCommitShaShort`** (first 7 chars) for a quick compare to `git log`.
- **`gitBranch`** — branch that triggered the deploy, when available.
- **`railwayDeploymentId`** — Railway’s deployment id.

The Docker build also passes **`ARG RAILWAY_GIT_COMMIT_SHA`** into **`DEPLOY_GIT_SHA`** so the SHA is visible even when only the build receives Railway’s git args.

**In the Railway UI:** open the deployment → **Build logs** or **Deploy logs**; the image build usually prints the cloned commit, and this app logs `Deploy revision: git=...` on startup.

**Common mismatch:** the service deploy branch does not match the branch where you committed fixes — merge to `main` or point Railway at the correct branch, then redeploy.

## Features

- **Message store**: Messages seen while the client runs are stored in SQLite.
- **Embeddings (RAG-style)**: Text is embedded; drafts use your **past replies in the same chat** with highest similarity plus recent thread lines.
- **Agent modes**: `off`, `approval`, `autonomous`, `hybrid` with keyword lists (see earlier sections in code / `policy.js`).
- **Web UI** at `/` — QR when needed, health, config, pending approvals, message peek by `chatId`.

## Environment

| Variable | Description |
|----------|-------------|
| `OPENROUTER_API_KEY` | [OpenRouter](https://openrouter.ai/) API key |
| `OPENROUTER_CHAT_MODEL` | Default `openai/gpt-4o-mini` — any [OpenRouter chat model](https://openrouter.ai/models) |
| `OPENROUTER_EMBEDDING_MODEL` | Default `openai/text-embedding-3-small` — must support embeddings on OpenRouter |
| `OPENROUTER_BASE_URL` | Optional; default `https://openrouter.ai/api/v1` |
| `API_TOKEN` | **Set on Railway** — secures `/api/*` and QR in the UI |
| `DATA_ROOT` | Data directory (Dockerfile: `/data`) |
| `DATABASE_PATH` | Override DB path (default `$DATA_ROOT/app.db`) |
| `ALLOW_OPEN_API` | Set to `1` only if you accept an open API (e.g. local dev) |
| `PUPPETEER_EXECUTABLE_PATH` | Set in Docker image to Chromium |

## Local run (optional)

```bash
npm install
npm start
```

Without Railway env vars you can omit `API_TOKEN` for quick testing; for anything reachable from the internet, always set `API_TOKEN`.

**Compliance note:** Automating WhatsApp may violate Meta’s terms of use. Use an official API (WhatsApp Business Cloud API) for production customer messaging where policy matters.

## API

All under `/api/*` (Bearer token or `?token=` when `API_TOKEN` is set).

- `GET /api/health` — `{ ok, whatsappReady, whatsappQr? }` (`whatsappQr` has `dataUrl` for the pairing image when needed)
- `GET` / `PUT /api/config`
- `GET /api/chats?limit=...` — recent private chats with `pending_count`
- `GET /api/pending?chatId=...&status=pending` — filter drafts by chat
- `POST /api/chats/:chatId/send` — body `{ "text": "..." }` send your own message
- `GET /api/messages?chatId=...`

## Tech stack

Node 18+, Express, better-sqlite3, OpenRouter (fetch), whatsapp-web.js, Puppeteer/Chromium.
