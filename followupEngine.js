import { LeadDB } from './database.js';
import { generateContextualFollowUp } from './llmBrain.js';

export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export const OWNER_NUMBER = (process.env.OWNER_NUMBER || '917982412945').replace(/\D/g, '') + '@s.whatsapp.net';
export const PUBLIC_DASHBOARD_URL = process.env.PUBLIC_URL || 'https://college-vidya-bot-production.up.railway.app';

// Exact Phase 4 Cadences
export const FOLLOW_UP_CADENCES = {
  GHOST_NEW: {
    delays: [4 * HOUR, 24 * HOUR, 72 * HOUR],
    strategies: [
      'Gentle friendly nudge — check if they still want career/degree guidance alongside their job',
      'Value hook — share how UGC-recognized flexible/online programs help working professionals get promotions without quitting their job',
      'Respectful closing check-in — leave the door open for free counseling anytime'
    ]
  },
  GHOST_PITCHED: {
    delays: [2 * HOUR, 24 * HOUR, 48 * HOUR, 4 * DAY, 7 * DAY],
    strategies: [
      'Quick check-in — ask if they have any doubt about the recommended university or eligibility',
      'Verification confidence — remind them how they can verify UGC/AICTE approvals on official govt portals',
      'Course schedule clarity — explain how weekend/flexible classes are managed easily with a full-time job',
      'Budget/alternative check — ask if fee structure is a concern so we can compare options',
      'Graceful final check-in — no pressure, available whenever they are ready'
    ]
  },
  GHOST_WARM: {
    delays: [2 * HOUR, 24 * HOUR, 48 * HOUR, 4 * DAY, 7 * DAY, 14 * DAY],
    strategies: [
      'Share concise semester-wise fee & official portal payment safety reminder',
      'Process simplicity — explain that admission takes 3 simple steps starting with basic document verification',
      'Direct doubt check — ask if any specific question (fees, family consultation, or validity) is holding them back',
      'Cost-of-delay perspective — starting this session saves a full academic year toward their promotion/degree',
      'Offer a quick 5-minute call with senior counselor Harsh if they want to discuss with family',
      'Respectful final close — wish them the best'
    ]
  },
  GHOST_DOCS: {
    delays: [1 * HOUR, 24 * HOUR, 48 * HOUR, 4 * DAY, 7 * DAY],
    strategies: [
      'Helpful document checklist reminder — they can send just their marksheet photo first to verify eligibility',
      'Reassurance — all documents are not needed at once, just 10th/Diploma marksheet & Aadhaar to start verification',
      'Obstacle removal — ask if any marksheet or experience certificate is missing so we can guide on alternatives',
      'Application assistance offer — offer help filling out the official university form',
      'Polite final check-in on pending document submission'
    ]
  }
};

export function mapStageToGhostStage(stage) {
  switch (stage) {
    case 'NEW':
    case 'QUALIFYING':
    case 'DISCOVERY':
    case 'QUALIFIED':
      return 'GHOST_NEW';
    case 'PITCHED':
      return 'GHOST_PITCHED';
    case 'WARM':
    case 'INTERESTED':
      return 'GHOST_WARM';
    case 'DOCS_PENDING':
    case 'PAYMENT_PENDING':
      return 'GHOST_DOCS';
    default:
      return null;
  }
}

/**
 * Explicit Asia/Kolkata IST Time Helpers (Railway runs in UTC)
 */
export function getISTParts(timestamp = Date.now()) {
  const d = new Date(timestamp);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = Object.fromEntries(formatter.formatToParts(d).map(p => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) === 24 ? 0 : Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second)
  };
}

export function isBusinessHoursIST(timestamp = Date.now()) {
  const { hour } = getISTParts(timestamp);
  return hour >= 9 && hour < 21; // 9:00 AM to 8:59 PM IST
}

/**
 * If timestamp falls outside 9 AM - 9 PM IST, returns the timestamp for
 * 9:30 AM IST (next morning if >= 21:00, or same morning if < 09:00) + random jitter (0-30 min).
 */
export function adjustToBusinessHoursIST(targetTimestamp, addJitter = true) {
  if (isBusinessHoursIST(targetTimestamp)) {
    return targetTimestamp;
  }

  const { hour, minute, second } = getISTParts(targetTimestamp);
  let msUntil930 = 0;

  if (hour >= 21) {
    // Remaining time today until midnight + 9h 30m
    const secsLeftToday = ((23 - hour) * 3600) + ((59 - minute) * 60) + (60 - second);
    msUntil930 = (secsLeftToday * 1000) + (9.5 * HOUR);
  } else if (hour < 9) {
    // Same day 9:30 AM
    const currentSecs = (hour * 3600) + (minute * 60) + second;
    const targetSecs = 9.5 * 3600;
    msUntil930 = (targetSecs - currentSecs) * 1000;
  }

  const jitterMs = addJitter ? Math.floor(Math.random() * 30 * MINUTE) : 0;
  return targetTimestamp + msUntil930 + jitterMs;
}

/**
 * Schedule persistent follow-up jobs in SQLite when a lead becomes ghosted
 */
export function scheduleGhostFollowUps(lead, now = Date.now()) {
  const blockedStages = new Set(['NOT_ELIGIBLE', 'ENROLLED', 'OPTED_OUT', 'LOST', 'HUMAN_HANDLING']);
  if (!lead || lead.opted_out || lead.ai_mode === 'HUMAN' || blockedStages.has(lead.stage)) {
    return [];
  }

  const ghostStage = mapStageToGhostStage(lead.stage);
  if (!ghostStage) return [];

  const cadence = FOLLOW_UP_CADENCES[ghostStage];
  if (!cadence) return [];

  const jobs = cadence.delays.map((delayMs, idx) => {
    const rawDue = now + delayMs;
    const adjustedDue = adjustToBusinessHoursIST(rawDue, true);
    return {
      followupIndex: idx,
      strategy: cadence.strategies[idx] || cadence.strategies[cadence.strategies.length - 1],
      dueAt: adjustedDue
    };
  });

  LeadDB.scheduleFollowUpJobs(lead.phone, ghostStage, jobs);
  LeadDB.upsert(lead.phone, {
    is_ghost: true,
    ghost_stage: ghostStage,
    follow_up_count: 0
  });

  return jobs;
}

/**
 * Format duration ago (e.g., "1h 10m ago")
 */
export function formatDurationAgo(timestamp, now = Date.now()) {
  if (!timestamp) return 'N/A';
  const diffMin = Math.max(1, Math.round((now - timestamp) / MINUTE));
  if (diffMin < 60) return `${diffMin}m ago`;
  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  return m > 0 ? `${h}h ${m}m ago` : `${h}h ago`;
}

/**
 * 🚨 Send Red Alert Escalation to Owner WhatsApp (24x7, throttled 1 per lead per 6h)
 */
export async function sendRedAlert(leadPhone, reason, sendRawMessageFn, force = false) {
  const lead = LeadDB.get(leadPhone);
  if (!lead) return false;

  const now = Date.now();
  if (!force && lead.last_alert_at && (now - lead.last_alert_at) < 6 * HOUR) {
    return false; // Throttled (max 1 alert per lead per 6h)
  }

  const recentMsgs = LeadDB.getMessages(lead.phone, 5);
  const lastUserMsg = [...recentMsgs].reverse().find(m => m.role === 'user')?.text || 'N/A';
  const cleanNumber = lead.phone.replace(/@.*/, '');
  const qualText = [
    lead.qualification || 'Unknown Qual',
    lead.stream_branch ? `(${lead.stream_branch})` : '',
    lead.percentage ? `${lead.percentage}%` : ''
  ].filter(Boolean).join(' ');
  const empText = lead.employment_type ? `${lead.employment_type} job` : 'Job unknown';
  const cityText = lead.city || 'Location unknown';
  const univText = lead.recommended_university || 'Not pitched yet';
  const progText = lead.recommended_program || 'Course TBD';

  const alertText = `🚨 *RED ALERT – ${reason}*
👤 ${lead.name || 'Student'} | 📱 +${cleanNumber}
🎓 ${qualText} | ${empText} | ${cityText}
🏛️ ${univText} – ${progText} | Stage: ${lead.stage}
⏱️ Last reply: ${formatDurationAgo(lead.last_user_msg_at || lead.last_active_at, now)}
💬 Last msg: "${lastUserMsg.slice(0, 120)}"
👉 Call now | Dashboard: ${PUBLIC_DASHBOARD_URL}`;

  LeadDB.upsert(lead.phone, { last_alert_at: now });

  if (sendRawMessageFn) {
    try {
      await sendRawMessageFn(OWNER_NUMBER, alertText);
      return true;
    } catch (e) {
      console.error('⚠️ Red alert send error:', e.message);
    }
  }
  return false;
}

/**
 * 📊 Build Daily Report Text (9 PM IST & /report command)
 */
export function buildDailyReportText() {
  const stats = LeadDB.getStats();
  const allLeads = LeadDB.getAll();
  const hotLeads = allLeads
    .filter(l => !l.opted_out && (l.lead_score >= 70 || ['WARM', 'INTERESTED', 'DOCS_PENDING', 'PAYMENT_PENDING'].includes(l.stage)))
    .sort((a, b) => (b.lead_score || 0) - (a.lead_score || 0))
    .slice(0, 5);

  const docsCount = allLeads.filter(l => (l.docs_uploads && l.docs_uploads.length > 0) || l.stage === 'DOCS_PENDING').length;
  const payPendingCount = stats.stageCounts['PAYMENT_PENDING'] || 0;
  const aiHandled = stats.totalLeads - stats.manualCount;

  const stageLines = Object.entries(stats.stageCounts)
    .map(([st, cnt]) => `• ${st}: *${cnt}*`)
    .join('\n') || '• No leads yet';

  const hotLines = hotLeads.length > 0
    ? hotLeads.map((l, i) => `${i + 1}. *${l.name || '+' + l.phone.replace(/@.*/, '')}* — ${l.stage} (Score: ${l.lead_score})`).join('\n')
    : '• None right now';

  return `📊 *COLLEGE VIDYA DAILY REPORT* (${getNowDateIST()})

🆕 New Leads Today: *${stats.newLeadsToday}*
💬 Active Today: *${stats.activeToday}* (Total: *${stats.totalLeads}*)
🎓 Enrolled Today: *${stats.enrolledToday}*
📄 Docs Stage/Received: *${docsCount}* | 💳 Payment Pending: *${payPendingCount}*
👻 Ghosted: *${stats.ghostCount}* | 🛑 Opted Out: *${stats.optedOutCount}*
🤖 AI Handled: *${aiHandled}* | 🧑 Human Mode: *${stats.manualCount}*
⚠️ Failed Sends: *${stats.failedMessages}*

📈 *Pipeline Breakdown:*
${stageLines}

🔥 *Top 5 Hot Leads:*
${hotLines}`;
}

function getNowDateIST() {
  return new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });
}

/**
 * Periodic Ghost Detector & Follow-Up Job Runner (runs every 5 min)
 */
export async function runGhostAndFollowUpTick({ sendBotMessageFn, sendOwnerAlertFn, isGlobalAiPausedFn, now = Date.now() }) {
  if (isGlobalAiPausedFn && isGlobalAiPausedFn()) return;

  const allLeads = LeadDB.getAll();
  const blockedStages = new Set(['NOT_ELIGIBLE', 'ENROLLED', 'OPTED_OUT', 'LOST', 'HUMAN_HANDLING']);

  // 1. Detect new ghosts
  for (const lead of allLeads) {
    if (lead.is_ghost || lead.opted_out || lead.ai_mode === 'HUMAN' || blockedStages.has(lead.stage)) {
      continue;
    }
    const lastBot = lead.last_bot_msg_at || 0;
    const lastUser = lead.last_user_msg_at || 0;
    // Lead is silent after bot's last reply
    if (!lastBot || lastUser > lastBot) continue;

    const isHotStage = ['WARM', 'INTERESTED', 'DOCS_PENDING', 'PAYMENT_PENDING'].includes(lead.stage) || (lead.lead_score >= 70);
    const thresholdMs = isHotStage ? 1 * HOUR : 2 * HOUR;

    if ((now - lastBot) >= thresholdMs) {
      scheduleGhostFollowUps(lead, now);
      // If lead is in DOCS_PENDING or PAYMENT_PENDING and ghosted -> Immediate Red Alert to Owner!
      if (['DOCS_PENDING', 'PAYMENT_PENDING'].includes(lead.stage)) {
        await sendRedAlert(lead.phone, `Hot Lead Ghosted in ${lead.stage}`, sendOwnerAlertFn);
      }
    }
  }

  // 2. Execute due follow-up jobs from SQLite
  const dueJobs = LeadDB.getDueFollowUpJobs(now);
  for (const job of dueJobs) {
    const lead = LeadDB.get(job.lead_phone);
    if (!lead || lead.opted_out || lead.ai_mode === 'HUMAN' || blockedStages.has(lead.stage)) {
      LeadDB.markFollowUpJobDone(job.id, 'CANCELLED');
      continue;
    }

    // Check IST Business Hours (9 AM - 9 PM IST)
    if (!isBusinessHoursIST(now)) {
      const nextMorning = adjustToBusinessHoursIST(now, true);
      LeadDB.rescheduleFollowUpJob(job.id, nextMorning);
      continue;
    }

    try {
      const recentMessages = LeadDB.getMessages(lead.phone, 8);
      const followUpText = await generateContextualFollowUp({
        lead,
        ghostStage: job.ghost_stage,
        followupIndex: job.followup_index,
        strategy: job.strategy,
        recentMessages
      });

      if (sendBotMessageFn) {
        await sendBotMessageFn(lead.phone, [followUpText], { isFollowUp: true });
      }

      LeadDB.markFollowUpJobDone(job.id, 'SENT');
      const newCount = (job.followup_index || 0) + 1;
      const cadence = FOLLOW_UP_CADENCES[job.ghost_stage];
      const maxCount = cadence?.delays?.length || 3;

      if (newCount >= maxCount) {
        LeadDB.upsert(lead.phone, { follow_up_count: newCount, stage: 'LOST', is_ghost: false });
      } else {
        LeadDB.upsert(lead.phone, { follow_up_count: newCount });
      }

      // Anti-ban gap between different leads (20–40 seconds in production)
      if (process.env.NODE_ENV !== 'test' && dueJobs.length > 1) {
        await new Promise(r => setTimeout(r, 20000 + Math.floor(Math.random() * 20000)));
      }
    } catch (err) {
      console.error(`⚠️ Follow-up job #${job.id} error:`, err.message);
    }
  }
}

/**
 * 📲 Handle Owner WhatsApp Commands (/report, /hot, /lead, /takeover, /release, /pause, /resume, /say)
 */
export async function handleOwnerCommand({ text, sendRawMessageFn, setGlobalAiPausedFn, getGlobalAiPausedFn }) {
  const clean = String(text || '').trim();
  if (!clean.startsWith('/')) return null;

  const parts = clean.split(/\s+/);
  const cmd = parts[0].toLowerCase();

  if (cmd === '/report') {
    const report = buildDailyReportText();
    if (sendRawMessageFn) await sendRawMessageFn(OWNER_NUMBER, report);
    return report;
  }

  if (cmd === '/hot') {
    const all = LeadDB.getAll();
    const hot = all
      .filter(l => !l.opted_out && (l.lead_score >= 70 || ['WARM', 'INTERESTED', 'DOCS_PENDING', 'PAYMENT_PENDING'].includes(l.stage)))
      .slice(0, 10);
    const reply = hot.length === 0
      ? '🔥 Abhi koi hot lead nahi hai.'
      : `🔥 *HOT LEADS (${hot.length}):*\n` + hot.map((l, i) =>
        `${i + 1}. *${l.name || 'Student'}* (+${l.phone.replace(/@.*/, '')})\n   Stage: ${l.stage} | Score: ${l.lead_score} | ${l.qualification || '?'} | ${l.recommended_university || 'TBD'}`
      ).join('\n');
    if (sendRawMessageFn) await sendRawMessageFn(OWNER_NUMBER, reply);
    return reply;
  }

  if (cmd === '/lead') {
    const targetPhone = parts[1];
    if (!targetPhone) {
      const msg = 'Usage: `/lead <phone>`';
      if (sendRawMessageFn) await sendRawMessageFn(OWNER_NUMBER, msg);
      return msg;
    }
    const lead = LeadDB.get(targetPhone);
    if (!lead) {
      const msg = `❌ Lead not found for ${targetPhone}`;
      if (sendRawMessageFn) await sendRawMessageFn(OWNER_NUMBER, msg);
      return msg;
    }
    const reply = `📋 *LEAD SUMMARY*
👤 Name: ${lead.name || 'N/A'}
📱 Phone: +${lead.phone.replace(/@.*/, '')}
🎓 Qual: ${lead.qualification || 'N/A'} (${lead.stream_branch || '-'}) | ${lead.percentage ? lead.percentage + '%' : 'N/A'}
💼 Job: ${lead.employment_type || 'N/A'} | 📍 City: ${lead.city || 'N/A'}
🏛️ Recommended: ${lead.recommended_university || 'N/A'} (${lead.recommended_program || 'N/A'})
📊 Stage: *${lead.stage}* | Score: *${lead.lead_score}/100*
🤖 Mode: *${lead.ai_mode}* | Ghost: ${lead.is_ghost ? 'Yes' : 'No'}`;
    if (sendRawMessageFn) await sendRawMessageFn(OWNER_NUMBER, reply);
    return reply;
  }

  if (cmd === '/takeover') {
    const targetPhone = parts[1];
    if (!targetPhone) return 'Usage: `/takeover <phone>`';
    const norm = LeadDB.normalizePhoneJid(targetPhone);
    LeadDB.upsert(norm, { ai_mode: 'HUMAN', human_until: Date.now() + 12 * HOUR });
    LeadDB.cancelFollowUpJobs(norm);
    const reply = `🧑 *Human Takeover Active* for +${norm.replace(/@.*/, '')}. Bot is now silent for this student.`;
    if (sendRawMessageFn) await sendRawMessageFn(OWNER_NUMBER, reply);
    return reply;
  }

  if (cmd === '/release') {
    const targetPhone = parts[1];
    if (!targetPhone) return 'Usage: `/release <phone>`';
    const norm = LeadDB.normalizePhoneJid(targetPhone);
    LeadDB.upsert(norm, { ai_mode: 'AI', human_until: null });
    const reply = `🤖 *AI Mode Restored* for +${norm.replace(/@.*/, '')}. Bot will now auto-reply and follow up.`;
    if (sendRawMessageFn) await sendRawMessageFn(OWNER_NUMBER, reply);
    return reply;
  }

  if (cmd === '/pause') {
    if (setGlobalAiPausedFn) setGlobalAiPausedFn(true);
    const reply = '⏸️ *Global AI Paused.* Bot will not auto-reply to any student until `/resume`.';
    if (sendRawMessageFn) await sendRawMessageFn(OWNER_NUMBER, reply);
    return reply;
  }

  if (cmd === '/resume') {
    if (setGlobalAiPausedFn) setGlobalAiPausedFn(false);
    const reply = '▶️ *Global AI Resumed.* Bot is actively handling leads.';
    if (sendRawMessageFn) await sendRawMessageFn(OWNER_NUMBER, reply);
    return reply;
  }

  if (cmd === '/say') {
    const targetPhone = parts[1];
    const messageText = parts.slice(2).join(' ').trim();
    if (!targetPhone || !messageText) return 'Usage: `/say <phone> <message>`';
    const norm = LeadDB.normalizePhoneJid(targetPhone);
    if (sendRawMessageFn) {
      await sendRawMessageFn(norm, messageText, { asHuman: true });
      const confirm = `✅ Sent to +${norm.replace(/@.*/, '')}: "${messageText}"`;
      await sendRawMessageFn(OWNER_NUMBER, confirm);
      return confirm;
    }
  }

  return null;
}
