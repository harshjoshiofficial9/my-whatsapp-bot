import express from 'express';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import QRCode from 'qrcode';
import { LeadDB, STORAGE_PATHS } from './database.js';
import { inferFromUserText, evaluateEligibility, computeStageAndScore } from './eligibilityEngine.js';
import { generateCounselorTurn, generateContextualFollowUp } from './llmBrain.js';
import { sendSingleBubbleWithRetry, processStudentTurn } from './conversationController.js';
import { HOUR } from './followupEngine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CRM_USERNAME = process.env.CRM_USERNAME || 'harsh';
const CRM_PASSWORD = process.env.CRM_PASSWORD || 'collegevidya2026';
const SESSION_SECRET = process.env.CRM_SESSION_SECRET || crypto.createHash('sha256').update(CRM_PASSWORD + '_cv_salt').digest('hex');

function createSessionToken(username) {
  const payload = `${username}.${Date.now()}`;
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [user, ts, sig] = parts;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(`${user}.${ts}`).digest('hex');
  if (sig !== expected) return false;
  // Valid for 14 days
  if (Date.now() - Number(ts) > 14 * 24 * 3600 * 1000) return false;
  return true;
}

function parseCookies(cookieHeader = '') {
  const list = {};
  cookieHeader.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    const name = parts.shift()?.trim();
    if (name) list[name] = decodeURIComponent(parts.join('='));
  });
  return list;
}

export function startCrmServer({
  getSock,
  getConnectionInfo,
  requestPairingCodeFn,
  isGlobalAiPausedFn,
  setGlobalAiPausedFn
}) {
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(express.json({ limit: '5mb' }));

  // Public Healthcheck endpoint (Phase 6)
  app.get('/health', (req, res) => {
    const conn = getConnectionInfo ? getConnectionInfo() : { status: 'UNKNOWN' };
    res.json({
      status: 'ok',
      whatsapp: conn.status,
      lastConnectedAt: conn.lastConnectedAt || null,
      dbPath: STORAGE_PATHS.dbPath,
      uptimeSeconds: Math.round(process.uptime())
    });
  });

  // Auth Endpoints
  app.post('/api/login', (req, res) => {
    const { username, password } = req.body || {};
    if (username === CRM_USERNAME && password === CRM_PASSWORD) {
      const token = createSessionToken(username);
      res.setHeader('Set-Cookie', `cv_crm_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${14 * 86400}`);
      return res.json({ success: true, username });
    }
    return res.status(401).json({ error: 'Invalid username or password' });
  });

  app.post('/api/logout', (req, res) => {
    res.setHeader('Set-Cookie', 'cv_crm_session=; Path=/; HttpOnly; Max-Age=0');
    res.json({ success: true });
  });

  app.get('/api/auth/check', (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    const authenticated = verifySessionToken(cookies.cv_crm_session);
    res.json({ authenticated, username: authenticated ? CRM_USERNAME : null });
  });

  // Serve static frontend assets (login modal handles unauthenticated state cleanly)
  app.use(express.static(path.join(__dirname, 'public')));

  // Auth Middleware for all protected /api/* and /uploads/* routes
  const requireAuth = (req, res, next) => {
    const cookies = parseCookies(req.headers.cookie);
    const authHeader = req.headers.authorization || '';
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (verifySessionToken(cookies.cv_crm_session) || verifySessionToken(bearerToken)) {
      return next();
    }
    return res.status(401).json({ error: 'Authentication required' });
  };

  app.use('/uploads', requireAuth, express.static(STORAGE_PATHS.uploadsDir));
  app.use('/api', requireAuth);

  // API: Get all leads
  app.get('/api/leads', (req, res) => {
    try {
      const leads = LeadDB.getAll();
      res.json(leads);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // API: Get messages + pending follow-ups for a lead
  app.get('/api/leads/:phone/messages', (req, res) => {
    try {
      const phone = req.params.phone;
      LeadDB.markReadOnDashboard(phone);
      const messages = LeadDB.getMessages(phone, 100);
      const followups = LeadDB.getPendingFollowUpJobsForLead(phone);
      res.json({ messages, followups });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // API: Update lead profile, stage, AI/Human mode, notes, tags, checklist
  app.patch('/api/leads/:phone', (req, res) => {
    try {
      const phone = req.params.phone;
      const body = { ...req.body };
      if (body.ai_mode === 'HUMAN' || body.ai_autopilot === false) {
        body.ai_mode = 'HUMAN';
        body.ai_autopilot = false;
        body.human_until = Date.now() + 12 * HOUR;
        LeadDB.cancelFollowUpJobs(phone);
      } else if (body.ai_mode === 'AI' || body.ai_autopilot === true) {
        body.ai_mode = 'AI';
        body.ai_autopilot = true;
        body.human_until = null;
      }
      const updated = LeadDB.upsert(phone, body);
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // API: Send manual message as Human Advisor
  app.post('/api/leads/:phone/message', async (req, res) => {
    try {
      const { text } = req.body;
      if (!text) return res.status(400).json({ error: 'Text is required' });

      const phone = LeadDB.normalizePhoneJid(req.params.phone);
      // Automatically switch lead to HUMAN mode for 12h when human sends a message
      LeadDB.upsert(phone, { ai_mode: 'HUMAN', human_until: Date.now() + 12 * HOUR });
      LeadDB.cancelFollowUpJobs(phone);

      const sendRes = await sendSingleBubbleWithRetry({
        jid: phone,
        text,
        getSock,
        isFollowUp: false,
        role: 'human'
      });

      res.json({ success: sendRes.success, status: sendRes.status, error: sendRes.error });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // API: "✨ AI Suggest Reply" button for Human Mode (drafts reply without sending)
  app.post('/api/leads/:phone/suggest', async (req, res) => {
    try {
      const phone = LeadDB.normalizePhoneJid(req.params.phone);
      const lead = LeadDB.getOrCreate(phone);
      const messages = LeadDB.getMessages(phone, 20);
      const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.text || 'Hello';

      const { updates, meta } = inferFromUserText(lastUserMsg, lead);
      const mergedLead = { ...lead, ...updates };
      const kb = LeadDB.getKnowledgeBase();
      const eligibilityResult = evaluateEligibility(mergedLead, kb, meta);
      const stageInfo = computeStageAndScore(mergedLead, eligibilityResult, meta);

      const turnResult = await generateCounselorTurn({
        userText: lastUserMsg,
        lead: mergedLead,
        conversationHistory: messages,
        eligibilityResult,
        stageInfo,
        kb,
        meta
      });

      res.json({
        suggestedText: turnResult.messages.join('\n\n'),
        bubbles: turnResult.messages,
        eligibilityResult
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // API: Trigger instant AI follow-up nudge
  app.post('/api/leads/:phone/nudge', async (req, res) => {
    try {
      const phone = LeadDB.normalizePhoneJid(req.params.phone);
      const lead = LeadDB.get(phone);
      if (!lead) return res.status(404).json({ error: 'Lead not found' });

      const recentMessages = LeadDB.getMessages(phone, 10);
      const nudgeText = await generateContextualFollowUp({
        lead,
        ghostStage: lead.ghost_stage || 'GHOST_PITCHED',
        followupIndex: lead.follow_up_count || 0,
        strategy: 'Friendly direct check-in with admission & fee details',
        recentMessages
      });

      const sendRes = await sendSingleBubbleWithRetry({
        jid: phone,
        text: nudgeText,
        getSock,
        isFollowUp: true,
        role: 'bot'
      });

      LeadDB.upsert(phone, { follow_up_count: (lead.follow_up_count || 0) + 1 });
      res.json({ success: sendRes.success, text: nudgeText, status: sendRes.status });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // API: Cancel follow-ups for a lead
  app.delete('/api/leads/:phone/followups', (req, res) => {
    try {
      const phone = LeadDB.normalizePhoneJid(req.params.phone);
      LeadDB.cancelFollowUpJobs(phone);
      LeadDB.upsert(phone, { is_ghost: false, ghost_stage: null });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // API: Get all pending follow-up jobs
  app.get('/api/followups', (req, res) => {
    try {
      res.json(LeadDB.getAllPendingFollowUpJobs());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // API: Knowledge Base Get & Update
  app.get('/api/kb', (req, res) => {
    try {
      res.json(LeadDB.getKnowledgeBase());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/kb', (req, res) => {
    try {
      const updated = LeadDB.saveKnowledgeBase(req.body);
      res.json({ success: true, kb: updated });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // API: Dashboard Test Chat Simulator (Phase 7)
  app.post('/api/simulator/chat', async (req, res) => {
    try {
      const { phone = '919999900001@s.whatsapp.net', text, reset = false } = req.body || {};
      const norm = LeadDB.normalizePhoneJid(phone);

      if (reset) {
        LeadDB.upsert(norm, {
          name: 'Test Student',
          city: null,
          state: null,
          distance_km_from_campus: null,
          qualification: null,
          stream_branch: null,
          percentage: null,
          category: 'GEN',
          employed: null,
          employment_type: null,
          work_experience_years: null,
          goal: null,
          budget: null,
          preferred_mode: null,
          recommended_program: null,
          recommended_university: null,
          objections: [],
          stage: 'NEW',
          lead_score: 10,
          ai_mode: 'AI',
          opted_out: false,
          turn_count: 0,
          last_cta_turn: 0
        });
        return res.json({ reset: true, lead: LeadDB.get(norm), messages: [] });
      }

      if (!text) return res.status(400).json({ error: 'Text is required' });

      LeadDB.addMessage(norm, 'user', text, { status: 'RECEIVED' });
      const simSentBubbles = [];
      const mockGetSock = () => ({
        readMessages: async () => {},
        presenceSubscribe: async () => {},
        sendPresenceUpdate: async () => {},
        sendMessage: async (_jid, content) => {
          simSentBubbles.push(content.text);
          return { key: { id: `sim_${Date.now()}_${simSentBubbles.length}` } };
        }
      });

      const result = await processStudentTurn({
        phone: norm,
        combinedText: text,
        incomingKeys: [],
        getSock: mockGetSock,
        sendOwnerAlertFn: async () => {},
        isGlobalAiPaused: false,
        skipDelays: true
      });

      res.json({
        bubbles: simSentBubbles,
        lead: result.lead,
        eligibilityResult: result.eligibilityResult,
        stageInfo: result.stageInfo,
        messages: LeadDB.getMessages(norm, 50)
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // API: CRM Stats & Global Pause Toggle
  app.get('/api/stats', (req, res) => {
    try {
      res.json({
        ...LeadDB.getStats(),
        globalAiPaused: isGlobalAiPausedFn ? isGlobalAiPausedFn() : false
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/settings/pause', (req, res) => {
    const { paused } = req.body || {};
    if (setGlobalAiPausedFn) setGlobalAiPausedFn(Boolean(paused));
    res.json({ success: true, globalAiPaused: Boolean(paused) });
  });

  // API: Export to CSV
  app.get('/api/export', (req, res) => {
    try {
      const leads = LeadDB.getAll();
      const headers = [
        'Phone', 'Name', 'Qualification', 'Stream', 'Percentage', 'Employment_Type',
        'City', 'Goal', 'Recommended_Program', 'Recommended_University', 'Stage',
        'Lead_Score', 'AI_Mode', 'Ghost', 'Opted_Out', 'Notes', 'Created_At'
      ];

      const csvRows = [headers.join(',')];
      for (const l of leads) {
        const row = [
          `"${l.phone.replace(/@.*/, '')}"`,
          `"${(l.name || '').replace(/"/g, '""')}"`,
          `"${l.qualification || ''}"`,
          `"${l.stream_branch || ''}"`,
          l.percentage ?? '',
          `"${l.employment_type || ''}"`,
          `"${(l.city || '').replace(/"/g, '""')}"`,
          `"${(l.goal || '').replace(/"/g, '""')}"`,
          `"${(l.recommended_program || '').replace(/"/g, '""')}"`,
          `"${(l.recommended_university || '').replace(/"/g, '""')}"`,
          `"${l.stage}"`,
          l.lead_score ?? 0,
          `"${l.ai_mode}"`,
          l.is_ghost ? 'Yes' : 'No',
          l.opted_out ? 'Yes' : 'No',
          `"${(l.notes || '').replace(/"/g, '""')}"`,
          `"${l.created_at ? new Date(l.created_at).toISOString() : ''}"`
        ];
        csvRows.push(row.join(','));
      }

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="college-vidya-leads.csv"');
      res.send(csvRows.join('\n'));
    } catch (err) {
      res.status(500).send('Export error: ' + err.message);
    }
  });

  // API: WhatsApp Connection & QR / Pairing Code
  app.get('/api/qr', async (req, res) => {
    try {
      const info = getConnectionInfo ? getConnectionInfo() : { status: 'DISCONNECTED', qr: null, lastConnectedAt: null };
      if (info.status === 'CONNECTED') {
        return res.json({ status: 'CONNECTED', lastConnectedAt: info.lastConnectedAt, qrDataUrl: null });
      }

      let qrDataUrl = null;
      if (info.qr) {
        qrDataUrl = await QRCode.toDataURL(info.qr, { width: 300, margin: 2 });
      }
      res.json({
        status: info.status,
        lastConnectedAt: info.lastConnectedAt,
        qrDataUrl
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/whatsapp/pair', async (req, res) => {
    try {
      const { phone } = req.body || {};
      if (!phone) return res.status(400).json({ error: 'Phone number required' });
      if (!requestPairingCodeFn) return res.status(503).json({ error: 'Pairing not available' });
      const code = await requestPairingCodeFn(phone);
      res.json({ success: true, code });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  const server = app.listen(PORT, () => {
    console.log(`🌐 College Vidya CRM Dashboard active on http://localhost:${PORT}`);
  });
  return server;
}
