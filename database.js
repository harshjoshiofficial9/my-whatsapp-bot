import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Resolve persistent directory for SQLite DB, Baileys Auth, Knowledge Library & Uploads.
 * On Render.com, /data is the mounted Persistent Disk. Falls back gracefully to local paths.
 */
export function resolveStoragePaths() {
  const hasRenderDisk = fs.existsSync('/data');
  const baseDataDir = process.env.DATA_DIR || (hasRenderDisk ? '/data' : path.join(__dirname, 'data'));

  const dbPath = process.env.DB_PATH || (
    hasRenderDisk
      ? '/data/crm.db'
      : (fs.existsSync(path.join(__dirname, 'crm.db')) ? path.join(__dirname, 'crm.db') : path.join(baseDataDir, 'crm.db'))
  );

  const authDir = process.env.AUTH_DIR || (
    hasRenderDisk ? '/data/auth' : path.join(__dirname, 'auth_info_baileys')
  );

  const knowledgeDir = process.env.KNOWLEDGE_DIR || path.join(baseDataDir, 'knowledge_library');
  const uploadsDir = process.env.UPLOADS_DIR || path.join(baseDataDir, 'uploads');
  const backupDir = path.join(baseDataDir, 'backups');

  for (const dir of [baseDataDir, path.dirname(dbPath), authDir, knowledgeDir, uploadsDir, backupDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  return { dataDir: baseDataDir, authDir, dbPath, knowledgeDir, uploadsDir, backupDir };
}

export const STORAGE_PATHS = resolveStoragePaths();
export const db = new Database(STORAGE_PATHS.dbPath);

// Enable WAL mode for high concurrency and crash safety
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
    preferred_program TEXT,
    recommended_program TEXT,
    recommended_university TEXT,
    declined_programs TEXT DEFAULT '[]',
    objections TEXT DEFAULT '[]',
    conversation_mood TEXT DEFAULT 'neutral',
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
    last_thought TEXT,
    last_reasoning TEXT,
    last_intent TEXT,
    last_rag_docs TEXT DEFAULT '[]',
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
    thought TEXT,
    reasoning TEXT,
    detected_intent TEXT,
    rag_docs TEXT,
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

  CREATE TABLE IF NOT EXISTS knowledge_docs (
    doc_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    tags TEXT DEFAULT '',
    category TEXT DEFAULT 'General',
    summary TEXT DEFAULT '',
    content TEXT NOT NULL,
    word_count INTEGER DEFAULT 0,
    chunk_count INTEGER DEFAULT 0,
    updated_at INTEGER
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks_fts USING fts5(
    doc_id,
    title,
    tags,
    category,
    chunk_text
  );

  CREATE TABLE IF NOT EXISTS llm_telemetry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_phone TEXT,
    model TEXT,
    prompt_tokens INTEGER DEFAULT 0,
    cached_tokens INTEGER DEFAULT 0,
    completion_tokens INTEGER DEFAULT 0,
    remaining_requests INTEGER,
    remaining_tokens INTEGER,
    reset_requests TEXT,
    reset_tokens TEXT,
    created_at INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_messages_lead ON messages(lead_phone);
  CREATE INDEX IF NOT EXISTS idx_leads_stage ON leads(stage);
  CREATE INDEX IF NOT EXISTS idx_followup_due ON followup_jobs(status, due_at);
  CREATE INDEX IF NOT EXISTS idx_outbound_status ON outbound_queue(status);
  CREATE INDEX IF NOT EXISTS idx_telemetry_created ON llm_telemetry(created_at);
`);

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
    ['preferred_program', 'TEXT'],
    ['recommended_program', 'TEXT'],
    ['recommended_university', 'TEXT'],
    ['declined_programs', "TEXT DEFAULT '[]'"],
    ['objections', "TEXT DEFAULT '[]'"],
    ['conversation_mood', "TEXT DEFAULT 'neutral'"],
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
    ['last_thought', 'TEXT'],
    ['last_reasoning', 'TEXT'],
    ['last_intent', 'TEXT'],
    ['last_rag_docs', "TEXT DEFAULT '[]'"],
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
    ['raw_proto', 'TEXT'],
    ['thought', 'TEXT'],
    ['reasoning', 'TEXT'],
    ['detected_intent', 'TEXT'],
    ['rag_docs', 'TEXT']
  ];

  for (const [col, def] of newMsgCols) {
    if (!msgCols.has(col)) {
      db.exec(`ALTER TABLE messages ADD COLUMN ${col} ${def}`);
    }
  }

  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_wa_id ON messages(wa_msg_id);');
}

runMigrations();

// Sync KB from knowledge_base.json on first boot or if updated
const kbFilePath = path.join(__dirname, 'knowledge_base.json');
function seedKnowledgeBase() {
  try {
    const existing = db.prepare('SELECT id, data FROM kb_store WHERE id = ?').get('main');
    if (fs.existsSync(kbFilePath)) {
      const raw = fs.readFileSync(kbFilePath, 'utf8');
      if (!existing) {
        db.prepare('INSERT INTO kb_store (id, data, updated_at) VALUES (?, ?, ?)').run('main', raw, Date.now());
      } else {
        // Ensure faq_knowledge and brand exist if upgrading from earlier schema
        const parsedExisting = JSON.parse(existing.data);
        if (!parsedExisting.faq_knowledge || !parsedExisting.brand) {
          db.prepare('UPDATE kb_store SET data = ?, updated_at = ? WHERE id = ?').run(raw, Date.now(), 'main');
        }
      }
    }
  } catch (e) {
    console.error('⚠️ KB seed error:', e.message);
  }
}
seedKnowledgeBase();

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
    declined_programs: safeJson(row.declined_programs, []),
    objections: safeJson(row.objections, []),
    tags: safeJson(row.tags, []),
    docs_checklist: safeJson(row.docs_checklist, {}),
    docs_uploads: safeJson(row.docs_uploads, []),
    last_rag_docs: safeJson(row.last_rag_docs, [])
  };
}

export const LeadDB = {
  normalizePhoneJid(jid) {
    if (!jid) return jid;
    let clean = String(jid).trim();
    clean = clean.replace(/:\d+@/, '@');
    if (clean.endsWith('@lid')) {
      const mapped = db.prepare('SELECT phone_jid FROM lid_map WHERE lid = ?').get(clean);
      if (mapped?.phone_jid) return mapped.phone_jid;
      return clean;
    }
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
      'job_role', 'goal', 'budget', 'preferred_mode', 'preferred_program',
      'recommended_program', 'recommended_university', 'declined_programs', 'objections',
      'conversation_mood', 'stage', 'lead_score', 'last_user_msg_at', 'last_bot_msg_at',
      'ai_mode', 'human_until', 'opted_out', 'notes', 'tags', 'docs_checklist', 'docs_uploads',
      'is_ghost', 'ghost_stage', 'follow_up_count', 'unread_count', 'consecutive_failures',
      'last_alert_at', 'last_cta_turn', 'turn_count', 'last_thought', 'last_reasoning',
      'last_intent', 'last_rag_docs', 'sector', 'location', 'motivation', 'recommended_univ',
      'ai_autopilot', 'last_active_at'
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
      } else if (['declined_programs', 'objections', 'tags', 'docs_checklist', 'docs_uploads', 'last_rag_docs'].includes(key)) {
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
    const thought = options.thought || null;
    const reasoning = options.reasoning || null;
    const detectedIntent = options.detectedIntent || null;
    const ragDocs = options.ragDocs ? JSON.stringify(options.ragDocs) : null;

    const res = db.prepare(`
      INSERT INTO messages (
        lead_phone, wa_msg_id, role, text, status, is_follow_up,
        media_type, media_path, raw_proto, thought, reasoning, detected_intent, rag_docs, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      norm, waMsgId, role, text, status, isFollowUp ? 1 : 0,
      mediaType, mediaPath, rawProto, thought, reasoning, detectedIntent, ragDocs, now
    );

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
    return db.prepare(`
      SELECT * FROM (
        SELECT * FROM messages 
        WHERE lead_phone = ? 
        ORDER BY id DESC 
        LIMIT ?
      ) ORDER BY id ASC
    `).all(norm, limit);
  },

  /**
   * Section 2.3 & 2.6: Merge multi-bubble bot turns into a single assistant message separated by \n\n
   * and consecutive user messages into a single user message separated by \n so the LLM clearly sees
   * everything it already said and NEVER repeats itself!
   */
  getMergedConversationTurns(leadPhone, maxTurns = 12) {
    const rawMsgs = this.getMessages(leadPhone, 35);
    const merged = [];

    for (const m of rawMsgs) {
      const role = m.role === 'user' ? 'user' : 'assistant';
      const text = String(m.text || '').trim();
      if (!text) continue;

      if (merged.length > 0 && merged[merged.length - 1].role === role) {
        const sep = role === 'assistant' ? '\n\n' : '\n';
        merged[merged.length - 1].content += `${sep}${text}`;
      } else {
        merged.push({ role, content: text });
      }
    }

    return merged.slice(-maxTurns);
  },

  markReadOnDashboard(leadPhone) {
    const norm = this.normalizePhoneJid(leadPhone);
    db.prepare('UPDATE leads SET unread_count = 0 WHERE phone = ?').run(norm);
  },

  clearMessages(leadPhone) {
    const norm = this.normalizePhoneJid(leadPhone);
    const rows = db.prepare('SELECT wa_msg_id FROM messages WHERE lead_phone = ? AND wa_msg_id IS NOT NULL').all(norm);
    for (const r of rows) {
      db.prepare('DELETE FROM processed_msg_ids WHERE msg_id = ?').run(r.wa_msg_id);
    }
    db.prepare('DELETE FROM messages WHERE lead_phone = ?').run(norm);
  },

  deleteLead(leadPhone) {
    const norm = this.normalizePhoneJid(leadPhone);
    this.clearMessages(norm);
    this.cancelFollowUpJobs(norm);
    db.prepare('DELETE FROM outbound_queue WHERE lead_phone = ?').run(norm);
    db.prepare('DELETE FROM leads WHERE phone = ?').run(norm);
  },

  isMessageProcessed(msgId) {
    if (!msgId) return false;
    const row = db.prepare('SELECT msg_id FROM processed_msg_ids WHERE msg_id = ?').get(msgId);
    return Boolean(row);
  },

  markMessageProcessed(msgId) {
    if (!msgId) return;
    db.prepare('INSERT OR IGNORE INTO processed_msg_ids (msg_id, created_at) VALUES (?, ?)').run(msgId, Date.now());
  },

  markBotSentId(msgId) {
    if (!msgId) return;
    db.prepare('INSERT OR IGNORE INTO bot_sent_ids (msg_id, created_at) VALUES (?, ?)').run(msgId, Date.now());
  },

  isBotSentId(msgId) {
    if (!msgId) return false;
    const row = db.prepare('SELECT msg_id FROM bot_sent_ids WHERE msg_id = ?').get(msgId);
    return Boolean(row);
  },

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

  // Record Groq LLM Telemetry & Rate Limit Headers (Section 2.6)
  recordLlmTelemetry({
    leadPhone = null,
    model = 'openai/gpt-oss-120b',
    promptTokens = 0,
    cachedTokens = 0,
    completionTokens = 0,
    remainingRequests = null,
    remainingTokens = null,
    resetRequests = null,
    resetTokens = null
  }) {
    db.prepare(`
      INSERT INTO llm_telemetry (
        lead_phone, model, prompt_tokens, cached_tokens, completion_tokens,
        remaining_requests, remaining_tokens, reset_requests, reset_tokens, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      leadPhone, model, promptTokens, cachedTokens, completionTokens,
      remainingRequests !== null ? Number(remainingRequests) : null,
      remainingTokens !== null ? Number(remainingTokens) : null,
      resetRequests, resetTokens, Date.now()
    );
  },

  getGroqQuotaMetrics() {
    // Daily reset is 00:00 UTC (5:30 AM IST)
    const now = new Date();
    const utcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0);

    const agg = db.prepare(`
      SELECT
        COUNT(*) as requests_today,
        COALESCE(SUM(prompt_tokens), 0) as prompt_tokens_today,
        COALESCE(SUM(cached_tokens), 0) as cached_tokens_today,
        COALESCE(SUM(completion_tokens), 0) as completion_tokens_today
      FROM llm_telemetry
      WHERE created_at >= ?
    `).get(utcMidnight);

    const latest = db.prepare(`
      SELECT * FROM llm_telemetry ORDER BY id DESC LIMIT 1
    `).get();

    const totalPrompt = agg.prompt_tokens_today || 0;
    const totalCached = agg.cached_tokens_today || 0;
    const uncachedPrompt = Math.max(0, totalPrompt - totalCached);
    const totalUncachedAndCompletion = uncachedPrompt + (agg.completion_tokens_today || 0);
    const cacheHitPct = totalPrompt > 0 ? Math.round((totalCached / totalPrompt) * 100) : 0;
    const avgUncachedPerTurn = agg.requests_today > 0 ? Math.round(uncachedPrompt / agg.requests_today) : 0;

    return {
      model: process.env.LLM_MODEL || 'openai/gpt-oss-120b',
      rpd_limit: 1000,
      tpd_limit: 200000,
      rpm_limit: 30,
      tpm_limit: 8000,
      requests_used_today: agg.requests_today || 0,
      requests_remaining_today: latest?.remaining_requests ?? Math.max(0, 1000 - (agg.requests_today || 0)),
      tokens_used_today: totalUncachedAndCompletion,
      tokens_remaining_today: Math.max(0, 200000 - totalUncachedAndCompletion),
      prompt_tokens_today: totalPrompt,
      cached_tokens_today: totalCached,
      completion_tokens_today: agg.completion_tokens_today || 0,
      cache_hit_pct: cacheHitPct,
      avg_uncached_tokens_per_turn: avgUncachedPerTurn,
      latest_remaining_tpm: latest?.remaining_tokens ?? 8000
    };
  },

  getStats() {
    const totalLeads = db.prepare('SELECT COUNT(*) as count FROM leads').get().count;
    const stages = db.prepare('SELECT stage, COUNT(*) as count FROM leads GROUP BY stage').all();
    const ghostCount = db.prepare('SELECT COUNT(*) as count FROM leads WHERE is_ghost = 1').get().count;
    const manualCount = db.prepare("SELECT COUNT(*) as count FROM leads WHERE ai_mode = 'HUMAN' OR ai_autopilot = 0").get().count;
    const hotCount = db.prepare("SELECT COUNT(*) as count FROM leads WHERE lead_score >= 70 OR stage IN ('WARM', 'INTERESTED', 'DOCS_PENDING', 'PAYMENT_PENDING')").get().count;
    const optedOutCount = db.prepare('SELECT COUNT(*) as count FROM leads WHERE opted_out = 1').get().count;
    const totalMessages = db.prepare('SELECT COUNT(*) as count FROM messages').get().count;
    const failedMessages = db.prepare("SELECT COUNT(*) as count FROM messages WHERE status = 'FAILED'").get().count;
    const knowledgeDocsCount = db.prepare('SELECT COUNT(*) as count FROM knowledge_docs').get().count;
    const knowledgeWordsCount = db.prepare('SELECT COALESCE(SUM(word_count), 0) as words FROM knowledge_docs').get().words;

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayTs = startOfToday.getTime();
    const newLeadsToday = db.prepare('SELECT COUNT(*) as count FROM leads WHERE created_at >= ?').get(todayTs).count;
    const activeToday = db.prepare('SELECT COUNT(*) as count FROM leads WHERE last_active_at >= ?').get(todayTs).count;
    const enrolledToday = db.prepare("SELECT COUNT(*) as count FROM leads WHERE stage = 'ENROLLED' AND last_active_at >= ?").get(todayTs).count;

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
      knowledgeDocsCount,
      knowledgeWordsCount,
      stageCounts: Object.fromEntries(stages.map(s => [s.stage, s.count])),
      objectionCounts,
      groqQuota: this.getGroqQuotaMetrics()
    };
  },

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
