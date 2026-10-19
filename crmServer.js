import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import QRCode from 'qrcode';
import { LeadDB } from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function startCrmServer({ getSock, getLatestQr, isBotConnected, generateFollowUp }) {
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  // API: Get all leads
  app.get('/api/leads', (req, res) => {
    try {
      const leads = LeadDB.getAll();
      res.json(leads);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // API: Get messages for a lead
  app.get('/api/leads/:phone/messages', (req, res) => {
    try {
      const messages = LeadDB.getMessages(req.params.phone, 100);
      res.json(messages);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // API: Update lead fields (stage, ai_autopilot, name, sector, notes, checklist, etc.)
  app.patch('/api/leads/:phone', (req, res) => {
    try {
      const updated = LeadDB.upsert(req.params.phone, req.body);
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

      const sock = getSock();
      if (!sock) return res.status(503).json({ error: 'WhatsApp bot is not connected' });

      await sock.sendMessage(req.params.phone, { text });
      LeadDB.addMessage(req.params.phone, 'human', text);

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // API: Trigger instant AI follow-up nudge
  app.post('/api/leads/:phone/nudge', async (req, res) => {
    try {
      const lead = LeadDB.get(req.params.phone);
      if (!lead) return res.status(404).json({ error: 'Lead not found' });

      const sock = getSock();
      if (!sock) return res.status(503).json({ error: 'WhatsApp bot is not connected' });

      const conversationHistory = LeadDB.getMessages(req.params.phone, 10);
      lead.conversationLog = conversationHistory.map(m => ({ role: m.role, text: m.text }));

      const nudgeText = await generateFollowUp(lead, lead.follow_up_count || 0, "Friendly direct check-in with admission details");
      
      await sock.sendMessage(req.params.phone, { text: nudgeText });
      LeadDB.addMessage(req.params.phone, 'bot', nudgeText, true);
      LeadDB.upsert(req.params.phone, { follow_up_count: (lead.follow_up_count || 0) + 1 });

      res.json({ success: true, text: nudgeText });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // API: CRM Stats
  app.get('/api/stats', (req, res) => {
    try {
      res.json(LeadDB.getStats());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // API: Export to CSV
  app.get('/api/export', (req, res) => {
    try {
      const leads = LeadDB.getAll();
      const headers = ['Phone', 'Name', 'Sector', 'Location', 'Qualification', 'Percentage', 'Target_University', 'Stage', 'AI_Autopilot', 'Ghost', 'Notes', 'Created_At'];
      
      const csvRows = [headers.join(',')];
      for (const l of leads) {
        const row = [
          `"${l.phone.replace(/@.*/, '')}"`,
          `"${(l.name || '').replace(/"/g, '""')}"`,
          `"${l.sector || ''}"`,
          `"${(l.location || '').replace(/"/g, '""')}"`,
          `"${l.qualification || ''}"`,
          l.percentage || '',
          `"${l.recommended_univ || ''}"`,
          `"${l.stage}"`,
          l.ai_autopilot ? 'Yes' : 'No',
          l.is_ghost ? 'Yes' : 'No',
          `"${(l.notes || '').replace(/"/g, '""')}"`,
          `"${new Date(l.created_at).toISOString()}"`
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

  // API: QR status
  app.get('/api/qr', async (req, res) => {
    try {
      const connected = isBotConnected();
      if (connected) {
        return res.json({ status: 'CONNECTED' });
      }

      const qr = getLatestQr();
      if (!qr) {
        return res.json({ status: 'DISCONNECTED', qrDataUrl: null });
      }

      const qrDataUrl = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
      res.json({ status: 'DISCONNECTED', qrDataUrl });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.listen(PORT, () => {
    console.log(`🌐 College Vidya CRM Dashboard active on http://localhost:${PORT}`);
  });
}
