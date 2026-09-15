// database.js — using Node's built-in SQLite
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'therapy.db');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON;');

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
    reminder_sent INTEGER DEFAULT 0,
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

  CREATE TABLE IF NOT EXISTS direct_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL,
    recipient_id INTEGER NOT NULL,
    message TEXT NOT NULL,
    is_read INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS session_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    appointment_id INTEGER UNIQUE NOT NULL,
    notes TEXT,
    subjective TEXT DEFAULT '',
    objective TEXT DEFAULT '',
    assessment TEXT DEFAULT '',
    plan TEXT DEFAULT '',
    recording_url TEXT DEFAULT NULL,
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

  CREATE TABLE IF NOT EXISTS treatment_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    therapist_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    status TEXT DEFAULT 'active' CHECK(status IN ('active','paused','completed','cancelled')),
    start_date TEXT NOT NULL,
    target_date TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (therapist_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS treatment_goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id INTEGER NOT NULL,
    description TEXT NOT NULL,
    target_date TEXT,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','in_progress','achieved','abandoned')),
    notes TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (plan_id) REFERENCES treatment_plans(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS symptom_assessments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('PHQ9','GAD7')),
    total_score INTEGER NOT NULL,
    severity TEXT NOT NULL,
    answers TEXT NOT NULL,
    notes TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS crisis_resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    url TEXT DEFAULT '',
    display_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    link TEXT DEFAULT NULL,
    is_read INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    endpoint TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, endpoint)
  );

  CREATE TABLE IF NOT EXISTS group_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    therapist_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    scheduled_date TEXT NOT NULL,
    scheduled_time TEXT NOT NULL,
    duration_minutes INTEGER DEFAULT 60,
    max_participants INTEGER DEFAULT 8,
    room_name TEXT NOT NULL UNIQUE,
    status TEXT DEFAULT 'scheduled' CHECK(status IN ('scheduled','in_progress','completed','cancelled')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (therapist_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS group_participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    client_id INTEGER NOT NULL,
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_id) REFERENCES group_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(group_id, client_id)
  );

  CREATE INDEX IF NOT EXISTS idx_appt_client ON appointments(client_id);
  CREATE INDEX IF NOT EXISTS idx_appt_therapist ON appointments(therapist_id);
  CREATE INDEX IF NOT EXISTS idx_appt_status ON appointments(status);
  CREATE INDEX IF NOT EXISTS idx_msg_appt ON messages(appointment_id);
  CREATE INDEX IF NOT EXISTS idx_dm_sender ON direct_messages(sender_id);
  CREATE INDEX IF NOT EXISTS idx_dm_recipient ON direct_messages(recipient_id);
  CREATE INDEX IF NOT EXISTS idx_dm_pair ON direct_messages(sender_id, recipient_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_user_email ON users(email);
  CREATE INDEX IF NOT EXISTS idx_user_role ON users(role);
  CREATE INDEX IF NOT EXISTS idx_plans_client ON treatment_plans(client_id);
  CREATE INDEX IF NOT EXISTS idx_plans_therapist ON treatment_plans(therapist_id);
  CREATE INDEX IF NOT EXISTS idx_goals_plan ON treatment_goals(plan_id);
  CREATE INDEX IF NOT EXISTS idx_assess_client ON symptom_assessments(client_id);
  CREATE INDEX IF NOT EXISTS idx_assess_type ON symptom_assessments(type);
  CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id);
  CREATE INDEX IF NOT EXISTS idx_notif_unread ON notifications(user_id, is_read);
  CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);
  CREATE INDEX IF NOT EXISTS idx_group_therapist ON group_sessions(therapist_id);
  CREATE INDEX IF NOT EXISTS idx_group_part ON group_participants(group_id);
`);

// Migrations for existing DBs
try {
  const cols = db.prepare("PRAGMA table_info(session_notes)").all().map(c => c.name);
  if (!cols.includes('subjective')) db.exec("ALTER TABLE session_notes ADD COLUMN subjective TEXT DEFAULT ''");
  if (!cols.includes('objective')) db.exec("ALTER TABLE session_notes ADD COLUMN objective TEXT DEFAULT ''");
  if (!cols.includes('assessment')) db.exec("ALTER TABLE session_notes ADD COLUMN assessment TEXT DEFAULT ''");
  if (!cols.includes('plan')) db.exec("ALTER TABLE session_notes ADD COLUMN plan TEXT DEFAULT ''");
  if (!cols.includes('recording_url')) db.exec("ALTER TABLE session_notes ADD COLUMN recording_url TEXT DEFAULT NULL");
} catch (e) {}

try {
  const apptCols = db.prepare("PRAGMA table_info(appointments)").all().map(c => c.name);
  if (!apptCols.includes('reminder_sent')) db.exec("ALTER TABLE appointments ADD COLUMN reminder_sent INTEGER DEFAULT 0");
} catch (e) {}

// Seed default crisis resources (Trevor Project removed)
const crisisCount = db.prepare('SELECT COUNT(*) AS c FROM crisis_resources').get().c;
if (crisisCount === 0) {
  const insert = db.prepare(
    'INSERT INTO crisis_resources (title, description, phone, url, display_order) VALUES (?, ?, ?, ?, ?)'
  );
  insert.run('Emergency Services', 'Call for immediate danger to life', '911', '', 1);
  insert.run('National Suicide Prevention Lifeline', '24/7 free and confidential support', '988', 'https://988lifeline.org', 2);
  insert.run('Crisis Text Line', 'Text HOME to 741741 to connect with a Crisis Counselor', '741741', 'https://www.crisistextline.org', 3);
  insert.run('SAMHSA National Helpline', 'Treatment referral and information (24/7)', '1-800-662-4357', 'https://www.samhsa.gov/find-help/national-helpline', 4);
  insert.run('Domestic Violence Hotline', '24/7 support for domestic abuse', '1-800-799-7233', 'https://www.thehotline.org', 5);
  console.log('✅ Default crisis resources seeded');
}

// Default admin
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