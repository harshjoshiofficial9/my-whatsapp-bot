import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, 'crm.db');

const db = new Database(dbPath);

// Enable WAL mode for high performance
db.pragma('journal_mode = WAL');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    phone TEXT PRIMARY KEY,
    name TEXT,
    sector TEXT,
    location TEXT,
    qualification TEXT,
    percentage REAL,
    motivation TEXT,
    recommended_univ TEXT,
    stage TEXT DEFAULT 'NEW',
    ai_autopilot INTEGER DEFAULT 1,
    is_ghost INTEGER DEFAULT 0,
    ghost_stage TEXT,
    follow_up_count INTEGER DEFAULT 0,
    notes TEXT,
    docs_checklist TEXT,
    created_at INTEGER,
    last_active_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_phone TEXT,
    role TEXT,
    text TEXT,
    is_follow_up INTEGER DEFAULT 0,
    created_at INTEGER,
    FOREIGN KEY(lead_phone) REFERENCES leads(phone)
  );

  CREATE INDEX IF NOT EXISTS idx_messages_lead ON messages(lead_phone);
  CREATE INDEX IF NOT EXISTS idx_leads_stage ON leads(stage);
`);

export const LeadDB = {
  get(phone) {
    const row = db.prepare('SELECT * FROM leads WHERE phone = ?').get(phone);
    if (!row) return null;
    return {
      ...row,
      ai_autopilot: Boolean(row.ai_autopilot),
      is_ghost: Boolean(row.is_ghost),
      docs_checklist: row.docs_checklist ? JSON.parse(row.docs_checklist) : {},
    };
  },

  getAll() {
    const rows = db.prepare(`
      SELECT l.*, 
        (SELECT text FROM messages WHERE lead_phone = l.phone ORDER BY id DESC LIMIT 1) as last_message,
        (SELECT created_at FROM messages WHERE lead_phone = l.phone ORDER BY id DESC LIMIT 1) as last_message_time
      FROM leads l
      ORDER BY l.last_active_at DESC
    `).all();

    return rows.map(r => ({
      ...r,
      ai_autopilot: Boolean(r.ai_autopilot),
      is_ghost: Boolean(r.is_ghost),
      docs_checklist: r.docs_checklist ? JSON.parse(r.docs_checklist) : {},
    }));
  },

  upsert(phone, data) {
    const existing = db.prepare('SELECT phone FROM leads WHERE phone = ?').get(phone);
    const now = Date.now();

    if (!existing) {
      db.prepare(`
        INSERT INTO leads (
          phone, name, sector, location, qualification, percentage, motivation,
          recommended_univ, stage, ai_autopilot, is_ghost, ghost_stage, follow_up_count,
          notes, docs_checklist, created_at, last_active_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?
        )
      `).run(
        phone,
        data.name || null,
        data.sector || null,
        data.location || null,
        data.qualification || null,
        data.percentage !== undefined ? data.percentage : null,
        data.motivation || null,
        data.recommended_univ || null,
        data.stage || 'NEW',
        data.ai_autopilot !== undefined ? (data.ai_autopilot ? 1 : 0) : 1,
        data.is_ghost !== undefined ? (data.is_ghost ? 1 : 0) : 0,
        data.ghost_stage || null,
        data.follow_up_count || 0,
        data.notes || null,
        JSON.stringify(data.docs_checklist || {}),
        now,
        now
      );
    } else {
      // Dynamic update of provided fields
      const updates = [];
      const values = [];

      for (const [key, val] of Object.entries(data)) {
        if (key === 'phone' || key === 'created_at') continue;
        if (key === 'ai_autopilot' || key === 'is_ghost') {
          updates.push(`${key} = ?`);
          values.push(val ? 1 : 0);
        } else if (key === 'docs_checklist') {
          updates.push(`${key} = ?`);
          values.push(JSON.stringify(val));
        } else {
          updates.push(`${key} = ?`);
          values.push(val);
        }
      }

      if (!data.last_active_at) {
        updates.push('last_active_at = ?');
        values.push(now);
      }

      if (updates.length > 0) {
        values.push(phone);
        db.prepare(`UPDATE leads SET ${updates.join(', ')} WHERE phone = ?`).run(...values);
      }
    }

    return this.get(phone);
  },

  addMessage(leadPhone, role, text, isFollowUp = false) {
    const now = Date.now();
    const res = db.prepare(`
      INSERT INTO messages (lead_phone, role, text, is_follow_up, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(leadPhone, role, text, isFollowUp ? 1 : 0, now);

    db.prepare('UPDATE leads SET last_active_at = ? WHERE phone = ?').run(now, leadPhone);
    return res.lastInsertRowid;
  },

  getMessages(leadPhone, limit = 50) {
    return db.prepare(`
      SELECT * FROM messages 
      WHERE lead_phone = ? 
      ORDER BY id ASC 
      LIMIT ?
    `).all(leadPhone, limit);
  },

  getStats() {
    const totalLeads = db.prepare('SELECT COUNT(*) as count FROM leads').get().count;
    const stages = db.prepare('SELECT stage, COUNT(*) as count FROM leads GROUP BY stage').all();
    const ghostCount = db.prepare('SELECT COUNT(*) as count FROM leads WHERE is_ghost = 1').get().count;
    const manualCount = db.prepare('SELECT COUNT(*) as count FROM leads WHERE ai_autopilot = 0').get().count;
    const totalMessages = db.prepare('SELECT COUNT(*) as count FROM messages').get().count;

    return {
      totalLeads,
      ghostCount,
      manualCount,
      totalMessages,
      stageCounts: Object.fromEntries(stages.map(s => [s.stage, s.count])),
    };
  }
};
