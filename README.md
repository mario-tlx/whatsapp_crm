# WhatsApp archive + configurable AI agent (RAG-style)

Node service using [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js) to sync messages into SQLite, embed them with OpenAI, and draft replies. You control **when** the bot sends on its own versus when it queues a draft for your approval (with optional edit before send).

## Features

- **Message store**: Every `message_create` event is upserted into SQLite (`messages` table) with text, chat id, direction, timestamp.
- **Embeddings (RAG-style)**: Inbound/outbound text is embedded (`text-embedding-3-small` by default). For each new inbound message, the app retrieves your **past replies in that same chat** with highest cosine similarity and passes them to the model so it can mirror your wording when questions are similar.
- **Agent modes** (`agent_config` table, editable via API/dashboard):
  - `off` — no AI replies.
  - `approval` — always queue draft; you approve or edit in the dashboard.
  - `autonomous` — send immediately unless the message matches **approval keywords**.
  - `hybrid` — send if **autonomous keywords** match; otherwise queue. **Approval keywords** always force a queue.
- **HTTP API** under `/api/*` (optional `API_TOKEN` via `Authorization: Bearer …` or `?token=`).
- **Web dashboard** at `/` for config and pending replies.

## Environment

Copy `.env.example` to `.env` and set:

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes for AI | Embeddings + chat completions |
| `API_TOKEN` | Recommended in production | Protects `/api/*` |
| `PORT` | No | Default `3000` |
| `DATA_ROOT` | No | Folder for `app.db` and `.wwebjs_auth` (Dockerfile uses `/data`) |
| `DATABASE_PATH` | No | Overrides default `$DATA_ROOT/app.db` |
| `PUPPETEER_EXECUTABLE_PATH` | Docker/Railway | Dockerfile sets `/usr/bin/chromium` |

## Local run

```bash
npm install
npm start
```

Scan the QR printed in the terminal with **WhatsApp → Settings → Linked devices**.

## Railway

1. Create a **new service** from this repo (Dockerfile build).
2. Add variables: `OPENAI_API_KEY`, `API_TOKEN`, `PORT` (Railway sets `PORT` automatically).
3. Mount a **volume** at `/data` (matches `DATA_ROOT=/data` in the Dockerfile). Set `OPENAI_API_KEY` and `API_TOKEN`.
4. WhatsApp session files live under `/data/.wwebjs_auth`; the database defaults to `/data/app.db` unless you override `DATABASE_PATH`.

**Compliance note:** Automating WhatsApp may violate Meta’s terms of use. Use an official API (WhatsApp Business Cloud API) for production customer messaging where policy matters.

## API

- `GET /api/health` — `{ ok, whatsappReady }`
- `GET /api/config` / `PUT /api/config` — mode, keyword lists, `system_prompt_extra`
- `GET /api/pending` — queued drafts
- `POST /api/pending/:id/approve` — body `{ "editedText": "optional override" }`
- `POST /api/pending/:id/reject`
- `GET /api/messages?chatId=...&limit=...`

## Tech stack

Node 18+, Express, better-sqlite3, OpenAI SDK, whatsapp-web.js, Puppeteer/Chromium.
