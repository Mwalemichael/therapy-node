// routes/admin.js
const express = require('express');
const db = require('../database');
const { requireLogin, requireRole } = require('../middleware/auth');
const router = express.Router();

router.get('/admin_get_users', requireRole('admin'), (req, res) => {
  const users = db.prepare(
    'SELECT id, first_name, last_name, email, role, is_verified, is_active FROM users ORDER BY id'
  ).all();
  res.json({ success: true, users });
});

router.post('/admin_verify_therapist', requireRole('admin'), (req, res) => {
  const { id } = req.body;
  if (!id) return res.json({ success: false, message: 'User ID required' });
  const info = db.prepare("UPDATE users SET is_verified = 1 WHERE id = ? AND role = 'therapist'").run(id);
  if (info.changes) res.json({ success: true, message: 'Therapist verified' });
  else res.json({ success: false, message: 'Not found or already verified' });
});

router.post('/admin_delete_user', requireRole('admin'), (req, res) => {
  const { id } = req.body;
  if (!id) return res.json({ success: false, message: 'User ID required' });
  if (id == req.session.user_id) return res.json({ success: false, message: 'Cannot delete yourself' });
  const info = db.prepare('DELETE FROM users WHERE id = ?').run(id);
  if (info.changes) res.json({ success: true, message: 'User deleted' });
  else res.json({ success: false, message: 'User not found' });
});

router.post('/admin_toggle_user', requireRole('admin'), (req, res) => {
  const { user_id, action } = req.body;
  if (!user_id || !['enable', 'disable'].includes(action)) {
    return res.json({ success: false, message: 'Invalid request' });
  }
  const status = action === 'enable' ? 1 : 0;
  db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(status, user_id);
  res.json({ success: true, message: `User ${action}d` });
});

router.get('/admin_get_reports', requireRole('admin'), (req, res) => {
  const clients = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'client'").get().c;
  const therapists = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'therapist'").get().c;
  const appointments = db.prepare('SELECT COUNT(*) AS c FROM appointments').get().c;
  res.json({
    success: true,
    total_clients: clients,
    total_therapists: therapists,
    total_appointments: appointments
  });
});

router.get('/get_resources', requireLogin, (req, res) => {
  const resources = db.prepare(
    'SELECT id, title, description, type, url, created_at FROM resources ORDER BY created_at DESC'
  ).all();
  res.json({ success: true, resources });
});

router.post('/add_resource', requireRole('admin'), (req, res) => {
  const { title, description, type, url } = req.body;
  if (!title || !type || !url) {
    return res.json({ success: false, message: 'Title, type and URL required' });
  }
  if (!['article', 'video', 'audio', 'exercise'].includes(type)) {
    return res.json({ success: false, message: 'Invalid type' });
  }
  db.prepare(
    'INSERT INTO resources (title, description, type, url, created_by) VALUES (?, ?, ?, ?, ?)'
  ).run(title, description || '', type, url, req.session.user_id);
  res.json({ success: true, message: 'Resource added successfully' });
});

router.post('/delete_resource', requireRole('admin'), (req, res) => {
  const { id } = req.body;
  if (!id) return res.json({ success: false, message: 'Resource ID required' });
  db.prepare('DELETE FROM resources WHERE id = ?').run(id);
  res.json({ success: true, message: 'Resource deleted' });
});

module.exports = router;