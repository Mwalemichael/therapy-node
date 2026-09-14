// routes/appointments.js
const express = require('express');
const db = require('../database');
const { requireLogin, requireRole } = require('../middleware/auth');
const { sendEmail, templates } = require('../email');
const { createNotification } = require('../notifications');
const router = express.Router();

// ─────────────────────────────────────────────
// LIST APPOINTMENTS
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
// PENDING APPOINTMENTS (therapist)
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
// LIST THERAPISTS (for booking)
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
// BOOK APPOINTMENT
// ─────────────────────────────────────────────
router.post('/book_appointment', requireRole('client'), (req, res) => {
  const { therapist_id, date, time } = req.body;
  if (!therapist_id || !date || !time) {
    return res.json({ success: false, message: 'All fields required' });
  }

  const therapist = db.prepare(
    "SELECT id, availability, first_name, last_name, email FROM users WHERE id = ? AND role = 'therapist'"
  ).get(therapist_id);
  if (!therapist) return res.json({ success: false, message: 'Invalid therapist' });

  // Availability check
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

  // Fetch client info
  const client = db.prepare('SELECT first_name, last_name, email FROM users WHERE id = ?')
    .get(req.session.user_id);
  const clientName = `${client.first_name} ${client.last_name}`;
  const therapistName = `${therapist.first_name} ${therapist.last_name}`;

  // Notify therapist (in-app + email)
  createNotification(
    therapist_id,
    'appointment_booked',
    'New appointment request',
    `${clientName} requested ${date} at ${time}.`,
    '/dashboard'
  );
  sendEmail({
    to: therapist.email,
    ...templates.appointmentBookedTherapist(therapistName, clientName, date, time)
  }).catch(() => {});

  // Notify client (email only)
  sendEmail({
    to: client.email,
    ...templates.appointmentBookedClient(clientName, therapistName, date, time)
  }).catch(() => {});

  res.json({ success: true, message: 'Appointment requested successfully' });
});

// ─────────────────────────────────────────────
// CONFIRM APPOINTMENT (therapist)
// ─────────────────────────────────────────────
router.post('/confirm_appointment', requireRole('therapist'), (req, res) => {
  const { id } = req.body;
  if (!id) return res.json({ success: false, message: 'ID required' });

  const appt = db.prepare(
    "SELECT id FROM appointments WHERE id = ? AND therapist_id = ? AND status = 'pending'"
  ).get(id, req.session.user_id);
  if (!appt) return res.json({ success: false, message: 'Not found or already handled' });

  db.prepare("UPDATE appointments SET status = 'confirmed' WHERE id = ?").run(id);

  // Fetch details for notification/email
  const details = db.prepare(`
    SELECT a.date, a.time, a.client_id,
           (c.first_name || ' ' || c.last_name) AS client_name,
           c.email AS client_email,
           (t.first_name || ' ' || t.last_name) AS therapist_name
    FROM appointments a
    JOIN users c ON a.client_id = c.id
    JOIN users t ON a.therapist_id = t.id
    WHERE a.id = ?
  `).get(id);

  if (details) {
    createNotification(
      details.client_id,
      'appointment_confirmed',
      'Appointment confirmed',
      `Your appointment with ${details.therapist_name} on ${details.date} at ${details.time} is confirmed.`,
      '/dashboard'
    );
    sendEmail({
      to: details.client_email,
      ...templates.appointmentConfirmed(
        details.client_name,
        details.therapist_name,
        details.date,
        details.time
      )
    }).catch(() => {});
  }

  res.json({ success: true, message: 'Appointment confirmed' });
});

// ─────────────────────────────────────────────
// DENY APPOINTMENT (therapist)
// ─────────────────────────────────────────────
router.post('/deny_appointment', requireRole('therapist'), (req, res) => {
  const { id } = req.body;
  if (!id) return res.json({ success: false, message: 'ID required' });

  const appt = db.prepare(
    "SELECT id FROM appointments WHERE id = ? AND therapist_id = ? AND status = 'pending'"
  ).get(id, req.session.user_id);
  if (!appt) return res.json({ success: false, message: 'Not found or already handled' });

  db.prepare("UPDATE appointments SET status = 'denied' WHERE id = ?").run(id);

  const details = db.prepare(`
    SELECT a.date, a.time, a.client_id,
           (c.first_name || ' ' || c.last_name) AS client_name,
           c.email AS client_email,
           (t.first_name || ' ' || t.last_name) AS therapist_name
    FROM appointments a
    JOIN users c ON a.client_id = c.id
    JOIN users t ON a.therapist_id = t.id
    WHERE a.id = ?
  `).get(id);

  if (details) {
    createNotification(
      details.client_id,
      'appointment_denied',
      'Appointment not confirmed',
      `${details.therapist_name} couldn't confirm your appointment on ${details.date} at ${details.time}.`,
      '/dashboard'
    );
    sendEmail({
      to: details.client_email,
      ...templates.appointmentDenied(
        details.client_name,
        details.therapist_name,
        details.date,
        details.time
      )
    }).catch(() => {});
  }

  res.json({ success: true, message: 'Appointment denied' });
});

// ─────────────────────────────────────────────
// CANCEL APPOINTMENT (either party)
// ─────────────────────────────────────────────
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

  const details = db.prepare(`
    SELECT a.date, a.time, a.client_id, a.therapist_id,
           (c.first_name || ' ' || c.last_name) AS client_name,
           c.email AS client_email,
           (t.first_name || ' ' || t.last_name) AS therapist_name,
           t.email AS therapist_email
    FROM appointments a
    JOIN users c ON a.client_id = c.id
    JOIN users t ON a.therapist_id = t.id
    WHERE a.id = ?
  `).get(id);

  if (details) {
    const isClient = req.session.user_id === details.client_id;
    const recipientId = isClient ? details.therapist_id : details.client_id;
    const recipientName = isClient ? details.therapist_name : details.client_name;
    const recipientEmail = isClient ? details.therapist_email : details.client_email;
    const cancellerName = isClient ? details.client_name : details.therapist_name;

    createNotification(
      recipientId,
      'appointment_cancelled',
      'Appointment cancelled',
      `${cancellerName} cancelled the appointment on ${details.date} at ${details.time}.`,
      '/dashboard'
    );
    sendEmail({
      to: recipientEmail,
      ...templates.appointmentCancelled(recipientName, cancellerName, details.date, details.time)
    }).catch(() => {});
  }

  res.json({ success: true, message: 'Appointment cancelled' });
});

// ─────────────────────────────────────────────
// COMPLETE APPOINTMENT (therapist)
// ─────────────────────────────────────────────
router.post('/complete_appointment', requireRole('therapist'), (req, res) => {
  const { id } = req.body;
  if (!id) return res.json({ success: false, message: 'ID required' });

  const appt = db.prepare(
    "SELECT id FROM appointments WHERE id = ? AND therapist_id = ? AND status = 'confirmed'"
  ).get(id, req.session.user_id);
  if (!appt) return res.json({ success: false, message: 'Not found or not confirmed' });

  db.prepare("UPDATE appointments SET status = 'completed' WHERE id = ?").run(id);

  const details = db.prepare(`
    SELECT a.client_id,
           (t.first_name || ' ' || t.last_name) AS therapist_name
    FROM appointments a
    JOIN users t ON a.therapist_id = t.id
    WHERE a.id = ?
  `).get(id);

  if (details) {
    createNotification(
      details.client_id,
      'appointment_completed',
      'Session completed',
      `Your session with ${details.therapist_name} is complete. Please rate your experience.`,
      '/dashboard'
    );
  }

  res.json({ success: true, message: 'Marked as completed' });
});

// ─────────────────────────────────────────────
// SUBMIT REVIEW
// ─────────────────────────────────────────────
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

  // Notify therapist
  const therapist = db.prepare('SELECT id, email, first_name, last_name FROM users WHERE id = ?')
    .get(appt.therapist_id);
  const client = db.prepare('SELECT first_name, last_name FROM users WHERE id = ?')
    .get(req.session.user_id);

  if (therapist) {
    createNotification(
      therapist.id,
      'rating_received',
      'New rating received',
      `${client.first_name} ${client.last_name} gave you a ${r}-star rating.`,
      '/dashboard'
    );
    sendEmail({
      to: therapist.email,
      ...templates.ratingReceived(
        `${therapist.first_name} ${therapist.last_name}`,
        `${client.first_name} ${client.last_name}`,
        r,
        review || ''
      )
    }).catch(() => {});
  }

  res.json({ success: true, message: 'Thank you for your review!' });
});

module.exports = router;