import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import QRCode from 'qrcode';
import wwebjs from 'whatsapp-web.js';
const { Client, LocalAuth } = wwebjs;

import { openDatabase, upsertMessage, getAgentConfig, setAgentConfig, addPendingReply, listPendingReplies, updatePendingReply, getRecentMessages, findSimilarUserReply, setMessageEmbedding, getMessageByWaId } from './db.js';
import { decideReplyAction } from './policy.js';
import { createEmbeddingClient } from './embeddings.js';
import { createChatClient, buildSystemPrompt, buildUserPrompt } from './agent.js';
import { createApiRouter } from './server.js';
import cors from 'cors';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const dataRoot = process.env.DATA_ROOT || process.env.RAILWAY_VOLUME_MOUNT_PATH || '.';
const defaultDbPath = path.join(dataRoot, 'app.db');
const dbPath = process.env.DATABASE_PATH || defaultDbPath;
const port = Number(process.env.PORT) || 3000;
const openaiKey = process.env.OPENAI_API_KEY || '';
const chatModel = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';
const embedModel = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';

const db = openDatabase(dbPath);
const embedClient = createEmbeddingClient(openaiKey, embedModel);
const chatClient = createChatClient(openaiKey, chatModel);

let waReady = false;
/** @type {{ dataUrl: string | null, at: number | null }} */
let waQrState = { dataUrl: null, at: null };

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: path.join(dataRoot, '.wwebjs_auth') }),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
    ],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  },
});

function persistMessage(msg) {
  const chatId = msg.fromMe ? msg.to : msg.from;
  const waId = msg.id?._serialized || msg.id?.id;
  if (!waId || !chatId) return;

  let body = msg.body;
  if (!body && msg.type) {
    body = `[${msg.type}]`;
  }

  upsertMessage(db, {
    wa_message_id: waId,
    chat_id: chatId,
    chat_name: msg._data?.notifyName || msg._data?.pushname || null,
    from_me: msg.fromMe ? 1 : 0,
    author_id: msg.author || null,
    body: body || null,
    type: msg.type,
    timestamp: msg.timestamp * 1000,
    raw_json: JSON.stringify({ type: msg.type, hasMedia: msg.hasMedia }),
  });

  queueEmbedding(waId, body);
}

function queueEmbedding(waMessageId, body) {
  if (!openaiKey || !body || body.length < 3) return;
  setImmediate(async () => {
    try {
      const existing = getMessageByWaId(db, waMessageId);
      if (existing?.embedding) return;
      const vec = await embedClient.embed(body);
      setMessageEmbedding(db, waMessageId, embedModel, vec);
    } catch (e) {
      console.error('Embedding failed:', e.message || e);
    }
  });
}

async function buildDraftForChat(chatId, incomingBody) {
  const recent = getRecentMessages(db, chatId, 35);
  const recentLines = recent.map((m) => {
    const who = m.from_me ? 'Me' : 'Them';
    const t = new Date(m.timestamp).toISOString();
    return `[${t}] ${who}: ${m.body}`;
  });

  let incomingVec = null;
  if (openaiKey && incomingBody) {
    try {
      incomingVec = await embedClient.embed(incomingBody);
    } catch {
      incomingVec = null;
    }
  }

  const buf = incomingVec
    ? Buffer.from(incomingVec.buffer, incomingVec.byteOffset, incomingVec.byteLength)
    : null;
  const similar = buf ? findSimilarUserReply(db, chatId, buf, 4).map((x) => x.body) : [];

  const cfg = getAgentConfig(db);
  const systemPrompt = buildSystemPrompt({
    chatName: null,
    styleSnippets: recent.slice(-12).map((m) => `${m.from_me ? 'Me' : 'Them'}: ${m.body}`),
    configExtra: cfg.system_prompt_extra,
    similarReplies: similar,
  });
  const userPrompt = buildUserPrompt({ incomingBody, recentLines });
  const draft = await chatClient.draftReply({ systemPrompt, userContent: userPrompt });
  return draft;
}

async function handleInboundAgent(msg) {
  if (msg.fromMe) return;
  if (msg.from?.endsWith('@g.us')) return;
  if (!openaiKey) return;

  const cfg = getAgentConfig(db);
  if (!cfg || cfg.mode === 'off') return;

  const incoming = msg.body || '';
  if (!incoming.trim() && !msg.hasMedia) return;
  if (msg.hasMedia && !incoming.trim()) return;

  const decision = decideReplyAction(cfg, incoming);
  const chatId = msg.from;
  const waMessageId = msg.id?._serialized;

  let draft;
  try {
    draft = await buildDraftForChat(chatId, incoming);
  } catch (e) {
    console.error('Draft failed:', e.message || e);
    return;
  }
  if (!draft) return;

  if (decision.action === 'send_auto') {
    try {
      await client.sendMessage(chatId, draft);
      console.log(`Auto-sent to ${chatId} (${decision.reason})`);
    } catch (e) {
      console.error('Auto-send failed:', e.message || e);
      addPendingReply(db, {
        chatId,
        waMessageId,
        incomingBody: incoming,
        draftBody: draft,
        status: 'pending',
      });
    }
    return;
  }

  addPendingReply(db, {
    chatId,
    waMessageId,
    incomingBody: incoming,
    draftBody: draft,
    status: 'pending',
  });
  console.log(`Queued approval for ${chatId} (${decision.reason})`);
}

client.on('qr', async (qr) => {
  waReady = false;
  try {
    waQrState = {
      dataUrl: await QRCode.toDataURL(qr, { width: 280, margin: 2, errorCorrectionLevel: 'M' }),
      at: Date.now(),
    };
  } catch (e) {
    console.error('QR render failed:', e.message || e);
    waQrState = { dataUrl: null, at: Date.now() };
  }
  console.log('WhatsApp QR updated — open the web UI Connection section to scan.');
});

client.on('ready', () => {
  waReady = true;
  waQrState = { dataUrl: null, at: null };
  console.log('WhatsApp client is ready.');
});

client.on('authenticated', () => {
  console.log('WhatsApp authenticated.');
});

client.on('auth_failure', (m) => {
  waQrState = { dataUrl: null, at: null };
  console.error('Auth failure', m);
});

client.on('disconnected', (r) => {
  waReady = false;
  waQrState = { dataUrl: null, at: null };
  console.warn('Disconnected:', r);
});

client.on('message_create', async (msg) => {
  try {
    persistMessage(msg);
    if (!msg.fromMe) {
      await handleInboundAgent(msg);
    }
  } catch (e) {
    console.error('message_create handler:', e);
  }
});

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.use(
  '/api',
  createApiRouter({
    isReady: () => waReady,
    getQr: () =>
      waQrState.dataUrl ? { dataUrl: waQrState.dataUrl, generatedAt: waQrState.at } : null,
    getConfig: () => getAgentConfig(db),
    updateConfig: (body) => {
      const allowed = ['off', 'autonomous', 'approval', 'hybrid'];
      if (body.mode && !allowed.includes(body.mode)) {
        throw new Error(`mode must be one of: ${allowed.join(', ')}`);
      }
      return setAgentConfig(db, body);
    },
    listPending: () => listPendingReplies(db, { status: 'pending' }),
    getRecentMessages: (chatId, limit) => getRecentMessages(db, chatId, limit),
    approvePending: async (id, editedText) => {
      const rows = db.prepare('SELECT * FROM pending_replies WHERE id = ?').all(id);
      const row = rows[0];
      if (!row) throw new Error('Not found');
      if (row.status !== 'pending') throw new Error('Not pending');
      const text = (editedText && String(editedText).trim()) || row.draft_body;
      if (!waReady) throw new Error('WhatsApp not ready');
      await client.sendMessage(row.chat_id, text);
      updatePendingReply(db, id, { status: 'sent', draftBody: text });
    },
    rejectPending: (id) => {
      updatePendingReply(db, id, { status: 'rejected' });
    },
  })
);

app.listen(port, () => {
  console.log(`HTTP API on http://0.0.0.0:${port}`);
});

client.initialize().catch((e) => {
  console.error('WhatsApp init failed:', e);
  process.exit(1);
});
