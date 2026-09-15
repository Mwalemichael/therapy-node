// routes/messages.js
const express = require('express');
const db = require('../database');
const { requireLogin } = require('../middleware/auth');
const { createNotification } = require('../notifications');
const router = express.Router();

router.get('/dm_conversations', requireLogin, (req, res) => {
  const userId = req.session.user_id;
  const role = req.session.role;

  let contacts;
  if (role === 'client') {
    contacts = db.prepare(`
      SELECT DISTINCT u.id, (u.first_name || ' ' || u.last_name) AS name,
             u.role, u.profile_picture
      FROM appointments a
      JOIN users u ON a.therapist_id = u.id
      WHERE a.client_id = ?
      ORDER BY u.first_name ASC
    `).all(userId);
  } else if (role === 'therapist') {
    contacts = db.prepare(`
      SELECT DISTINCT u.id, (u.first_name || ' ' || u.last_name) AS name,
             u.role, u.profile_picture
      FROM appointments a
      JOIN users u ON a.client_id = u.id
      WHERE a.therapist_id = ?
      ORDER BY u.first_name ASC
    `).all(userId);
  } else {
    contacts = db.prepare(`
      SELECT id, (first_name || ' ' || last_name) AS name, role, profile_picture
      FROM users WHERE id != ? AND is_active = 1
      ORDER BY first_name ASC
    `).all(userId);
  }

  const lastStmt = db.prepare(`
    SELECT message, created_at, sender_id
    FROM direct_messages
    WHERE (sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)
    ORDER BY created_at DESC LIMIT 1
  `);
  const unreadStmt = db.prepare(`
    SELECT COUNT(*) AS c FROM direct_messages
    WHERE sender_id = ? AND recipient_id = ? AND is_read = 0
  `);

  contacts.forEach(c => {
    const last = lastStmt.get(userId, c.id, c.id, userId);
    const unread = unreadStmt.get(c.id, userId).c;
    c.last_message = last ? last.message : null;
    c.last_at = last ? last.created_at : null;
    c.last_from_me = last ? last.sender_id === userId : false;
    c.unread = unread;
  });

  contacts.sort((a, b) => {
    if (!a.last_at && !b.last_at) return a.name.localeCompare(b.name);
    if (!a.last_at) return 1;
    if (!b.last_at) return -1;
    return new Date(b.last_at) - new Date(a.last_at);
  });

  res.json({ success: true, contacts });
});

router.get('/dm_thread', requireLogin, (req, res) => {
  const userId = req.session.user_id;
  const otherId = parseInt(req.query.with_user_id, 10);
  const lastId = parseInt(req.query.last_id || '0', 10);

  if (!otherId) return res.json({ success: false, message: 'with_user_id required' });

  const messages = db.prepare(`
    SELECT m.id, m.sender_id, m.recipient_id, m.message, m.is_read, m.created_at,
           (u.first_name || ' ' || u.last_name) AS sender_name
    FROM direct_messages m
    JOIN users u ON m.sender_id = u.id
    WHERE ((m.sender_id = ? AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = ?))
      AND m.id > ?
    ORDER BY m.id ASC
  `).all(userId, otherId, otherId, userId, lastId);

  res.json({ success: true, messages });
});

router.post('/dm_send', requireLogin, (req, res) => {
  const senderId = req.session.user_id;
  const { recipient_id, message } = req.body;

  if (!recipient_id || !message || !message.trim()) {
    return res.json({ success: false, message: 'recipient_id and message required' });
  }

  const recipient = db.prepare('SELECT id, first_name FROM users WHERE id = ? AND is_active = 1').get(recipient_id);
  if (!recipient) return res.json({ success: false, message: 'Recipient not found' });

  const text = message.trim();
  const info = db.prepare(`
    INSERT INTO direct_messages (sender_id, recipient_id, message)
    VALUES (?, ?, ?)
  `).run(senderId, recipient_id, text);

  const sender = db.prepare('SELECT first_name, last_name FROM users WHERE id = ?').get(senderId);
  const senderName = `${sender.first_name} ${sender.last_name}`;
  const preview = text.length > 60 ? text.substring(0, 60) + '…' : text;
  createNotification(recipient_id, 'new_message', 'New message',
    `${senderName}: ${preview}`, '/dashboard');

  res.json({ success: true, message_id: Number(info.lastInsertRowid) });
});

router.post('/dm_mark_read', requireLogin, (req, res) => {
  const userId = req.session.user_id;
  const { with_user_id } = req.body;
  if (!with_user_id) return res.json({ success: false, message: 'with_user_id required' });

  db.prepare(`
    UPDATE direct_messages SET is_read = 1
    WHERE sender_id = ? AND recipient_id = ? AND is_read = 0
  `).run(with_user_id, userId);

  res.json({ success: true });
});

router.get('/dm_unread_total', requireLogin, (req, res) => {
  const row = db.prepare(`
    SELECT COUNT(*) AS c FROM direct_messages
    WHERE recipient_id = ? AND is_read = 0
  `).get(req.session.user_id);
  res.json({ success: true, count: row ? row.c : 0 });
});

module.exports = router;