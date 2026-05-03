import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function openDatabase(dbPath) {
  ensureDir(dbPath);
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wa_message_id TEXT UNIQUE,
      chat_id TEXT NOT NULL,
      chat_name TEXT,
      from_me INTEGER NOT NULL DEFAULT 0,
      author_id TEXT,
      body TEXT,
      type TEXT,
      timestamp INTEGER NOT NULL,
      raw_json TEXT,
      embedding_model TEXT,
      embedding BLOB,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id);
    CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages(timestamp);

    CREATE TABLE IF NOT EXISTS agent_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      mode TEXT NOT NULL DEFAULT 'approval',
      autonomous_keywords TEXT,
      approval_keywords TEXT,
      system_prompt_extra TEXT,
      updated_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS pending_replies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      wa_message_id TEXT,
      incoming_body TEXT,
      draft_body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER DEFAULT (unixepoch())
    );
  `);

  const row = db.prepare('SELECT COUNT(*) AS c FROM agent_config WHERE id = 1').get();
  if (row.c === 0) {
    db.prepare(
      `INSERT INTO agent_config (id, mode, autonomous_keywords, approval_keywords, system_prompt_extra)
       VALUES (1, 'approval', 'urgent|asap|emergency', 'contract|invoice|legal|payment', '')`
    ).run();
  }

  return db;
}

export function upsertMessage(db, row) {
  const stmt = db.prepare(`
    INSERT INTO messages (wa_message_id, chat_id, chat_name, from_me, author_id, body, type, timestamp, raw_json)
    VALUES (@wa_message_id, @chat_id, @chat_name, @from_me, @author_id, @body, @type, @timestamp, @raw_json)
    ON CONFLICT(wa_message_id) DO UPDATE SET
      chat_name = excluded.chat_name,
      body = excluded.body,
      type = excluded.type,
      raw_json = excluded.raw_json
  `);
  stmt.run(row);
}

export function getAgentConfig(db) {
  return db.prepare('SELECT * FROM agent_config WHERE id = 1').get();
}

export function setAgentConfig(db, patch) {
  const cur = getAgentConfig(db);
  const next = {
    mode: patch.mode ?? cur.mode,
    autonomous_keywords: patch.autonomous_keywords ?? cur.autonomous_keywords,
    approval_keywords: patch.approval_keywords ?? cur.approval_keywords,
    system_prompt_extra: patch.system_prompt_extra ?? cur.system_prompt_extra,
  };
  db.prepare(
    `UPDATE agent_config SET
      mode = @mode,
      autonomous_keywords = @autonomous_keywords,
      approval_keywords = @approval_keywords,
      system_prompt_extra = @system_prompt_extra,
      updated_at = unixepoch()
     WHERE id = 1`
  ).run(next);
  return getAgentConfig(db);
}

export function addPendingReply(db, { chatId, waMessageId, incomingBody, draftBody, status = 'pending' }) {
  const r = db
    .prepare(
      `INSERT INTO pending_replies (chat_id, wa_message_id, incoming_body, draft_body, status)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(chatId, waMessageId ?? null, incomingBody ?? null, draftBody, status);
  return r.lastInsertRowid;
}

export function listPendingReplies(db, { status, chatId } = {}) {
  let sql = 'SELECT * FROM pending_replies WHERE 1=1';
  const args = [];
  if (status) {
    sql += ' AND status = ?';
    args.push(status);
  }
  if (chatId) {
    sql += ' AND chat_id = ?';
    args.push(chatId);
  }
  sql += ' ORDER BY id DESC LIMIT 100';
  return db.prepare(sql).all(...args);
}

/** Chats with recent activity (private chats only by default). */
export function listChats(db, { limit = 80, excludeGroups = true } = {}) {
  const lim = Math.min(Number(limit) || 80, 200);
  let sql = `
    SELECT m.chat_id AS chat_id,
           (SELECT x.chat_name FROM messages x
            WHERE x.chat_id = m.chat_id AND x.chat_name IS NOT NULL AND TRIM(x.chat_name) != ''
            ORDER BY x.timestamp DESC LIMIT 1) AS chat_name,
           MAX(m.timestamp) AS last_message_at,
           COUNT(*) AS message_count
    FROM messages m
    WHERE m.body IS NOT NULL AND TRIM(m.body) != ''
  `;
  if (excludeGroups) {
    sql += ` AND m.chat_id NOT LIKE '%@g.us'`;
  }
  sql += ` GROUP BY m.chat_id ORDER BY last_message_at DESC LIMIT ?`;
  const rows = db.prepare(sql).all(lim);
  const pendingRows = db
    .prepare(
      `SELECT chat_id, COUNT(*) AS c FROM pending_replies WHERE status = 'pending' GROUP BY chat_id`
    )
    .all();
  const pendingMap = Object.fromEntries(pendingRows.map((r) => [r.chat_id, r.c]));
  return rows.map((row) => ({
    ...row,
    pending_count: pendingMap[row.chat_id] ?? 0,
  }));
}

export function updatePendingReply(db, id, { draftBody, status }) {
  const sets = [];
  const vals = [];
  if (draftBody !== undefined) {
    sets.push('draft_body = ?');
    vals.push(draftBody);
  }
  if (status !== undefined) {
    sets.push('status = ?');
    vals.push(status);
  }
  if (!sets.length) return;
  vals.push(id);
  db.prepare(`UPDATE pending_replies SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export function getRecentMessages(db, chatId, limit = 40) {
  return db
    .prepare(
      `SELECT from_me, body, timestamp FROM messages
       WHERE chat_id = ? AND body IS NOT NULL AND TRIM(body) != ''
       ORDER BY timestamp DESC LIMIT ?`
    )
    .all(chatId, limit)
    .reverse();
}

export function findSimilarUserReply(db, chatId, embeddingBytes, limit = 3) {
  if (!embeddingBytes) return [];
  const all = db
    .prepare(
      `SELECT body, embedding FROM messages
       WHERE chat_id = ? AND from_me = 1 AND embedding IS NOT NULL AND body IS NOT NULL`
    )
    .all(chatId);
  const query = bufferToFloat32(embeddingBytes);
  const scored = all
    .map((row) => ({
      body: row.body,
      score: cosineSimilarity(query, bufferToFloat32(row.embedding)),
    }))
    .filter((x) => Number.isFinite(x.score))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored;
}

function bufferToFloat32(buf) {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

function cosineSimilarity(a, b) {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export function setMessageEmbedding(db, waMessageId, model, embeddingFloat32) {
  const buf = Buffer.from(embeddingFloat32.buffer, embeddingFloat32.byteOffset, embeddingFloat32.byteLength);
  db.prepare(
    `UPDATE messages SET embedding = ?, embedding_model = ? WHERE wa_message_id = ?`
  ).run(buf, model, waMessageId);
}

export function getMessageByWaId(db, waMessageId) {
  return db.prepare('SELECT * FROM messages WHERE wa_message_id = ?').get(waMessageId);
}
