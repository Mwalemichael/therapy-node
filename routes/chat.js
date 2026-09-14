// routes/chat.js
const express = require('express');
const db = require('../database');
const { requireLogin } = require('../middleware/auth');
const { sendEmail, templates } = require('../email');
const { createNotification } = require('../notifications');
const router = express.Router();

function isAuthorized(userId, role, appointment) {
  return (role === 'client' && appointment.client_id === userId) ||
         (role === 'therapist' && appointment.therapist_id === userId);
}

// ─────────────────────────────────────────────
// GET CHAT MESSAGES
// ─────────────────────────────────────────────
router.get('/chat_get', requireLogin, (req, res) => {
  const { appointment_id, last_id = 0 } = req.query;
  if (!appointment_id) return res.json({ success: false, message: 'Appointment ID required' });

  const appt = db.prepare('SELECT * FROM appointments WHERE id = ?').get(appointment_id);
  if (!appt) return res.json({ success: false, message: 'Appointment not found' });
  if (!isAuthorized(req.session.user_id, req.session.role, appt)) {
    return res.json({ success: false, message: 'Forbidden' });
  }

  const messages = db.prepare(`
    SELECT m.id, m.message, m.created_at,
           (u.first_name || ' ' || u.last_name) AS sender_name,
           u.id AS sender_id
    FROM messages m
    JOIN users u ON m.sender_id = u.id
    WHERE m.appointment_id = ? AND m.id > ?
    ORDER BY m.id ASC
  `).all(appointment_id, last_id);

  res.json({ success: true, messages });
});

// ─────────────────────────────────────────────
// SEND CHAT MESSAGE
// ─────────────────────────────────────────────
router.post('/chat_send', requireLogin, (req, res) => {
  const { appointment_id, message } = req.body;
  if (!appointment_id || !message) {
    return res.json({ success: false, message: 'Required fields missing' });
  }

  const appt = db.prepare('SELECT * FROM appointments WHERE id = ?').get(appointment_id);
  if (!appt) return res.json({ success: false, message: 'Appointment not found' });
  if (!isAuthorized(req.session.user_id, req.session.role, appt)) {
    return res.json({ success: false, message: 'Forbidden' });
  }

  const trimmed = message.trim();
  db.prepare('INSERT INTO messages (appointment_id, sender_id, message) VALUES (?, ?, ?)')
    .run(appointment_id, req.session.user_id, trimmed);

  // Notify the other party
  const otherId = req.session.user_id === appt.client_id ? appt.therapist_id : appt.client_id;
  const sender = db.prepare('SELECT first_name, last_name FROM users WHERE id = ?')
    .get(req.session.user_id);
  const senderName = `${sender.first_name} ${sender.last_name}`;
  const recipient = db.prepare('SELECT email, first_name FROM users WHERE id = ?').get(otherId);

  const preview = trimmed.length > 60 ? trimmed.substring(0, 60) + '…' : trimmed;

  createNotification(
    otherId,
    'new_message',
    'New message',
    `${senderName}: ${preview}`,
    '/dashboard'
  );

  // Rate-limit emails — 1 per appointment per recipient per 10 minutes
  const key = `chatmail_${otherId}_${appointment_id}`;
  const now = Date.now();
  if (!global[key] || now - global[key] > 10 * 60 * 1000) {
    global[key] = now;
    if (recipient) {
      sendEmail({
        to: recipient.email,
        ...templates.newMessage(recipient.first_name, senderName, trimmed.substring(0, 200))
      }).catch(() => {});
    }
  }

  res.json({ success: true, message: 'Message sent' });
});

// ─────────────────────────────────────────────
// GET SESSION NOTES
// ─────────────────────────────────────────────
router.get('/notes_get', requireLogin, (req, res) => {
  const { appointment_id } = req.query;
  if (!appointment_id) return res.json({ success: false, message: 'Appointment ID required' });

  const appt = db.prepare('SELECT * FROM appointments WHERE id = ?').get(appointment_id);
  if (!appt) return res.json({ success: false, message: 'Appointment not found' });
  if (!isAuthorized(req.session.user_id, req.session.role, appt)) {
    return res.json({ success: false, message: 'Forbidden' });
  }

  const row = db.prepare('SELECT notes FROM session_notes WHERE appointment_id = ?').get(appointment_id);
  res.json({ success: true, notes: row ? row.notes : '' });
});

// ─────────────────────────────────────────────
// SAVE SESSION NOTES
// ─────────────────────────────────────────────
router.post('/notes_save', requireLogin, (req, res) => {
  const { appointment_id, notes } = req.body;
  if (!appointment_id) return res.json({ success: false, message: 'Appointment ID required' });

  const appt = db.prepare('SELECT * FROM appointments WHERE id = ?').get(appointment_id);
  if (!appt) return res.json({ success: false, message: 'Appointment not found' });
  if (!isAuthorized(req.session.user_id, req.session.role, appt)) {
    return res.json({ success: false, message: 'Forbidden' });
  }

  db.prepare(`
    INSERT INTO session_notes (appointment_id, notes) VALUES (?, ?)
    ON CONFLICT(appointment_id) DO UPDATE SET notes = excluded.notes, updated_at = CURRENT_TIMESTAMP
  `).run(appointment_id, notes || '');

  res.json({ success: true, message: 'Notes saved' });
});

module.exports = router;