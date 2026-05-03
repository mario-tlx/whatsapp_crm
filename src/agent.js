import { openRouterChatCompletion } from './openrouter.js';

/**
 * @param {string} apiKey - OPENROUTER_API_KEY
 * @param {string} model - e.g. openai/gpt-4o-mini
 */
export function createChatClient(apiKey, model) {
  if (!apiKey) {
    return {
      async draftReply() {
        throw new Error('OPENROUTER_API_KEY is not set');
      },
    };
  }
  return {
    async draftReply({ systemPrompt, userContent }) {
      const content = await openRouterChatCompletion({
        apiKey,
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        temperature: 0.4,
        max_tokens: 800,
      });
      return content.trim();
    },
  };
}

export function buildSystemPrompt({ chatName, styleSnippets, configExtra, similarReplies }) {
  const parts = [
    'You are drafting WhatsApp replies on behalf of the user.',
    'Match their tone: concise, same language as the customer, no markdown unless they use it.',
    'Do not invent facts (prices, dates, legal commitments). If unsure, say you will confirm.',
  ];
  if (chatName) {
    parts.push(`Conversation partner label: ${chatName}.`);
  }
  if (configExtra && configExtra.trim()) {
    parts.push(`User instructions: ${configExtra.trim()}`);
  }
  if (similarReplies && similarReplies.length) {
    parts.push(
      'Here are past replies the user sent in this chat (highest similarity first). Mirror phrasing when the question matches:'
    );
    similarReplies.forEach((s, i) => {
      parts.push(`${i + 1}. ${s}`);
    });
  }
  if (styleSnippets && styleSnippets.length) {
    parts.push('Recent message snippets from this chat for context:');
    styleSnippets.forEach((line) => parts.push(`- ${line}`));
  }
  return parts.join('\n');
}

export function buildUserPrompt({ incomingBody, recentLines }) {
  const lines = [];
  lines.push('Recent thread (oldest to newest):');
  recentLines.forEach((l) => lines.push(l));
  lines.push('');
  lines.push('Latest inbound message to answer:');
  lines.push(incomingBody || '(empty or non-text)');
  lines.push('');
  lines.push('Write one reply message only, no prefix.');
  return lines.join('\n');
}
