import express from 'express';

export function createApiRouter(deps) {
  const router = express.Router();

  const auth = (req, res, next) => {
    const token = process.env.API_TOKEN;
    if (!token) return next();
    const h = req.headers.authorization;
    const bearer = h && h.startsWith('Bearer ') ? h.slice(7) : null;
    const q = req.query.token;
    if (bearer === token || q === token) return next();
    return res.status(401).json({ error: 'Unauthorized' });
  };

  router.use(auth);

  router.get('/health', (req, res) => {
    res.json({ ok: true, whatsappReady: deps.isReady() });
  });

  router.get('/config', (req, res) => {
    res.json(deps.getConfig());
  });

  router.put('/config', (req, res) => {
    try {
      const updated = deps.updateConfig(req.body || {});
      res.json(updated);
    } catch (e) {
      res.status(400).json({ error: String(e.message || e) });
    }
  });

  router.get('/pending', (req, res) => {
    res.json(deps.listPending());
  });

  router.post('/pending/:id/approve', async (req, res) => {
    try {
      await deps.approvePending(Number(req.params.id), req.body?.editedText);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: String(e.message || e) });
    }
  });

  router.post('/pending/:id/reject', (req, res) => {
    try {
      deps.rejectPending(Number(req.params.id));
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: String(e.message || e) });
    }
  });

  router.get('/messages', (req, res) => {
    const chatId = req.query.chatId;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    if (!chatId) return res.status(400).json({ error: 'chatId required' });
    res.json(deps.getRecentMessages(chatId, limit));
  });

  return router;
}
