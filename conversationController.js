import { LeadDB } from './database.js';
import { inferFromUserText, evaluateEligibility, computeStageAndScore } from './eligibilityEngine.js';
import { generateCounselorTurn } from './llmBrain.js';
import { sendRedAlert, HOUR } from './followupEngine.js';

// Per-user debounce buffers & concurrency locks
const userDebounceBuffers = new Map(); // Map<phone, { texts: [], keys: [], timer: Timeout, resolvers: [] }>
const userLocks = new Map();           // Map<phone, Promise>

// Rate-limiter state (~20 msgs/min global)
const recentSendTimestamps = [];
const MAX_SENDS_PER_MINUTE = 20;

export async function waitForGlobalRateLimit(skipDelays = false) {
  if (skipDelays) return;
  const now = Date.now();
  while (recentSendTimestamps.length > 0 && (now - recentSendTimestamps[0]) > 60000) {
    recentSendTimestamps.shift();
  }
  if (recentSendTimestamps.length >= MAX_SENDS_PER_MINUTE) {
    const waitMs = 60000 - (now - recentSendTimestamps[0]) + 500 + Math.floor(Math.random() * 1000);
    await new Promise(r => setTimeout(r, Math.max(500, waitMs)));
  }
  recentSendTimestamps.push(Date.now());
}

/**
 * Reliable single-bubble sender with 3 retries, exponential backoff, and offline DB queue fallback.
 */
export async function sendSingleBubbleWithRetry({
  jid,
  text,
  getSock,
  isFollowUp = false,
  role = 'bot',
  skipDelays = false
}) {
  const norm = LeadDB.normalizePhoneJid(jid);
  await waitForGlobalRateLimit(skipDelays);

  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const sock = getSock ? getSock() : null;
    if (!sock) {
      lastErr = new Error('Socket disconnected');
    } else {
      try {
        const sent = await sock.sendMessage(norm, { text });
        const waMsgId = sent?.key?.id || `local_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        LeadDB.markBotSentId(waMsgId);
        LeadDB.addMessage(norm, role, text, {
          waMsgId,
          status: 'SENT',
          isFollowUp
        });
        return { success: true, waMsgId, status: 'SENT' };
      } catch (err) {
        lastErr = err;
        console.warn(`⚠️ sendMessage attempt ${attempt}/3 failed for ${norm}: ${err.message}`);
      }
    }

    if (attempt < 3 && !skipDelays) {
      const backoffMs = Math.pow(2, attempt) * 750;
      await new Promise(r => setTimeout(r, backoffMs));
    }
  }

  // All 3 attempts failed or socket is offline -> queue in DB for reconnect flush & record status
  const errMsg = lastErr?.message || 'Socket disconnected';
  LeadDB.enqueueOutbound(norm, text, isFollowUp, errMsg);
  LeadDB.addMessage(norm, role, text, {
    waMsgId: null,
    status: 'FAILED',
    isFollowUp
  });
  return { success: false, status: 'QUEUED', error: errMsg };
}

/**
 * Flush queued outbound messages after Baileys reconnects
 */
export async function flushOutboundQueue({ getSock, skipDelays = false }) {
  const pending = LeadDB.getPendingOutbound();
  if (pending.length === 0) return 0;

  let flushed = 0;
  for (const item of pending) {
    const sock = getSock ? getSock() : null;
    if (!sock) break;

    try {
      await waitForGlobalRateLimit(skipDelays);
      const sent = await sock.sendMessage(item.lead_phone, { text: item.text });
      const waMsgId = sent?.key?.id || `flushed_${Date.now()}`;
      LeadDB.markBotSentId(waMsgId);
      LeadDB.markOutboundSent(item.id);
      // Update any FAILED message record matching this text or insert fresh SENT record
      LeadDB.addMessage(item.lead_phone, 'bot', item.text, {
        waMsgId,
        status: 'SENT',
        isFollowUp: Boolean(item.is_follow_up)
      });
      flushed++;
      if (!skipDelays) {
        await new Promise(r => setTimeout(r, 800 + Math.floor(Math.random() * 700)));
      }
    } catch (err) {
      LeadDB.markOutboundFailed(item.id, err.message);
    }
  }
  return flushed;
}

/**
 * Multi-bubble human rhythm sender (Phase 1.2)
 * Blue tick -> reading pause (1-2.5s) -> composing proportional to length -> paused -> send bubble
 */
export async function sendMultiBubbleHumanTurn({
  jid,
  bubbles,
  incomingKeys = [],
  getSock,
  isFollowUp = false,
  skipDelays = false
}) {
  const norm = LeadDB.normalizePhoneJid(jid);
  const sock = getSock ? getSock() : null;

  // 1. Mark incoming messages as read (blue ticks)
  if (sock && incomingKeys.length > 0) {
    try {
      await sock.readMessages(incomingKeys);
    } catch { /* ignore presence errors */ }
  }

  // 2. Short reading pause (1–2.2s)
  if (!skipDelays && sock) {
    await new Promise(r => setTimeout(r, 1000 + Math.floor(Math.random() * 1200)));
  }

  const results = [];
  for (let i = 0; i < bubbles.length; i++) {
    const bubbleText = bubbles[i];
    if (!bubbleText) continue;

    const currentSock = getSock ? getSock() : null;
    if (currentSock && !skipDelays) {
      try {
        await currentSock.presenceSubscribe(norm);
        await currentSock.sendPresenceUpdate('composing', norm);
        // Wait proportional to length: ~1.1s base + 25ms/char, capped at 5.5s + jitter
        const typingMs = Math.min(5500, 1100 + (bubbleText.length * 25)) + Math.floor(Math.random() * 400);
        await new Promise(r => setTimeout(r, typingMs));
        await currentSock.sendPresenceUpdate('paused', norm);
      } catch { /* ignore presence errors */ }
    }

    const sendRes = await sendSingleBubbleWithRetry({
      jid: norm,
      text: bubbleText,
      getSock,
      isFollowUp,
      role: 'bot',
      skipDelays
    });
    results.push(sendRes);
  }

  return results;
}

/**
 * Merge validated profile updates from LLM into lead profile without overwriting known valid data with nulls
 */
function sanitizeAndMergeProfileUpdates(lead, inferredUpdates, llmUpdates = {}) {
  const merged = { ...inferredUpdates };
  const allowedQuals = new Set(['12TH_SCIENCE', '12TH_COMMERCE', '12TH_ARTS', '12TH', 'DIPLOMA', 'BTECH', 'OTHER_GRAD', 'BSC_MATHS', 'PG']);
  const allowedEmp = new Set(['PRIVATE', 'GOVT', 'PSU']);

  if (llmUpdates && typeof llmUpdates === 'object') {
    if (llmUpdates.name && typeof llmUpdates.name === 'string' && llmUpdates.name !== 'null' && llmUpdates.name.length >= 2) {
      merged.name = llmUpdates.name.trim();
    }
    if (!merged.qualification && llmUpdates.qualification) {
      const q = String(llmUpdates.qualification).toUpperCase().trim();
      if (allowedQuals.has(q)) merged.qualification = q;
    }
    if (!merged.stream_branch && llmUpdates.stream_branch && llmUpdates.stream_branch !== 'null') {
      merged.stream_branch = String(llmUpdates.stream_branch).trim();
    }
    if (merged.percentage === undefined && llmUpdates.percentage !== null && llmUpdates.percentage !== undefined && llmUpdates.percentage !== 'null') {
      const p = Number(llmUpdates.percentage);
      if (!isNaN(p) && p >= 30 && p <= 100) merged.percentage = p;
    }
    if (!merged.employment_type && llmUpdates.employment_type) {
      const e = String(llmUpdates.employment_type).toUpperCase().trim();
      if (allowedEmp.has(e)) {
        merged.employment_type = e;
        merged.employed = true;
      }
    }
    if (!merged.city && llmUpdates.city && llmUpdates.city !== 'null') {
      merged.city = String(llmUpdates.city).trim();
    }
    if (!merged.goal && llmUpdates.goal && llmUpdates.goal !== 'null') {
      merged.goal = String(llmUpdates.goal).trim();
    }
    if (!merged.recommended_university && llmUpdates.recommended_university && llmUpdates.recommended_university !== 'null') {
      merged.recommended_university = String(llmUpdates.recommended_university).trim();
    }
  }

  return merged;
}

/**
 * Core Turn Processor (runs inside per-user lock after debounce)
 */
export async function processStudentTurn({
  phone,
  combinedText,
  incomingKeys = [],
  getSock,
  sendOwnerAlertFn,
  isGlobalAiPaused = false,
  skipDelays = false
}) {
  const norm = LeadDB.normalizePhoneJid(phone);
  let lead = LeadDB.getOrCreate(norm);

  // Cancel any pending follow-ups immediately since student replied!
  LeadDB.cancelFollowUpJobs(norm);

  // Check if lead is in HUMAN mode or Global AI is paused
  if (isGlobalAiPaused || lead.ai_mode === 'HUMAN') {
    return {
      skipped: true,
      reason: isGlobalAiPaused ? 'GLOBAL_AI_PAUSED' : 'HUMAN_MODE',
      lead
    };
  }

  // 1. Deterministic pre-LLM inference
  const { updates: inferredUpdates, meta } = inferFromUserText(combinedText, lead);

  // Merge new objections into existing objections list
  const existingObjs = Array.isArray(lead.objections) ? lead.objections : [];
  const updatedObjs = Array.from(new Set([...existingObjs, ...(meta.objections || [])]));

  // Increment turn count
  const nextTurnCount = (lead.turn_count || 0) + 1;

  lead = LeadDB.upsert(norm, {
    ...inferredUpdates,
    objections: updatedObjs,
    is_ghost: false,
    ghost_stage: null,
    follow_up_count: 0,
    turn_count: nextTurnCount,
    last_user_msg_at: Date.now()
  });

  // 2. Deterministic Eligibility & Stage Engine
  const kb = LeadDB.getKnowledgeBase();
  let eligibilityResult = evaluateEligibility(lead, kb, meta);
  let stageInfo = computeStageAndScore(lead, eligibilityResult, meta);

  // Auto-populate recommended university/program if eligibility engine determined a top recommendation
  const topRec = eligibilityResult.recommended?.[0];
  if (topRec) {
    lead = LeadDB.upsert(norm, {
      recommended_university: topRec.short_name || topRec.university,
      recommended_program: topRec.program,
      stage: stageInfo.stage,
      lead_score: stageInfo.lead_score
    });
  } else {
    lead = LeadDB.upsert(norm, {
      stage: stageInfo.stage,
      lead_score: stageInfo.lead_score
    });
  }

  // 3. Load last 20 messages from SQLite
  const conversationHistory = LeadDB.getMessages(norm, 20);

  // 4. Generate Counselor Turn (LLM + Post-processor + Guardrails)
  let turnResult;
  try {
    turnResult = await generateCounselorTurn({
      userText: combinedText,
      lead,
      conversationHistory,
      eligibilityResult,
      stageInfo,
      kb,
      meta
    });

    // Merge any additional fields extracted by LLM
    const finalUpdates = sanitizeAndMergeProfileUpdates(lead, {}, turnResult.profile_updates);
    const hasCta = turnResult.messages.some(m => /\b(registration|apply|form fill|enroll)\b/i.test(m));

    lead = LeadDB.upsert(norm, {
      ...finalUpdates,
      stage: stageInfo.stage,
      lead_score: stageInfo.lead_score,
      consecutive_failures: 0,
      ...(hasCta ? { last_cta_turn: nextTurnCount } : {})
    });
  } catch (err) {
    console.error(`❌ processStudentTurn error for ${norm}:`, err.message);
    const failCount = (lead.consecutive_failures || 0) + 1;
    lead = LeadDB.upsert(norm, { consecutive_failures: failCount });
    turnResult = {
      messages: ['Ek minute, main check karke batata hoon 🙏'],
      profile_updates: {},
      stage: lead.stage,
      intent: 'error_fallback',
      needs_human: failCount >= 2
    };
  }

  // 5. Send multi-bubble reply
  const sendResults = await sendMultiBubbleHumanTurn({
    jid: norm,
    bubbles: turnResult.messages,
    incomingKeys,
    getSock,
    isFollowUp: false,
    skipDelays
  });

  // 6. Check if Red Alert Escalation is needed
  if (turnResult.needs_human || meta.needs_human || (lead.consecutive_failures || 0) >= 2) {
    const reason = meta.escalation_reason || (lead.consecutive_failures >= 2 ? 'Bot failed 2 times in a row' : 'Counselor Escalation / Outside KB Query');
    await sendRedAlert(norm, reason, sendOwnerAlertFn);
  }

  return {
    skipped: false,
    lead: LeadDB.get(norm),
    eligibilityResult,
    stageInfo,
    turnResult,
    sendResults
  };
}

/**
 * Enqueue an incoming user message with per-user debouncing (8.5s default) and concurrency lock (Phase 1.3)
 */
export function enqueueIncomingUserMessage({
  phone,
  text,
  msgKey = null,
  rawProto = null,
  mediaType = null,
  mediaPath = null,
  getSock,
  sendOwnerAlertFn,
  isGlobalAiPaused = false,
  debounceMs = 8500,
  skipDelays = false
}) {
  const norm = LeadDB.normalizePhoneJid(phone);

  // Immediately persist the incoming message to SQLite so nothing is ever lost
  LeadDB.addMessage(norm, 'user', text, {
    waMsgId: msgKey?.id || null,
    status: 'RECEIVED',
    mediaType,
    mediaPath,
    rawProto
  });

  return new Promise((resolve) => {
    let entry = userDebounceBuffers.get(norm);
    if (!entry) {
      entry = { texts: [], keys: [], timer: null, resolvers: [] };
      userDebounceBuffers.set(norm, entry);
    }

    entry.texts.push(text);
    if (msgKey) entry.keys.push(msgKey);
    entry.resolvers.push(resolve);

    if (entry.timer) {
      clearTimeout(entry.timer);
    }

    entry.timer = setTimeout(async () => {
      userDebounceBuffers.delete(norm);
      const combinedText = entry.texts.join('\n');
      const keys = entry.keys;
      const resolvers = entry.resolvers;

      // Acquire per-user concurrency lock so two turns never run in parallel for the same student
      const prevLock = userLocks.get(norm) || Promise.resolve();
      const currentTask = prevLock.then(async () => {
        try {
          return await processStudentTurn({
            phone: norm,
            combinedText,
            incomingKeys: keys,
            getSock,
            sendOwnerAlertFn,
            isGlobalAiPaused,
            skipDelays
          });
        } catch (e) {
          console.error(`⚠️ Locked turn error for ${norm}:`, e.message);
          return { error: e.message };
        }
      });

      userLocks.set(norm, currentTask);
      const result = await currentTask;
      for (const r of resolvers) r(result);
    }, debounceMs);
  });
}
