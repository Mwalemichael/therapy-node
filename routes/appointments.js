// routes/appointments.js
const express = require('express');
const db = require('../database');
const { requireLogin, requireRole } = require('../middleware/auth');
const router = express.Router();

router.get('/get_appointments', requireLogin, (req, res) => {
  const userId = req.session.user_id;
  const role = req.session.role;
  const status = req.query.status;

  let rows;
  if (role === 'client') {
    let sql = `SELECT a.id, a.date, a.time, a.status,
                      (t.first_name || ' ' || t.last_name) AS therapist_name
               FROM appointments a
               JOIN users t ON a.therapist_id = t.id
               WHERE a.client_id = ?`;
    const params = [userId];
    if (status) { sql += ' AND a.status = ?'; params.push(status); }
    sql += ' ORDER BY a.date ASC, a.time ASC';
    rows = db.prepare(sql).all(...params);
  } else {
    let sql = `SELECT a.id, a.date, a.time, a.status,
                      (c.first_name || ' ' || c.last_name) AS client_name
               FROM appointments a
               JOIN users c ON a.client_id = c.id
               WHERE a.therapist_id = ?`;
    const params = [userId];
    if (status) { sql += ' AND a.status = ?'; params.push(status); }
    sql += ' ORDER BY a.date ASC, a.time ASC';
    rows = db.prepare(sql).all(...params);
  }
  res.json({ success: true, appointments: rows });
});

router.get('/get_pending_appointments', requireRole('therapist'), (req, res) => {
  const rows = db.prepare(`
    SELECT a.id, a.date, a.time, a.status,
           (c.first_name || ' ' || c.last_name) AS client_name
    FROM appointments a
    JOIN users c ON a.client_id = c.id
    WHERE a.therapist_id = ? AND a.status = 'pending'
    ORDER BY a.created_at ASC
  `).all(req.session.user_id);
  res.json({ success: true, requests: rows });
});

router.get('/get_therapists', requireLogin, (req, res) => {
  const rows = db.prepare(
    `SELECT id, (first_name || ' ' || last_name) AS name, specializations
     FROM users WHERE role = 'therapist' AND is_active = 1`
  ).all();
  rows.forEach(r => {
    r.specializations = r.specializations ? r.specializations.split(',') : [];
  });
  res.json(rows);
});

router.post('/book_appointment', requireRole('client'), (req, res) => {
  const { therapist_id, date, time } = req.body;
  if (!therapist_id || !date || !time) {
    return res.json({ success: false, message: 'All fields required' });
  }
  const therapist = db.prepare(
    "SELECT id, availability FROM users WHERE id = ? AND role = 'therapist'"
  ).get(therapist_id);
  if (!therapist) return res.json({ success: false, message: 'Invalid therapist' });

  if (therapist.availability) {
    const availability = JSON.parse(therapist.availability);
    const dayName = new Date(date).toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    if (availability[dayName]) {
      const reqTime = time.substring(0, 5);
      const ok = availability[dayName].some(slot => {
        const [s, e] = slot.split('-');
        return reqTime >= s && reqTime <= e;
      });
      if (!ok) return res.json({ success: false, message: 'Therapist not available at that time' });
    }
  }

  db.prepare(
    "INSERT INTO appointments (client_id, therapist_id, date, time, status) VALUES (?, ?, ?, ?, 'pending')"
  ).run(req.session.user_id, therapist_id, date, time);

  res.json({ success: true, message: 'Appointment requested successfully' });
});

router.post('/confirm_appointment', requireRole('therapist'), (req, res) => {
  const { id } = req.body;
  if (!id) return res.json({ success: false, message: 'ID required' });
  const appt = db.prepare(
    "SELECT id FROM appointments WHERE id = ? AND therapist_id = ? AND status = 'pending'"
  ).get(id, req.session.user_id);
  if (!appt) return res.json({ success: false, message: 'Not found or already handled' });
  db.prepare("UPDATE appointments SET status = 'confirmed' WHERE id = ?").run(id);
  res.json({ success: true, message: 'Appointment confirmed' });
});

router.post('/deny_appointment', requireRole('therapist'), (req, res) => {
  const { id } = req.body;
  if (!id) return res.json({ success: false, message: 'ID required' });
  const appt = db.prepare(
    "SELECT id FROM appointments WHERE id = ? AND therapist_id = ? AND status = 'pending'"
  ).get(id, req.session.user_id);
  if (!appt) return res.json({ success: false, message: 'Not found or already handled' });
  db.prepare("UPDATE appointments SET status = 'denied' WHERE id = ?").run(id);
  res.json({ success: true, message: 'Appointment denied' });
});

router.post('/cancel_appointment', requireLogin, (req, res) => {
  const { id } = req.body;
  if (!id) return res.json({ success: false, message: 'ID required' });
  const appt = db.prepare(
    'SELECT status FROM appointments WHERE id = ? AND (client_id = ? OR therapist_id = ?)'
  ).get(id, req.session.user_id, req.session.user_id);
  if (!appt) return res.json({ success: false, message: 'Not found or not authorized' });
  if (['denied', 'completed'].includes(appt.status)) {
    return res.json({ success: false, message: 'Cannot cancel this appointment' });
  }
  db.prepare("UPDATE appointments SET status = 'denied' WHERE id = ?").run(id);
  res.json({ success: true, message: 'Appointment cancelled' });
});

router.post('/complete_appointment', requireRole('therapist'), (req, res) => {
  const { id } = req.body;
  if (!id) return res.json({ success: false, message: 'ID required' });
  const appt = db.prepare(
    "SELECT id FROM appointments WHERE id = ? AND therapist_id = ? AND status = 'confirmed'"
  ).get(id, req.session.user_id);
  if (!appt) return res.json({ success: false, message: 'Not found or not confirmed' });
  db.prepare("UPDATE appointments SET status = 'completed' WHERE id = ?").run(id);
  res.json({ success: true, message: 'Marked as completed' });
});

router.post('/submit_review', requireRole('client'), (req, res) => {
  const { appointment_id, rating, review } = req.body;
  const r = parseInt(rating, 10);
  if (!appointment_id || !r || r < 1 || r > 5) {
    return res.json({ success: false, message: 'Valid appointment ID and rating required' });
  }
  const appt = db.prepare(
    "SELECT therapist_id FROM appointments WHERE id = ? AND client_id = ? AND status = 'completed'"
  ).get(appointment_id, req.session.user_id);
  if (!appt) return res.json({ success: false, message: 'Not found or not completed' });

  const existing = db.prepare('SELECT id FROM reviews WHERE appointment_id = ?').get(appointment_id);
  if (existing) return res.json({ success: false, message: 'Already reviewed' });

  db.prepare(
    'INSERT INTO reviews (appointment_id, client_id, therapist_id, rating, review) VALUES (?, ?, ?, ?, ?)'
  ).run(appointment_id, req.session.user_id, appt.therapist_id, r, review || '');

  res.json({ success: true, message: 'Thank you for your review!' });
});

module.exports = router;