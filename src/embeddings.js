import { openRouterEmbedding } from './openrouter.js';

/**
 * @param {string} apiKey - OPENROUTER_API_KEY
 * @param {string} model - OpenRouter embedding model id (e.g. openai/text-embedding-3-small)
 */
export function createEmbeddingClient(apiKey, model) {
  if (!apiKey) {
    return {
      async embed() {
        throw new Error('OPENROUTER_API_KEY is not set');
      },
    };
  }
  return {
    async embed(text) {
      const input = (text || '').slice(0, 8000);
      return openRouterEmbedding({ apiKey, model, input });
    },
  };
}
