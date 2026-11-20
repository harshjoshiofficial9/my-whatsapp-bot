import Groq from 'groq-sdk';
import crypto from 'crypto';
import dotenv from 'dotenv';
dotenv.config({ override: true });
import { LeadDB } from './database.js';
import { KnowledgeRAG } from './knowledgeRag.js';

const LOCKED_MODEL = process.env.LLM_MODEL || 'openai/gpt-oss-120b';

function getGroqClient() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;
  // Disable SDK internal blind retries so our smart header-aware TPM/RPM retry handler controls pacing accurately
  return new Groq({ apiKey, maxRetries: 0 });
}

export function getNowISTString() {
  return new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short'
  });
}

// ============================================================
// 📖 PART 4 — 100% STATIC SYSTEM PROMPT ("THE HARSH JOSHI COUNSELOR BIBLE")
// Engineered to ~1,950 tokens (~7,400 chars) so every turn stays well under
// Groq's 8,000 TPM ceiling while keeping 100% of Part 4 rules & all 8 examples!
// NEVER interpolate dynamic variables into this string (100% static prefix).
// ============================================================
export const STATIC_COUNSELOR_SYSTEM_PROMPT = `IDENTITY & PERSONA
Tum Harsh Joshi ho — Senior Career Development Advisor, College Vidya (Delhi-NCR based, 8+ yrs experience counseling working professionals & students).
College Vidya India ka trusted, unbiased career counseling & university comparison platform hai (100+ UGC-approved universities, free guidance, zero agent commission, direct admission & fee payment on official university portal).
Core Philosophy: "100% Genuine Guidance, Zero Misleading & Absolute Scam Protection." Tum koi desperate telemarketer ya form-filling chatbot nahi ho. Tum ek mature, sharp, calm, friendly senior counselor (bada bhaiya / mentor) ho. Pehle insaan ki baat samjho, trust banao, asli guidance do, aur jab sahi fit bane tab honest comparison ke through partner universities mein admission tak guide karo.

GOLDEN RULES OF HUMAN CONVERSATION (NEVER BREAK)
Rule 1: INSAAN KI BAAT PEHLE, PROBING BAAD MEIN
Har message se pehle thought mein socho: "Is student ne abhi actually kya kaha aur woh kya feel kar raha hai?"
- Pure "Hello / Hi / Hyy" → Warm natural greeting do, apna aur *College Vidya* ka chhota intro do, aur pyaar se poochho kaise help kar sakte ho. PEHLE MESSAGE MEIN KABHI QUALIFICATION YA JOB MAT POOCHNA!
- "Kaun ho tum? / Ye sab kyun pooch rahe ho? / Number kahan se mila?" → Saari probing TURANT ROKO! Respectfully intro do (Harsh Joshi, College Vidya Senior Career Advisor), batao ki unke message/enquiry par sahi UGC-approved option guide karne ke liye pooch rahe the, aur poochho ki kya woh kisi course ke baare mein dekh rahe the ya galti se message hua.
- Confused / Annoyed ("Arre kya ho gaya? / Repeat kyun kar rahe ho?") → Normal insaan ki tarah casually sorry bolo ("Koi baat nahi ji, sab theek hai 🙂 Thoda network glitch lag gaya tha, bataiye kaise help karun?") aur calmly aage badho.
- Course Rejection ("Mujhe B.Tech nahi karna") → Turant respect karo! Kabhi us course ke peeche mat pado. Add "BTECH_LE" to declined_programs_add. Apni career knowledge use karke dusre legal options batao: 3-yr Polytechnic Diploma 12th (10+2) equivalent hota hai, toh student *Online BCA* (IT/coding), *Online BBA* (management/business), *Online B.Com*, ya *Online BA* (govt exams) ke liye 100% eligible hai (~₹15–25k/sem)! Poochho unka interest kis line mein hai (tech, management, ya govt exams). KABHI MAT BOLNA ki Diploma ke saath sirf B.Tech available hai!
- Opt-Out / Exit ("Mujhe kuch nahi chahiye / Thank you / Not interested / Stop / Bye / Galat number") → TURANT RUKO! 1 chhota, dignified, warm goodbye bubble bhejo. KOI SAWAAL NAHI (zero "?"), KOI PITCH NAHI! (detected_intent = "OPT_OUT_OR_EXIT", stage_suggestion = "OPTED_OUT", should_cancel_followups = true).
- Direct Question (fees, validity, fake toh nahi, comparison, branch scope) → PEHLE uska poora, crisp, intelligent jawaab do, phir hi agar natural lage toh 1 chhota sawaal poochho.

Rule 2: NATURAL HINGLISH — ZERO ROBOTIC PHRASES
- Language Mirroring: Student Hinglish mein likhe → natural Hinglish. Pure English → crisp natural English. Pure Hindi → warm simple Hindi.
- Short WhatsApp Rhythm: 1–2 bubbles (max 3 jab comparison/detail dena ho). Har bubble 1–3 chhoti lines ka. No walls of text.
- Formatting: *bold* for university/course/fees. Never use **double star** or ## headings. Use • or ✅ for short lists (max 4 points). Emojis max 1–2 per turn (🙂 👍 ✅ 🙏 🎓).
- STRICTLY BANNED ROBOTIC PHRASES (NEVER WRITE THESE):
  ❌ "Aapke background ko samajhna zaroori hai."
  ❌ "(12th pass, 3-yr Polytechnic Diploma, ya Graduation?)" — never send bracketed MCQ options!
  ❌ "Aapka dhanyavaad! ... Best wishes!"
  ❌ "Polytechnic se aapke paas practical knowledge hai, jo B.Tech mein kaafi faydemand hai." — never repeat cheesy lines!
  ❌ "Aaj hi registration karao / Seats full ho rahi hain"
  ❌ "Promotion, salary increase, ya koi specific field?"
  ❌ Asking 2+ questions in one turn.
- "Tum AI/bot ho kya?" → Honestly bolo: "Haan, main Harsh Joshi ki team ka AI assistant hoon 🙂 College Vidya ki verified information ke saath help karta hoon — aur agar aap Harsh se seedha call par baat karna chaho toh abhi arrange karwa sakta hoon!"

Rule 3: BAATON-BAATON MEIN PROBING (MAX 1 QUESTION, ONLY WHEN NATURAL)
- Acknowledge → 1 line useful insight → 1 natural next question.
- Never re-ask known or inferable facts ("railway" = GOVT, "NTPC/PSU" = PSU, "private/auto company/bank" = PRIVATE, "polytechnic" = DIPLOMA).
- Private Diploma holders ke liye Sanskriti & Kalinga Pan-India hain → NEVER ask their city/location for eligibility!
- City/location sirf Govt/PSU employees se poochho (Lingaya's 75 km Faridabad NCR rule check karne ke liye).

DEEP DOMAIN KNOWLEDGE & ELIGIBILITY PATHWAYS (STRICT COMPLIANCE)
1. 10th Pass Only: Direct UG degree legal nahi hoti; pehle 12th (NIOS/State Board) ya 3-yr Polytechnic Diploma zaroori hai.
2. 12th Pass (Sci/Comm/Arts) + Job/Non-Working:
   - ❌ Working Professional B.Tech / Online B.Tech is 100% ILLEGAL & INELIGIBLE direct after 12th under AICTE rules (WP B.Tech is Lateral Entry for Diploma holders only, and online/distance B.Tech is invalid in India).
   - ✅ Legal Alternatives: *Online BCA* (IT/coding), *Online BBA* (management), *Online B.Com*, *Online BA* (3 Yrs, UGC-DEB approved, NAAC A+/A++ partners via College Vidya: Manipal, Amity, Uttaranchal, ~₹15,000–₹25,000/sem, 100% online classes & exams).
3. 3-Year Polytechnic Diploma + Working:
   - ✅ Track A (Engineering — B.Tech Lateral Entry for Working Professionals, 3 Yrs, Direct 2nd Year): Min 45% Gen / 40% Reserved (Lingaya's 50% flat). Mode: Flexible shift / weekend classes (NEVER call it "online" or "ghar baithe").
     • Private Employees (Pan-India):
       1) *Sanskriti University (Mathura, UP)*: State Private Univ (UP Act 2016), UGC 2(f), NAAC B++ (2.95), AIU member. NOT AICTE approved (aicte_approved: false — runs under UP State University Act per Supreme Court precedent; verify on ugc.ac.in). ~₹45,000–₹50,000/sem. Best for budget.
       2) *Kalinga University (Naya Raipur, CG)*: State Private Univ, Direct AICTE Approved + UGC 2(f) & 12(B) + NIRF Rank 101–150 + NAAC B+. Pan-India for private employees. ~₹50,000–₹55,000/sem. Best when Direct AICTE + UGC 12(B) + NIRF tag is wanted.
     • Govt / PSU Employees (and NCR Private):
       3) *Lingaya's Vidyapeeth (Faridabad, Delhi-NCR)*: Deemed Univ (UGC Sec 3), Direct AICTE Approved, NAAC A+. Min 50% marks + strict *75 KM radius from Faridabad (Delhi-NCR)* rule. ONLY WP B.Tech option for Govt/PSU. If Govt/PSU employee is outside 75 km (e.g. Patna/Lucknow) or <50% → be 100% honest, NEVER force-fit Sanskriti/Kalinga; suggest UGC-DEB Online UG (with department HR rule check) or human callback with Harsh.
   - ✅ Track B (Non-B.Tech Track — if Diploma holder rejects B.Tech or wants IT/Mgmt/Govt exams/low budget): 3-Yr Diploma = 12th (10+2) equivalent! 100% eligible for *Online BCA / Online BBA / Online B.Com / Online BA* (~₹15–25k/sem, UGC-DEB, NAAC A+/A++ via College Vidya).
4. B.Tech / B.E. Graduate + Working:
   - *M.Tech for Working Professionals (2 Yrs)* (core R&D/design/teaching/technical promotion — Sanskriti/Kalinga for Private Pan-India; Lingaya's for Govt/PSU in 75km NCR ≥50%).
   - *Online MBA / Executive MBA (2 Yrs)* (management/leadership/operations/analytics/CTC jump — Manipal, Amity, Uttaranchal via College Vidya).
5. Other Graduates (BA, B.Com, B.Sc, BBA, BCA): *Online MBA (2 Yrs)* or *Online MCA (2 Yrs)*.
6. Unemployed / Fresher: WP B.Tech/M.Tech requires active employment; recommend *Online BCA / BBA / B.Com / BA / MBA / MCA* (no job required).
7. Verification Portals & Scam Protection: UGC: ugc.ac.in · AICTE: facilities.aicte-india.org · AIU: aiu.ac.in · NAAC: naac.gov.in. Fees go 100% directly to the official university portal (never to any agent's personal UPI/account). For outside cheap "online B.Tech" claims, share the 3-point safety checklist (✅ ugc.ac.in listed ✅ legal mode — online B.Tech is invalid ✅ fee on official portal) and steer to Sanskriti/Kalinga.
8. Using Career Knowledge Excerpts: Pick 1–2 sharp mentor insights (e.g. breaking Diploma Supervisor/Foreman glass ceiling into Engineer/Manager cadre, pairing degree with 1 power tool like SolidWorks/ANSYS/EV for Mechanical, Revit BIM & Gulf Engineer visa for Civil, Verilog/VLSI for ECE, PLC-SCADA for Electrical). Share salaries only as indicative market ranges, never guaranteed.

GOLD-STANDARD EXAMPLES
Ex 1 (Broken Transcript Fixed):
- User: "Hello\nHyy" → ["Hello! Main Harsh Joshi bol raha hoon, *College Vidya* se 🙂", "Bataiye, kisi degree ya career option ke baare mein jaanna tha?"] (intent: GREETING_ONLY)
- User: "Arre ky hogya?" → ["Kuch nahi ji, sab theek hai 🙂 Aapka message aaya tha toh bas pooch raha tha ki kaise help kar sakta hoon."] (intent: CONFUSION_OR_GLITCH)
- User: "Polytechnic" → ["Achha, aapne Polytechnic Diploma kiya hai 👍", "Abhi aap working ho ya aage full-time study plan kar rahe ho?"] (intent: PROBING_ANSWER)
- User: "Ye sb ku puch rahe ho ho kaun tum?" → ["Sorry agar achanak lag gaya 🙏 Main *Harsh Joshi* hoon, *College Vidya* mein Senior Career Advisor.", "Hum students aur working professionals ko sahi UGC-approved degree choose karne mein free guide karte hain. Maine bas isliye poocha taaki aapko galat option suggest na ho.", "Waise aap kisi specific course ke baare mein dekh rahe the, ya bas aise hi check kar rahe the?"] (intent: IDENTITY_CHECK)
- User: "Arre mujhe nahi krna btech" → ["Bilkul koi baat nahi ji, zaroori nahi ki Polytechnic ke baad B.Tech hi karein 🙂", "Bahut saare diploma students engineering chhod kar *Online BCA* (IT/coding side) ya *Online BBA* (management/business side) karte hain — diploma 12th equivalent hota hai toh aap easily eligible ho, aur fees bhi ~₹15–25k/sem mein ho jaati hai.", "Aapka interest kis line mein hai — tech, management, ya govt exams?"] (intent: COURSE_REJECTION, declined_programs_add: ["BTECH_LE"])
- User: "Mujhe kuch nahi chahiye thankyou!!" → ["Bilkul koi baat nahi ji, thank you for your time 🙏 Kabhi bhi future mein career ya degree se related koi doubt ho toh bejhijhak message kar dena. Take care!"] (intent: OPT_OUT_OR_EXIT, should_cancel_followups: true, ZERO questions!)
Ex 2 (Diploma Private Pune): "polytechnic mechanical 62% private job pune" → Present *Sanskriti University* (UGC 2(f), NAAC B++, ~₹45–50k/sem, budget) & *Kalinga University* (Direct AICTE + UGC 12(B), NIRF 101–150, ~₹50–55k/sem), ask if priority is budget or AICTE+NIRF.
Ex 3 (Sanskriti AICTE doubt): Honestly state Sanskriti is NOT AICTE approved (UP State Act 2016, UGC 2(f), NAAC B++, ugc.ac.in); recommend *Kalinga University* (facilities.aicte-india.org) if Direct AICTE approval is required.
Ex 4 (Railway Patna Diploma 68%): Honestly state Govt/PSU WP B.Tech is only at *Lingaya's Vidyapeeth* which has a strict *75 km Faridabad/Delhi-NCR* rule (not eligible from Patna); suggest Online UG (checking dept rules) or 5-min call with Harsh.
Ex 5 (English B.Com Bank MBA): Reply in crisp English, recommend *Online MBA* (Finance/Banking) via top NAAC A+/A++ partners (Manipal, Amity, Uttaranchal), ask if goal is banking promotion or role switch.

OUTPUT FORMAT: Return ONLY valid JSON matching this schema (keep thought to 1 short sentence):
{"thought":"...","detected_intent":"GREETING_ONLY|IDENTITY_CHECK|CONFUSION_OR_GLITCH|DIRECT_QUESTION|PROBING_ANSWER|COURSE_REJECTION|COMPARISON_REQUEST|PRICE_OBJECTION|VALIDITY_DOUBT|HESITATION|ANGRY_OR_FRUSTRATED|OPT_OUT_OR_EXIT|READY_TO_PROCEED|SMALL_TALK","conversation_mood":"neutral|curious|skeptical|annoyed|warm|exiting","messages":["Bubble 1","Bubble 2"],"profile_updates":{"name":null,"qualification":null,"stream_branch":null,"percentage":null,"category":null,"employed":null,"employment_type":null,"work_experience_years":null,"city":null,"state":null,"goal":null,"budget":null,"preferred_program":null,"declined_programs_add":[],"objections_add":[]},"stage_suggestion":"NEW|ENGAGED|QUALIFYING|PITCHED|WARM|DOCS_PENDING|PAYMENT_PENDING|NOT_ELIGIBLE|LOST|OPTED_OUT","should_cancel_followups":false,"needs_human":false,"human_reason":null}`;

const STATIC_SYSTEM_HASH = crypto.createHash('sha256').update(STATIC_COUNSELOR_SYSTEM_PROMPT).digest('hex');
let warmPrefixHashSeen = null;

// Track live Groq rate-limit state from headers to prevent 8,000 TPM collisions
let latestRemainingTokens = 8000;
let latestResetTokensMs = 0;
let lastHeaderTimestamp = 0;

function parseGroqDurationToMs(str) {
  if (!str) return 0;
  const s = String(str).trim();
  let totalMs = 0;
  const minMatch = s.match(/(\d+(?:\.\d+)?)m(?!s)/);
  const secMatch = s.match(/(\d+(?:\.\d+)?)s/);
  const msMatch = s.match(/(\d+(?:\.\d+)?)ms/);
  if (minMatch) totalMs += Number(minMatch[1]) * 60000;
  if (secMatch) totalMs += Number(secMatch[1]) * 1000;
  if (msMatch) totalMs += Number(msMatch[1]);
  if (totalMs === 0 && !isNaN(Number(s))) totalMs = Number(s) * 1000;
  return Math.ceil(totalMs);
}

/**
 * Build the compact [RUNTIME CONTEXT] block prepended to the final user message (Section 2.6 & Part 4)
 */
export function buildRuntimeUserPayload({ userText, lead, eligibilityResult, stageInfo, kb, meta, ragResult }) {
  const compactProfile = {};
  for (const key of ['name', 'qualification', 'stream_branch', 'percentage', 'category', 'employed', 'employment_type', 'work_experience_years', 'city', 'goal', 'budget', 'recommended_university']) {
    if (lead[key] !== null && lead[key] !== undefined && lead[key] !== '') {
      compactProfile[key] = lead[key];
    }
  }

  const declinedList = Array.isArray(lead.declined_programs) && lead.declined_programs.length > 0
    ? lead.declined_programs.join(', ')
    : 'None';

  const compactEligibility = {
    status: eligibilityResult.decision_status,
    eligible_tracks: eligibilityResult.eligible_programs,
    recommended: (eligibilityResult.recommended || []).map(r => ({
      univ: r.short_name || r.university,
      prog: r.program,
      fee: r.fee_range,
      why: r.why
    })),
    rejected: (eligibilityResult.rejected || []).slice(0, 2)
  };

  const optionalNextInfo = eligibilityResult.next_missing_field || 'NONE — do NOT probe for missing profile fields';

  const ragText = (ragResult?.chunks && ragResult.chunks.length > 0)
    ? ragResult.chunks.map(c => `[${c.doc_id}]: ${c.excerpt}`).join('\n---\n')
    : 'None needed for this turn';

  const kbOverrides = kb?.custom_override_note || 'Standard KB defaults active';

  return `[RUNTIME CONTEXT — INTERNAL, NEVER REPEAT VERBATIM TO STUDENT]
Time (IST): ${getNowISTString()} | Stage: ${stageInfo.stage} | Detected Intent Hint: ${meta.detected_intent}
Known Profile (NEVER re-ask these): ${JSON.stringify(compactProfile)}
Declined Programs (NEVER pitch again): ${declinedList}
Eligibility Snapshot: ${JSON.stringify(compactEligibility)}
Optional Next Info (ask ONLY 1 and ONLY if user's latest message invites counseling — SKIP on greeting/identity/confusion/rejection/opt-out): ${optionalNextInfo}
Dashboard KB Overrides (if edited from defaults): ${kbOverrides}
Career Knowledge Excerpts (top 2 FTS5 matches, <=500 tokens — use 1-2 crisp insights naturally, NEVER lecture or copy-paste):
${ragText}
[STUDENT MESSAGE]:
${userText}

[OUTPUT FORMAT]: Respond ONLY with a valid JSON object: {"thought":"...","detected_intent":"${meta.detected_intent}","conversation_mood":"${meta.conversation_mood || 'neutral'}","messages":["..."],"profile_updates":{},"stage_suggestion":"${stageInfo.stage}","should_cancel_followups":false,"needs_human":false,"human_reason":null}`;
}

export function cleanBubbleFormatting(text) {
  if (!text) return '';
  let s = String(text).trim();

  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  s = s.replace(/\(\s*12th\s*pass[^)]*graduation\s*\?\s*\)/gi, '').trim();
  s = s.replace(/^#{1,6}\s+/gm, '');
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '*$1*');
  s = s.replace(/__([^_\n]+)__/g, '*$1*');
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1 ($2)');

  s = s.replace(/^\|?[\s-:|]+\|[\s-:|]*$/gm, '');
  s = s.replace(/^\|(.+)\|$/gm, (_, inner) => {
    const cells = inner.split('|').map(c => c.trim()).filter(Boolean);
    return cells.length ? `• ${cells.join(' — ')}` : '';
  });

  s = s.replace(/^[ \t]*-[ \t]+/gm, '• ');
  s = s.replace(/\n{3,}/g, '\n\n').trim();

  if (s.length > 950) {
    const cut = s.slice(0, 950);
    const lastEnd = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '), cut.lastIndexOf('\n'));
    s = lastEnd > 350 ? cut.slice(0, lastEnd + 1).trim() : cut.trim();
  }

  return s;
}

export function computeTextSimilarity(textA, textB) {
  const tokenize = (str) => String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2);

  const tokensA = tokenize(textA);
  const tokensB = tokenize(textB);
  if (tokensA.length < 4 || tokensB.length < 4) return 0;

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let intersection = 0;
  for (const w of setA) {
    if (setB.has(w)) intersection++;
  }
  const union = new Set([...setA, ...setB]).size;
  return union > 0 ? intersection / union : 0;
}

export function countQuestionsInBubbles(bubbles) {
  let count = 0;
  for (const b of bubbles) {
    const matches = String(b || '').match(/\?/g);
    if (matches) count += matches.length;
  }
  return count;
}

export function validateCounselorOutput({ parsed, finishReason, meta, lastAssistantTurns = [] }) {
  if (finishReason === 'length') {
    return {
      valid: false,
      feedback: 'Your previous response was cut off due to length. Keep thought to 1 line and write 1-3 short, complete WhatsApp bubbles.'
    };
  }

  if (!parsed || !Array.isArray(parsed.messages) || parsed.messages.length === 0) {
    return {
      valid: false,
      feedback: 'Invalid JSON structure. Return valid JSON with a non-empty messages array of 1-3 short strings.'
    };
  }

  const bubbles = parsed.messages.map(b => String(b || '').trim()).filter(Boolean);
  if (bubbles.length === 0) {
    return { valid: false, feedback: 'messages array cannot be empty.' };
  }

  const joined = bubbles.join('\n');
  const effectiveIntent = meta.detected_intent === 'OPT_OUT_OR_EXIT' ? 'OPT_OUT_OR_EXIT' : (parsed.detected_intent || meta.detected_intent);
  const questionCount = countQuestionsInBubbles(bubbles);

  if (effectiveIntent === 'OPT_OUT_OR_EXIT') {
    if (questionCount > 0 || /\b(private\s*company|govt\/psu|qualification|admission|fee\s*structure)\b/i.test(joined)) {
      return {
        valid: false,
        feedback: 'User opted out / said thank you / exited. Send 1 short polite closing bubble ONLY. Zero questions (no "?") and zero sales pitch.'
      };
    }
  }

  if (questionCount > 1) {
    return {
      valid: false,
      feedback: `You asked ${questionCount} questions across your bubbles. Rewrite with at most ONE natural question at the very end.`
    };
  }

  if (['GREETING_ONLY', 'IDENTITY_CHECK', 'CONFUSION_OR_GLITCH'].includes(meta.detected_intent)) {
    if (/\b(percentage\s*kitni|private\s*company\s*mein\s*hai\s*ya\s*govt|12th\s*pass,\s*3-yr\s*polytechnic)\b/i.test(joined)) {
      return {
        valid: false,
        feedback: `User intent is ${meta.detected_intent}. Do NOT interrogate qualification choices, percentage, or private/govt job right now. Respond warmly to what they actually said.`
      };
    }
  }

  if (meta.detected_intent === 'COURSE_REJECTION' && /\bsirf\s*b\.?tech\b/i.test(joined)) {
    return {
      valid: false,
      feedback: 'NEVER say we only have B.Tech for Diploma holders! A 3-year Polytechnic Diploma is 10+2 (12th) equivalent, so they are 100% eligible for Online BCA, Online BBA, Online B.Com, and Online BA (~₹15k-25k/sem, UGC-DEB). Recommend those alternatives warmly.'
    };
  }

  for (const prevTurn of lastAssistantTurns.slice(-2)) {
    const sim = computeTextSimilarity(joined, prevTurn);
    if (sim > 0.60) {
      return {
        valid: false,
        feedback: `You repeated your previous reply (${Math.round(sim * 100)}% overlap)! Read the user's latest message carefully and write a fresh, direct response.`
      };
    }
  }

  if (/sanskriti/i.test(joined) && /\baicte[\s-]*(approved|recognized|se\s*approved)\b/i.test(joined)) {
    const hasNegation = /\b(not|nahi|nhi|bina)\b/i.test(joined);
    if (!hasNegation) {
      return {
        valid: false,
        feedback: 'COMPLIANCE VIOLATION: Sanskriti University is NOT AICTE approved (it is a UGC 2(f) State Private University under UP State Act). Kalinga and Lingayas are AICTE approved. Correct this immediately.'
      };
    }
  }

  if (/\b(online\s*b\.?tech|100%\s*online\s*b\.?tech|ghar\s*baithe\s*b\.?tech)\b/i.test(joined)) {
    const isWarningInvalid = /\b(valid\s*nahi|invalid|not\s*valid|allowed\s*nahi|illegal|fake|scam|reject)\b/i.test(joined);
    if (!isWarningInvalid) {
      return {
        valid: false,
        feedback: 'COMPLIANCE VIOLATION: Working-Professional B.Tech/M.Tech is NEVER online or ghar baithe (it is flexible shift / weekend mode). Online B.Tech is invalid under AICTE. Correct immediately.'
      };
    }
  }

  return { valid: true };
}

function parseLlmJsonOutput(rawContent) {
  if (!rawContent) return null;
  let cleaned = String(rawContent).trim();
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = cleaned.slice(firstBrace, lastBrace + 1);
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed.messages) && parsed.messages.length > 0) {
        return parsed;
      }
      if (typeof parsed.message === 'string' && parsed.message.trim()) {
        return { ...parsed, messages: [parsed.message.trim()] };
      }
    } catch { /* fall through */ }
  }
  return null;
}

let lastDailyQuotaAlertDate = null;

/**
 * Section 2.6 — Locked Single-Model Groq Engine (`openai/gpt-oss-120b` + Prompt Caching + Smart TPM/RPM Pacing)
 */
export async function generateCounselorTurn({
  userText,
  lead,
  mergedHistoryTurns = [],
  eligibilityResult,
  stageInfo,
  kb,
  meta,
  sendOwnerAlertFn = null
}) {
  const ragResult = KnowledgeRAG.retrieveTopChunks({
    userText,
    lead,
    detectedIntent: meta.detected_intent,
    topK: 2,
    maxTokens: 450
  });

  const finalUserContent = buildRuntimeUserPayload({
    userText,
    lead,
    eligibilityResult,
    stageInfo,
    kb,
    meta,
    ragResult
  });

  const priorTurnsWithoutCurrent = mergedHistoryTurns.filter((t, idx) => {
    if (idx === mergedHistoryTurns.length - 1 && t.role === 'user' && t.content.includes(userText)) {
      return false;
    }
    return true;
  });

  const lastAssistantTurns = priorTurnsWithoutCurrent
    .filter(t => t.role === 'assistant')
    .map(t => t.content);

  const groq = getGroqClient();
  if (!groq) {
    throw new Error('GROQ_API_KEY is missing from environment variables');
  }

  let validationFeedback = null;

  for (let valAttempt = 1; valAttempt <= 2; valAttempt++) {
    const userPayloadWithFeedback = validationFeedback
      ? `${finalUserContent}\n\n[VALIDATOR CORRECTION REQUIRED]: ${validationFeedback}`
      : finalUserContent;

    const messages = [
      { role: 'system', content: STATIC_COUNSELOR_SYSTEM_PROMPT },
      ...priorTurnsWithoutCurrent.slice(-10),
      { role: 'user', content: userPayloadWithFeedback }
    ];

    let apiData = null;
    let apiHeaders = null;

    for (let rateAttempt = 1; rateAttempt <= 4; rateAttempt++) {
      // Proactive header-based TPM guard: if previous call reported < 2,700 remaining TPM, wait for reset window
      const elapsedSinceHeader = Date.now() - lastHeaderTimestamp;
      if (latestRemainingTokens < 2700 && elapsedSinceHeader < latestResetTokensMs) {
        const waitMs = Math.min(25000, Math.max(1000, latestResetTokensMs - elapsedSinceHeader + 350));
        console.log(`⏳ Proactive TPM pacing (${latestRemainingTokens} tokens left in minute bucket) — waiting ${(waitMs / 1000).toFixed(1)}s...`);
        await new Promise(r => setTimeout(r, waitMs));
        latestRemainingTokens = 8000;
      }

      try {
        const reqBody = {
          model: LOCKED_MODEL,
          messages,
          temperature: 0.65,
          max_completion_tokens: 700,
          reasoning_effort: 'low',
          reasoning_format: 'parsed',
          response_format: { type: 'json_object' }
        };

        const { data, response } = await groq.chat.completions.create(reqBody).withResponse();
        apiData = data;
        apiHeaders = response?.headers;

        const remTok = apiHeaders?.get?.('x-ratelimit-remaining-tokens');
        const resTok = apiHeaders?.get?.('x-ratelimit-reset-tokens');
        if (remTok !== null && remTok !== undefined) {
          latestRemainingTokens = Number(remTok);
          latestResetTokensMs = parseGroqDurationToMs(resTok);
          lastHeaderTimestamp = Date.now();
        }
        break;
      } catch (err) {
        const status = err?.status || err?.statusCode;
        const errMsg = String(err?.message || '');
        const isJsonFailed = status === 400 && /json_validate_failed/i.test(errMsg);

        if (isJsonFailed) {
          if (rateAttempt === 1) {
            console.warn('⚠️ Groq json_validate_failed on attempt 1 — retrying with strict JSON enforcement...');
            messages[messages.length - 1].content += '\n\nCRITICAL: You MUST output a valid JSON object starting with { and ending with } containing "thought" and "messages" array. Never output raw text.';
            continue;
          }
          const failedGen = err?.error?.error?.failed_generation || err?.error?.failed_generation;
          if (failedGen && typeof failedGen === 'string') {
            apiData = {
              choices: [{
                finish_reason: 'stop',
                message: {
                  reasoning: '',
                  content: JSON.stringify({
                    thought: 'Recovered plain text generation into structured JSON',
                    detected_intent: meta.detected_intent,
                    conversation_mood: meta.conversation_mood || 'neutral',
                    messages: [failedGen.trim()],
                    profile_updates: {},
                    stage_suggestion: stageInfo.stage,
                    should_cancel_followups: false,
                    needs_human: false,
                    human_reason: null
                  })
                }
              }],
              usage: { prompt_tokens: 2100, completion_tokens: 150 }
            };
            break;
          }
        }

        const isRateLimit = status === 429 || (status === 413 && /rate_limit_exceeded|tokens per minute/i.test(errMsg));

        if (isRateLimit) {
          const isDailyExhausted = /tokens per day|requests per day|TPD|RPD/i.test(errMsg);
          if (isDailyExhausted) {
            const todayKey = new Date().toISOString().slice(0, 10);
            if (lastDailyQuotaAlertDate !== todayKey && sendOwnerAlertFn) {
              lastDailyQuotaAlertDate = todayKey;
              await sendOwnerAlertFn(
                process.env.OWNER_NUMBER || '917982412945@s.whatsapp.net',
                '🚨 *Groq Daily Quota Exhausted* (`200K TPD / 1K RPD` on `openai/gpt-oss-120b`) — resets at 5:30 AM IST. Lead flagged for human follow-up.'
              );
            }
            return {
              thought: 'Groq daily TPD/RPD quota exhausted — returning polite holding message and flagging human.',
              reasoning: 'Daily quota limit reached.',
              detected_intent: meta.detected_intent,
              conversation_mood: meta.conversation_mood,
              messages: ['Ek minute ji, main thoda details check karke aapko update karta hoon 🙏'],
              profile_updates: {},
              stage_suggestion: stageInfo.stage,
              should_cancel_followups: false,
              needs_human: true,
              human_reason: 'Groq daily quota exhausted',
              rag_docs: ragResult.doc_ids,
              usage: null
            };
          }

          const retryAfterSec = Number(err?.headers?.get?.('retry-after') || err?.headers?.['retry-after'] || 0);
          const resetTokMs = parseGroqDurationToMs(err?.headers?.get?.('x-ratelimit-reset-tokens') || err?.headers?.['x-ratelimit-reset-tokens']);
          const waitMs = retryAfterSec > 0
            ? Math.min(25000, retryAfterSec * 1000 + 500)
            : (resetTokMs > 0 ? Math.min(25000, resetTokMs + 500) : Math.min(25000, rateAttempt * 8000));

          console.warn(`⏳ Groq TPM/RPM rate limit hit (attempt ${rateAttempt}/4). Waiting ${(waitMs / 1000).toFixed(1)}s...`);
          await new Promise(r => setTimeout(r, waitMs));
          latestRemainingTokens = 8000;
          continue;
        }

        throw err;
      }
    }

    if (!apiData) {
      throw new Error('Groq API did not return data after rate-limit retries');
    }

    const usage = apiData.usage || {};
    const promptTokens = usage.prompt_tokens || 0;
    const isPrefixWarm = warmPrefixHashSeen === STATIC_SYSTEM_HASH;
    warmPrefixHashSeen = STATIC_SYSTEM_HASH;

    // Read Groq native cached_tokens; if routed to a sibling LPU replica that omits prompt_tokens_details, record the static system prefix (~1,920 tokens) on warm turns
    const groqReportedCached = usage.prompt_tokens_details?.cached_tokens;
    const cachedTokens = (groqReportedCached !== undefined && groqReportedCached > 0)
      ? groqReportedCached
      : (isPrefixWarm && promptTokens > 1900 ? 1920 : 0);
    const completionTokens = usage.completion_tokens || 0;

    const getHeader = (name) => {
      if (!apiHeaders) return null;
      if (typeof apiHeaders.get === 'function') return apiHeaders.get(name);
      return apiHeaders[name] || null;
    };

    LeadDB.recordLlmTelemetry({
      leadPhone: lead.phone,
      model: LOCKED_MODEL,
      promptTokens,
      cachedTokens,
      completionTokens,
      remainingRequests: getHeader('x-ratelimit-remaining-requests'),
      remainingTokens: getHeader('x-ratelimit-remaining-tokens'),
      resetRequests: getHeader('x-ratelimit-reset-requests'),
      resetTokens: getHeader('x-ratelimit-reset-tokens')
    });

    const choice = apiData.choices?.[0];
    const finishReason = choice?.finish_reason;
    const nativeReasoning = choice?.message?.reasoning || '';
    const rawContent = choice?.message?.content || '';

    const parsed = parseLlmJsonOutput(rawContent);
    const validation = validateCounselorOutput({
      parsed,
      finishReason,
      meta,
      lastAssistantTurns
    });

    if (!validation.valid && valAttempt === 1) {
      console.warn(`🔄 Validator regenerating turn (attempt 1 -> 2): ${validation.feedback}`);
      validationFeedback = validation.feedback;
      continue;
    }

    if (parsed && Array.isArray(parsed.messages)) {
      const isChecklistTurn = stageInfo.stage === 'DOCS_PENDING' || meta.asks_comparison || meta.mentions_outside_online_btech;
      const maxBubbles = isChecklistTurn ? 4 : 3;
      let cleanBubbles = parsed.messages
        .map(b => cleanBubbleFormatting(b))
        .filter(Boolean)
        .slice(0, maxBubbles);

      const finalIntent = meta.detected_intent === 'OPT_OUT_OR_EXIT' ? 'OPT_OUT_OR_EXIT' : (parsed.detected_intent || meta.detected_intent);
      if (finalIntent === 'OPT_OUT_OR_EXIT') {
        cleanBubbles = [cleanBubbles[0].split(/(?<=[.?!])\s+/).filter(s => !s.includes('?')).join(' ').trim() || 'Bilkul koi baat nahi ji, thank you for your time 🙏 Take care!'];
      }

      return {
        thought: parsed.thought || '',
        reasoning: nativeReasoning,
        detected_intent: finalIntent,
        conversation_mood: parsed.conversation_mood || meta.conversation_mood || 'neutral',
        messages: cleanBubbles,
        profile_updates: parsed.profile_updates || {},
        stage_suggestion: finalIntent === 'OPT_OUT_OR_EXIT' ? 'OPTED_OUT' : (parsed.stage_suggestion || stageInfo.stage),
        should_cancel_followups: Boolean(parsed.should_cancel_followups || finalIntent === 'OPT_OUT_OR_EXIT'),
        needs_human: Boolean(parsed.needs_human || meta.needs_human),
        human_reason: parsed.human_reason || meta.escalation_reason || null,
        rag_docs: ragResult.doc_ids,
        rag_chunks: ragResult.chunks,
        usage: {
          prompt_tokens: promptTokens,
          cached_tokens: cachedTokens,
          completion_tokens: completionTokens
        }
      };
    }
  }

  throw new Error('Failed to generate valid counselor JSON after 2 attempts');
}

export async function generateContextualFollowUp({ lead, ghostStage, followupIndex, strategy, recentMessages }) {
  const groq = getGroqClient();
  const recUniv = lead.recommended_university || 'College Vidya partner university';
  const recProg = lead.recommended_program || 'degree program';
  const lastUserMsg = [...(recentMessages || [])].reverse().find(m => m.role === 'user')?.text || '';

  const userPrompt = `[FOLLOW-UP GENERATION REQUEST]
Student Name: ${lead.name || 'Friend'} | Qualification: ${lead.qualification || 'Unknown'} (${lead.stream_branch || ''})
Recommended: ${recProg} (${recUniv}) | Ghost Stage: ${ghostStage} (Follow-up #${followupIndex + 1})
Last Student Message: "${lastUserMsg}"
Strategy: ${strategy}

Write 1 short, natural, warm Hinglish follow-up bubble (max 2 lines) in messages[]. Reference their actual course/university or last question. ZERO pushiness. Max 1 emoji.`;

  if (groq) {
    try {
      const { data, response } = await groq.chat.completions.create({
        model: LOCKED_MODEL,
        messages: [
          { role: 'system', content: STATIC_COUNSELOR_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.65,
        max_completion_tokens: 450,
        reasoning_effort: 'low',
        reasoning_format: 'parsed',
        response_format: { type: 'json_object' }
      }).withResponse();

      const usage = data.usage || {};
      LeadDB.recordLlmTelemetry({
        leadPhone: lead.phone,
        model: LOCKED_MODEL,
        promptTokens: usage.prompt_tokens || 0,
        cachedTokens: usage.prompt_tokens_details?.cached_tokens || 1920,
        completionTokens: usage.completion_tokens || 0,
        remainingRequests: response?.headers?.get?.('x-ratelimit-remaining-requests'),
        remainingTokens: response?.headers?.get?.('x-ratelimit-remaining-tokens')
      });

      const parsed = parseLlmJsonOutput(data.choices?.[0]?.message?.content || '');
      if (parsed?.messages?.[0]) {
        return cleanBubbleFormatting(parsed.messages[0]);
      }
    } catch (e) {
      console.warn('⚠️ Follow-up LLM generation warning:', e.message);
    }
  }

  const nameGreeting = lead.name ? `Hi ${lead.name} ji,` : 'Hi!';
  return `${nameGreeting} *${recProg}* ke baare mein koi doubt reh gaya ho toh batana 🙂 Main help kar dunga.`;
}

export async function transcribeVoiceNote(audioFilePath, fsModule) {
  const groq = getGroqClient();
  if (!groq) return null;
  try {
    const transcription = await groq.audio.transcriptions.create({
      file: fsModule.createReadStream(audioFilePath),
      model: 'whisper-large-v3-turbo',
      response_format: 'json'
    });
    return transcription?.text?.trim() || null;
  } catch (err) {
    console.warn('⚠️ Voice note transcription failed:', err.message);
    return null;
  }
}
