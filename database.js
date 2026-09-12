// database.js — using Node's built-in SQLite (no installation required)
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const bcrypt = require('bcryptjs');

const db = new DatabaseSync(path.join(__dirname, 'therapy.db'));

// Enable foreign keys
db.exec('PRAGMA foreign_keys = ON;');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    phone TEXT DEFAULT '',
    role TEXT NOT NULL DEFAULT 'client' CHECK(role IN ('client','therapist','admin')),
    is_verified INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    profile_picture TEXT DEFAULT NULL,
    specializations TEXT DEFAULT NULL,
    availability TEXT DEFAULT NULL,
    reset_token TEXT DEFAULT NULL,
    reset_token_expiry TEXT DEFAULT NULL,
    force_password_reset INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    therapist_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','confirmed','denied','completed')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (therapist_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    appointment_id INTEGER NOT NULL,
    sender_id INTEGER NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS session_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    appointment_id INTEGER UNIQUE NOT NULL,
    notes TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    appointment_id INTEGER UNIQUE NOT NULL,
    client_id INTEGER NOT NULL,
    therapist_id INTEGER NOT NULL,
    rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
    review TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE,
    FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (therapist_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    type TEXT NOT NULL CHECK(type IN ('article','video','audio','exercise')),
    url TEXT NOT NULL,
    created_by INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_appt_client ON appointments(client_id);
  CREATE INDEX IF NOT EXISTS idx_appt_therapist ON appointments(therapist_id);
  CREATE INDEX IF NOT EXISTS idx_appt_status ON appointments(status);
  CREATE INDEX IF NOT EXISTS idx_msg_appt ON messages(appointment_id);
  CREATE INDEX IF NOT EXISTS idx_user_email ON users(email);
  CREATE INDEX IF NOT EXISTS idx_user_role ON users(role);
`);

// Create default admin if missing
try {
  const adminExists = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@thinktech.com');
  if (!adminExists) {
    const hash = bcrypt.hashSync('password', 10);
    db.prepare(
      'INSERT INTO users (first_name, last_name, email, password, role, is_verified) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('Admin', 'User', 'admin@thinktech.com', hash, 'admin', 1);
    console.log('✅ Default admin created: admin@thinktech.com / password');
  }
} catch (err) {
  console.error('Admin creation error:', err.message);
}

module.exports = db;