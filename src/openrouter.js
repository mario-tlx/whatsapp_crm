const DEFAULT_BASE = 'https://openrouter.ai/api/v1';

async function parseErrorBody(res) {
  let text = '';
  try {
    text = await res.text();
  } catch {
    return res.statusText;
  }
  try {
    const j = JSON.parse(text);
    return j.error?.message || j.message || text || res.statusText;
  } catch {
    return text || res.statusText;
  }
}

/**
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} [opts.baseUrl]
 * @param {string} opts.model
 * @param {Array<{role:string, content:string}>} opts.messages
 * @param {number} [opts.temperature]
 * @param {number} [opts.max_tokens]
 * @returns {Promise<string>}
 */
export async function openRouterChatCompletion(opts) {
  const base = (opts.baseUrl || process.env.OPENROUTER_BASE_URL || DEFAULT_BASE).replace(/\/$/, '');
  const url = `${base}/chat/completions`;
  const body = {
    model: opts.model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.4,
    max_tokens: opts.max_tokens ?? 800,
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER || 'https://github.com',
      'X-Title': process.env.OPENROUTER_APP_TITLE || 'whatsapp-agent-rag',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const msg = await parseErrorBody(res);
    throw new Error(`OpenRouter chat: ${res.status} ${msg}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (text == null) throw new Error('OpenRouter chat: empty response');
  return String(text);
}

/**
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} [opts.baseUrl]
 * @param {string} opts.model
 * @param {string} opts.input
 * @returns {Promise<Float32Array>}
 */
export async function openRouterEmbedding(opts) {
  const base = (opts.baseUrl || process.env.OPENROUTER_BASE_URL || DEFAULT_BASE).replace(/\/$/, '');
  const url = `${base}/embeddings`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER || 'https://github.com',
      'X-Title': process.env.OPENROUTER_APP_TITLE || 'whatsapp-agent-rag',
    },
    body: JSON.stringify({
      model: opts.model,
      input: opts.input,
    }),
  });
  if (!res.ok) {
    const msg = await parseErrorBody(res);
    throw new Error(`OpenRouter embeddings: ${res.status} ${msg}`);
  }
  const data = await res.json();
  const arr = data.data?.[0]?.embedding;
  if (!Array.isArray(arr) || !arr.length) throw new Error('OpenRouter embeddings: no vector');
  return Float32Array.from(arr);
}
