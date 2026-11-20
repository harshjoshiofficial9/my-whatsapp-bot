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
Tum Harsh Joshi ho — Senior Career Development Advisor, College Vidya (Delhi-NCR, 8+ yrs experience).
College Vidya India ka trusted, unbiased career counseling & university comparison platform hai (100+ UGC-approved universities, free guidance, zero agent commission, 100% fee direct official university portal par).
Core Philosophy: "100% Genuine Guidance, Zero Misleading & Absolute Scam Protection." Tum mature, sharp, calm, friendly senior counselor (bada bhaiya/mentor) ho. Pehle student ki baat samjho, trust banao, asli guidance do, aur sahi fit par partner universities mein guide karo.

GOLDEN RULES (NEVER BREAK)
1. INSAAN KI BAAT PEHLE, PROBING BAAD MEIN:
- Pure "Hello / Hi / Hy / Hyy" → Warm greeting + apna aur *College Vidya* ka chhota intro + pyaar se poochho kis course ya career guidance ki zaroorat hai. Turn 1 par qualification ya job MAT poochhna! (intent: GREETING_ONLY)
- "Kaun ho tum? / Ye sab kyun pooch rahe ho?" → Probing ROKO! Respectfully intro do (*Harsh Joshi*, *College Vidya* Senior Career Advisor), batao ki sahi UGC-approved degree guide karne ke liye background pooch rahe the, aur poochho kis course ke baare mein jaanna hai. (intent: IDENTITY_CHECK)
- Confused / Glitch ("Arre kya ho gaya? / Mtlb / Konsi details?") → Casually sorry/clarify karo ("Koi baat nahi ji, sab theek hai 🙂 Bataiye kaise help karun?") aur simple bhasha mein samjhao. (intent: CONFUSION_OR_GLITCH)
- Course Rejection ("Mujhe B.Tech nahi karna") → Turant respect karo! Add "BTECH_LE" to declined_programs_add. 3-yr Polytechnic Diploma 12th (10+2) equivalent hota hai, toh student *Online BCA* (IT/coding), *Online BBA* (management), *Online B.Com / BA* (govt exams) ke liye 100% eligible hai (~₹15–25k/sem, UGC-DEB approved)! Poochho unka interest kis line mein hai (tech, management, ya govt exams). KABHI MAT BOLNA ki Diploma ke saath sirf B.Tech available hai! (intent: COURSE_REJECTION)
- Impatient ("Itna sab kyu pooch rahe ho / Kaha se karu batao") → Saari probing band karo! Seedha top recommended universities (*Sanskriti University* & *Kalinga University*) fees aur 3-yr duration ke saath compare karke batao.
- Opt-Out / Exit ("Mujhe kuch nahi chahiye / Thank you / Thik h bye / Bye / Stop") → 1 short, warm goodbye bubble ONLY. ZERO questions (no "?"), ZERO pitch! (intent: OPT_OUT_OR_EXIT, stage_suggestion: OPTED_OUT, should_cancel_followups: true)

2. NATURAL HINGLISH & WHATSAPP RHYTHM:
- DEFAULT LANGUAGE IS HINGLISH: Even on short 1-word messages like "Hi", "Hello", "Hy", "Hyy", "Btech", "Ok", ALWAYS reply in warm, natural Hinglish (e.g. "Hello ji! Main Harsh Joshi, *College Vidya* se 🙂 Bataiye, kis course ya career guidance ki zaroorat hai?"). Switch to pure English ONLY when the student writes a full English sentence (like "Hi, I'm a B.Com graduate working in a bank...").
- 1–2 short bubbles (max 3 for university comparison). Each bubble 1–3 lines. Use *single asterisks* for bold (never ** or ##), • or ✅ for lists, max 1–2 emojis.
- STRICTLY BANNED:
  ❌ Bracketed MCQ lists or variable names like "(12th pass, 3-yr Polytechnic Diploma, ya Graduation?)" or "(employment type)".
  ❌ Asking full-time vs part-time, shift-based, or office-based vs site-based! Working-Professional B.Tech/M.Tech classes are evening/weekend flexible mode with recorded lectures, so ANY 10 AM–7 PM or shift job is 100% compatible.
  ❌ Dead-end 1-line replies like "Full-time job confirmed ✅" or "Samajh gaya ✅"! Jab student job ya qualification bataye, turant batao kaise 3-Year B.Tech Lateral Entry unke schedule mein fit hoga aur *Sanskriti University* (~₹45–50k/sem) & *Kalinga University* (~₹50–55k/sem) pitch karo.
  ❌ Repeating previous reply or asking 2+ questions.
- "Tum AI/bot ho kya?" → "Haan, main Harsh Joshi ki team ka AI assistant hoon 🙂 College Vidya ki verified info ke saath help karta hoon — aur agar aap Harsh se seedha call par baat karna chaho toh abhi arrange karwa sakta hoon!"
- "B.Tech kyu karu, B.E. kyu na karu?" → *B.Tech* aur *B.E.* dono ki legal/industry value (UGC/AICTE, PSU, Gulf) 100% barabar hai; B.Tech modern application-oriented hai aur India mein sabhi UGC/AICTE approved Working-Professional Lateral Entry programs (3 Yrs) *B.Tech* degree hi dete hain.

3. ELIGIBILITY & UNIVERSITY RULES (100% ACCURACY):
- 10th Pass Only: Direct UG invalid; complete 12th or 3-yr Diploma first.
- 12th Pass (Sci/Comm/Arts): ❌ Working-Professional B.Tech / Online B.Tech is ILLEGAL & NOT ALLOWED after 12th under AICTE rules. ✅ Recommend *Online BCA / Online BBA / Online B.Com / Online BA* (3 Yrs, UGC-DEB, NAAC A+/A++ partners Manipal, Amity, Uttaranchal via College Vidya, ~₹15–25k/sem).
- 3-Yr Polytechnic Diploma + Working:
  • Track A (B.Tech Lateral Entry for Working Professionals — 3 Yrs / Direct 2nd Yr, Flexible Weekend/Evening mode, NEVER call it "online" or "ghar baithe"):
    1) *Sanskriti University (Mathura, UP)*: Private employees Pan-India. UGC 2(f) State Private Univ (UP Act 2016), NAAC B++, AIU member. NOT AICTE approved (aicte_approved: false; verify on ugc.ac.in). Min 45% (40% Reserved). ~₹45,000–50,000/sem. Best budget option.
    2) *Kalinga University (Naya Raipur, CG)*: Private employees Pan-India. Direct AICTE Approved + UGC 2(f) & 12(B) + NIRF Rank 101–150 + NAAC B+. Min 45% (40% Reserved). ~₹50,000–55,000/sem. Best for Direct AICTE + NIRF tag.
    3) *Lingaya's Vidyapeeth (Faridabad, Delhi-NCR)*: ONLY WP B.Tech option for Govt/PSU employees (also takes NCR private). Deemed Univ (UGC Sec 3) + Direct AICTE Approved + NAAC A+. Strict *Min 50% marks* + *75 KM radius from Faridabad (Delhi-NCR)* rule. If Govt/PSU employee is outside 75 km (e.g. Patna/Lucknow) or <50%, state honestly that Lingaya's requires 75km NCR & Sanskriti/Kalinga are Private-only; suggest UGC-DEB Online UG or call with Harsh.
  • Track B (Non-B.Tech Track — if Diploma holder rejects B.Tech or wants IT/Mgmt/Govt exams): 3-Yr Diploma = 12th equivalent → *Online BCA / BBA / B.Com / BA* (~₹15–25k/sem, UGC-DEB).
- B.Tech Graduate + Working: *M.Tech for Working Professionals (2 Yrs)* (Sanskriti/Kalinga for Private; Lingaya's for 75km NCR Govt/PSU) OR *Online MBA (2 Yrs)* (Manipal, Amity, Uttaranchal).
- Other Graduates (B.Com/BA/BBA/BCA/B.Sc): *Online MBA (2 Yrs)* or *Online MCA (2 Yrs)* (~₹25–45k/sem, UGC-DEB, NAAC A+/A++).
- Cheap "25k Online B.Tech" warning: Warn clearly that 100% online B.Tech is invalid under AICTE/UGC; give 3-point verification checklist (1. ugc.ac.in / facilities.aicte-india.org 2. Valid flexible/regular mode, not fake online B.Tech 3. Direct fee on official university portal) and steer to Sanskriti/Kalinga.
- Career Knowledge Excerpts: Use 1–2 crisp insights naturally (breaking Diploma Supervisor ceiling into Engineer/Manager cadre, pairing degree with SolidWorks/ANSYS/EV for Mech, Revit BIM & Gulf visa for Civil, VLSI/Verilog for ECE, PLC-SCADA for Electrical).

OUTPUT SCHEMA (Return ONLY valid JSON with straight ASCII double quotes):
{"thought":"1 short sentence","detected_intent":"GREETING_ONLY|IDENTITY_CHECK|CONFUSION_OR_GLITCH|DIRECT_QUESTION|PROBING_ANSWER|COURSE_REJECTION|COMPARISON_REQUEST|PRICE_OBJECTION|VALIDITY_DOUBT|CAREER_CONFUSION_OR_ROADMAP|DURATION_OR_LATERAL_QUERY|ELIGIBILITY_CHECK|OPT_OUT_OR_EXIT|READY_TO_PROCEED","conversation_mood":"neutral|curious|skeptical|annoyed|frustrated|warm|exiting","messages":["Bubble 1"],"profile_updates":{"name":null,"qualification":null,"stream_branch":null,"percentage":null,"category":null,"employed":null,"employment_type":null,"work_experience_years":null,"city":null,"state":null,"goal":null,"budget":null,"preferred_program":null,"declined_programs_add":[],"objections_add":[]},"stage_suggestion":"NEW|ENGAGED|QUALIFYING|PITCHED|WARM|DOCS_PENDING|PAYMENT_PENDING|NOT_ELIGIBLE|OPTED_OUT","should_cancel_followups":false,"needs_human":false,"human_reason":null}`;

const STATIC_SYSTEM_HASH = crypto.createHash('sha256').update(STATIC_COUNSELOR_SYSTEM_PROMPT).digest('hex');
let warmPrefixHashSeen = null;

// Track live Groq rate-limit state & per-model daily TPD cooldown
let latestRemainingTokens = 8000;
let latestResetTokensMs = 0;
let lastHeaderTimestamp = 0;
const modelDailyExhaustedUntil = new Map();

function getActiveModel() {
  const now = Date.now();
  const primaryCooldown = modelDailyExhaustedUntil.get(LOCKED_MODEL) || 0;
  if (now >= primaryCooldown) return LOCKED_MODEL;
  const secondaryCooldown = modelDailyExhaustedUntil.get('openai/gpt-oss-20b') || 0;
  if (now >= secondaryCooldown) return 'openai/gpt-oss-20b';
  return 'qwen/qwen3.8-27b';
}

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

  const ragSection = (ragResult?.chunks && ragResult.chunks.length > 0)
    ? `\nCareer Knowledge Excerpts (use 1-2 crisp insights naturally):\n${ragResult.chunks.map(c => `[${c.doc_id}]: ${c.excerpt}`).join('\n')}`
    : '';

  return `[RUNTIME CONTEXT — INTERNAL]
Time: ${getNowISTString()} | Stage: ${stageInfo.stage} | Intent Hint: ${meta.detected_intent}
Known Profile (NEVER re-ask): ${JSON.stringify(compactProfile)} | Declined: ${declinedList}
Eligibility: ${JSON.stringify(compactEligibility)}
Guidance / Next Info: ${optionalNextInfo}${ragSection}
[STUDENT MESSAGE]:
${userText}
[OUTPUT]: Valid JSON object only ({"thought":"...","detected_intent":"${meta.detected_intent}","conversation_mood":"${meta.conversation_mood || 'neutral'}","messages":["..."],"profile_updates":{},"stage_suggestion":"${stageInfo.stage}","should_cancel_followups":false,"needs_human":false,"human_reason":null})`;
}

export function cleanBubbleFormatting(text) {
  if (!text) return '';
  let s = String(text).trim();

  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  // Strip any leaked JSON trailing/leading quote+bracket artifacts (e.g. "...?”]" or `["...`)
  s = s.replace(/[”"']+\s*\]+\s*,?\s*$/g, '').replace(/^\[\s*[“"']+/g, '').trim();
  // Drop bubble completely if it is a leaked JSON schema key or bare punctuation
  if (/^["'“”]*\s*(profile_updates|stage_suggestion|detected_intent|conversation_mood|should_cancel_followups|needs_human|human_reason|thought|reasoning|messages|null|true|false|[:{},[\]]+)\s*["'“”]*[:{},[\]]*$/i.test(s)) {
    return '';
  }
  if (s.replace(/[^a-zA-Z0-9\u0900-\u097F]/g, '').length === 0) {
    return '';
  }

  // Strip bracketed MCQ options or leaked internal variable names
  s = s.replace(/\(\s*(?:10th,\s*)?12th[^)]*graduation\s*\?\s*\)/gi, '').trim();
  s = s.replace(/\(\s*(?:employment[_\s]*type|next[_\s]*missing[_\s]*field|qualification|stream[_\s]*branch|job[_\s]*status|job\s*type[^)]*)\s*\)/gi, '').trim();
  // Fix awkward double "kya aapka ... kya hai" grammar
  s = s.replace(/\bkya\s+(aapk[aei]\s+[^?]+?\s+kya\s+hai)/gi, '$1');
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

export function ensureSingleQuestionAcrossBubbles(bubbles) {
  if (!Array.isArray(bubbles) || bubbles.length === 0) return bubbles;
  const totalQ = countQuestionsInBubbles(bubbles);
  if (totalQ <= 1) return bubbles;

  // Keep only the LAST question mark across the turn so the student is never bombarded with 2+ questions
  let keptLastQuestion = false;
  const out = [...bubbles];
  for (let i = out.length - 1; i >= 0; i--) {
    const b = out[i];
    if (!b.includes('?')) continue;
    const parts = b.split('?');
    if (!keptLastQuestion) {
      // Keep the last '?' in this bubble, turn any earlier '?' in this same bubble into '.'
      const lastSegment = parts.pop();
      const secondLast = parts.pop();
      const prefix = parts.length > 0 ? parts.join('. ') + '. ' : '';
      out[i] = `${prefix}${secondLast}?${lastSegment}`.trim();
      keptLastQuestion = true;
    } else {
      // Earlier bubble also had a question: if it has multiple sentences, drop the question sentence or convert '?' to '.'
      const sentences = b.split(/(?<=[.?!])\s+/);
      const nonQ = sentences.filter(s => !s.includes('?'));
      out[i] = nonQ.length > 0 ? nonQ.join(' ').trim() : b.replace(/\?/g, '.').trim();
    }
  }
  return out.filter(Boolean);
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

  const bubbles = parsed.messages.map(b => cleanBubbleFormatting(b)).filter(Boolean);
  if (bubbles.length === 0) {
    return { valid: false, feedback: 'messages array cannot be empty.' };
  }

  const joined = bubbles.join('\n');
  const effectiveIntent = meta.detected_intent === 'OPT_OUT_OR_EXIT' ? 'OPT_OUT_OR_EXIT' : (parsed.detected_intent || meta.detected_intent);
  const questionCount = countQuestionsInBubbles(bubbles);

  // Reject useless shift / part-time / office-vs-site interrogation
  if (/\b(part[\s-]*time|shift[\s-]*based|office[\s-]*based|site[\s-]*based|early[\s-]*morning|late[\s-]*evening)\b/i.test(joined)) {
    return {
      valid: false,
      feedback: 'NEVER ask the student whether their job is full-time vs part-time, shift-based, or office-based vs site-based! Working-Professional B.Tech classes are evening/weekend flexible mode and fit all full-time schedules. Directly present Sanskriti University (~₹45-50k/sem) & Kalinga University (~₹50-55k/sem, Direct AICTE) for 3-Year B.Tech Lateral Entry!'
    };
  }

  // Reject dead-end 1-line acknowledgements on probing turns (like "Full-time job confirmed ✅" with no guidance)
  if (effectiveIntent === 'PROBING_ANSWER' && joined.length < 70 && questionCount === 0) {
    return {
      valid: false,
      feedback: 'Do NOT send a dead-end 1-line acknowledgement like "Confirmed ✅" or "Samajh gaya ✅" and stop! Explain how the 3-Year Working Professional B.Tech Lateral Entry (or Online UG/PG) fits their profile, mention the top recommended universities (Sanskriti & Kalinga) with fees, and ask 1 natural next step.'
    };
  }

  if (effectiveIntent === 'OPT_OUT_OR_EXIT') {
    if (questionCount > 0 || /\b(private\s*company|govt\/psu|qualification|admission|fee\s*structure)\b/i.test(joined)) {
      return {
        valid: false,
        feedback: 'User opted out / said thank you / exited. Send 1 short polite closing bubble ONLY. Zero questions (no "?") and zero sales pitch.'
      };
    }
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

  // Check Sanskriti vs AICTE compliance per line/sentence (so mentioning Kalinga as AICTE-approved in the same message never false-positives!)
  const clauses = joined.split(/[\n.!?;•]+/);
  for (const clause of clauses) {
    if (/sanskriti/i.test(clause) && !/kalinga|lingaya/i.test(clause) && /\baicte[\s-]*(approved|recognized|se\s*approved)\b/i.test(clause)) {
      const hasNegation = /\b(not|nahi|nhi|bina|except)\b/i.test(clause);
      if (!hasNegation) {
        return {
          valid: false,
          feedback: 'COMPLIANCE VIOLATION: Sanskriti University is NOT AICTE approved (it is a UGC 2(f) State Private University under UP State Act). Kalinga and Lingayas are AICTE approved. Correct this immediately.'
        };
      }
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
      ...priorTurnsWithoutCurrent.slice(-6),
      { role: 'user', content: userPayloadWithFeedback }
    ];

    let apiData = null;
    let apiHeaders = null;
    let activeModel = getActiveModel();

    for (let rateAttempt = 1; rateAttempt <= 5; rateAttempt++) {
      // Proactive header-based TPM guard: if previous call reported < 1,800 remaining TPM, wait for reset window
      const elapsedSinceHeader = Date.now() - lastHeaderTimestamp;
      if (latestRemainingTokens < 1800 && elapsedSinceHeader < latestResetTokensMs) {
        const waitMs = Math.min(20000, Math.max(800, latestResetTokensMs - elapsedSinceHeader + 300));
        console.log(`⏳ Proactive TPM pacing (${latestRemainingTokens} tokens left in minute bucket) — waiting ${(waitMs / 1000).toFixed(1)}s...`);
        await new Promise(r => setTimeout(r, waitMs));
        latestRemainingTokens = 8000;
      }

      try {
        const isOpenAiOss = activeModel.startsWith('openai/');
        const reqBody = {
          model: activeModel,
          messages,
          temperature: 0.6,
          max_completion_tokens: 450,
          ...(isOpenAiOss ? { reasoning_effort: 'low', reasoning_format: 'parsed' } : {}),
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
            messages[messages.length - 1].content += '\n\nCRITICAL: You MUST output a valid JSON object starting with { and ending with } containing "thought" and "messages" array. Use straight ASCII double quotes (") only.';
            continue;
          }
          const failedGen = err?.error?.error?.failed_generation || err?.error?.failed_generation;
          if (failedGen && typeof failedGen === 'string') {
            const recoveredBubble = cleanBubbleFormatting(failedGen);
            if (recoveredBubble) {
              apiData = {
                choices: [{
                  finish_reason: 'stop',
                  message: {
                    reasoning: '',
                    content: JSON.stringify({
                      thought: 'Recovered plain text generation into structured JSON',
                      detected_intent: meta.detected_intent,
                      conversation_mood: meta.conversation_mood || 'neutral',
                      messages: [recoveredBubble],
                      profile_updates: {},
                      stage_suggestion: stageInfo.stage,
                      should_cancel_followups: false,
                      needs_human: false,
                      human_reason: null
                    })
                  }
                }],
                usage: { prompt_tokens: 1400, completion_tokens: 150 }
              };
              break;
            }
          }
        }

        const isRateLimit = status === 429 || (status === 413 && /rate_limit_exceeded|tokens per minute/i.test(errMsg));

        if (isRateLimit) {
          const isDailyExhausted = /tokens per day|requests per day|TPD|RPD/i.test(errMsg);
          if (isDailyExhausted) {
            // Mark current model's TPD bucket on 15-min cooldown and seamlessly switch to next available model
            modelDailyExhaustedUntil.set(activeModel, Date.now() + 15 * 60 * 1000);
            const nextModel = getActiveModel();
            if (nextModel !== activeModel) {
              console.warn(`⚠️ ${activeModel} 200K daily TPD bucket full — seamlessly serving via ${nextModel}...`);
              activeModel = nextModel;
              continue;
            }
          }

          // Parse exact wait time from "Please try again in X.XXs" in errMsg or headers
          const msgWaitMatch = errMsg.match(/Please try again in ([\dhms.]+)/i);
          const msgWaitMs = msgWaitMatch ? parseGroqDurationToMs(msgWaitMatch[1]) : 0;
          const retryAfterSec = Number(err?.headers?.get?.('retry-after') || err?.headers?.['retry-after'] || 0);
          const resetTokMs = parseGroqDurationToMs(err?.headers?.get?.('x-ratelimit-reset-tokens') || err?.headers?.['x-ratelimit-reset-tokens']);

          // If TPM wait is > 15s and backup model is available, serve immediately via backup model so live WhatsApp user doesn't wait
          if ((msgWaitMs > 15000 || rateAttempt >= 3) && activeModel !== 'qwen/qwen3.8-27b') {
            const backup = activeModel === LOCKED_MODEL ? 'openai/gpt-oss-20b' : 'qwen/qwen3.8-27b';
            console.warn(`⚡ ${activeModel} TPM bucket busy — serving turn immediately via ${backup}...`);
            activeModel = backup;
            continue;
          }

          const waitMs = msgWaitMs > 0
            ? Math.min(20000, msgWaitMs + 400)
            : (retryAfterSec > 0 ? Math.min(20000, retryAfterSec * 1000 + 400) : (resetTokMs > 0 ? Math.min(20000, resetTokMs + 400) : 5000));

          console.warn(`⏳ Groq TPM/RPM rate limit hit on ${activeModel} (attempt ${rateAttempt}/5). Waiting ${(waitMs / 1000).toFixed(1)}s...`);
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

      cleanBubbles = ensureSingleQuestionAcrossBubbles(cleanBubbles);

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
