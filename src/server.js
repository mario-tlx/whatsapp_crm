import express from 'express';

export function createApiRouter(deps) {
  const router = express.Router();

  const auth = (req, res, next) => {
    const token = process.env.API_TOKEN;
    const onRailway = Boolean(process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_SERVICE_ID);
    const allowOpen = process.env.ALLOW_OPEN_API === '1';
    const requireAuth = Boolean(token) || (onRailway && !allowOpen);
    if (!requireAuth) return next();
    if (!token) {
      return res.status(503).json({
        error:
          'Set API_TOKEN in Railway variables. It secures the dashboard API and the WhatsApp pairing QR. For local dev without Railway, omit Railway env vars or set ALLOW_OPEN_API=1 (not recommended).',
      });
    }
    const h = req.headers.authorization;
    const bearer = h && h.startsWith('Bearer ') ? h.slice(7) : null;
    const q = req.query.token;
    if (bearer === token || q === token) return next();
    return res.status(401).json({ error: 'Unauthorized' });
  };

  router.use(auth);

  router.get('/health', (req, res) => {
    res.json({
      ok: true,
      whatsappReady: deps.isReady(),
      whatsappQr: deps.getQr?.() ?? null,
    });
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
    res.json(
      deps.listPending({
        chatId: req.query.chatId || undefined,
        status: req.query.status || 'pending',
      })
    );
  });

  router.get('/chats', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 80, 200);
    res.json(deps.listChats({ limit }));
  });

  router.post('/chats/:chatId/send', async (req, res) => {
    try {
      const text = req.body?.text ?? req.body?.message;
      await deps.sendChatMessage(req.params.chatId, text);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: String(e.message || e) });
    }
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
