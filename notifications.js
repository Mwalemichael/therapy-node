// notifications.js — creates in-app notification and optionally sends push
const db = require('./database');
const { sendPushToUser } = require('./push');

function createNotification(userId, type, title, message, link = null, sendPush = true) {
  try {
    const info = db.prepare(`
      INSERT INTO notifications (user_id, type, title, message, link)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, type, title, message, link);

    if (sendPush) {
      sendPushToUser(userId, {
        title,
        body: message,
        link: link || '/dashboard',
        tag: `notif-${info.lastInsertRowid}`
      }).catch(err => console.error('Push error:', err.message));
    }
    return true;
  } catch (err) {
    console.error('Notification error:', err.message);
    return false;
  }
}

module.exports = { createNotification };