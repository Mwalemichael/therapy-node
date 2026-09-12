// routes/user.js
const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../database');
const { requireLogin } = require('../middleware/auth');
const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `user_${req.session.user_id}_${Date.now()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Invalid file type'));
  }
});

router.get('/get_user_data', requireLogin, (req, res) => {
  const user = db.prepare(
    'SELECT id, first_name, last_name, email, phone, role, is_verified, profile_picture, specializations, availability FROM users WHERE id = ?'
  ).get(req.session.user_id);
  if (!user) return res.json({ success: false, message: 'User not found' });

  const data = {
    success: true,
    role: user.role,
    user: {
      id: Number(user.id),
      name: `${user.first_name} ${user.last_name}`,
      email: user.email,
      phone: user.phone || '',
      initials: (user.first_name[0] + user.last_name[0]).toUpperCase(),
      profile_picture: user.profile_picture || null,
      specializations: user.specializations || '',
      availability: user.availability ? JSON.parse(user.availability) : null
    }
  };

  if (req.query.all == 1) {
    if (user.role === 'client') {
      data.appointments = db.prepare(`
        SELECT a.id, a.date, a.time, a.status,
               (t.first_name || ' ' || t.last_name) AS therapist_name
        FROM appointments a
        JOIN users t ON a.therapist_id = t.id
        WHERE a.client_id = ?
        ORDER BY a.date ASC, a.time ASC
      `).all(user.id);
    } else if (user.role === 'therapist') {
      data.appointments = db.prepare(`
        SELECT a.id, a.date, a.time, a.status,
               (c.first_name || ' ' || c.last_name) AS client_name
        FROM appointments a
        JOIN users c ON a.client_id = c.id
        WHERE a.therapist_id = ?
        ORDER BY a.date ASC, a.time ASC
      `).all(user.id);
    }
  }
  res.json(data);
});

router.post('/update_profile', requireLogin, (req, res) => {
  const { first_name, last_name, email, phone, specializations, availability } = req.body;
  if (!first_name || !last_name || !email) {
    return res.json({ success: false, message: 'Required fields missing' });
  }
  const conflict = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?')
    .get(email, req.session.user_id);
  if (conflict) return res.json({ success: false, message: 'Email already in use' });

  if (req.session.role === 'therapist') {
    if (availability) {
      try { JSON.parse(availability); }
      catch (e) { return res.json({ success: false, message: 'Invalid availability JSON' }); }
    }
    db.prepare(
      'UPDATE users SET first_name = ?, last_name = ?, email = ?, phone = ?, specializations = ?, availability = ? WHERE id = ?'
    ).run(first_name, last_name, email, phone || '', specializations || null, availability || null, req.session.user_id);
  } else {
    db.prepare(
      'UPDATE users SET first_name = ?, last_name = ?, email = ?, phone = ? WHERE id = ?'
    ).run(first_name, last_name, email, phone || '', req.session.user_id);
  }
  res.json({ success: true, message: 'Profile updated successfully' });
});

router.post('/change_password', requireLogin, (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;
  if (!current_password || !new_password || !confirm_password) {
    return res.json({ success: false, message: 'All fields required' });
  }
  if (new_password !== confirm_password) {
    return res.json({ success: false, message: 'Passwords do not match' });
  }
  if (new_password.length < 6) {
    return res.json({ success: false, message: 'Min 6 characters' });
  }
  const user = db.prepare('SELECT password FROM users WHERE id = ?').get(req.session.user_id);
  if (!bcrypt.compareSync(current_password, user.password)) {
    return res.json({ success: false, message: 'Current password incorrect' });
  }
  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, req.session.user_id);
  res.json({ success: true, message: 'Password changed successfully' });
});

router.post('/upload_profile_picture', requireLogin, upload.single('profile_picture'), (req, res) => {
  if (!req.file) return res.json({ success: false, message: 'No file uploaded' });
  const old = db.prepare('SELECT profile_picture FROM users WHERE id = ?').get(req.session.user_id);
  if (old && old.profile_picture) {
    const oldPath = path.join(__dirname, '..', 'uploads', old.profile_picture);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }
  db.prepare('UPDATE users SET profile_picture = ? WHERE id = ?')
    .run(req.file.filename, req.session.user_id);
  res.json({
    success: true,
    message: 'Profile picture updated',
    filename: req.file.filename,
    url: '/uploads/' + req.file.filename
  });
});

module.exports = router;