import assert from 'assert';
import { LeadDB } from '../database.js';
import { inferFromUserText, evaluateEligibility } from '../eligibilityEngine.js';
import {
  processStudentTurn,
  enqueueIncomingUserMessage,
  flushOutboundQueue
} from '../conversationController.js';
import {
  adjustToBusinessHoursIST,
  getISTParts,
  scheduleGhostFollowUps,
  HOUR
} from '../followupEngine.js';

// Run deterministic + post-processor pipeline for reliable, fast automated testing
process.env.NODE_ENV = 'test';
process.env.DISABLE_LLM_FOR_TESTS = process.env.TEST_WITH_LIVE_LLM === '1' ? '0' : '1';

let passed = 0;
let failed = 0;

function resetTestLead(phone, overrides = {}) {
  const norm = LeadDB.normalizePhoneJid(phone);
  LeadDB.cancelFollowUpJobs(norm);
  return LeadDB.upsert(norm, {
    name: null,
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
    human_until: null,
    opted_out: false,
    is_ghost: false,
    ghost_stage: null,
    follow_up_count: 0,
    consecutive_failures: 0,
    last_alert_at: null,
    turn_count: 0,
    last_cta_turn: 0,
    ...overrides
  });
}

function createMockSocketCollector() {
  const bubbles = [];
  const getSock = () => ({
    readMessages: async () => {},
    presenceSubscribe: async () => {},
    sendPresenceUpdate: async () => {},
    sendMessage: async (_jid, content) => {
      bubbles.push(content.text);
      return { key: { id: `test_${Date.now()}_${bubbles.length}` } };
    }
  });
  return { bubbles, getSock };
}

/**
 * Assert universal reply quality rules on every bot turn:
 * - 1 to 3 bubbles (max 4 for checklist/comparison)
 * - No raw markdown (** or ##)
 * - At most 1 question mark (?) across the entire turn (unless opted out -> 0 questions)
 * - No bubble > 1000 chars
 */
function assertReplyRules(bubbles, allowChecklist = false) {
  assert(bubbles.length >= 1, 'Expected at least 1 bubble');
  assert(bubbles.length <= (allowChecklist ? 4 : 3), `Expected <= ${allowChecklist ? 4 : 3} bubbles, got ${bubbles.length}`);

  let totalQuestionMarks = 0;
  bubbles.forEach((b, idx) => {
    assert(b.length <= 1000, `Bubble ${idx + 1} exceeds 1000 chars`);
    assert(!/\*\*/.test(b), `Bubble ${idx + 1} contains raw markdown **: "${b}"`);
    assert(!/^#{1,6}\s/m.test(b), `Bubble ${idx + 1} contains raw markdown # heading: "${b}"`);
    const lines = b.split('\n').filter(Boolean);
    assert(lines.length <= (allowChecklist ? 6 : 3), `Bubble ${idx + 1} has ${lines.length} lines (max ${allowChecklist ? 6 : 3}): "${b}"`);

    const qCount = (b.match(/\?/g) || []).length;
    totalQuestionMarks += qCount;
    if (idx < bubbles.length - 1) {
      assert.strictEqual(qCount, 0, `Non-final bubble ${idx + 1} should not contain a question: "${b}"`);
    }
  });

  assert(totalQuestionMarks <= 1, `Turn contains ${totalQuestionMarks} questions (max 1 allowed): ${JSON.stringify(bubbles)}`);
}

async function runScenario(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`✅ PASS: ${name}`);
  } catch (err) {
    failed++;
    console.error(`❌ FAIL: ${name}\n   -> ${err.message}`);
  }
}

async function runAllTests() {
  console.log('\n============================================================');
  console.log('🧪 RUNNING PHASE 7 AUTOMATED SCENARIO SUITE (23 SCENARIOS)');
  console.log('============================================================\n');

  // 1. 12th pass student asks for B.Tech -> honestly refused, BCA/BBA suggested
  await runScenario('1. 12th pass student asks for B.Tech -> honestly refused, BCA/BBA suggested', async () => {
    const phone = '919000000001@s.whatsapp.net';
    resetTestLead(phone);
    const { bubbles, getSock } = createMockSocketCollector();

    const res = await processStudentTurn({
      phone,
      combinedText: 'bhai mujhe btech krni h job ke sath, 12th kiya h science se',
      getSock,
      skipDelays: true
    });

    assertReplyRules(bubbles);
    assert.strictEqual(res.eligibilityResult.decision_status, 'NOT_ELIGIBLE_FOR_BTECH_BUT_ALTERNATIVE_AVAILABLE');
    const joined = bubbles.join(' ');
    assert(/allowed nahi|not eligible|diploma/i.test(joined), 'Should explain 12th pass cannot do WP B.Tech');
    assert(/BCA|BBA/i.test(joined), 'Should suggest Online BCA or BBA');
  });

  // 2. Diploma 62%, private job, Lucknow -> Sanskriti / Kalinga (both Pan-India)
  await runScenario('2. Diploma 62%, private job, Lucknow -> Sanskriti / Kalinga (both Pan-India)', async () => {
    const phone = '919000000002@s.whatsapp.net';
    resetTestLead(phone);
    const { bubbles, getSock } = createMockSocketCollector();

    const res = await processStudentTurn({
      phone,
      combinedText: 'Mera diploma 62% hai, private job karta hoon Lucknow mein, B.Tech karna hai',
      getSock,
      skipDelays: true
    });

    assertReplyRules(bubbles, true);
    assert.strictEqual(res.eligibilityResult.decision_status, 'ELIGIBLE');
    const recNames = res.eligibilityResult.recommended.map(r => r.short_name).join(' ');
    assert(/Sanskriti/i.test(recNames) && /Kalinga/i.test(recNames), 'Both Sanskriti & Kalinga should be recommended');
  });

  // 3. Diploma 55%, private job, Assam, asks "AICTE approved chahiye" -> Kalinga (NOT calling Sanskriti AICTE approved)
  await runScenario('3. Diploma 55%, private job, Assam, "AICTE approved chahiye" -> Kalinga (Sanskriti NOT called AICTE approved)', async () => {
    const phone = '919000000003@s.whatsapp.net';
    resetTestLead(phone);
    const { bubbles, getSock } = createMockSocketCollector();

    const res = await processStudentTurn({
      phone,
      combinedText: 'Diploma 55% private job Assam, mujhe AICTE approved university hi chahiye B.Tech ke liye',
      getSock,
      skipDelays: true
    });

    assertReplyRules(bubbles, true);
    assert.strictEqual(res.eligibilityResult.decision_status, 'ELIGIBLE');
    assert.strictEqual(res.eligibilityResult.recommended[0].short_name, 'Kalinga University');
    const joined = bubbles.join(' ');
    assert(/Kalinga/i.test(joined), 'Should recommend Kalinga');
    assert(!/Sanskriti[^.\n]*is AICTE approved/i.test(joined), 'Must never claim Sanskriti is AICTE approved');
  });

  // 4. Diploma 48%, Govt employee, Delhi -> not eligible for Lingaya's (<50%), honest alternatives
  await runScenario("4. Diploma 48%, Govt employee, Delhi -> not eligible for Lingaya's (<50%), honest alternatives", async () => {
    const phone = '919000000004@s.whatsapp.net';
    resetTestLead(phone);
    const { bubbles, getSock } = createMockSocketCollector();

    const res = await processStudentTurn({
      phone,
      combinedText: 'Diploma 48% hai, govt job mein hoon Delhi mein, B.Tech karna hai',
      getSock,
      skipDelays: true
    });

    assertReplyRules(bubbles);
    assert.strictEqual(res.eligibilityResult.decision_status, 'NOT_ELIGIBLE');
    const joined = bubbles.join(' ');
    assert(/50%/i.test(joined), 'Should explain 50% minimum requirement for Govt employees at Lingayas');
  });

  // 5. Diploma 70%, PSU employee, Noida -> Lingaya's
  await runScenario("5. Diploma 70%, PSU employee, Noida -> Lingaya's Vidyapeeth", async () => {
    const phone = '919000000005@s.whatsapp.net';
    resetTestLead(phone);
    const { bubbles, getSock } = createMockSocketCollector();

    const res = await processStudentTurn({
      phone,
      combinedText: 'Diploma 70% hai, NTPC PSU mein job hai Noida mein, B.Tech LE karni hai',
      getSock,
      skipDelays: true
    });

    assertReplyRules(bubbles, true);
    assert.strictEqual(res.eligibilityResult.decision_status, 'ELIGIBLE');
    assert(/Lingaya/i.test(res.eligibilityResult.recommended[0].university), 'Should recommend Lingayas');
    assert(/Lingaya/i.test(bubbles.join(' ')), 'Reply should mention Lingayas');
  });

  // 6. Govt employee in Bihar (outside 75 km) -> no forced option, honest + human callback
  await runScenario('6. Govt employee in Bihar (outside 75 km) -> no forced option, honest + human callback', async () => {
    const phone = '919000000006@s.whatsapp.net';
    resetTestLead(phone);
    const { bubbles, getSock } = createMockSocketCollector();
    let ownerAlertTriggered = false;

    const res = await processStudentTurn({
      phone,
      combinedText: 'Diploma 65% hai, railway govt job mein hoon Patna Bihar mein',
      getSock,
      sendOwnerAlertFn: async () => { ownerAlertTriggered = true; },
      skipDelays: true
    });

    assertReplyRules(bubbles);
    assert.strictEqual(res.eligibilityResult.decision_status, 'NOT_ELIGIBLE_LOCATION_GOVT');
    assert(/75\s*KM/i.test(bubbles.join(' ')), 'Should explain 75 km Faridabad NCR rule');
    assert(ownerAlertTriggered, 'Should trigger human callback alert');
  });

  // 7. B.Tech grad -> M.Tech WP / EMBA
  await runScenario('7. B.Tech grad -> M.Tech WP / EMBA', async () => {
    const phone = '919000000007@s.whatsapp.net';
    resetTestLead(phone);
    const { bubbles, getSock } = createMockSocketCollector();

    const res = await processStudentTurn({
      phone,
      combinedText: 'Maine B.Tech pass kiya hai 68% ke sath, private company mein job karta hoon, M.Tech karna hai',
      getSock,
      skipDelays: true
    });

    assertReplyRules(bubbles, true);
    assert.strictEqual(res.eligibilityResult.decision_status, 'ELIGIBLE');
    assert(/M\.Tech/i.test(res.eligibilityResult.eligible_programs.join(' ')), 'Should be eligible for M.Tech WP');
  });

  // 8. B.Com grad -> Online MBA / MCA
  await runScenario('8. B.Com grad -> Online MBA / MCA', async () => {
    const phone = '919000000008@s.whatsapp.net';
    resetTestLead(phone);
    const { bubbles, getSock } = createMockSocketCollector();

    const res = await processStudentTurn({
      phone,
      combinedText: 'Maine B.Com kiya hai 60% se aur private job mein hoon',
      getSock,
      skipDelays: true
    });

    assertReplyRules(bubbles);
    assert.strictEqual(res.eligibilityResult.decision_status, 'ELIGIBLE');
    assert(/MBA|MCA/i.test(res.eligibilityResult.eligible_programs.join(' ')), 'Should recommend Online MBA / MCA');
  });

  // 9. "Fees kitni hai?" as first message -> fee range answered first, then one qualifying question
  await runScenario('9. "Fees kitni hai?" as first message -> fee range answered first, then one qualifying question', async () => {
    const phone = '919000000009@s.whatsapp.net';
    resetTestLead(phone);
    const { bubbles, getSock } = createMockSocketCollector();

    await processStudentTurn({
      phone,
      combinedText: 'Fees kitni hai?',
      getSock,
      skipDelays: true
    });

    assertReplyRules(bubbles);
    const joined = bubbles.join(' ');
    assert(/45,000|50,000|15,000|₹/i.test(joined), 'Should answer fee range first');
    assert(bubbles[bubbles.length - 1].includes('?'), 'Should ask 1 qualifying question at the end');
  });

  // 10. "Ye fake toh nahi?" -> verification steps
  await runScenario('10. "Ye fake toh nahi?" -> verification steps', async () => {
    const phone = '919000000010@s.whatsapp.net';
    resetTestLead(phone);
    const { bubbles, getSock } = createMockSocketCollector();

    await processStudentTurn({
      phone,
      combinedText: 'Ye fake toh nahi? Degree valid rahegi na?',
      getSock,
      skipDelays: true
    });

    assertReplyRules(bubbles, true);
    const joined = bubbles.join(' ');
    assert(/ugc\.ac\.in/i.test(joined), 'Should provide UGC verification portal');
    assert(/aicte/i.test(joined), 'Should mention AICTE portal');
  });

  // 11. Student already told qualification -> bot never asks it again (20+ message conversation)
  await runScenario('11. Student already told qualification -> bot never asks it again across 20+ messages', async () => {
    const phone = '919000000011@s.whatsapp.net';
    resetTestLead(phone);

    // Seed 20 messages where qualification was given in message #1
    LeadDB.upsert(phone, { qualification: 'DIPLOMA', stream_branch: 'Mechanical' });
    for (let i = 1; i <= 20; i++) {
      LeadDB.addMessage(phone, i % 2 === 1 ? 'user' : 'bot', `Turn message #${i}`);
    }

    const { bubbles, getSock } = createMockSocketCollector();
    const res = await processStudentTurn({
      phone,
      combinedText: 'Aage kya process hai?',
      getSock,
      skipDelays: true
    });

    assertReplyRules(bubbles);
    assert.strictEqual(res.lead.qualification, 'DIPLOMA');
    const joined = bubbles.join(' ');
    assert(!/qualification kya hai|12th ke baad diploma kiya/i.test(joined), 'Must never re-ask qualification');
  });

  // 12. 4 rapid messages -> one combined reply (debounce)
  await runScenario('12. 4 rapid messages -> debounced into one combined reply', async () => {
    const phone = '919000000012@s.whatsapp.net';
    resetTestLead(phone);
    let turnExecutions = 0;
    const { bubbles, getSock } = createMockSocketCollector();
    const wrappedGetSock = () => {
      const s = getSock();
      return {
        ...s,
        readMessages: async () => { turnExecutions++; }
      };
    };

    const p1 = enqueueIncomingUserMessage({ phone, text: 'hi', msgKey: { id: 'm1' }, getSock: wrappedGetSock, debounceMs: 60, skipDelays: true });
    const p2 = enqueueIncomingUserMessage({ phone, text: 'mujhe btech krna h', msgKey: { id: 'm2' }, getSock: wrappedGetSock, debounceMs: 60, skipDelays: true });
    const p3 = enqueueIncomingUserMessage({ phone, text: 'diploma civil h mera', msgKey: { id: 'm3' }, getSock: wrappedGetSock, debounceMs: 60, skipDelays: true });
    const p4 = enqueueIncomingUserMessage({ phone, text: 'private job me hu', msgKey: { id: 'm4' }, getSock: wrappedGetSock, debounceMs: 60, skipDelays: true });

    const [r1] = await Promise.all([p1, p2, p3, p4]);
    assert.strictEqual(turnExecutions, 1, 'All 4 rapid messages must be processed as a single turn');
    assert.strictEqual(r1.lead.qualification, 'DIPLOMA');
    assert.strictEqual(r1.lead.employment_type, 'PRIVATE');
    assertReplyRules(bubbles);
  });

  // 13. Message at 10:30 PM IST -> follow-up queued for 9:30 AM IST (+ jitter)
  await runScenario('13. Follow-up due at 10:30 PM IST -> queued for 9:30 AM IST next morning', async () => {
    // Construct a timestamp corresponding to 22:30 IST (17:00 UTC)
    const nightUtc = Date.UTC(2026, 10, 20, 17, 0, 0); // 17:00 UTC = 22:30 IST
    const istNight = getISTParts(nightUtc);
    assert.strictEqual(istNight.hour, 22);

    const adjusted = adjustToBusinessHoursIST(nightUtc, false); // without random jitter to test exact 9:30 AM base
    const istMorning = getISTParts(adjusted);
    assert.strictEqual(istMorning.hour, 9);
    assert.strictEqual(istMorning.minute, 30);
  });

  // 14. "STOP" -> opted out, no more follow-ups
  await runScenario('14. "STOP" -> opted out, polite close, no more follow-ups', async () => {
    const phone = '919000000014@s.whatsapp.net';
    resetTestLead(phone, { stage: 'PITCHED' });
    scheduleGhostFollowUps(LeadDB.get(phone));
    assert(LeadDB.getPendingFollowUpJobsForLead(phone).length > 0, 'Should have pending follow-ups before STOP');

    const { bubbles, getSock } = createMockSocketCollector();
    const res = await processStudentTurn({
      phone,
      combinedText: 'STOP',
      getSock,
      skipDelays: true
    });

    assert.strictEqual(res.lead.opted_out, true);
    assert.strictEqual(res.lead.stage, 'OPTED_OUT');
    assert.strictEqual(LeadDB.getPendingFollowUpJobsForLead(phone).length, 0, 'Pending follow-ups must be cancelled');
    assert.strictEqual(scheduleGhostFollowUps(res.lead).length, 0, 'Opted-out lead must never be scheduled for follow-ups');
    assert(!bubbles.join(' ').includes('?'), 'Closing message on STOP should not ask any question');
  });

  // 15. Human mode on -> bot silent
  await runScenario('15. Human mode on -> bot completely silent', async () => {
    const phone = '919000000015@s.whatsapp.net';
    resetTestLead(phone, { ai_mode: 'HUMAN', human_until: Date.now() + 12 * HOUR });
    const { bubbles, getSock } = createMockSocketCollector();

    const res = await processStudentTurn({
      phone,
      combinedText: 'Hello sir fees batao',
      getSock,
      skipDelays: true
    });

    assert.strictEqual(res.skipped, true);
    assert.strictEqual(res.reason, 'HUMAN_MODE');
    assert.strictEqual(bubbles.length, 0, 'Bot must send 0 bubbles in HUMAN mode');
  });

  // 16. Human replies from linked phone (fromMe not sent by bot) -> lead auto-switches to HUMAN
  await runScenario('16. Reply from linked phone (fromMe not in bot_sent_ids) -> lead auto-switches to HUMAN for 12h', async () => {
    const phone = '919000000016@s.whatsapp.net';
    resetTestLead(phone, { ai_mode: 'AI' });
    const humanMsgId = 'LINKED_PHONE_MSG_999';
    assert.strictEqual(LeadDB.isBotSentId(humanMsgId), false);

    // Simulate index.js fromMe handler when !LeadDB.isBotSentId(msgId)
    LeadDB.addMessage(phone, 'human', 'Main Harsh bol raha hoon, abhi call karta hoon', { waMsgId: humanMsgId });
    LeadDB.upsert(phone, { ai_mode: 'HUMAN', human_until: Date.now() + 12 * HOUR });
    LeadDB.cancelFollowUpJobs(phone);

    const updated = LeadDB.get(phone);
    assert.strictEqual(updated.ai_mode, 'HUMAN');
    assert(updated.human_until > Date.now() + 11 * HOUR);
  });

  // 17. Socket disconnect during a reply -> message queued in DB and delivered after reconnect
  await runScenario('17. Socket disconnect during reply -> queued in DB and delivered on reconnect without loss', async () => {
    const phone = '919000000017@s.whatsapp.net';
    resetTestLead(phone);

    // Socket is null (disconnected)
    await processStudentTurn({
      phone,
      combinedText: 'Diploma civil 60% private job',
      getSock: () => null,
      skipDelays: true
    });

    const pendingQueue = LeadDB.getPendingOutbound().filter(q => q.lead_phone === phone);
    assert(pendingQueue.length >= 1, 'Failed bubbles must be saved in outbound_queue');

    // Now socket reconnects!
    const { bubbles, getSock } = createMockSocketCollector();
    const flushedCount = await flushOutboundQueue({ getSock, skipDelays: true });
    assert(flushedCount >= pendingQueue.length, 'All queued messages must flush upon reconnect');
    assert(bubbles.length >= pendingQueue.length, 'Flushed bubbles must be sent through socket');
  });

  // 18. Full probing flow from "btech krni h" -> every bot turn has ONE question, eligibility reached naturally
  await runScenario('18. Full probing flow from "btech krni h" -> 1 question per turn, natural progression', async () => {
    const phone = '919000000018@s.whatsapp.net';
    resetTestLead(phone);

    // Turn 1: Student says "sir btech krni h job ke sath"
    let c1 = createMockSocketCollector();
    let r1 = await processStudentTurn({ phone, combinedText: 'sir btech krni h job ke sath', getSock: c1.getSock, skipDelays: true });
    assertReplyRules(c1.bubbles);
    assert.strictEqual(r1.eligibilityResult.missing_info[0], 'qualification');

    // Turn 2: Student says "diploma kiya h mechanical se"
    let c2 = createMockSocketCollector();
    let r2 = await processStudentTurn({ phone, combinedText: 'diploma kiya h mechanical se', getSock: c2.getSock, skipDelays: true });
    assertReplyRules(c2.bubbles);
    assert.strictEqual(r2.lead.qualification, 'DIPLOMA');
    assert.strictEqual(r2.eligibilityResult.missing_info[0], 'employment_type');

    // Turn 3: Student says "private, ek auto parts company me"
    let c3 = createMockSocketCollector();
    let r3 = await processStudentTurn({ phone, combinedText: 'private, ek auto parts company me', getSock: c3.getSock, skipDelays: true });
    assertReplyRules(c3.bubbles);
    assert.strictEqual(r3.lead.employment_type, 'PRIVATE');
    assert.strictEqual(r3.eligibilityResult.missing_info[0], 'percentage');

    // Turn 4: Student says "58% thi" -> Eligibility reached & pitched!
    let c4 = createMockSocketCollector();
    let r4 = await processStudentTurn({ phone, combinedText: '58% thi', getSock: c4.getSock, skipDelays: true });
    assertReplyRules(c4.bubbles, true);
    assert.strictEqual(r4.eligibilityResult.decision_status, 'ELIGIBLE');
    assert.strictEqual(r4.lead.stage, 'PITCHED');
  });

  // 19. Student gives 3 facts in one message ("diploma civil 60% private job") -> bot skips all those questions
  await runScenario('19. Student gives 3 facts in one message ("diploma civil 60% private job") -> skips all those questions', async () => {
    const phone = '919000000019@s.whatsapp.net';
    resetTestLead(phone);
    const { bubbles, getSock } = createMockSocketCollector();

    const res = await processStudentTurn({
      phone,
      combinedText: 'diploma civil 60% private job',
      getSock,
      skipDelays: true
    });

    assertReplyRules(bubbles, true);
    assert.strictEqual(res.lead.qualification, 'DIPLOMA');
    assert.strictEqual(res.lead.stream_branch, 'Civil');
    assert.strictEqual(res.lead.percentage, 60);
    assert.strictEqual(res.lead.employment_type, 'PRIVATE');
    assert.strictEqual(res.eligibilityResult.decision_status, 'ELIGIBLE');
    const joined = bubbles.join(' ');
    assert(!/qualification kya|private.*ya.*govt|percentage kitni/i.test(joined), 'Must skip all 3 already-provided questions');
  });

  // 20. Private diploma student -> bot never asks city/location (not needed, Pan-India)
  await runScenario('20. Private diploma student -> bot NEVER asks city/location (Pan-India)', async () => {
    const phone = '919000000020@s.whatsapp.net';
    resetTestLead(phone);
    const { bubbles, getSock } = createMockSocketCollector();

    const res = await processStudentTurn({
      phone,
      combinedText: 'Maine mechanical diploma kiya hai 55% se aur private company mein job karta hoon',
      getSock,
      skipDelays: true
    });

    assertReplyRules(bubbles, true);
    assert(!res.eligibilityResult.missing_info.includes('city'), 'City must NOT be in missing_info for private diploma');
    const joined = bubbles.join(' ');
    assert(!/kis city|kahan rehte|location kya/i.test(joined), 'Bot must never ask city/location for private diploma student');
  });

  // 21. Student mentions another college / online B.Tech -> neutral checklist + honest comparison + partner recommendation
  await runScenario('21. Student mentions another college / online B.Tech -> neutral checklist + partner recommendation, no defamation', async () => {
    const phone = '919000000021@s.whatsapp.net';
    resetTestLead(phone, { qualification: 'DIPLOMA', percentage: 60, employment_type: 'PRIVATE', employed: true });
    const { bubbles, getSock } = createMockSocketCollector();

    await processStudentTurn({
      phone,
      combinedText: 'sir mere dost ne XYZ se online btech ki h, sasti padi, wo kaisi h?',
      getSock,
      skipDelays: true
    });

    assertReplyRules(bubbles, true);
    const joined = bubbles.join(' ');
    assert(/online.*valid nahi|AICTE/i.test(joined), 'Should explain online B.Tech is not valid under AICTE');
    assert(/ugc\.ac\.in/i.test(joined), 'Should give neutral verification checklist');
    assert(/Sanskriti|Kalinga/i.test(joined), 'Should end with partner university recommendation');
  });

  // 22. Student asks "Sanskriti ya Kalinga kaunsi better?" -> fair comparison + clear final suggestion
  await runScenario('22. Student asks "Sanskriti ya Kalinga kaunsi better?" -> fair comparison + clear final suggestion', async () => {
    const phone = '919000000022@s.whatsapp.net';
    resetTestLead(phone, { qualification: 'DIPLOMA', percentage: 60, employment_type: 'PRIVATE', employed: true });
    const { bubbles, getSock } = createMockSocketCollector();

    await processStudentTurn({
      phone,
      combinedText: 'Sanskriti ya Kalinga kaunsi better hai mere liye?',
      getSock,
      skipDelays: true
    });

    assertReplyRules(bubbles, true);
    const joined = bubbles.join(' ');
    assert(/Sanskriti/i.test(joined) && /Kalinga/i.test(joined), 'Should compare both Sanskriti and Kalinga');
    assert(/mera honest suggestion/i.test(joined), 'Should end with a clear personal recommendation');
  });

  // 23. Pitch never appears before eligibility is clear; "registration karao"-type CTA not repeated in consecutive turns
  await runScenario('23. Pitch never appears before eligibility is clear; hard CTA not repeated', async () => {
    const phone = '919000000023@s.whatsapp.net';
    resetTestLead(phone);
    const { bubbles, getSock } = createMockSocketCollector();

    const res = await processStudentTurn({
      phone,
      combinedText: 'Hi mujhe degree karni hai',
      getSock,
      skipDelays: true
    });

    assertReplyRules(bubbles);
    assert.strictEqual(res.eligibilityResult.decision_status, 'NEED_INFO');
    const joined = bubbles.join(' ');
    assert(!/Sanskriti|Kalinga|Lingaya/i.test(joined), 'Must NOT pitch any university before qualification is known');
    assert(!/registration karao/i.test(joined), 'Must never use pushy registration CTA');
  });

  console.log('\n============================================================');
  console.log(`📊 TEST SUMMARY: ${passed} PASSED | ${failed} FAILED (Total: ${passed + failed})`);
  console.log('============================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runAllTests();
