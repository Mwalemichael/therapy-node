// routes/chat.js
const express = require('express');
const db = require('../database');
const { requireLogin } = require('../middleware/auth');
const router = express.Router();

function isAuthorized(userId, role, appointment) {
  return (role === 'client' && appointment.client_id === userId) ||
         (role === 'therapist' && appointment.therapist_id === userId);
}

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
  db.prepare('INSERT INTO messages (appointment_id, sender_id, message) VALUES (?, ?, ?)')
    .run(appointment_id, req.session.user_id, message.trim());
  res.json({ success: true, message: 'Message sent' });
});

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