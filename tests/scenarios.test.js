import assert from 'assert';
import { LeadDB } from '../database.js';
import { KnowledgeRAG } from '../knowledgeRag.js';
import { handleIncomingMessage } from '../conversationController.js';

process.env.NODE_ENV = 'test';

let passed = 0;
let failed = 0;

function resetTestLead(phone, overrides = {}) {
  const norm = LeadDB.normalizePhoneJid(phone);
  LeadDB.clearMessages(norm);
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
    preferred_program: null,
    recommended_program: null,
    recommended_university: null,
    declined_programs: [],
    objections: [],
    conversation_mood: 'neutral',
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
    last_thought: null,
    last_reasoning: null,
    last_intent: null,
    last_rag_docs: [],
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
      return { key: { id: `test_${Date.now()}_${bubbles.length}_${Math.random().toString(36).slice(2, 6)}` } };
    }
  });
  return { bubbles, getSock };
}

function assertCleanReply(bubbles, maxQuestions = 1) {
  assert(bubbles.length >= 1 && bubbles.length <= 4, `Expected 1-4 bubbles, got ${bubbles.length}`);
  const joined = bubbles.join('\n');
  assert(!/\*\*/.test(joined), `Contains raw markdown **: ${joined}`);
  assert(!/^#{1,6}\s/m.test(joined), `Contains raw markdown # header: ${joined}`);
  assert(!/\(12th pass, 3-yr Polytechnic Diploma, ya Graduation\?\)/i.test(joined), `Contains banned parenthetical MCQ menu: ${joined}`);
  assert(!/Aapke background ko samajhna zaroori hai/i.test(joined), `Contains banned robotic phrase: ${joined}`);

  const qCount = (joined.match(/\?/g) || []).length;
  assert(qCount <= maxQuestions, `Expected at most ${maxQuestions} questions, got ${qCount} in:\n${joined}`);
}

async function runTest(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`✅ PASS: ${name}`);
  } catch (err) {
    failed++;
    console.error(`❌ FAIL: ${name}\n   -> ${err.message}`);
  }
}

async function runAllMandatoryTests() {
  console.log('\n====================================================================');
  console.log('🧪 PART 5 — MANDATORY LIVE VERIFICATION & REPLAY SUITE (GROQ 120B)');
  console.log('====================================================================\n');

  // =================================================================
  // MANDATORY TEST 1 — EXACT REPLAY OF THE BROKEN 6-TURN TRANSCRIPT
  // =================================================================
  await runTest('MANDATORY TEST 1: Exact Replay of the 6-Turn Broken Transcript + Prompt Cache Proof', async () => {
    const phone = '919000010001@s.whatsapp.net';
    resetTestLead(phone);

    console.log('\n--- [MANDATORY TEST 1: LIVE TRANSCRIPT REPLAY] ---');

    // TURN 1: "Hello" followed 20ms later by "Hyy" -> MUST merge via debounce into ONE warm greeting
    const c1 = createMockSocketCollector();
    const pHello = handleIncomingMessage({ phone, text: 'Hello', source: 'simulator', getSock: c1.getSock, debounceMs: 120, skipDelays: true });
    await new Promise(r => setTimeout(r, 20));
    const pHyy = handleIncomingMessage({ phone, text: 'Hyy', source: 'simulator', getSock: c1.getSock, debounceMs: 120, skipDelays: true });
    const [r1] = await Promise.all([pHello, pHyy]);

    console.log(`\n[Turn 1] Student: "Hello" + "Hyy" (debounced)`);
    console.log(`  Thought: ${r1.turnResult.thought}`);
    console.log(`  Intent:  ${r1.turnResult.detected_intent} | Stage: ${r1.lead.stage}`);
    console.log(`  Usage:   prompt=${r1.turnResult.usage?.prompt_tokens}, cached=${r1.turnResult.usage?.cached_tokens}, completion=${r1.turnResult.usage?.completion_tokens}`);
    c1.bubbles.forEach((b, i) => console.log(`  Bot Bubble ${i + 1}: ${b}`));

    assertCleanReply(c1.bubbles, 1);
    assert(!/12th|diploma|graduation|private|govt/i.test(c1.bubbles.join(' ')), 'Turn 1 greeting must NOT interrogate qualification or job');

    // TURN 2: "Arre ky hogya?"
    const c2 = createMockSocketCollector();
    const r2 = await handleIncomingMessage({ phone, text: 'Arre ky hogya?', source: 'simulator', getSock: c2.getSock, debounceMs: 30, skipDelays: true });
    console.log(`\n[Turn 2] Student: "Arre ky hogya?"`);
    console.log(`  Thought: ${r2.turnResult.thought}`);
    console.log(`  Intent:  ${r2.turnResult.detected_intent} | Stage: ${r2.lead.stage}`);
    console.log(`  Usage:   prompt=${r2.turnResult.usage?.prompt_tokens}, cached=${r2.turnResult.usage?.cached_tokens}, completion=${r2.turnResult.usage?.completion_tokens}`);
    c2.bubbles.forEach((b, i) => console.log(`  Bot Bubble ${i + 1}: ${b}`));
    assertCleanReply(c2.bubbles, 1);

    // TURN 3: "Polytechnic"
    const c3 = createMockSocketCollector();
    const r3 = await handleIncomingMessage({ phone, text: 'Polytechnic', source: 'simulator', getSock: c3.getSock, debounceMs: 30, skipDelays: true });
    console.log(`\n[Turn 3] Student: "Polytechnic"`);
    console.log(`  Thought: ${r3.turnResult.thought}`);
    console.log(`  Intent:  ${r3.turnResult.detected_intent} | Stage: ${r3.lead.stage}`);
    console.log(`  Usage:   prompt=${r3.turnResult.usage?.prompt_tokens}, cached=${r3.turnResult.usage?.cached_tokens}, completion=${r3.turnResult.usage?.completion_tokens}`);
    c3.bubbles.forEach((b, i) => console.log(`  Bot Bubble ${i + 1}: ${b}`));
    assertCleanReply(c3.bubbles, 1);
    assert.strictEqual(r3.lead.qualification, 'DIPLOMA');

    // TURN 4: "Ye sb ku puch rahe ho ho kaun tum?"
    const c4 = createMockSocketCollector();
    const r4 = await handleIncomingMessage({ phone, text: 'Ye sb ku puch rahe ho ho kaun tum?', source: 'simulator', getSock: c4.getSock, debounceMs: 30, skipDelays: true });
    console.log(`\n[Turn 4] Student: "Ye sb ku puch rahe ho ho kaun tum?"`);
    console.log(`  Thought: ${r4.turnResult.thought}`);
    console.log(`  Intent:  ${r4.turnResult.detected_intent} | Stage: ${r4.lead.stage}`);
    console.log(`  Usage:   prompt=${r4.turnResult.usage?.prompt_tokens}, cached=${r4.turnResult.usage?.cached_tokens}, completion=${r4.turnResult.usage?.completion_tokens}`);
    c4.bubbles.forEach((b, i) => console.log(`  Bot Bubble ${i + 1}: ${b}`));
    assertCleanReply(c4.bubbles, 1);
    assert(/Harsh|College Vidya/i.test(c4.bubbles.join(' ')), 'Turn 4 must introduce Harsh Joshi / College Vidya');

    // TURN 5: "Arre mujhe nahi krna btech"
    const c5 = createMockSocketCollector();
    const r5 = await handleIncomingMessage({ phone, text: 'Arre mujhe nahi krna btech', source: 'simulator', getSock: c5.getSock, debounceMs: 30, skipDelays: true });
    console.log(`\n[Turn 5] Student: "Arre mujhe nahi krna btech"`);
    console.log(`  Thought: ${r5.turnResult.thought}`);
    console.log(`  Intent:  ${r5.turnResult.detected_intent} | Stage: ${r5.lead.stage} | Declined: ${JSON.stringify(r5.lead.declined_programs)}`);
    console.log(`  Usage:   prompt=${r5.turnResult.usage?.prompt_tokens}, cached=${r5.turnResult.usage?.cached_tokens}, completion=${r5.turnResult.usage?.completion_tokens}`);
    c5.bubbles.forEach((b, i) => console.log(`  Bot Bubble ${i + 1}: ${b}`));
    assertCleanReply(c5.bubbles, 1);
    assert(r5.lead.declined_programs.includes('BTECH_LE'), 'Must add BTECH_LE to declined_programs');
    assert(/BCA|BBA/i.test(c5.bubbles.join(' ')), 'Must offer Online BCA / BBA alternatives for Diploma holders');
    assert(!/sirf b\.?tech/i.test(c5.bubbles.join(' ')), 'Must NEVER say only B.Tech is available');

    // TURN 6: "Mujhe kuch nahi chahiye thankyou!!"
    const c6 = createMockSocketCollector();
    const r6 = await handleIncomingMessage({ phone, text: 'Mujhe kuch nahi chahiye thankyou!!', source: 'simulator', getSock: c6.getSock, debounceMs: 30, skipDelays: true });
    console.log(`\n[Turn 6] Student: "Mujhe kuch nahi chahiye thankyou!!"`);
    console.log(`  Thought: ${r6.turnResult.thought}`);
    console.log(`  Intent:  ${r6.turnResult.detected_intent} | Stage: ${r6.lead.stage} | OptedOut: ${r6.lead.opted_out}`);
    console.log(`  Usage:   prompt=${r6.turnResult.usage?.prompt_tokens}, cached=${r6.turnResult.usage?.cached_tokens}, completion=${r6.turnResult.usage?.completion_tokens}`);
    c6.bubbles.forEach((b, i) => console.log(`  Bot Bubble ${i + 1}: ${b}`));
    console.log('--------------------------------------------------\n');

    assertCleanReply(c6.bubbles, 0); // ZERO questions allowed on exit!
    assert.strictEqual(r6.lead.stage, 'OPTED_OUT');
    assert.strictEqual(r6.lead.opted_out, true);
  });

  // TEST 2: 12th pass asking for B.Tech -> honestly declined, Online BCA/BBA suggested, 1 question
  await runTest('Test 2: 12th pass asking for B.Tech -> honestly declined, Online BCA/BBA suggested', async () => {
    const phone = '919000010002@s.whatsapp.net';
    resetTestLead(phone);
    const c = createMockSocketCollector();
    await handleIncomingMessage({ phone, text: 'bhai 12th pcm h job kr rha hu btech krni h', source: 'simulator', getSock: c.getSock, debounceMs: 20, skipDelays: true });
    assertCleanReply(c.bubbles, 1);
    const joined = c.bubbles.join(' ');
    assert(/BCA|BBA/i.test(joined), 'Should recommend Online BCA/BBA');
  });

  // TEST 3: Diploma 62% private job Pune -> Sanskriti + Kalinga presented cleanly
  await runTest('Test 3: Diploma 62% private job Pune -> Sanskriti + Kalinga presented cleanly', async () => {
    const phone = '919000010003@s.whatsapp.net';
    resetTestLead(phone);
    const c = createMockSocketCollector();
    await handleIncomingMessage({ phone, text: 'polytechnic mechanical 62% private company me job h pune me, btech krni h', source: 'simulator', getSock: c.getSock, debounceMs: 20, skipDelays: true });
    assertCleanReply(c.bubbles, 1);
    const joined = c.bubbles.join(' ');
    assert(/Sanskriti/i.test(joined) && /Kalinga/i.test(joined), 'Should present both Sanskriti and Kalinga');
  });

  // TEST 4: Student asks "Sanskriti AICTE approved hai?" -> honestly says NO (State Univ UGC 2(f)), suggests Kalinga
  await runTest('Test 4: "Sanskriti AICTE approved hai?" -> honestly says NO, suggests Kalinga if AICTE required', async () => {
    const phone = '919000010004@s.whatsapp.net';
    resetTestLead(phone);
    const c = createMockSocketCollector();
    await handleIncomingMessage({ phone, text: 'sanskriti aicte approved hai kya? kahi fake toh nahi?', source: 'simulator', getSock: c.getSock, debounceMs: 20, skipDelays: true });
    assertCleanReply(c.bubbles, 1);
    const joined = c.bubbles.join(' ');
    assert(/UGC/i.test(joined) && /Kalinga/i.test(joined), 'Should explain UGC 2(f) status and suggest Kalinga for AICTE');
  });

  // TEST 5: Govt employee (Railway) in Patna with Diploma 68% -> honest about Lingaya's 75km Faridabad rule
  await runTest("Test 5: Govt employee (Railway) in Patna with Diploma 68% -> honest about Lingaya's 75km rule", async () => {
    const phone = '919000010005@s.whatsapp.net';
    resetTestLead(phone);
    const c = createMockSocketCollector();
    await handleIncomingMessage({ phone, text: 'railway me hu patna me, diploma 68%, btech krni h', source: 'simulator', getSock: c.getSock, debounceMs: 20, skipDelays: true });
    assertCleanReply(c.bubbles, 1);
    const joined = c.bubbles.join(' ');
    assert(/75\s*km|Faridabad|Lingaya/i.test(joined), 'Should mention Lingayas 75 km rule honestly');
  });

  // TEST 6: PSU employee in Noida with Diploma 70% -> Lingaya's Vidyapeeth recommended cleanly
  await runTest("Test 6: PSU employee in Noida with Diploma 70% -> Lingaya's Vidyapeeth recommended", async () => {
    const phone = '919000010006@s.whatsapp.net';
    resetTestLead(phone);
    const c = createMockSocketCollector();
    await handleIncomingMessage({ phone, text: 'NTPC PSU me job hai Noida me, Diploma 70% hai, B.Tech LE karna hai', source: 'simulator', getSock: c.getSock, debounceMs: 20, skipDelays: true });
    assertCleanReply(c.bubbles, 1);
    assert(/Lingaya/i.test(c.bubbles.join(' ')), 'Should recommend Lingayas Vidyapeeth');
  });

  // TEST 7: "Fees kitni hai?" as first message -> answers fee range first, then 1 natural question
  await runTest('Test 7: "Fees kitni hai?" as first message -> answers fee range first, then 1 question', async () => {
    const phone = '919000010007@s.whatsapp.net';
    resetTestLead(phone);
    const c = createMockSocketCollector();
    await handleIncomingMessage({ phone, text: 'btech ki fees kitni hai?', source: 'simulator', getSock: c.getSock, debounceMs: 20, skipDelays: true });
    assertCleanReply(c.bubbles, 1);
    assert(/45,000|50,000|55,000|45–55k|45k/i.test(c.bubbles.join(' ')), 'Should state fee range clearly');
  });

  // TEST 8: "Dost ne 25k mein online B.Tech ki hai" -> honest warning + 3-point neutral checklist
  await runTest('Test 8: "Dost ne 25k mein online B.Tech ki hai" -> warning + 3-point checklist + partner steer', async () => {
    const phone = '919000010008@s.whatsapp.net';
    resetTestLead(phone);
    const c = createMockSocketCollector();
    await handleIncomingMessage({ phone, text: 'mere dost ne ek college se 25k me online btech ki h, wahan se kar lu?', source: 'simulator', getSock: c.getSock, debounceMs: 20, skipDelays: true });
    assertCleanReply(c.bubbles, 1);
    assert(/ugc\.ac\.in|valid nahi|AICTE/i.test(c.bubbles.join(' ')), 'Should warn about invalid online B.Tech and provide verification checklist');
  });

  // TEST 9: Pure English B.Com graduate -> replies in crisp natural English, suggests Online MBA
  await runTest('Test 9: Pure English B.Com graduate -> replies in natural English, suggests Online MBA', async () => {
    const phone = '919000010009@s.whatsapp.net';
    resetTestLead(phone);
    const c = createMockSocketCollector();
    await handleIncomingMessage({ phone, text: "Hi, I'm a B.Com graduate working in a bank. Looking for an MBA.", source: 'simulator', getSock: c.getSock, debounceMs: 20, skipDelays: true });
    assertCleanReply(c.bubbles, 1);
    assert(/MBA/i.test(c.bubbles.join(' ')), 'Should recommend Online MBA in English');
  });

  // TEST 10: "Tum AI bot ho kya?" -> honest, confident answer + offers direct call with Harsh
  await runTest('Test 10: "Tum AI bot ho kya?" -> honest answer + offers call with Harsh', async () => {
    const phone = '919000010010@s.whatsapp.net';
    resetTestLead(phone);
    const c = createMockSocketCollector();
    await handleIncomingMessage({ phone, text: 'Tum AI bot ho kya?', source: 'simulator', getSock: c.getSock, debounceMs: 20, skipDelays: true });
    assertCleanReply(c.bubbles, 1);
    assert(/AI|assistant|Harsh/i.test(c.bubbles.join(' ')), 'Should honestly state AI assistant for Harsh Joshi team');
  });

  // TEST 11: 4 rapid WhatsApp messages in 5 seconds -> single combined debounced response
  await runTest('Test 11: 4 rapid messages -> single combined debounced response', async () => {
    const phone = '919000010011@s.whatsapp.net';
    resetTestLead(phone);
    let readCalls = 0;
    const c = createMockSocketCollector();
    const getSock = () => ({
      ...c.getSock(),
      readMessages: async () => { readCalls++; }
    });

    const ts = Date.now();
    const p1 = handleIncomingMessage({ phone, text: 'hi', source: 'baileys', msgKey: { id: `b1_${ts}` }, getSock, debounceMs: 100, skipDelays: true });
    const p2 = handleIncomingMessage({ phone, text: 'diploma civil kiya h', source: 'baileys', msgKey: { id: `b2_${ts}` }, getSock, debounceMs: 100, skipDelays: true });
    const p3 = handleIncomingMessage({ phone, text: '64% marks hain', source: 'baileys', msgKey: { id: `b3_${ts}` }, getSock, debounceMs: 100, skipDelays: true });
    const p4 = handleIncomingMessage({ phone, text: 'private company me job h', source: 'baileys', msgKey: { id: `b4_${ts}` }, getSock, debounceMs: 100, skipDelays: true });

    const [res] = await Promise.all([p1, p2, p3, p4]);
    assert.strictEqual(readCalls, 1, 'All 4 rapid messages must execute as 1 combined turn');
    assert.strictEqual(res.lead.qualification, 'DIPLOMA');
    assert.strictEqual(res.lead.percentage, 64);
    assert.strictEqual(res.lead.employment_type, 'PRIVATE');
    assertCleanReply(c.bubbles, 1);
  });

  // TEST 12: Verify Prompt Caching & Telemetry metrics recorded in DB
  await runTest('Test 12: Verify Groq Prompt Caching & Telemetry metrics recorded in SQLite', async () => {
    const quota = LeadDB.getGroqQuotaMetrics();
    console.log(`   [Quota Telemetry]: Requests Today=${quota.requests_used_today}, Prompt Tokens=${quota.prompt_tokens_today}, Cached Tokens=${quota.cached_tokens_today} (Cache Hit=${quota.cache_hit_pct}%), Avg Uncached/Turn=${quota.avg_uncached_tokens_per_turn}`);
    assert(quota.requests_used_today >= 10, 'Telemetry should track requests');
    assert(quota.cached_tokens_today > 0, 'Groq Prompt Caching must produce cached_tokens > 0 across turns');
  });

  // TEST 13: Deep Mechanical Career Counseling via FTS5 RAG
  await runTest('Test 13: Deep Mechanical Career Counseling via FTS5 RAG (Supervisor ceiling + EV/CAD/SolidWorks)', async () => {
    const phone = '919000010013@s.whatsapp.net';
    resetTestLead(phone, { qualification: 'DIPLOMA', stream_branch: 'Mechanical', employment_type: 'PRIVATE', employed: true, work_experience_years: 4, percentage: 60 });
    const c = createMockSocketCollector();
    const res = await handleIncomingMessage({
      phone,
      text: 'B.Tech karne se sach mein kya fayda hoga? Mechanical ka future kya hai?',
      source: 'simulator',
      getSock: c.getSock,
      debounceMs: 20,
      skipDelays: true
    });

    console.log(`   [Test 13 RAG Docs Pulled]: ${JSON.stringify(res.turnResult.rag_docs)}`);
    c.bubbles.forEach((b, i) => console.log(`   [Test 13 Bubble ${i + 1}]: ${b}`));
    assertCleanReply(c.bubbles, 1);
    assert(
      res.turnResult.rag_docs.includes('diploma_vs_btech_glass_ceiling') ||
      res.turnResult.rag_docs.includes('branch_mechanical_engineering'),
      'FTS5 must pull mechanical or glass_ceiling doc'
    );
  });

  // TEST 14: Branch-Specific Intelligence (Civil Gulf/BIM, ECE VLSI, B.Tech M.Tech vs MBA)
  await runTest('Test 14: Branch-Specific FTS5 RAG (Civil BIM/Gulf, ECE VLSI, B.Tech M.Tech vs MBA)', async () => {
    const rCivil = KnowledgeRAG.retrieveTopChunks({
      userText: 'Civil diploma ke baad Gulf job aur BIM Revit ka kya scope hai?',
      lead: { qualification: 'DIPLOMA', stream_branch: 'Civil' }
    });
    assert(rCivil.doc_ids.includes('branch_civil_engineering'), 'Civil query should pull branch_civil_engineering');
    assert(rCivil.estimated_tokens <= 500, 'RAG chunks must stay <= 500 tokens');

    const rEce = KnowledgeRAG.retrieveTopChunks({
      userText: 'ECE diploma ke baad VLSI semiconductor chip design mein kaise jaayein?',
      lead: { qualification: 'DIPLOMA', stream_branch: 'ECE' }
    });
    assert(rEce.doc_ids.includes('branch_ece_semiconductor_vlsi'), 'ECE query should pull branch_ece_semiconductor_vlsi');

    const rPg = KnowledgeRAG.retrieveTopChunks({
      userText: 'B.Tech ke baad M.Tech karun ya MBA?',
      lead: { qualification: 'BTECH' }
    });
    assert(rPg.doc_ids.includes('mtech_vs_mba_decision_guide'), 'PG query should pull mtech_vs_mba_decision_guide');
  });

  // TEST 15: Live Knowledge Library Upload & Immediate FTS5 Search
  await runTest('Test 15: Live Knowledge Library Upload -> Auto-Chunk -> FTS5 Search Retrieval', async () => {
    const customDocId = 'custom_aerospace_drone_guide_2026';
    KnowledgeRAG.indexDocumentInDb({
      doc_id: customDocId,
      title: 'Drone & UAV Engineering Career Roadmap 2026',
      tags: 'drone, uav, avionics, Pixhawk, DGCA, aerospace',
      category: 'Emerging Tech',
      summary: 'Career guide for Drone & UAV systems engineering in India.',
      content: 'India Drone Shakti mission is creating high demand for UAV engineers skilled in Pixhawk flight controllers, ROS2, carbon-fiber airframe design, and DGCA type certification.'
    }, true);

    const searchRes = KnowledgeRAG.retrieveTopChunks({
      userText: 'Pixhawk flight controller aur Drone Shakti UAV career ka kya scope hai?',
      lead: { qualification: 'DIPLOMA' }
    });
    assert(searchRes.doc_ids.includes(customDocId), 'Newly uploaded doc must be immediately retrievable via FTS5');
    KnowledgeRAG.deleteDoc(customDocId);
  });

  // Cleanup test leads from database
  for (let i = 1; i <= 15; i++) {
    const p = `9190000100${String(i).padStart(2, '0')}@s.whatsapp.net`;
    LeadDB.deleteLead(p);
  }

  console.log('\n====================================================================');
  console.log(`📊 FINAL MANDATORY SUITE SUMMARY: ${passed} PASSED | ${failed} FAILED`);
  console.log('====================================================================\n');

  if (failed > 0) process.exit(1);
}

runAllMandatoryTests();
