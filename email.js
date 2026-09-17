// email.js — Nodemailer service
const nodemailer = require('nodemailer');

let transporter = null;
let emailEnabled = false;

function initEmail() {
  console.log('[email.js] initEmail() called');

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587');
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    console.log('⚠️  Email not configured — emails will be logged to console only');
    console.log('[email.js] Missing:', {
      host: !host ? 'SMTP_HOST' : null,
      user: !user ? 'SMTP_USER' : null,
      pass: !pass ? 'SMTP_PASS' : null
    });
    return;
  }

  console.log('[email.js] Creating SMTP transporter to ' + host + ':' + port);
  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000
  });

  // Enable immediately — don't block on verify(). Some hosts block SMTP verify.
  emailEnabled = true;
  console.log('✅ Email service enabled (verify skipped)');

  // Run verify in the background, purely for logging. Hard timeout at 12s.
  const timer = setTimeout(() => {
    console.warn('⚠️  [email.js] SMTP verify timed out after 12s — verify is likely blocked, but sends may still work.');
  }, 12000);

  transporter.verify((err) => {
    clearTimeout(timer);
    if (err) {
      console.warn('⚠️  [email.js] SMTP verify failed (sends may still work):', err.message);
    } else {
      console.log('✅ [email.js] SMTP verify passed');
    }
  });
}

async function sendEmail({ to, subject, html, text }) {
  if (!emailEnabled) {
    console.log(`\n📧 [EMAIL DISABLED] To: ${to}\n   Subject: ${subject}\n`);
    return { success: true, skipped: true };
  }
  try {
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to, subject, html, text: text || html.replace(/<[^>]*>/g, '')
    });
    console.log(`✅ Email sent to ${to}: ${subject}`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error(`❌ Email failed to ${to}:`, err.message);
    return { success: false, error: err.message };
  }
}

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

const APP_URL = process.env.APP_URL || 'http://localhost:3000';

const baseStyle = `
  body { font-family: Arial, sans-serif; background: #f0f2f5; margin: 0; padding: 0; }
  .wrap { max-width: 560px; margin: 2rem auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.06); }
  .header { background: #1a2a3a; color: white; padding: 1.5rem; text-align: center; }
  .header h1 { margin: 0; font-size: 1.4rem; }
  .header span { color: #2a9d8f; }
  .body { padding: 2rem; color: #1a2a3a; line-height: 1.6; }
  .button { display: inline-block; background: #2a9d8f; color: white; padding: 0.8rem 1.5rem; border-radius: 60px; text-decoration: none; font-weight: 600; margin: 1rem 0; }
  .footer { background: #f8f9fa; padding: 1rem; text-align: center; font-size: 0.8rem; color: #718096; }
`;

function wrap(title, bodyHtml) {
  return `<!DOCTYPE html><html><head><style>${baseStyle}</style></head><body>
  <div class="wrap">
    <div class="header"><h1>ThinkTech <span>Therapy</span></h1></div>
    <div class="body"><h2 style="margin-top:0;color:#1a2a3a;">${esc(title)}</h2>${bodyHtml}</div>
    <div class="footer">&copy; ${new Date().getFullYear()} ThinkTech Therapy · <a href="${APP_URL}" style="color:#2a9d8f;">Visit site</a></div>
  </div></body></html>`;
}

const templates = {
  welcome: (name, role) => ({
    subject: 'Welcome to ThinkTech Therapy',
    html: wrap('Welcome!', `
      <p>Hi ${esc(name)},</p>
      <p>Your <strong>${esc(role)}</strong> account is now active. You can sign in right away.</p>
      <a href="${APP_URL}" class="button">Sign in</a>
    `)
  }),

  appointmentBookedTherapist: (therapistName, clientName, date, time) => ({
    subject: `New appointment request from ${clientName}`,
    html: wrap('New appointment request', `
      <p>Hi ${esc(therapistName)},</p>
      <p><strong>${esc(clientName)}</strong> has requested an appointment:</p>
      <p style="background:#f0f2f5;padding:1rem;border-radius:8px;">
        <strong>Date:</strong> ${esc(date)}<br>
        <strong>Time:</strong> ${esc(time)}
      </p>
      <a href="${APP_URL}/dashboard" class="button">Review</a>
    `)
  }),

  appointmentBookedClient: (clientName, therapistName, date, time) => ({
    subject: 'Your appointment request was sent',
    html: wrap('Request sent', `
      <p>Hi ${esc(clientName)},</p>
      <p>Your request to <strong>${esc(therapistName)}</strong>:</p>
      <p style="background:#f0f2f5;padding:1rem;border-radius:8px;">
        <strong>Date:</strong> ${esc(date)}<br>
        <strong>Time:</strong> ${esc(time)}
      </p>
    `)
  }),

  appointmentConfirmed: (name, therapistName, date, time) => ({
    subject: 'Your appointment is confirmed',
    html: wrap('Appointment confirmed', `
      <p>Hi ${esc(name)},</p>
      <p>Your appointment with <strong>${esc(therapistName)}</strong> is confirmed:</p>
      <p style="background:#c6f6d5;padding:1rem;border-radius:8px;">
        <strong>Date:</strong> ${esc(date)}<br>
        <strong>Time:</strong> ${esc(time)}
      </p>
      <a href="${APP_URL}/dashboard" class="button">Go to dashboard</a>
    `)
  }),

  appointmentDenied: (name, therapistName, date, time) => ({
    subject: 'Appointment update',
    html: wrap('Appointment not confirmed', `
      <p>Hi ${esc(name)},</p>
      <p><strong>${esc(therapistName)}</strong> couldn't confirm your appointment on ${esc(date)} at ${esc(time)}.</p>
      <a href="${APP_URL}/dashboard" class="button">Book another time</a>
    `)
  }),

  appointmentCancelled: (name, otherName, date, time) => ({
    subject: 'Appointment cancelled',
    html: wrap('Appointment cancelled', `
      <p>Hi ${esc(name)},</p>
      <p>Your appointment with <strong>${esc(otherName)}</strong> on ${esc(date)} at ${esc(time)} has been cancelled.</p>
    `)
  }),

  appointmentReminder: (name, otherName, date, time, link) => ({
    subject: `Reminder: session tomorrow at ${time}`,
    html: wrap('Session reminder', `
      <p>Hi ${esc(name)},</p>
      <p>You have a session with <strong>${esc(otherName)}</strong> coming up:</p>
      <p style="background:#eef2ff;padding:1rem;border-radius:8px;">
        <strong>Date:</strong> ${esc(date)}<br>
        <strong>Time:</strong> ${esc(time)}
      </p>
      <a href="${link}" class="button">Join session</a>
    `)
  }),

  newMessage: (name, senderName, preview) => ({
    subject: `New message from ${senderName}`,
    html: wrap('New message', `
      <p>Hi ${esc(name)},</p>
      <p><strong>${esc(senderName)}</strong> sent you a message:</p>
      <p style="background:#f0f2f5;padding:1rem;border-radius:8px;font-style:italic;">"${esc(preview)}"</p>
      <a href="${APP_URL}/dashboard" class="button">Reply</a>
    `)
  }),

  passwordReset: (name, resetLink) => ({
    subject: 'Reset your password',
    html: wrap('Reset your password', `
      <p>Hi ${esc(name)},</p>
      <p>Click below to choose a new password:</p>
      <a href="${resetLink}" class="button">Reset password</a>
      <p style="color:#718096;font-size:0.9rem;">Expires in 1 hour.</p>
    `)
  }),

  ratingReceived: (therapistName, clientName, rating, review) => ({
    subject: `New ${rating}-star rating`,
    html: wrap('New rating', `
      <p>Hi ${esc(therapistName)},</p>
      <p><strong>${esc(clientName)}</strong> rated your session:</p>
      <p style="font-size:1.4rem;color:#f6b83e;">${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}</p>
      ${review ? `<p style="background:#f0f2f5;padding:1rem;border-radius:8px;font-style:italic;">"${esc(review)}"</p>` : ''}
    `)
  })
};

module.exports = { initEmail, sendEmail, templates };