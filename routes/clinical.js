// routes/clinical.js
const express = require('express');
const db = require('../database');
const { requireLogin, requireRole } = require('../middleware/auth');
const { createNotification } = require('../notifications');
const router = express.Router();

// ═══════════════════════════════════════════════════════
// SOAP NOTES
// ═══════════════════════════════════════════════════════
router.get('/soap_get', requireLogin, (req, res) => {
  const { appointment_id } = req.query;
  if (!appointment_id) return res.json({ success: false, message: 'Appointment ID required' });
  const appt = db.prepare('SELECT * FROM appointments WHERE id = ?').get(appointment_id);
  if (!appt) return res.json({ success: false, message: 'Appointment not found' });
  const authorized = (req.session.role === 'client' && appt.client_id === req.session.user_id) ||
                     (req.session.role === 'therapist' && appt.therapist_id === req.session.user_id);
  if (!authorized) return res.json({ success: false, message: 'Forbidden' });
  const row = db.prepare(`
    SELECT subjective, objective, assessment, plan, recording_url, updated_at
    FROM session_notes WHERE appointment_id = ?
  `).get(appointment_id);
  res.json({ success: true, notes: row || { subjective: '', objective: '', assessment: '', plan: '', recording_url: null } });
});

router.post('/soap_save', requireRole('therapist'), (req, res) => {
  const { appointment_id, subjective, objective, assessment, plan } = req.body;
  if (!appointment_id) return res.json({ success: false, message: 'Appointment ID required' });
  const appt = db.prepare('SELECT * FROM appointments WHERE id = ? AND therapist_id = ?')
    .get(appointment_id, req.session.user_id);
  if (!appt) return res.json({ success: false, message: 'Not authorized' });
  db.prepare(`
    INSERT INTO session_notes (appointment_id, subjective, objective, assessment, plan)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(appointment_id) DO UPDATE SET
      subjective = excluded.subjective, objective = excluded.objective,
      assessment = excluded.assessment, plan = excluded.plan,
      updated_at = CURRENT_TIMESTAMP
  `).run(appointment_id, subjective || '', objective || '', assessment || '', plan || '');
  res.json({ success: true, message: 'SOAP notes saved' });
});

router.post('/soap_recording', requireRole('therapist'), (req, res) => {
  const { appointment_id, recording_url } = req.body;
  if (!appointment_id) return res.json({ success: false, message: 'Appointment ID required' });
  const appt = db.prepare('SELECT * FROM appointments WHERE id = ? AND therapist_id = ?')
    .get(appointment_id, req.session.user_id);
  if (!appt) return res.json({ success: false, message: 'Not authorized' });
  db.prepare(`
    INSERT INTO session_notes (appointment_id, recording_url) VALUES (?, ?)
    ON CONFLICT(appointment_id) DO UPDATE SET recording_url = excluded.recording_url, updated_at = CURRENT_TIMESTAMP
  `).run(appointment_id, recording_url || null);
  res.json({ success: true, message: 'Recording link saved' });
});

// ═══════════════════════════════════════════════════════
// TREATMENT PLANS
// ═══════════════════════════════════════════════════════
router.get('/plans_list', requireLogin, (req, res) => {
  const userId = req.session.user_id;
  const role = req.session.role;
  let plans;
  if (role === 'client') {
    plans = db.prepare(`
      SELECT p.*, (t.first_name || ' ' || t.last_name) AS therapist_name
      FROM treatment_plans p JOIN users t ON p.therapist_id = t.id
      WHERE p.client_id = ? ORDER BY p.created_at DESC
    `).all(userId);
  } else if (role === 'therapist') {
    plans = db.prepare(`
      SELECT p.*, (c.first_name || ' ' || c.last_name) AS client_name
      FROM treatment_plans p JOIN users c ON p.client_id = c.id
      WHERE p.therapist_id = ? ORDER BY p.created_at DESC
    `).all(userId);
  } else {
    plans = db.prepare(`
      SELECT p.*, (c.first_name || ' ' || c.last_name) AS client_name,
             (t.first_name || ' ' || t.last_name) AS therapist_name
      FROM treatment_plans p
      JOIN users c ON p.client_id = c.id
      JOIN users t ON p.therapist_id = t.id
      ORDER BY p.created_at DESC
    `).all();
  }
  const goalStmt = db.prepare('SELECT * FROM treatment_goals WHERE plan_id = ? ORDER BY created_at ASC');
  plans.forEach(p => { p.goals = goalStmt.all(p.id); });
  res.json({ success: true, plans });
});

router.post('/plans_create', requireRole('therapist'), (req, res) => {
  const { client_id, title, description, start_date, target_date } = req.body;
  if (!client_id || !title || !start_date) return res.json({ success: false, message: 'Client, title, and start date required' });
  const info = db.prepare(`
    INSERT INTO treatment_plans (client_id, therapist_id, title, description, start_date, target_date)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(client_id, req.session.user_id, title, description || '', start_date, target_date || null);
  res.json({ success: true, message: 'Treatment plan created', plan_id: Number(info.lastInsertRowid) });
});

router.post('/plans_update_status', requireLogin, (req, res) => {
  const { plan_id, status } = req.body;
  if (!plan_id || !['active','paused','completed','cancelled'].includes(status)) return res.json({ success: false, message: 'Invalid request' });
  const plan = db.prepare('SELECT * FROM treatment_plans WHERE id = ?').get(plan_id);
  if (!plan) return res.json({ success: false, message: 'Plan not found' });
  const canEdit = (req.session.role === 'therapist' && plan.therapist_id === req.session.user_id) || (req.session.role === 'admin');
  if (!canEdit) return res.json({ success: false, message: 'Forbidden' });
  db.prepare('UPDATE treatment_plans SET status = ? WHERE id = ?').run(status, plan_id);
  res.json({ success: true, message: 'Status updated' });
});

router.post('/plans_delete', requireRole('therapist'), (req, res) => {
  const { plan_id } = req.body;
  if (!plan_id) return res.json({ success: false, message: 'Plan ID required' });
  const plan = db.prepare('SELECT * FROM treatment_plans WHERE id = ? AND therapist_id = ?').get(plan_id, req.session.user_id);
  if (!plan) return res.json({ success: false, message: 'Not found' });
  db.prepare('DELETE FROM treatment_plans WHERE id = ?').run(plan_id);
  res.json({ success: true, message: 'Plan deleted' });
});

router.post('/goals_add', requireRole('therapist'), (req, res) => {
  const { plan_id, description, target_date } = req.body;
  if (!plan_id || !description) return res.json({ success: false, message: 'Plan ID and description required' });
  const plan = db.prepare('SELECT * FROM treatment_plans WHERE id = ? AND therapist_id = ?').get(plan_id, req.session.user_id);
  if (!plan) return res.json({ success: false, message: 'Plan not found' });
  db.prepare('INSERT INTO treatment_goals (plan_id, description, target_date) VALUES (?, ?, ?)').run(plan_id, description, target_date || null);
  res.json({ success: true, message: 'Goal added' });
});

router.post('/goals_update', requireRole('therapist'), (req, res) => {
  const { goal_id, status, notes } = req.body;
  if (!goal_id) return res.json({ success: false, message: 'Goal ID required' });
  const validStatuses = ['pending', 'in_progress', 'achieved', 'abandoned'];
  if (status && !validStatuses.includes(status)) return res.json({ success: false, message: 'Invalid status' });
  const goal = db.prepare(`
    SELECT g.* FROM treatment_goals g
    JOIN treatment_plans p ON g.plan_id = p.id
    WHERE g.id = ? AND p.therapist_id = ?
  `).get(goal_id, req.session.user_id);
  if (!goal) return res.json({ success: false, message: 'Not found' });
  db.prepare('UPDATE treatment_goals SET status = COALESCE(?, status), notes = COALESCE(?, notes) WHERE id = ?')
    .run(status || null, notes !== undefined ? notes : null, goal_id);
  res.json({ success: true, message: 'Goal updated' });
});

router.post('/goals_delete', requireRole('therapist'), (req, res) => {
  const { goal_id } = req.body;
  if (!goal_id) return res.json({ success: false, message: 'Goal ID required' });
  const goal = db.prepare(`
    SELECT g.id FROM treatment_goals g
    JOIN treatment_plans p ON g.plan_id = p.id
    WHERE g.id = ? AND p.therapist_id = ?
  `).get(goal_id, req.session.user_id);
  if (!goal) return res.json({ success: false, message: 'Not found' });
  db.prepare('DELETE FROM treatment_goals WHERE id = ?').run(goal_id);
  res.json({ success: true, message: 'Goal deleted' });
});

router.get('/my_clients', requireRole('therapist'), (req, res) => {
  const clients = db.prepare(`
    SELECT DISTINCT u.id, u.first_name || ' ' || u.last_name AS name, u.email
    FROM appointments a JOIN users u ON a.client_id = u.id
    WHERE a.therapist_id = ? ORDER BY u.first_name ASC
  `).all(req.session.user_id);
  res.json({ success: true, clients });
});

// ═══════════════════════════════════════════════════════
// SYMPTOM TRACKING
// ═══════════════════════════════════════════════════════
const PHQ9_QUESTIONS = [
  'Little interest or pleasure in doing things',
  'Feeling down, depressed, or hopeless',
  'Trouble falling or staying asleep, or sleeping too much',
  'Feeling tired or having little energy',
  'Poor appetite or overeating',
  'Feeling bad about yourself, or that you are a failure, or have let yourself or your family down',
  'Trouble concentrating on things, such as reading the newspaper or watching television',
  'Moving or speaking so slowly that other people could have noticed. Or the opposite — being so fidgety or restless that you have been moving around a lot more than usual',
  'Thoughts that you would be better off dead, or of hurting yourself in some way'
];

const GAD7_QUESTIONS = [
  'Feeling nervous, anxious, or on edge',
  'Not being able to stop or control worrying',
  'Worrying too much about different things',
  'Trouble relaxing',
  'Being so restless that it is hard to sit still',
  'Becoming easily annoyed or irritable',
  'Feeling afraid, as if something awful might happen'
];

function getSeverity(type, score) {
  if (type === 'PHQ9') {
    if (score <= 4) return 'Minimal';
    if (score <= 9) return 'Mild';
    if (score <= 14) return 'Moderate';
    if (score <= 19) return 'Moderately Severe';
    return 'Severe';
  } else {
    if (score <= 4) return 'Minimal';
    if (score <= 9) return 'Mild';
    if (score <= 14) return 'Moderate';
    return 'Severe';
  }
}

router.get('/symptoms_questions', requireLogin, (req, res) => {
  res.json({ success: true, PHQ9: PHQ9_QUESTIONS, GAD7: GAD7_QUESTIONS });
});

router.post('/symptoms_submit', requireRole('client'), (req, res) => {
  const { type, answers, notes } = req.body;
  if (!type || !['PHQ9', 'GAD7'].includes(type)) return res.json({ success: false, message: 'Invalid type' });
  if (!Array.isArray(answers)) return res.json({ success: false, message: 'Answers must be an array' });
  const expectedCount = type === 'PHQ9' ? 9 : 7;
  if (answers.length !== expectedCount) return res.json({ success: false, message: `Expected ${expectedCount} answers` });
  const valid = answers.every(a => typeof a === 'number' && a >= 0 && a <= 3);
  if (!valid) return res.json({ success: false, message: 'Each answer must be 0-3' });
  const total = answers.reduce((s, v) => s + v, 0);
  const severity = getSeverity(type, total);
  db.prepare(`
    INSERT INTO symptom_assessments (client_id, type, total_score, severity, answers, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(req.session.user_id, type, total, severity, JSON.stringify(answers), notes || '');
  res.json({ success: true, message: `Assessment submitted. Score: ${total} (${severity})`, score: total, severity });
});

router.get('/symptoms_list', requireLogin, (req, res) => {
  let clientId = req.session.user_id;
  if (req.session.role === 'therapist' && req.query.client_id) {
    const treat = db.prepare('SELECT 1 FROM appointments WHERE client_id = ? AND therapist_id = ? LIMIT 1')
      .get(req.query.client_id, req.session.user_id);
    if (!treat) return res.json({ success: false, message: 'Not authorized for this client' });
    clientId = req.query.client_id;
  }
  const assessments = db.prepare(`
    SELECT id, type, total_score, severity, notes, created_at
    FROM symptom_assessments WHERE client_id = ? ORDER BY created_at DESC
  `).all(clientId);
  res.json({ success: true, assessments });
});

router.get('/symptoms_chart', requireLogin, (req, res) => {
  const { type } = req.query;
  if (!type || !['PHQ9', 'GAD7'].includes(type)) return res.json({ success: false, message: 'Invalid type' });
  let clientId = req.session.user_id;
  if (req.session.role === 'therapist' && req.query.client_id) {
    const treat = db.prepare('SELECT 1 FROM appointments WHERE client_id = ? AND therapist_id = ? LIMIT 1')
      .get(req.query.client_id, req.session.user_id);
    if (!treat) return res.json({ success: false, message: 'Not authorized for this client' });
    clientId = req.query.client_id;
  }
  const data = db.prepare(`
    SELECT total_score, severity, created_at
    FROM symptom_assessments WHERE client_id = ? AND type = ?
    ORDER BY created_at ASC LIMIT 30
  `).all(clientId, type);
  res.json({ success: true, data });
});

router.get('/symptoms_my_clients', requireRole('therapist'), (req, res) => {
  const therapistId = req.session.user_id;
  const clients = db.prepare(`
    SELECT DISTINCT u.id, (u.first_name || ' ' || u.last_name) AS name, u.email
    FROM appointments a JOIN users u ON a.client_id = u.id
    WHERE a.therapist_id = ? ORDER BY u.first_name ASC
  `).all(therapistId);

  clients.forEach(c => {
    const phq9 = db.prepare(`
      SELECT total_score, severity, created_at FROM symptom_assessments
      WHERE client_id = ? AND type = 'PHQ9' ORDER BY created_at DESC LIMIT 1
    `).get(c.id);
    const gad7 = db.prepare(`
      SELECT total_score, severity, created_at FROM symptom_assessments
      WHERE client_id = ? AND type = 'GAD7' ORDER BY created_at DESC LIMIT 1
    `).get(c.id);
    c.phq9 = phq9 || null;
    c.gad7 = gad7 || null;
  });

  res.json({ success: true, clients });
});

router.get('/symptoms_client_history', requireRole('therapist'), (req, res) => {
  const clientId = req.query.client_id;
  if (!clientId) return res.json({ success: false, message: 'Client ID required' });
  const treat = db.prepare('SELECT 1 FROM appointments WHERE client_id = ? AND therapist_id = ? LIMIT 1')
    .get(clientId, req.session.user_id);
  if (!treat) return res.json({ success: false, message: 'Not authorized for this client' });
  const assessments = db.prepare(`
    SELECT id, type, total_score, severity, notes, created_at
    FROM symptom_assessments WHERE client_id = ? ORDER BY created_at ASC
  `).all(clientId);
  const client = db.prepare('SELECT (first_name || \' \' || last_name) AS name FROM users WHERE id = ?').get(clientId);
  res.json({ success: true, client_name: client ? client.name : 'Unknown', assessments });
});

// ═══════════════════════════════════════════════════════
// GROUP SESSIONS
// ═══════════════════════════════════════════════════════
router.get('/groups_list', requireLogin, (req, res) => {
  const userId = req.session.user_id;
  const role = req.session.role;
  let groups;
  if (role === 'therapist') {
    groups = db.prepare(`
      SELECT g.*, (t.first_name || ' ' || t.last_name) AS therapist_name,
        (SELECT COUNT(*) FROM group_participants WHERE group_id = g.id) AS participant_count
      FROM group_sessions g JOIN users t ON g.therapist_id = t.id
      WHERE g.therapist_id = ?
      ORDER BY g.scheduled_date DESC, g.scheduled_time DESC
    `).all(userId);
  } else if (role === 'client') {
    groups = db.prepare(`
      SELECT g.*, (t.first_name || ' ' || t.last_name) AS therapist_name,
        (SELECT COUNT(*) FROM group_participants WHERE group_id = g.id) AS participant_count,
        (SELECT COUNT(*) FROM group_participants WHERE group_id = g.id AND client_id = ?) AS is_joined
      FROM group_sessions g JOIN users t ON g.therapist_id = t.id
      WHERE g.status IN ('scheduled', 'in_progress')
      ORDER BY g.scheduled_date ASC, g.scheduled_time ASC
    `).all(userId);
  } else {
    groups = db.prepare(`
      SELECT g.*, (t.first_name || ' ' || t.last_name) AS therapist_name,
        (SELECT COUNT(*) FROM group_participants WHERE group_id = g.id) AS participant_count
      FROM group_sessions g JOIN users t ON g.therapist_id = t.id
      ORDER BY g.scheduled_date DESC, g.scheduled_time DESC
    `).all();
  }
  res.json({ success: true, groups });
});

router.post('/groups_create', requireRole('therapist'), (req, res) => {
  const { title, description, scheduled_date, scheduled_time, duration_minutes, max_participants } = req.body;
  if (!title || !scheduled_date || !scheduled_time) return res.json({ success: false, message: 'Title, date, time required' });
  const roomName = 'group-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8);
  const info = db.prepare(`
    INSERT INTO group_sessions (therapist_id, title, description, scheduled_date, scheduled_time, duration_minutes, max_participants, room_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.session.user_id, title, description || '', scheduled_date, scheduled_time, duration_minutes || 60, max_participants || 8, roomName);
  res.json({ success: true, message: 'Group session created', group_id: Number(info.lastInsertRowid) });
});

router.post('/groups_join', requireRole('client'), (req, res) => {
  const { group_id } = req.body;
  if (!group_id) return res.json({ success: false, message: 'Group ID required' });
  const group = db.prepare('SELECT * FROM group_sessions WHERE id = ?').get(group_id);
  if (!group) return res.json({ success: false, message: 'Group not found' });
  if (group.status !== 'scheduled') return res.json({ success: false, message: 'Group is not open for joining' });
  const count = db.prepare('SELECT COUNT(*) AS c FROM group_participants WHERE group_id = ?').get(group_id).c;
  if (count >= group.max_participants) return res.json({ success: false, message: 'Group is full' });
  try {
    db.prepare('INSERT INTO group_participants (group_id, client_id) VALUES (?, ?)').run(group_id, req.session.user_id);
    res.json({ success: true, message: 'Joined group session' });
  } catch (e) {
    res.json({ success: false, message: 'You already joined this group' });
  }
});

router.post('/groups_leave', requireRole('client'), (req, res) => {
  const { group_id } = req.body;
  if (!group_id) return res.json({ success: false, message: 'Group ID required' });
  db.prepare('DELETE FROM group_participants WHERE group_id = ? AND client_id = ?').run(group_id, req.session.user_id);
  res.json({ success: true, message: 'Left group' });
});

router.post('/groups_cancel', requireRole('therapist'), (req, res) => {
  const { group_id } = req.body;
  if (!group_id) return res.json({ success: false, message: 'Group ID required' });
  const group = db.prepare('SELECT * FROM group_sessions WHERE id = ? AND therapist_id = ?').get(group_id, req.session.user_id);
  if (!group) return res.json({ success: false, message: 'Not found' });
  db.prepare("UPDATE group_sessions SET status = 'cancelled' WHERE id = ?").run(group_id);
  res.json({ success: true, message: 'Group session cancelled' });
});

// ═══════════════════════════════════════════════════════
// MOOD CHECK-IN
// ═══════════════════════════════════════════════════════

// Get today's check-in (client)
router.get('/mood_today', requireRole('client'), (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const row = db.prepare(`
    SELECT id, mood_score, note, date, created_at
    FROM mood_checkins WHERE client_id = ? AND date = ?
  `).get(req.session.user_id, today);
  res.json({ success: true, checkin: row || null });
});

// Submit today's check-in (client)
router.post('/mood_checkin', requireRole('client'), (req, res) => {
  const { mood_score, note } = req.body;
  const score = parseInt(mood_score, 10);
  if (!score || score < 1 || score > 5) {
    return res.json({ success: false, message: 'Mood score must be between 1 and 5' });
  }
  const today = new Date().toISOString().split('T')[0];
  try {
    db.prepare(`
      INSERT INTO mood_checkins (client_id, mood_score, note, date)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(client_id, date) DO UPDATE SET
        mood_score = excluded.mood_score,
        note = excluded.note,
        created_at = CURRENT_TIMESTAMP
    `).run(req.session.user_id, score, note || '', today);
    res.json({ success: true, message: 'Mood check-in saved!' });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// Get mood history (last 30 days) — client or therapist for own client
router.get('/mood_history', requireLogin, (req, res) => {
  let clientId = req.session.user_id;
  if (req.session.role === 'therapist' && req.query.client_id) {
    const treat = db.prepare('SELECT 1 FROM appointments WHERE client_id = ? AND therapist_id = ? LIMIT 1')
      .get(req.query.client_id, req.session.user_id);
    if (!treat) return res.json({ success: false, message: 'Not authorized for this client' });
    clientId = req.query.client_id;
  } else if (req.session.role === 'admin' && req.query.client_id) {
    clientId = req.query.client_id;
  }
  const rows = db.prepare(`
    SELECT mood_score, note, date, created_at
    FROM mood_checkins WHERE client_id = ?
    ORDER BY date DESC LIMIT 30
  `).all(clientId);
  res.json({ success: true, history: rows });
});

// Get mood streak (consecutive days with check-ins, ending today or yesterday)
router.get('/mood_streak', requireLogin, (req, res) => {
  let clientId = req.session.user_id;
  if (req.session.role === 'therapist' && req.query.client_id) {
    const treat = db.prepare('SELECT 1 FROM appointments WHERE client_id = ? AND therapist_id = ? LIMIT 1')
      .get(req.query.client_id, req.session.user_id);
    if (!treat) return res.json({ success: false, message: 'Not authorized' });
    clientId = req.query.client_id;
  }
  const rows = db.prepare(`SELECT date FROM mood_checkins WHERE client_id = ? ORDER BY date DESC`).all(clientId);
  if (!rows.length) return res.json({ success: true, streak: 0 });

  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  let streak = 0;
  let expected = rows[0].date === today ? today : (rows[0].date === yesterday ? yesterday : null);
  if (!expected) return res.json({ success: true, streak: 0 });

  for (const row of rows) {
    if (row.date === expected) {
      streak++;
      const d = new Date(expected + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() - 1);
      expected = d.toISOString().split('T')[0];
    } else break;
  }
  res.json({ success: true, streak });
});

// Therapist: mood info per client (for the symptom tracker list)
router.get('/mood_my_clients', requireRole('therapist'), (req, res) => {
  const therapistId = req.session.user_id;
  const clients = db.prepare(`
    SELECT DISTINCT u.id FROM appointments a JOIN users u ON a.client_id = u.id
    WHERE a.therapist_id = ?
  `).all(therapistId);

  const result = {};
  clients.forEach(c => {
    const last = db.prepare(`
      SELECT mood_score, date FROM mood_checkins
      WHERE client_id = ? ORDER BY date DESC LIMIT 1
    `).get(c.id);
    const avg = db.prepare(`
      SELECT AVG(mood_score) AS avg_score FROM mood_checkins
      WHERE client_id = ? AND date >= date('now', '-7 days')
    `).get(c.id);
    result[c.id] = {
      last: last || null,
      avg_7d: avg && avg.avg_score ? Math.round(avg.avg_score * 10) / 10 : null
    };
  });
  res.json({ success: true, moods: result });
});

// ═══════════════════════════════════════════════════════
// HOMEWORK
// ═══════════════════════════════════════════════════════

// List homework
router.get('/homework_list', requireLogin, (req, res) => {
  const userId = req.session.user_id;
  const role = req.session.role;
  let rows;
  if (role === 'client') {
    rows = db.prepare(`
      SELECT h.*, (t.first_name || ' ' || t.last_name) AS therapist_name
      FROM homework h JOIN users t ON h.therapist_id = t.id
      WHERE h.client_id = ?
      ORDER BY
        CASE h.status WHEN 'pending' THEN 1 WHEN 'in_progress' THEN 2 ELSE 3 END,
        h.due_date ASC, h.created_at DESC
    `).all(userId);
  } else if (role === 'therapist') {
    rows = db.prepare(`
      SELECT h.*, (c.first_name || ' ' || c.last_name) AS client_name
      FROM homework h JOIN users c ON h.client_id = c.id
      WHERE h.therapist_id = ?
      ORDER BY h.created_at DESC
    `).all(userId);
  } else {
    rows = db.prepare(`
      SELECT h.*, (c.first_name || ' ' || c.last_name) AS client_name,
             (t.first_name || ' ' || t.last_name) AS therapist_name
      FROM homework h
      JOIN users c ON h.client_id = c.id
      JOIN users t ON h.therapist_id = t.id
      ORDER BY h.created_at DESC
    `).all();
  }
  res.json({ success: true, homework: rows });
});

// Create (therapist only)
router.post('/homework_create', requireRole('therapist'), (req, res) => {
  const { client_id, title, description, due_date } = req.body;
  if (!client_id || !title) return res.json({ success: false, message: 'Client and title required' });
  // Verify therapist treats this client
  const treat = db.prepare('SELECT 1 FROM appointments WHERE client_id = ? AND therapist_id = ? LIMIT 1')
    .get(client_id, req.session.user_id);
  if (!treat) return res.json({ success: false, message: 'Not authorized for this client' });

  const info = db.prepare(`
    INSERT INTO homework (therapist_id, client_id, title, description, due_date)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.session.user_id, client_id, title, description || '', due_date || null);

  // Notify client
  createNotification(
    client_id,
    'homework_assigned',
    'New homework assigned',
    `Your therapist assigned: "${title}"`,
    '/dashboard'
  );

  res.json({ success: true, message: 'Homework assigned', id: Number(info.lastInsertRowid) });
});

// Update status (client only)
router.post('/homework_update_status', requireRole('client'), (req, res) => {
  const { id, status, client_notes } = req.body;
  if (!id || !['pending', 'in_progress', 'completed'].includes(status)) {
    return res.json({ success: false, message: 'Valid ID and status required' });
  }
  const hw = db.prepare('SELECT * FROM homework WHERE id = ? AND client_id = ?').get(id, req.session.user_id);
  if (!hw) return res.json({ success: false, message: 'Homework not found' });

  const completedAt = status === 'completed' ? new Date().toISOString() : null;
  db.prepare(`
    UPDATE homework SET status = ?, client_notes = COALESCE(?, client_notes), completed_at = ?
    WHERE id = ?
  `).run(status, client_notes !== undefined ? client_notes : null, completedAt, id);

  if (status === 'completed') {
    createNotification(
      hw.therapist_id,
      'homework_completed',
      'Homework completed',
      `Your client completed: "${hw.title}"`,
      '/dashboard'
    );
  }
  res.json({ success: true, message: 'Homework updated' });
});

// Delete (therapist only)
router.post('/homework_delete', requireRole('therapist'), (req, res) => {
  const { id } = req.body;
  if (!id) return res.json({ success: false, message: 'ID required' });
  const hw = db.prepare('SELECT * FROM homework WHERE id = ? AND therapist_id = ?').get(id, req.session.user_id);
  if (!hw) return res.json({ success: false, message: 'Not found' });
  db.prepare('DELETE FROM homework WHERE id = ?').run(id);
  res.json({ success: true, message: 'Homework deleted' });
});

module.exports = router;