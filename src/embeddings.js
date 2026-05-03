import OpenAI from 'openai';

export function createEmbeddingClient(apiKey, model) {
  if (!apiKey) {
    return {
      async embed() {
        throw new Error('OPENAI_API_KEY is not set');
      },
    };
  }
  const client = new OpenAI({ apiKey });
  return {
    async embed(text) {
      const input = (text || '').slice(0, 8000);
      const res = await client.embeddings.create({ model, input });
      const arr = res.data[0]?.embedding;
      if (!arr) throw new Error('No embedding returned');
      return Float32Array.from(arr);
    },
  };
}
