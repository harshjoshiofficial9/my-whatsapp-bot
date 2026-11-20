import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Resolve persistent directory for SQLite DB & Baileys Auth.
 * On Railway, /data or /app/auth_info_baileys is mounted as a persistent volume.
 */
export function resolveStoragePaths() {
  const envDataDir = process.env.DATA_DIR;
  let dataDir = __dirname;

  if (envDataDir && fs.existsSync(envDataDir)) {
    dataDir = envDataDir;
  } else if (fs.existsSync('/data')) {
    dataDir = '/data';
  } else if (process.env.RAILWAY_ENVIRONMENT && fs.existsSync('/app/auth_info_baileys')) {
    // Railway volume is mounted at /app/auth_info_baileys — store DB inside the mounted volume so redeploys never wipe it!
    dataDir = '/app/auth_info_baileys';
  }

  const authDir = process.env.AUTH_DIR || (
    dataDir === '/data'
      ? path.join('/data', 'auth_info_baileys')
      : path.join(__dirname, 'auth_info_baileys')
  );

  const dbPath = process.env.DB_PATH || path.join(dataDir, 'crm.db');
  const backupDir = path.join(dataDir, 'backups');
  const uploadsDir = path.join(dataDir, 'uploads');

  for (const dir of [path.dirname(dbPath), authDir, backupDir, uploadsDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // If moving from local ./crm.db to volume dbPath for the first time, copy existing DB so no data is lost
  const legacyDbPath = path.join(__dirname, 'crm.db');
  if (dbPath !== legacyDbPath && !fs.existsSync(dbPath) && fs.existsSync(legacyDbPath)) {
    try {
      fs.copyFileSync(legacyDbPath, dbPath);
      console.log(`📦 Migrated existing crm.db to persistent volume: ${dbPath}`);
    } catch (e) {
      console.error('⚠️ Legacy DB copy warning:', e.message);
    }
  }

  return { dataDir, authDir, dbPath, backupDir, uploadsDir };
}

export const STORAGE_PATHS = resolveStoragePaths();
const db = new Database(STORAGE_PATHS.dbPath);

// Enable WAL mode & foreign keys for high concurrency and safety
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

// ============================================================
// 🛠️ AUTOMATIC SCHEMA & MIGRATIONS
// ============================================================
db.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    phone TEXT PRIMARY KEY,
    name TEXT,
    city TEXT,
    state TEXT,
    distance_km_from_campus REAL,
    qualification TEXT,
    stream_branch TEXT,
    percentage REAL,
    category TEXT DEFAULT 'GEN',
    employed INTEGER,
    employment_type TEXT,
    work_experience_years REAL,
    job_role TEXT,
    goal TEXT,
    budget TEXT,
    preferred_mode TEXT,
    recommended_program TEXT,
    recommended_university TEXT,
    objections TEXT DEFAULT '[]',
    stage TEXT DEFAULT 'NEW',
    lead_score INTEGER DEFAULT 10,
    last_user_msg_at INTEGER,
    last_bot_msg_at INTEGER,
    ai_mode TEXT DEFAULT 'AI',
    human_until INTEGER,
    opted_out INTEGER DEFAULT 0,
    notes TEXT,
    tags TEXT DEFAULT '[]',
    docs_checklist TEXT DEFAULT '{}',
    docs_uploads TEXT DEFAULT '[]',
    is_ghost INTEGER DEFAULT 0,
    ghost_stage TEXT,
    follow_up_count INTEGER DEFAULT 0,
    unread_count INTEGER DEFAULT 0,
    consecutive_failures INTEGER DEFAULT 0,
    last_alert_at INTEGER,
    last_cta_turn INTEGER DEFAULT 0,
    turn_count INTEGER DEFAULT 0,
    -- Legacy columns kept in sync for backward compatibility
    sector TEXT,
    location TEXT,
    motivation TEXT,
    recommended_univ TEXT,
    ai_autopilot INTEGER DEFAULT 1,
    created_at INTEGER,
    last_active_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_phone TEXT,
    wa_msg_id TEXT,
    role TEXT,
    text TEXT,
    status TEXT DEFAULT 'SENT',
    is_follow_up INTEGER DEFAULT 0,
    media_type TEXT,
    media_path TEXT,
    raw_proto TEXT,
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS processed_msg_ids (
    msg_id TEXT PRIMARY KEY,
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS bot_sent_ids (
    msg_id TEXT PRIMARY KEY,
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS lid_map (
    lid TEXT PRIMARY KEY,
    phone_jid TEXT NOT NULL,
    updated_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS followup_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_phone TEXT NOT NULL,
    ghost_stage TEXT NOT NULL,
    followup_index INTEGER NOT NULL,
    strategy TEXT,
    due_at INTEGER NOT NULL,
    status TEXT DEFAULT 'PENDING',
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS outbound_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_phone TEXT NOT NULL,
    text TEXT NOT NULL,
    is_follow_up INTEGER DEFAULT 0,
    attempts INTEGER DEFAULT 0,
    last_error TEXT,
    status TEXT DEFAULT 'QUEUED',
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS kb_store (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_messages_lead ON messages(lead_phone);
  CREATE INDEX IF NOT EXISTS idx_leads_stage ON leads(stage);
  CREATE INDEX IF NOT EXISTS idx_followup_due ON followup_jobs(status, due_at);
  CREATE INDEX IF NOT EXISTS idx_outbound_status ON outbound_queue(status);
`);

// Add any missing columns to existing `leads` or `messages` tables non-destructively
function runMigrations() {
  const leadCols = new Set(db.prepare("PRAGMA table_info(leads)").all().map(c => c.name));
  const newLeadCols = [
    ['city', 'TEXT'],
    ['state', 'TEXT'],
    ['distance_km_from_campus', 'REAL'],
    ['stream_branch', 'TEXT'],
    ['category', "TEXT DEFAULT 'GEN'"],
    ['employed', 'INTEGER'],
    ['employment_type', 'TEXT'],
    ['work_experience_years', 'REAL'],
    ['job_role', 'TEXT'],
    ['goal', 'TEXT'],
    ['budget', 'TEXT'],
    ['preferred_mode', 'TEXT'],
    ['recommended_program', 'TEXT'],
    ['recommended_university', 'TEXT'],
    ['objections', "TEXT DEFAULT '[]'"],
    ['lead_score', 'INTEGER DEFAULT 10'],
    ['last_user_msg_at', 'INTEGER'],
    ['last_bot_msg_at', 'INTEGER'],
    ['ai_mode', "TEXT DEFAULT 'AI'"],
    ['human_until', 'INTEGER'],
    ['opted_out', 'INTEGER DEFAULT 0'],
    ['tags', "TEXT DEFAULT '[]'"],
    ['docs_uploads', "TEXT DEFAULT '[]'"],
    ['unread_count', 'INTEGER DEFAULT 0'],
    ['consecutive_failures', 'INTEGER DEFAULT 0'],
    ['last_alert_at', 'INTEGER'],
    ['last_cta_turn', 'INTEGER DEFAULT 0'],
    ['turn_count', 'INTEGER DEFAULT 0'],
    ['sector', 'TEXT'],
    ['location', 'TEXT'],
    ['motivation', 'TEXT'],
    ['recommended_univ', 'TEXT'],
    ['ai_autopilot', 'INTEGER DEFAULT 1']
  ];

  for (const [col, def] of newLeadCols) {
    if (!leadCols.has(col)) {
      db.exec(`ALTER TABLE leads ADD COLUMN ${col} ${def}`);
    }
  }

  const msgCols = new Set(db.prepare("PRAGMA table_info(messages)").all().map(c => c.name));
  const newMsgCols = [
    ['wa_msg_id', 'TEXT'],
    ['status', "TEXT DEFAULT 'SENT'"],
    ['media_type', 'TEXT'],
    ['media_path', 'TEXT'],
    ['raw_proto', 'TEXT']
  ];

  for (const [col, def] of newMsgCols) {
    if (!msgCols.has(col)) {
      db.exec(`ALTER TABLE messages ADD COLUMN ${col} ${def}`);
    }
  }

  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_wa_id ON messages(wa_msg_id);');
}

runMigrations();

// Seed KB from knowledge_base.json if kb_store is empty
const kbFilePath = path.join(__dirname, 'knowledge_base.json');
function seedKnowledgeBase() {
  try {
    const existing = db.prepare('SELECT id FROM kb_store WHERE id = ?').get('main');
    if (!existing && fs.existsSync(kbFilePath)) {
      const raw = fs.readFileSync(kbFilePath, 'utf8');
      db.prepare('INSERT INTO kb_store (id, data, updated_at) VALUES (?, ?, ?)').run('main', raw, Date.now());
    }
  } catch (e) {
    console.error('⚠️ KB seed error:', e.message);
  }
}
seedKnowledgeBase();

// Helper to parse JSON safely
function safeJson(str, fallback) {
  if (!str) return fallback;
  if (typeof str === 'object') return str;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

function hydrateLead(row) {
  if (!row) return null;
  const now = Date.now();
  // Auto-expire 12h human takeover if human_until has passed
  let aiMode = row.ai_mode || (row.ai_autopilot === 0 ? 'HUMAN' : 'AI');
  if (aiMode === 'HUMAN' && row.human_until && now > row.human_until) {
    aiMode = 'AI';
    db.prepare("UPDATE leads SET ai_mode = 'AI', ai_autopilot = 1, human_until = NULL WHERE phone = ?").run(row.phone);
  }

  const employmentType = row.employment_type || (
    row.sector
      ? (row.sector.toUpperCase().includes('GOV') ? 'GOVT' : row.sector.toUpperCase().includes('PSU') ? 'PSU' : 'PRIVATE')
      : null
  );
  const city = row.city || row.location || null;
  const goal = row.goal || row.motivation || null;
  const recommendedUniversity = row.recommended_university || row.recommended_univ || null;

  return {
    ...row,
    city,
    location: city,
    employment_type: employmentType,
    sector: employmentType,
    goal,
    motivation: goal,
    recommended_university: recommendedUniversity,
    recommended_univ: recommendedUniversity,
    employed: row.employed === null || row.employed === undefined ? (employmentType ? true : null) : Boolean(row.employed),
    ai_mode: aiMode,
    ai_autopilot: aiMode === 'AI',
    opted_out: Boolean(row.opted_out),
    is_ghost: Boolean(row.is_ghost),
    objections: safeJson(row.objections, []),
    tags: safeJson(row.tags, []),
    docs_checklist: safeJson(row.docs_checklist, {}),
    docs_uploads: safeJson(row.docs_uploads, []),
  };
}

// ============================================================
// 📦 EXPORTED DATABASE API
// ============================================================
export const LeadDB = {
  normalizePhoneJid(jid) {
    if (!jid) return jid;
    let clean = String(jid).trim();
    // Strip device suffix like :38@s.whatsapp.net
    clean = clean.replace(/:\d+@/, '@');
    // Check if it's an @lid that we already mapped
    if (clean.endsWith('@lid')) {
      const mapped = db.prepare('SELECT phone_jid FROM lid_map WHERE lid = ?').get(clean);
      if (mapped?.phone_jid) return mapped.phone_jid;
      return clean;
    }
    // If bare phone number was passed (e.g. from CLI command /lead 919876543210)
    if (!clean.includes('@')) {
      clean = clean.replace(/\D/g, '');
      if (clean.length === 10) clean = '91' + clean;
      clean = `${clean}@s.whatsapp.net`;
    }
    return clean;
  },

  mapLidToPhone(lidJid, phoneJid) {
    if (!lidJid || !phoneJid) return;
    const cleanLid = String(lidJid).replace(/:\d+@/, '@');
    const cleanPhone = this.normalizePhoneJid(phoneJid);
    if (!cleanLid.endsWith('@lid') || !cleanPhone.endsWith('@s.whatsapp.net')) return;

    db.prepare(`
      INSERT INTO lid_map (lid, phone_jid, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(lid) DO UPDATE SET phone_jid = excluded.phone_jid, updated_at = excluded.updated_at
    `).run(cleanLid, cleanPhone, Date.now());

    // If a temporary lead was created under the @lid before mapping was known, merge it into cleanPhone
    const lidLead = db.prepare('SELECT * FROM leads WHERE phone = ?').get(cleanLid);
    if (lidLead && cleanLid !== cleanPhone) {
      const phoneLead = db.prepare('SELECT * FROM leads WHERE phone = ?').get(cleanPhone);
      if (!phoneLead) {
        db.prepare('UPDATE leads SET phone = ? WHERE phone = ?').run(cleanPhone, cleanLid);
      } else {
        db.prepare('DELETE FROM leads WHERE phone = ?').run(cleanLid);
      }
      db.prepare('UPDATE messages SET lead_phone = ? WHERE lead_phone = ?').run(cleanPhone, cleanLid);
      db.prepare('UPDATE followup_jobs SET lead_phone = ? WHERE lead_phone = ?').run(cleanPhone, cleanLid);
      db.prepare('UPDATE outbound_queue SET lead_phone = ? WHERE lead_phone = ?').run(cleanPhone, cleanLid);
    }
  },

  get(phone) {
    const norm = this.normalizePhoneJid(phone);
    const row = db.prepare('SELECT * FROM leads WHERE phone = ?').get(norm);
    return hydrateLead(row);
  },

  getOrCreate(phone) {
    const norm = this.normalizePhoneJid(phone);
    let lead = this.get(norm);
    if (!lead) {
      lead = this.upsert(norm, { stage: 'NEW', ai_mode: 'AI', lead_score: 10 });
    }
    return lead;
  },

  getAll() {
    const rows = db.prepare(`
      SELECT l.*, 
        (SELECT text FROM messages WHERE lead_phone = l.phone ORDER BY id DESC LIMIT 1) as last_message,
        (SELECT created_at FROM messages WHERE lead_phone = l.phone ORDER BY id DESC LIMIT 1) as last_message_time,
        (SELECT status FROM messages WHERE lead_phone = l.phone ORDER BY id DESC LIMIT 1) as last_message_status
      FROM leads l
      ORDER BY COALESCE(l.last_active_at, l.created_at) DESC
    `).all();

    return rows.map(hydrateLead);
  },

  upsert(phone, data = {}) {
    const norm = this.normalizePhoneJid(phone);
    const existing = db.prepare('SELECT * FROM leads WHERE phone = ?').get(norm);
    const now = Date.now();

    // Synchronize alias fields
    const payload = { ...data };
    if (payload.naam !== undefined && payload.name === undefined) payload.name = payload.naam;
    delete payload.naam;

    if (payload.sector !== undefined && payload.employment_type === undefined) {
      const s = String(payload.sector || '').toUpperCase();
      payload.employment_type = s.includes('GOV') ? 'GOVT' : s.includes('PSU') ? 'PSU' : s ? 'PRIVATE' : null;
    }
    if (payload.employment_type !== undefined) {
      payload.sector = payload.employment_type;
      if (payload.employment_type && payload.employed === undefined) payload.employed = 1;
    }
    if (payload.location !== undefined && payload.city === undefined) payload.city = payload.location;
    if (payload.city !== undefined) payload.location = payload.city;
    if (payload.motivation !== undefined && payload.goal === undefined) payload.goal = payload.motivation;
    if (payload.goal !== undefined) payload.motivation = payload.goal;
    if (payload.recommended_univ !== undefined && payload.recommended_university === undefined) {
      payload.recommended_university = payload.recommended_univ;
    }
    if (payload.recommended_university !== undefined) {
      payload.recommended_univ = payload.recommended_university;
    }
    if (payload.ai_autopilot !== undefined && payload.ai_mode === undefined) {
      payload.ai_mode = payload.ai_autopilot ? 'AI' : 'HUMAN';
    }
    if (payload.ai_mode !== undefined) {
      payload.ai_autopilot = payload.ai_mode === 'AI' ? 1 : 0;
    }

    const validColumns = new Set([
      'name', 'city', 'state', 'distance_km_from_campus', 'qualification', 'stream_branch',
      'percentage', 'category', 'employed', 'employment_type', 'work_experience_years',
      'job_role', 'goal', 'budget', 'preferred_mode', 'recommended_program',
      'recommended_university', 'objections', 'stage', 'lead_score', 'last_user_msg_at',
      'last_bot_msg_at', 'ai_mode', 'human_until', 'opted_out', 'notes', 'tags',
      'docs_checklist', 'docs_uploads', 'is_ghost', 'ghost_stage', 'follow_up_count',
      'unread_count', 'consecutive_failures', 'last_alert_at', 'last_cta_turn', 'turn_count',
      'sector', 'location', 'motivation', 'recommended_univ', 'ai_autopilot', 'last_active_at'
    ]);

    if (!existing) {
      db.prepare(`
        INSERT INTO leads (phone, stage, ai_mode, ai_autopilot, lead_score, created_at, last_active_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        norm,
        payload.stage || 'NEW',
        payload.ai_mode || 'AI',
        payload.ai_autopilot !== undefined ? (payload.ai_autopilot ? 1 : 0) : 1,
        payload.lead_score || 10,
        now,
        now
      );
    }

    const updates = [];
    const values = [];

    for (const [key, val] of Object.entries(payload)) {
      if (!validColumns.has(key) || val === undefined) continue;
      if (['employed', 'opted_out', 'is_ghost', 'ai_autopilot'].includes(key)) {
        updates.push(`${key} = ?`);
        values.push(val === null ? null : (val ? 1 : 0));
      } else if (['objections', 'tags', 'docs_checklist', 'docs_uploads'].includes(key)) {
        updates.push(`${key} = ?`);
        values.push(typeof val === 'string' ? val : JSON.stringify(val));
      } else {
        updates.push(`${key} = ?`);
        values.push(val);
      }
    }

    if (updates.length > 0) {
      values.push(norm);
      db.prepare(`UPDATE leads SET ${updates.join(', ')} WHERE phone = ?`).run(...values);
    }

    return this.get(norm);
  },

  addMessage(leadPhone, role, text, options = {}) {
    const norm = this.normalizePhoneJid(leadPhone);
    this.getOrCreate(norm);
    const now = Date.now();
    const isFollowUp = typeof options === 'boolean' ? options : Boolean(options.isFollowUp);
    const waMsgId = options.waMsgId || null;
    const status = options.status || 'SENT';
    const mediaType = options.mediaType || null;
    const mediaPath = options.mediaPath || null;
    const rawProto = options.rawProto ? JSON.stringify(options.rawProto) : null;

    const res = db.prepare(`
      INSERT INTO messages (lead_phone, wa_msg_id, role, text, status, is_follow_up, media_type, media_path, raw_proto, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(norm, waMsgId, role, text, status, isFollowUp ? 1 : 0, mediaType, mediaPath, rawProto, now);

    if (role === 'user') {
      db.prepare('UPDATE leads SET last_active_at = ?, last_user_msg_at = ?, unread_count = COALESCE(unread_count, 0) + 1 WHERE phone = ?').run(now, now, norm);
    } else {
      db.prepare('UPDATE leads SET last_active_at = ?, last_bot_msg_at = ? WHERE phone = ?').run(now, now, norm);
    }

    return res.lastInsertRowid;
  },

  updateMessageStatus(waMsgId, status) {
    if (!waMsgId || !status) return;
    db.prepare('UPDATE messages SET status = ? WHERE wa_msg_id = ?').run(status, waMsgId);
  },

  getRawMessageByWaId(waMsgId) {
    if (!waMsgId) return null;
    const row = db.prepare('SELECT raw_proto, text FROM messages WHERE wa_msg_id = ? LIMIT 1').get(waMsgId);
    if (!row) return null;
    if (row.raw_proto) {
      try { return JSON.parse(row.raw_proto); } catch { /* ignore */ }
    }
    return { conversation: row.text };
  },

  getMessages(leadPhone, limit = 50) {
    const norm = this.normalizePhoneJid(leadPhone);
    const rows = db.prepare(`
      SELECT * FROM (
        SELECT * FROM messages 
        WHERE lead_phone = ? 
        ORDER BY id DESC 
        LIMIT ?
      ) ORDER BY id ASC
    `).all(norm, limit);
    return rows;
  },

  markReadOnDashboard(leadPhone) {
    const norm = this.normalizePhoneJid(leadPhone);
    db.prepare('UPDATE leads SET unread_count = 0 WHERE phone = ?').run(norm);
  },

  // Idempotency for incoming Baileys messages
  isMessageProcessed(msgId) {
    if (!msgId) return false;
    const row = db.prepare('SELECT msg_id FROM processed_msg_ids WHERE msg_id = ?').get(msgId);
    return Boolean(row);
  },

  markMessageProcessed(msgId) {
    if (!msgId) return;
    db.prepare('INSERT OR IGNORE INTO processed_msg_ids (msg_id, created_at) VALUES (?, ?)').run(msgId, Date.now());
  },

  // Track bot's own sent message IDs so we can distinguish human replies from the linked phone
  markBotSentId(msgId) {
    if (!msgId) return;
    db.prepare('INSERT OR IGNORE INTO bot_sent_ids (msg_id, created_at) VALUES (?, ?)').run(msgId, Date.now());
  },

  isBotSentId(msgId) {
    if (!msgId) return false;
    const row = db.prepare('SELECT msg_id FROM bot_sent_ids WHERE msg_id = ?').get(msgId);
    return Boolean(row);
  },

  // Outbound Queue for failed / disconnected sends
  enqueueOutbound(leadPhone, text, isFollowUp = false, lastError = null) {
    const norm = this.normalizePhoneJid(leadPhone);
    const res = db.prepare(`
      INSERT INTO outbound_queue (lead_phone, text, is_follow_up, attempts, last_error, status, created_at)
      VALUES (?, ?, ?, 1, ?, 'QUEUED', ?)
    `).run(norm, text, isFollowUp ? 1 : 0, lastError, Date.now());
    return res.lastInsertRowid;
  },

  getPendingOutbound() {
    return db.prepare("SELECT * FROM outbound_queue WHERE status = 'QUEUED' ORDER BY id ASC LIMIT 50").all();
  },

  markOutboundSent(id) {
    db.prepare("UPDATE outbound_queue SET status = 'SENT' WHERE id = ?").run(id);
  },

  markOutboundFailed(id, errorMsg) {
    db.prepare("UPDATE outbound_queue SET attempts = attempts + 1, last_error = ?, status = CASE WHEN attempts + 1 >= 5 THEN 'FAILED' ELSE 'QUEUED' END WHERE id = ?").run(errorMsg, id);
  },

  // Persistent Follow-Up Scheduler Jobs
  scheduleFollowUpJobs(leadPhone, ghostStage, jobs) {
    const norm = this.normalizePhoneJid(leadPhone);
    this.cancelFollowUpJobs(norm);
    const stmt = db.prepare(`
      INSERT INTO followup_jobs (lead_phone, ghost_stage, followup_index, strategy, due_at, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'PENDING', ?)
    `);
    const now = Date.now();
    for (const j of jobs) {
      stmt.run(norm, ghostStage, j.followupIndex, j.strategy, j.dueAt, now);
    }
  },

  cancelFollowUpJobs(leadPhone) {
    const norm = this.normalizePhoneJid(leadPhone);
    db.prepare("UPDATE followup_jobs SET status = 'CANCELLED' WHERE lead_phone = ? AND status = 'PENDING'").run(norm);
  },

  getDueFollowUpJobs(now = Date.now()) {
    return db.prepare(`
      SELECT * FROM followup_jobs
      WHERE status = 'PENDING' AND due_at <= ?
      ORDER BY due_at ASC
    `).all(now);
  },

  getPendingFollowUpJobsForLead(leadPhone) {
    const norm = this.normalizePhoneJid(leadPhone);
    return db.prepare(`
      SELECT * FROM followup_jobs
      WHERE lead_phone = ? AND status = 'PENDING'
      ORDER BY due_at ASC
    `).all(norm);
  },

  getAllPendingFollowUpJobs() {
    return db.prepare(`
      SELECT f.*, l.name, l.stage, l.recommended_university
      FROM followup_jobs f
      LEFT JOIN leads l ON l.phone = f.lead_phone
      WHERE f.status = 'PENDING'
      ORDER BY f.due_at ASC
    `).all();
  },

  rescheduleFollowUpJob(jobId, newDueAt) {
    db.prepare('UPDATE followup_jobs SET due_at = ? WHERE id = ?').run(newDueAt, jobId);
  },

  markFollowUpJobDone(jobId, status = 'SENT') {
    db.prepare('UPDATE followup_jobs SET status = ? WHERE id = ?').run(status, jobId);
  },

  // Knowledge Base Management
  getKnowledgeBase() {
    try {
      const row = db.prepare('SELECT data FROM kb_store WHERE id = ?').get('main');
      if (row?.data) return JSON.parse(row.data);
    } catch (e) {
      console.error('⚠️ Error reading KB from DB:', e.message);
    }
    return JSON.parse(fs.readFileSync(kbFilePath, 'utf8'));
  },

  saveKnowledgeBase(kbObject) {
    const updated = {
      ...kbObject,
      last_verified_date: new Date().toISOString().slice(0, 10)
    };
    const jsonStr = JSON.stringify(updated, null, 2);
    db.prepare(`
      INSERT INTO kb_store (id, data, updated_at)
      VALUES ('main', ?, ?)
      ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
    `).run(jsonStr, Date.now());
    try {
      fs.writeFileSync(kbFilePath, jsonStr, 'utf8');
    } catch { /* ignore if read-only fs */ }
    return updated;
  },

  // Stats & Analytics
  getStats() {
    const totalLeads = db.prepare('SELECT COUNT(*) as count FROM leads').get().count;
    const stages = db.prepare('SELECT stage, COUNT(*) as count FROM leads GROUP BY stage').all();
    const ghostCount = db.prepare('SELECT COUNT(*) as count FROM leads WHERE is_ghost = 1').get().count;
    const manualCount = db.prepare("SELECT COUNT(*) as count FROM leads WHERE ai_mode = 'HUMAN' OR ai_autopilot = 0").get().count;
    const hotCount = db.prepare("SELECT COUNT(*) as count FROM leads WHERE lead_score >= 70 OR stage IN ('WARM', 'INTERESTED', 'DOCS_PENDING', 'PAYMENT_PENDING')").get().count;
    const optedOutCount = db.prepare('SELECT COUNT(*) as count FROM leads WHERE opted_out = 1').get().count;
    const totalMessages = db.prepare('SELECT COUNT(*) as count FROM messages').get().count;
    const failedMessages = db.prepare("SELECT COUNT(*) as count FROM messages WHERE status = 'FAILED'").get().count;

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayTs = startOfToday.getTime();
    const newLeadsToday = db.prepare('SELECT COUNT(*) as count FROM leads WHERE created_at >= ?').get(todayTs).count;
    const activeToday = db.prepare('SELECT COUNT(*) as count FROM leads WHERE last_active_at >= ?').get(todayTs).count;
    const enrolledToday = db.prepare("SELECT COUNT(*) as count FROM leads WHERE stage = 'ENROLLED' AND last_active_at >= ?").get(todayTs).count;

    // Top objections aggregation
    const allObjs = db.prepare('SELECT objections FROM leads WHERE objections IS NOT NULL').all();
    const objectionCounts = {};
    for (const r of allObjs) {
      const arr = safeJson(r.objections, []);
      for (const o of arr) {
        objectionCounts[o] = (objectionCounts[o] || 0) + 1;
      }
    }

    return {
      totalLeads,
      newLeadsToday,
      activeToday,
      enrolledToday,
      ghostCount,
      manualCount,
      hotCount,
      optedOutCount,
      totalMessages,
      failedMessages,
      stageCounts: Object.fromEntries(stages.map(s => [s.stage, s.count])),
      objectionCounts
    };
  },

  // Daily Backup
  createBackup() {
    try {
      const dateStr = new Date().toISOString().slice(0, 10);
      const dest = path.join(STORAGE_PATHS.backupDir, `crm-backup-${dateStr}.db`);
      db.backup(dest);
      return dest;
    } catch (e) {
      console.error('⚠️ DB backup error:', e.message);
      return null;
    }
  }
};
