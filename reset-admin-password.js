// reset-admin-password.js
const bcrypt = require('bcryptjs');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const db = new DatabaseSync(path.join(__dirname, 'therapy.db'));


const NEW_PASSWORD = 'Admin2025!Secure';

const hash = bcrypt.hashSync(NEW_PASSWORD, 10);
const info = db.prepare('UPDATE users SET password = ? WHERE email = ?')
    .run(hash, 'admin@thinktech.com');

if (info.changes) {
    console.log(`✅ Admin password updated to: ${NEW_PASSWORD}`);
} else {
    console.log('❌ Admin user not found');
}

db.close();