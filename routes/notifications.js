// routes/notifications.js
const express = require('express');
const db = require('../database');
const { requireLogin } = require('../middleware/auth');
const router = express.Router();

router.get('/notifications_list', requireLogin, (req, res) => {
  const rows = db.prepare(`
    SELECT id, type, title, message, link, is_read, created_at
    FROM notifications WHERE user_id = ?
    ORDER BY created_at DESC LIMIT 50
  `).all(req.session.user_id);
  res.json({ success: true, notifications: rows });
});

router.get('/notifications_count', requireLogin, (req, res) => {
  const row = db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0')
    .get(req.session.user_id);
  res.json({ success: true, count: row ? row.c : 0 });
});

router.post('/notifications_read', requireLogin, (req, res) => {
  const { id } = req.body;
  if (!id) return res.json({ success: false, message: 'ID required' });
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?')
    .run(id, req.session.user_id);
  res.json({ success: true });
});

router.post('/notifications_read_all', requireLogin, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.session.user_id);
  res.json({ success: true, message: 'All marked as read' });
});

router.post('/notifications_delete', requireLogin, (req, res) => {
  const { id } = req.body;
  if (!id) return res.json({ success: false, message: 'ID required' });
  db.prepare('DELETE FROM notifications WHERE id = ? AND user_id = ?').run(id, req.session.user_id);
  res.json({ success: true });
});

// ─── Push subscription endpoints ───
router.get('/push_public_key', requireLogin, (req, res) => {
  res.json({ success: true, publicKey: process.env.VAPID_PUBLIC_KEY || '' });
});

router.post('/push_subscribe', requireLogin, (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
    return res.json({ success: false, message: 'Invalid subscription' });
  }
  try {
    db.prepare(`
      INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, endpoint) DO UPDATE SET
        p256dh = excluded.p256dh,
        auth = excluded.auth
    `).run(req.session.user_id, endpoint, keys.p256dh, keys.auth);
    res.json({ success: true, message: 'Subscribed to push notifications' });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

router.post('/push_unsubscribe', requireLogin, (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.json({ success: false, message: 'Endpoint required' });
  db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?')
    .run(req.session.user_id, endpoint);
  res.json({ success: true });
});

module.exports = router;