import { LeadDB } from './database.js';
import { inferFromUserText, evaluateEligibility, computeStageAndScore } from './eligibilityEngine.js';
import { generateCounselorTurn } from './llmBrain.js';
import { sendRedAlert } from './followupEngine.js';

// Per-user debounce buffers, turn sequence counters (for stale-reply cancellation), and active generation locks
const userDebounceMap = new Map(); // Map<phone, { texts: string[], keys: any[], timer: Timeout, resolvers: Function[] }>
const userTurnSeq = new Map();     // Map<phone, number>
const userActiveLock = new Map();  // Map<phone, Promise>

// Global send rate-limiter (~20 msgs/min)
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
  skipDelays = false,
  debugMeta = {}
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
          isFollowUp,
          thought: debugMeta.thought || null,
          reasoning: debugMeta.reasoning || null,
          detectedIntent: debugMeta.detectedIntent || null,
          ragDocs: debugMeta.ragDocs || null
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

  const errMsg = lastErr?.message || 'Socket disconnected';
  LeadDB.enqueueOutbound(norm, text, isFollowUp, errMsg);
  LeadDB.addMessage(norm, role, text, {
    waMsgId: null,
    status: 'FAILED',
    isFollowUp,
    thought: debugMeta.thought || null,
    reasoning: debugMeta.reasoning || null,
    detectedIntent: debugMeta.detectedIntent || null,
    ragDocs: debugMeta.ragDocs || null
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
 * Multi-bubble human rhythm sender
 */
export async function sendMultiBubbleHumanTurn({
  jid,
  bubbles,
  incomingKeys = [],
  getSock,
  isFollowUp = false,
  skipDelays = false,
  debugMeta = {}
}) {
  const norm = LeadDB.normalizePhoneJid(jid);
  const sock = getSock ? getSock() : null;

  if (sock && incomingKeys.length > 0) {
    try {
      await sock.readMessages(incomingKeys);
    } catch { /* ignore presence error */ }
  }

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
        const typingMs = Math.min(5500, 1100 + (bubbleText.length * 25)) + Math.floor(Math.random() * 400);
        await new Promise(r => setTimeout(r, typingMs));
        await currentSock.sendPresenceUpdate('paused', norm);
      } catch { /* ignore */ }
    }

    const sendRes = await sendSingleBubbleWithRetry({
      jid: norm,
      text: bubbleText,
      getSock,
      isFollowUp,
      role: 'bot',
      skipDelays,
      debugMeta: i === 0 ? debugMeta : {}
    });
    results.push(sendRes);
  }

  return results;
}

/**
 * Sanitize and merge profile_updates from LLM into LeadProfile
 */
function sanitizeAndMergeProfileUpdates(lead, inferredUpdates, llmUpdates = {}) {
  const merged = { ...inferredUpdates };
  const allowedQuals = new Set(['10TH', '12TH_SCIENCE', '12TH_COMMERCE', '12TH_ARTS', '12TH', 'DIPLOMA', 'BTECH', 'OTHER_GRAD', 'BSC_MATHS', 'PG']);
  const allowedEmp = new Set(['PRIVATE', 'GOVT', 'PSU']);

  if (llmUpdates && typeof llmUpdates === 'object') {
    if (llmUpdates.name && typeof llmUpdates.name === 'string' && llmUpdates.name !== 'null' && llmUpdates.name.length >= 2) {
      merged.name = llmUpdates.name.trim();
    }
    if (!merged.qualification && llmUpdates.qualification && llmUpdates.qualification !== 'null') {
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
    if (!merged.category && llmUpdates.category && ['GEN', 'RESERVED'].includes(String(llmUpdates.category).toUpperCase())) {
      merged.category = String(llmUpdates.category).toUpperCase();
    }
    if (merged.employed === undefined && typeof llmUpdates.employed === 'boolean') {
      merged.employed = llmUpdates.employed;
    }
    if (!merged.employment_type && llmUpdates.employment_type && llmUpdates.employment_type !== 'null') {
      const e = String(llmUpdates.employment_type).toUpperCase().trim();
      if (allowedEmp.has(e)) {
        merged.employment_type = e;
        merged.employed = true;
      }
    }
    if (merged.work_experience_years === undefined && llmUpdates.work_experience_years !== null && llmUpdates.work_experience_years !== undefined && llmUpdates.work_experience_years !== 'null') {
      const exp = Number(llmUpdates.work_experience_years);
      if (!isNaN(exp) && exp >= 0 && exp <= 50) merged.work_experience_years = exp;
    }
    if (!merged.city && llmUpdates.city && llmUpdates.city !== 'null') {
      merged.city = String(llmUpdates.city).trim();
    }
    if (!merged.state && llmUpdates.state && llmUpdates.state !== 'null') {
      merged.state = String(llmUpdates.state).trim();
    }
    if (!merged.goal && llmUpdates.goal && llmUpdates.goal !== 'null') {
      merged.goal = String(llmUpdates.goal).trim();
    }
    if (!merged.budget && llmUpdates.budget && llmUpdates.budget !== 'null') {
      merged.budget = String(llmUpdates.budget).trim();
    }
    if (!merged.preferred_program && llmUpdates.preferred_program && llmUpdates.preferred_program !== 'null') {
      merged.preferred_program = String(llmUpdates.preferred_program).trim();
    }
    if (Array.isArray(llmUpdates.declined_programs_add) && llmUpdates.declined_programs_add.length > 0) {
      const curr = Array.isArray(merged.declined_programs) ? merged.declined_programs : (Array.isArray(lead.declined_programs) ? lead.declined_programs : []);
      merged.declined_programs = Array.from(new Set([...curr, ...llmUpdates.declined_programs_add]));
    }
    if (Array.isArray(llmUpdates.objections_add) && llmUpdates.objections_add.length > 0) {
      const curr = Array.isArray(merged.objections) ? merged.objections : (Array.isArray(lead.objections) ? lead.objections : []);
      merged.objections = Array.from(new Set([...curr, ...llmUpdates.objections_add]));
    }
  }

  return merged;
}

/**
 * Core Turn Processor (supports direct test invocation AND debounced invocation with stale-turn cancellation)
 */
export async function processStudentTurn({
  phone,
  combinedText,
  incomingKeys = [],
  getSock,
  sendOwnerAlertFn,
  isGlobalAiPaused = false,
  skipDelays = false,
  expectedTurnSeq = null
}) {
  const norm = LeadDB.normalizePhoneJid(phone);
  let lead = LeadDB.getOrCreate(norm);

  // Cancel any pending follow-ups immediately since student replied
  LeadDB.cancelFollowUpJobs(norm);

  if (isGlobalAiPaused || lead.ai_mode === 'HUMAN') {
    return {
      skipped: true,
      reason: isGlobalAiPaused ? 'GLOBAL_AI_PAUSED' : 'HUMAN_MODE',
      lead
    };
  }

  // 1. Pre-LLM deterministic inference (profile updates, intent, mood, declined_programs)
  const { updates: inferredUpdates, meta } = inferFromUserText(combinedText, lead);

  const existingObjs = Array.isArray(lead.objections) ? lead.objections : [];
  const updatedObjs = Array.from(new Set([...existingObjs, ...(meta.objections || [])]));
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

  const topRec = eligibilityResult.recommended?.[0];
  lead = LeadDB.upsert(norm, {
    ...(topRec ? {
      recommended_university: topRec.short_name || topRec.university,
      recommended_program: topRec.program
    } : {}),
    stage: stageInfo.stage,
    lead_score: stageInfo.lead_score
  });

  // 3. Load merged conversation turns (up to last 12 turns, multi-bubble turns merged with \n\n)
  const mergedHistoryTurns = LeadDB.getMergedConversationTurns(norm, 12);

  // 4. Generate Counselor Turn on Locked Groq 120B Engine
  let turnResult;
  try {
    turnResult = await generateCounselorTurn({
      userText: combinedText,
      lead,
      mergedHistoryTurns,
      eligibilityResult,
      stageInfo,
      kb,
      meta,
      sendOwnerAlertFn
    });
  } catch (err) {
    console.error(`❌ processStudentTurn LLM error for ${norm}:`, err.message);
    const failCount = (lead.consecutive_failures || 0) + 1;
    lead = LeadDB.upsert(norm, { consecutive_failures: failCount });
    turnResult = {
      thought: `LLM error fallback: ${err.message}`,
      reasoning: '',
      detected_intent: meta.detected_intent,
      conversation_mood: meta.conversation_mood,
      messages: ['Ek minute ji, main check karke aapko batata hoon 🙏'],
      profile_updates: {},
      stage_suggestion: lead.stage,
      should_cancel_followups: false,
      needs_human: failCount >= 2,
      human_reason: err.message,
      rag_docs: [],
      usage: null
    };
  }

  // 5. STALE-REPLY CANCELLATION CHECK (Section 2.2):
  // If a newer message arrived from this student while the LLM was generating, discard this stale reply!
  if (expectedTurnSeq !== null && userTurnSeq.get(norm) !== expectedTurnSeq) {
    console.log(`⏭️ Discarding stale in-flight LLM reply for ${norm} (seq ${expectedTurnSeq} < current ${userTurnSeq.get(norm)})`);
    return {
      skipped: true,
      staleCancelled: true,
      reason: 'STALE_TURN_SUPERSEDED',
      lead: LeadDB.get(norm)
    };
  }

  // 6. Merge any LLM-extracted profile_updates & re-evaluate stage if profile gained new facts
  const postLlmUpdates = sanitizeAndMergeProfileUpdates(lead, {}, turnResult.profile_updates);
  const isOptOut = turnResult.detected_intent === 'OPT_OUT_OR_EXIT' || turnResult.should_cancel_followups || lead.opted_out;

  if (isOptOut) {
    postLlmUpdates.opted_out = true;
    postLlmUpdates.stage = 'OPTED_OUT';
    LeadDB.cancelFollowUpJobs(norm);
  }

  lead = LeadDB.upsert(norm, {
    ...postLlmUpdates,
    conversation_mood: turnResult.conversation_mood || lead.conversation_mood || 'neutral',
    last_thought: turnResult.thought || null,
    last_reasoning: turnResult.reasoning || null,
    last_intent: turnResult.detected_intent || meta.detected_intent,
    last_rag_docs: turnResult.rag_docs || [],
    consecutive_failures: 0
  });

  // Re-evaluate eligibility & stage after merging LLM profile updates
  eligibilityResult = evaluateEligibility(lead, kb, meta);
  stageInfo = computeStageAndScore(lead, eligibilityResult, meta);
  const finalStage = isOptOut ? 'OPTED_OUT' : stageInfo.stage;

  lead = LeadDB.upsert(norm, {
    stage: finalStage,
    lead_score: isOptOut ? 0 : stageInfo.lead_score,
    ...(eligibilityResult.recommended?.[0] ? {
      recommended_university: eligibilityResult.recommended[0].short_name || eligibilityResult.recommended[0].university,
      recommended_program: eligibilityResult.recommended[0].program
    } : {})
  });

  // 7. Send multi-bubble reply
  const sendResults = await sendMultiBubbleHumanTurn({
    jid: norm,
    bubbles: turnResult.messages,
    incomingKeys,
    getSock,
    isFollowUp: false,
    skipDelays,
    debugMeta: {
      thought: turnResult.thought,
      reasoning: turnResult.reasoning,
      detectedIntent: turnResult.detected_intent,
      ragDocs: turnResult.rag_docs
    }
  });

  // 8. Check if Red Alert Escalation is needed
  if (turnResult.needs_human || meta.needs_human || (lead.consecutive_failures || 0) >= 2) {
    const reason = turnResult.human_reason || meta.escalation_reason || 'Counselor Escalation / Human Requested';
    await sendRedAlert(norm, reason, sendOwnerAlertFn);
  }

  return {
    skipped: false,
    lead: LeadDB.get(norm),
    eligibilityResult,
    stageInfo: { stage: finalStage, lead_score: lead.lead_score },
    turnResult,
    sendResults
  };
}

/**
 * Section 2.2 — Unified Ingestion Pipeline (`handleIncomingMessage`)
 * Shared by BOTH Baileys (`messages.upsert`) and Dashboard Test Chat Simulator!
 * - Saves incoming message to DB immediately (with deduplication by waMsgId)
 * - Checks HUMAN mode
 * - Buffers rapid messages per user (7s on Baileys, 2.5s on Simulator, or custom debounceMs)
 * - Increments turnSeq to cancel any stale in-flight generation if a new message arrives mid-generation
 */
export function handleIncomingMessage({
  phone,
  text,
  source = 'baileys', // 'baileys' | 'simulator'
  msgKey = null,
  rawProto = null,
  mediaType = null,
  mediaPath = null,
  getSock,
  sendOwnerAlertFn,
  isGlobalAiPaused = false,
  debounceMs = null,
  skipDelays = false
}) {
  const norm = LeadDB.normalizePhoneJid(phone);
  const waMsgId = msgKey?.id || null;

  // 1. Deduplicate by wa_msg_id if provided
  if (waMsgId) {
    if (LeadDB.isMessageProcessed(waMsgId)) {
      return Promise.resolve({ skipped: true, reason: 'DUPLICATE_MSG_ID' });
    }
    LeadDB.markMessageProcessed(waMsgId);
  }

  // 2. Save incoming message to DB immediately
  LeadDB.addMessage(norm, 'user', text, {
    waMsgId,
    status: 'RECEIVED',
    mediaType,
    mediaPath,
    rawProto
  });

  // 3. Check if lead is in HUMAN mode
  const lead = LeadDB.getOrCreate(norm);
  LeadDB.cancelFollowUpJobs(norm);
  if (isGlobalAiPaused || lead.ai_mode === 'HUMAN') {
    return Promise.resolve({
      skipped: true,
      reason: isGlobalAiPaused ? 'GLOBAL_AI_PAUSED' : 'HUMAN_MODE',
      lead
    });
  }

  // 4. Increment turnSeq for this user (cancels any stale in-flight LLM generation!)
  const nextSeq = (userTurnSeq.get(norm) || 0) + 1;
  userTurnSeq.set(norm, nextSeq);

  // 5. Determine debounce window (7s for Baileys, 2.5s for Simulator, or explicit override)
  const waitMs = debounceMs !== null && debounceMs !== undefined
    ? Number(debounceMs)
    : (source === 'simulator' ? 2500 : 7000);

  return new Promise((resolve) => {
    let entry = userDebounceMap.get(norm);
    if (!entry) {
      entry = { texts: [], keys: [], timer: null, resolvers: [] };
      userDebounceMap.set(norm, entry);
    }

    entry.texts.push(text);
    if (msgKey) entry.keys.push(msgKey);
    entry.resolvers.push(resolve);

    if (entry.timer) {
      clearTimeout(entry.timer);
    }

    entry.timer = setTimeout(async () => {
      const capturedSeq = userTurnSeq.get(norm);
      const combinedText = entry.texts.join('\n');
      const keys = [...entry.keys];
      const resolvers = [...entry.resolvers];
      userDebounceMap.delete(norm);

      // Chain onto per-user active lock
      const prevLock = userActiveLock.get(norm) || Promise.resolve();
      const task = prevLock.then(async () => {
        // If another message arrived while waiting for the lock, skip this stale execution
        if (userTurnSeq.get(norm) !== capturedSeq) {
          return { skipped: true, staleCancelled: true, reason: 'STALE_BEFORE_START' };
        }
        try {
          return await processStudentTurn({
            phone: norm,
            combinedText,
            incomingKeys: keys,
            getSock,
            sendOwnerAlertFn,
            isGlobalAiPaused,
            skipDelays: skipDelays || source === 'simulator',
            expectedTurnSeq: capturedSeq
          });
        } catch (e) {
          console.error(`⚠️ handleIncomingMessage error for ${norm}:`, e.message);
          return { error: e.message };
        }
      });

      userActiveLock.set(norm, task);
      const result = await task;
      for (const r of resolvers) r(result);
    }, waitMs);
  });
}

// Keep alias for backward compatibility
export const enqueueIncomingUserMessage = handleIncomingMessage;
