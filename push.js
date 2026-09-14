// push.js — Web Push notifications
const webpush = require('web-push');
const db = require('./database');

let pushEnabled = false;

function initPush() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@thinktech.local';

  if (!publicKey || !privateKey) {
    console.log('⚠️  Push notifications not configured');
    return;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  pushEnabled = true;
  console.log('✅ Push notifications ready');
}

async function sendPushToUser(userId, payload) {
  if (!pushEnabled) return;
  const subs = db.prepare('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?').all(userId);
  const data = JSON.stringify(payload);

  for (const sub of subs) {
    try {
      await webpush.sendNotification({
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth }
      }, data);
    } catch (err) {
      // If subscription expired (410/404), delete it
      if (err.statusCode === 410 || err.statusCode === 404) {
        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
        console.log(`🗑️  Removed stale push subscription ${sub.id}`);
      } else {
        console.error('Push send error:', err.message);
      }
    }
  }
}

module.exports = { initPush, sendPushToUser };