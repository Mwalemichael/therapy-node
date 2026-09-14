// routes/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../database');
const { sendEmail, templates } = require('../email');
const { createNotification } = require('../notifications');
const router = express.Router();

const THERAPIST_REG_CODE = 'youngcolabos';

// ─────────────────────────────────────────────
// LOGIN
// ─────────────────────────────────────────────
router.post('/login', (req, res) => {
  const { email, password, role } = req.body;
  if (!email || !password) {
    return res.json({ success: false, message: 'Email and password required' });
  }
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.json({ success: false, message: 'Invalid credentials' });
  }
  if (user.role !== role) {
    return res.json({ success: false, message: 'Account role mismatch' });
  }
  if (user.is_active === 0) {
    return res.json({ success: false, message: 'Account has been disabled' });
  }
  req.session.user_id = Number(user.id);
  req.session.role = user.role;
  res.json({
    success: true,
    role: user.role,
    message: 'Login successful',
    user: {
      id: Number(user.id),
      name: `${user.first_name} ${user.last_name}`,
      email: user.email,
      phone: user.phone || '',
      initials: (user.first_name[0] + user.last_name[0]).toUpperCase()
    }
  });
});

// ─────────────────────────────────────────────
// REGISTER
// ─────────────────────────────────────────────
router.post('/register', (req, res) => {
  const { first_name, last_name, email, password, phone, role, therapist_code, specializations } = req.body;

  if (!first_name || !last_name || !email || !password) {
    return res.json({ success: false, message: 'All required fields must be filled' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.json({ success: false, message: 'Invalid email' });
  }
  if (!['client', 'therapist'].includes(role)) {
    return res.json({ success: false, message: 'Invalid role. Admin accounts cannot be self-registered.' });
  }
  if (role === 'therapist' && therapist_code !== THERAPIST_REG_CODE) {
    return res.json({ success: false, message: 'Invalid therapist code' });
  }
  if (password.length < 6) {
    return res.json({ success: false, message: 'Password must be at least 6 characters' });
  }
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (exists) return res.json({ success: false, message: 'Email already registered' });

  const specs = (role === 'therapist' && specializations)
    ? (Array.isArray(specializations) ? specializations.join(',') : specializations)
    : null;
  const hash = bcrypt.hashSync(password, 10);
  const is_verified = role === 'therapist' ? 1 : 0;

  const info = db.prepare(
    `INSERT INTO users (first_name, last_name, email, password, phone, role, is_verified, specializations)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(first_name, last_name, email, hash, phone || '', role, is_verified, specs);

  const userId = Number(info.lastInsertRowid);
  req.session.user_id = userId;
  req.session.role = role;

  // Welcome email (fire and forget)
  sendEmail({
    to: email,
    ...templates.welcome(`${first_name} ${last_name}`, role)
  }).catch(() => {});

  // Notify admins about new therapist
  if (role === 'therapist') {
    const admins = db.prepare("SELECT id FROM users WHERE role = 'admin'").all();
    admins.forEach(a => {
      createNotification(
        a.id,
        'therapist_registered',
        'New therapist registered',
        `${first_name} ${last_name} has registered as a therapist.`,
        '/dashboard'
      );
    });
  }

  res.json({
    success: true,
    role,
    message: 'Registration successful',
    user: {
      id: userId,
      name: `${first_name} ${last_name}`,
      email,
      phone: phone || '',
      initials: (first_name[0] + last_name[0]).toUpperCase()
    }
  });
});

// ─────────────────────────────────────────────
// LOGOUT
// ─────────────────────────────────────────────
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true, message: 'Logged out successfully' });
  });
});

// ─────────────────────────────────────────────
// PASSWORD RESET REQUEST
// ─────────────────────────────────────────────
router.post('/request_password_reset', (req, res) => {
  const { email } = req.body;
  if (!email) return res.json({ success: false, message: 'Email required' });

  const user = db.prepare('SELECT id, first_name FROM users WHERE email = ?').get(email);

  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiry = new Date(Date.now() + 3600000).toISOString();
    db.prepare('UPDATE users SET reset_token = ?, reset_token_expiry = ? WHERE id = ?')
      .run(token, expiry, user.id);

    const base = process.env.APP_URL || 'http://localhost:3000';
    const resetLink = `${base}/reset_password.html?token=${token}`;

    sendEmail({
      to: email,
      ...templates.passwordReset(user.first_name, resetLink)
    }).catch(() => {});

    console.log(`🔑 Reset link for ${email}: ${resetLink}`);
  }

  // Always return the same message for security
  res.json({ success: true, message: 'If your email is registered, you will receive a reset link.' });
});

// ─────────────────────────────────────────────
// PASSWORD RESET SUBMIT
// ─────────────────────────────────────────────
router.post('/reset_password', (req, res) => {
  const { token, password, confirm_password } = req.body;
  if (!token || !password) return res.json({ success: false, message: 'Token and password required' });
  if (password !== confirm_password) return res.json({ success: false, message: 'Passwords do not match' });
  if (password.length < 6) return res.json({ success: false, message: 'Min 6 characters' });

  const user = db.prepare(
    'SELECT id FROM users WHERE reset_token = ? AND reset_token_expiry > ?'
  ).get(token, new Date().toISOString());

  if (!user) return res.json({ success: false, message: 'Invalid or expired token' });

  const hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE users SET password = ?, reset_token = NULL, reset_token_expiry = NULL WHERE id = ?')
    .run(hash, user.id);

  res.json({ success: true, message: 'Password reset successfully' });
});

module.exports = router;