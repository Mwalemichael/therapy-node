require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

const { initEmail } = require('./email');
const { initPush } = require('./push');

const app = express();
const PORT = process.env.PORT || 3000;

const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

app.set('trust proxy', 1);

// ═══════════════════════════════════════════════
// DIAGNOSTIC INIT
// ═══════════════════════════════════════════════
console.log('═══════════════════════════════════════');
console.log('🔧 Initializing services...');
console.log('🔧 NODE_ENV       =', process.env.NODE_ENV || '(not set)');
console.log('🔧 SMTP_HOST      =', process.env.SMTP_HOST ? '✓ SET' : '✗ NOT SET');
console.log('🔧 SMTP_PORT      =', process.env.SMTP_PORT ? '✓ SET (' + process.env.SMTP_PORT + ')' : '✗ NOT SET');
console.log('🔧 SMTP_USER      =', process.env.SMTP_USER ? '✓ SET (' + process.env.SMTP_USER + ')' : '✗ NOT SET');
console.log('🔧 SMTP_PASS      =', process.env.SMTP_PASS ? '✓ SET (' + process.env.SMTP_PASS.length + ' chars)' : '✗ NOT SET');
console.log('🔧 SMTP_FROM      =', process.env.SMTP_FROM || '(not set)');
console.log('🔧 APP_URL        =', process.env.APP_URL || '(not set)');
console.log('═══════════════════════════════════════');

try {
  console.log('🔧 → Calling initEmail()...');
  initEmail();
  console.log('🔧 → initEmail() returned');
} catch (err) {
  console.error('🔧 ✗ initEmail() threw:', err.message);
  console.error(err.stack);
}

try {
  console.log('🔧 → Calling initPush()...');
  initPush();
  console.log('🔧 → initPush() returned');
} catch (err) {
  console.error('🔧 ✗ initPush() threw:', err.message);
}

console.log('═══════════════════════════════════════');

// Middleware
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-me-in-production-please',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  }
}));

// Static files
const staticOptions = {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('service-worker.js')) {
      res.setHeader('Service-Worker-Allowed', '/');
      res.setHeader('Cache-Control', 'no-cache');
    }
    if (filePath.endsWith('manifest.json')) {
      res.setHeader('Content-Type', 'application/manifest+json');
    }
  }
};
app.use(express.static(path.join(__dirname, 'public'), staticOptions));
app.use('/uploads', express.static(uploadsDir));

// API routes
app.use('/api', require('./routes/auth'));
app.use('/api', require('./routes/user'));
app.use('/api', require('./routes/appointments'));
app.use('/api', require('./routes/chat'));
app.use('/api', require('./routes/admin'));
app.use('/api', require('./routes/clinical'));
app.use('/api', require('./routes/notifications'));
app.use('/api', require('./routes/messages'));

// Protected dashboard
app.get('/dashboard', (req, res) => {
  if (!req.session.user_id) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ success: false, message: err.message || 'Server error' });
});

// Reminder scheduler
function startReminderScheduler() {
  const db = require('./database');
  const { sendEmail, templates } = require('./email');
  const { createNotification } = require('./notifications');

  async function checkReminders() {
    try {
      const rows = db.prepare(`
        SELECT a.id, a.date, a.time, a.client_id, a.therapist_id,
          (c.first_name || ' ' || c.last_name) AS client_name, c.email AS client_email,
          (t.first_name || ' ' || t.last_name) AS therapist_name, t.email AS therapist_email
        FROM appointments a
        JOIN users c ON a.client_id = c.id
        JOIN users t ON a.therapist_id = t.id
        WHERE a.status = 'confirmed'
          AND a.reminder_sent = 0
          AND datetime(a.date || ' ' || a.time) BETWEEN datetime('now') AND datetime('now', '+24 hours')
      `).all();
      for (const appt of rows) {
        const link = `${process.env.APP_URL || 'http://localhost:3000'}/dashboard`;
        createNotification(appt.client_id, 'appointment_reminder', 'Session reminder',
          `Reminder: session with ${appt.therapist_name} on ${appt.date} at ${appt.time}.`, '/dashboard');
        sendEmail({ to: appt.client_email, ...templates.appointmentReminder(appt.client_name, appt.therapist_name, appt.date, appt.time, link) }).catch(() => {});
        sendEmail({ to: appt.therapist_email, ...templates.appointmentReminder(appt.therapist_name, appt.client_name, appt.date, appt.time, link) }).catch(() => {});
        db.prepare('UPDATE appointments SET reminder_sent = 1 WHERE id = ?').run(appt.id);
      }
    } catch (err) {
      console.error('Reminder error:', err.message);
    }
  }
  setTimeout(checkReminders, 30000);
  setInterval(checkReminders, 15 * 60 * 1000);
}

app.listen(PORT, () => {
  console.log(`\n🚀 ThinkTech Therapy running on port ${PORT}\n`);
  startReminderScheduler();
});