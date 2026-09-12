// routes/admin.js
const express = require('express');
const db = require('../database');
const { requireLogin, requireRole } = require('../middleware/auth');
const router = express.Router();

// ---------- User management ----------
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
  if (user_id == req.session.user_id) {
    return res.json({ success: false, message: 'You cannot disable your own account' });
  }
  const status = action === 'enable' ? 1 : 0;
  db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(status, user_id);
  res.json({ success: true, message: `User ${action}d` });
});

// ---------- Promote / Demote admins ----------
router.post('/admin_promote_user', requireRole('admin'), (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.json({ success: false, message: 'User ID required' });

  const user = db.prepare('SELECT id, role FROM users WHERE id = ?').get(user_id);
  if (!user) return res.json({ success: false, message: 'User not found' });
  if (user.role === 'admin') return res.json({ success: false, message: 'User is already an admin' });

  db.prepare("UPDATE users SET role = 'admin', is_verified = 1 WHERE id = ?").run(user_id);
  res.json({ success: true, message: 'User promoted to admin' });
});

router.post('/admin_demote_user', requireRole('admin'), (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.json({ success: false, message: 'User ID required' });
  if (user_id == req.session.user_id) {
    return res.json({ success: false, message: 'You cannot demote yourself' });
  }

  const user = db.prepare('SELECT id, role FROM users WHERE id = ?').get(user_id);
  if (!user) return res.json({ success: false, message: 'User not found' });
  if (user.role !== 'admin') return res.json({ success: false, message: 'User is not an admin' });

  // Ensure at least one admin remains
  const adminCount = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get().c;
  if (adminCount <= 1) {
    return res.json({ success: false, message: 'Cannot demote the last remaining admin' });
  }

  db.prepare("UPDATE users SET role = 'client' WHERE id = ?").run(user_id);
  res.json({ success: true, message: 'Admin demoted to client' });
});

// ---------- Reports ----------
router.get('/admin_get_reports', requireRole('admin'), (req, res) => {
  const clients = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'client'").get().c;
  const therapists = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'therapist'").get().c;
  const admins = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get().c;
  const appointments = db.prepare('SELECT COUNT(*) AS c FROM appointments').get().c;
  res.json({
    success: true,
    total_clients: clients,
    total_therapists: therapists,
    total_admins: admins,
    total_appointments: appointments
  });
});

// ---------- Resources ----------
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