import Groq from 'groq-sdk';
import 'dotenv/config';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const PRIMARY_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const FALLBACK_MODEL = process.env.GROQ_FALLBACK_MODEL || 'qwen/qwen3.8-27b';

/**
 * Format current IST timestamp string
 */
export function getNowISTString() {
  return new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short'
  });
}

/**
 * Phase 1.4 — WhatsApp Formatting Post-Processor
 * - Converts **bold** -> *bold*
 * - Removes # headings and markdown table pipes
 * - Converts - bullets to • or ✅
 * - Enforces max 2 emojis per bubble
 * - Enforces max 3 short lines and < 1000 chars per bubble
 */
export function formatBubbleForWhatsApp(text, isChecklist = false) {
  if (!text) return '';
  let s = String(text).trim();

  // Remove <think>...</think> tags if any reasoning model outputs them
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // Remove markdown headings (# Heading -> Heading)
  s = s.replace(/^#{1,6}\s+/gm, '');

  // Convert **bold** or __bold__ to WhatsApp *bold*
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '*$1*');
  s = s.replace(/__([^_\n]+)__/g, '*$1*');

  // Convert markdown links [label](url) -> label (url)
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1 ($2)');

  // Strip markdown table separator rows and convert pipe rows to bullets
  s = s.replace(/^\|?[\s-:|]+\|[\s-:|]*$/gm, '');
  s = s.replace(/^\|(.+)\|$/gm, (_, inner) => {
    const cells = inner.split('|').map(c => c.trim()).filter(Boolean);
    return cells.length ? `• ${cells.join(' — ')}` : '';
  });

  // Convert markdown bullets (- item or * item at start of line) to • item
  s = s.replace(/^[ \t]*[-*][ \t]+/gm, '• ');

  // Collapse multiple blank lines
  s = s.replace(/\n{3,}/g, '\n\n').trim();

  // Cap emojis to max 2 per bubble
  const emojiRegex = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu;
  let emojiCount = 0;
  s = s.replace(emojiRegex, (match) => {
    emojiCount++;
    return emojiCount <= 2 ? match : '';
  });

  // Clean up extra spaces left by removed emojis
  s = s.replace(/ {2,}/g, ' ').trim();

  // Enforce max lines per bubble (max 3 lines normally, max 6 for checklist/comparison)
  const maxLines = isChecklist ? 6 : 3;
  const lines = s.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length > maxLines) {
    s = lines.slice(0, maxLines).join('\n');
  }

  // Hard safety: no single bubble > 1000 chars (split at sentence boundary)
  if (s.length > 950) {
    const cut = s.slice(0, 950);
    const lastPeriod = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '), cut.lastIndexOf('\n'));
    s = lastPeriod > 400 ? cut.slice(0, lastPeriod + 1).trim() : cut.trim();
  }

  return s;
}

/**
 * Phase 2.3 — Compliance Guard
 * Ensures Sanskriti is NEVER claimed to be AICTE approved, and removes any banned phrases.
 */
export function enforceComplianceOnBubble(text) {
  let s = text;
  // Check if Sanskriti and AICTE appear together claiming approval without negation
  if (/sanskriti/i.test(s) && /aicte/i.test(s)) {
    const hasNegation = /\b(not|nahi|nhi|without|bina|kalinga|lingaya)\b/i.test(s);
    if (!hasNegation) {
      s = s.replace(/aicte[\s-]*(approved|recognized|certified|मान्यता)/gi, 'UGC 2(f) recognized (UP State University Act)');
    }
  }
  // Never call Working Professional B.Tech/M.Tech "online B.Tech" or "distance B.Tech" unless saying it's invalid
  if (/\b(online|distance)\s+b\.?tech\b/i.test(s) && !/\b(valid nahi|invalid|not valid|allowed nahi|illegal|fake|mat)\b/i.test(s)) {
    s = s.replace(/\b(online|distance)\s+(b\.?tech)/gi, 'Flexible-Shift $2');
  }
  return s;
}

/**
 * Split a line into sentences safely without breaking URLs (ugc.ac.in) or abbreviations (B.Tech, M.Tech)
 */
function splitSentencesSafely(line) {
  if (!line) return [];
  // Protect known abbreviations & domain dots temporarily
  const protectedStr = line
    .replace(/\b(B|M)\.(Tech|E|Com|Sc|A)\b/gi, '$1__DOT__$2')
    .replace(/([a-z0-9])\.([a-z]{2,4})\b/gi, '$1__DOT__$2');

  const parts = protectedStr.split(/(?<=[?!]|\.(?=\s|$))\s+/);
  return parts.map(p => p.replace(/__DOT__/g, '.').trim()).filter(Boolean);
}

/**
 * Phase 2.4 — Anti-Repetition & Single-Question Validator
 * 1. Strips questions about fields already in lead profile (e.g. qualification, sector, percentage, location for private diploma).
 * 2. Ensures at most ONE question across the entire turn, placed at the end of the last bubble.
 */
export function enforceSingleNonRepeatingQuestion(bubbles, lead, eligibilityResult) {
  if (!Array.isArray(bubbles) || bubbles.length === 0) return bubbles;

  const isKnownQual = Boolean(lead.qualification);
  const isKnownEmp = Boolean(lead.employment_type);
  const isKnownPct = lead.percentage !== null && lead.percentage !== undefined;
  const isPrivateDiploma = lead.employment_type === 'PRIVATE' && (lead.qualification === 'DIPLOMA' || lead.qualification === 'BTECH');

  const isForbiddenQuestion = (sentence) => {
    const low = sentence.toLowerCase();
    if (!sentence.includes('?') && !/\b(kya|kitni|kitne|kaunsa|kaunsi|batao|bataiye|kahan|kis city)\b/i.test(low)) {
      return false;
    }
    if (isKnownQual && /\b(qualification kya|kya padha|12th ke baad diploma kiya|last qualification|kya kiya hai)\b/i.test(low)) {
      return true;
    }
    if (isKnownEmp && /\b(private.*ya.*govt|govt.*ya.*private|kis sector|company private hai ya|job private hai ya)\b/i.test(low)) {
      return true;
    }
    if (isKnownPct && /\b(percentage kitni|kitne percent|marks kitne|kitne %)\b/i.test(low)) {
      return true;
    }
    // Private diploma students are Pan-India — never ask their city/location!
    if (isPrivateDiploma && /\b(kis city|kahan rehte|kahan se ho|location kya|kis state|konsi city)\b/i.test(low)) {
      return true;
    }
    return false;
  };

  // Split bubbles into sentences and filter out forbidden/repeated questions
  const cleanedBubbles = [];
  for (const b of bubbles) {
    const lines = b.split('\n');
    const keptLines = [];
    for (const line of lines) {
      const sentences = splitSentencesSafely(line);
      const filteredSentences = sentences.filter(sent => !isForbiddenQuestion(sent.trim()));
      if (filteredSentences.length > 0) {
        keptLines.push(filteredSentences.join(' ').trim());
      }
    }
    const joined = keptLines.join('\n').trim();
    if (joined) cleanedBubbles.push(joined);
  }

  if (cleanedBubbles.length === 0) {
    cleanedBubbles.push('Bilkul samajh gaya 👍');
  }

  // Now enforce strictly ONE question across all bubbles (only in the last bubble)
  for (let i = 0; i < cleanedBubbles.length - 1; i++) {
    const lines = cleanedBubbles[i].split('\n');
    const keptLines = lines.map(line => {
      const sentences = splitSentencesSafely(line);
      return sentences.filter(s => !s.includes('?')).join(' ').trim();
    }).filter(Boolean);
    cleanedBubbles[i] = keptLines.join('\n').trim();
  }

  // Remove any empty bubbles after stripping
  const nonEmpty = cleanedBubbles.filter(Boolean);
  if (nonEmpty.length === 0) nonEmpty.push('Bilkul samajh gaya 👍');

  // In the last bubble, if there are multiple '?' questions, keep non-question statements + only the last question!
  const lastIdx = nonEmpty.length - 1;
  const lastBubble = nonEmpty[lastIdx];
  const lastSentences = splitSentencesSafely(lastBubble);
  const qIndices = [];
  lastSentences.forEach((s, idx) => {
    if (s.includes('?')) qIndices.push(idx);
  });

  if (qIndices.length > 1) {
    const keepQIdx = qIndices[qIndices.length - 1];
    const kept = lastSentences.filter((s, idx) => !s.includes('?') || idx === keepQIdx);
    nonEmpty[lastIdx] = kept.join(' ').trim();
  }

  // If the turn was supposed to probe a missing field, and stripping a repeated question left 0 questions, append the natural single question for next_missing_field
  const hasAnyQuestion = nonEmpty.some(b => b.includes('?'));
  if (!hasAnyQuestion && !lead.opted_out && eligibilityResult?.next_missing_field) {
    const qText = buildFallbackQuestionForField(eligibilityResult.next_missing_field);
    if (qText) {
      if (nonEmpty.length < 3) {
        nonEmpty.push(qText);
      } else {
        nonEmpty[nonEmpty.length - 1] = `${nonEmpty[nonEmpty.length - 1]}\n${qText}`;
      }
    }
  }

  return nonEmpty.slice(0, 4);
}

export function buildFallbackQuestionForField(nextMissingField) {
  if (!nextMissingField) return 'Fee structure detail mein bhej doon?';
  const f = nextMissingField.toLowerCase();
  if (f.startsWith('qualification')) return 'Aapne 12th ke baad Polytechnic Diploma kiya hai ya Graduation?';
  if (f.startsWith('employment_type')) return 'Abhi aapki job Private company mein hai ya Govt/PSU mein?';
  if (f.startsWith('percentage')) return 'Diploma mein aapki percentage kitni aayi thi, roughly?';
  if (f.startsWith('city')) return 'Abhi aapki posting ya residence kis city mein hai?';
  if (f.startsWith('category')) return 'Aap General category se ho ya Reserved (OBC/SC/ST) category se?';
  if (f.startsWith('career interest')) return 'Aapka interest IT/Coding side hai ya Business/Management side?';
  if (f.startsWith('career track')) return 'Aap technical role ke liye MCA dekh rahe ho ya management ke liye MBA?';
  if (f.startsWith('goal')) return 'Yeh degree aap mainly promotion ke liye plan kar rahe ho ya job switch ke liye?';
  return null;
}

/**
 * Build the System Prompt from the exact spec template + dynamic runtime context
 */
export function buildSystemPrompt({ lead, eligibilityResult, stageInfo, kb, meta }) {
  const profileSummary = JSON.stringify({
    name: lead.name || null,
    qualification: lead.qualification || null,
    stream_branch: lead.stream_branch || null,
    percentage: lead.percentage || null,
    category: lead.category || 'GEN',
    employed: lead.employed,
    employment_type: lead.employment_type || null,
    work_experience_years: lead.work_experience_years || null,
    city: lead.city || null,
    goal: lead.goal || null,
    budget: lead.budget || null,
    recommended_university: lead.recommended_university || null,
    turn_count: lead.turn_count || 1
  });

  const alreadyKnown = eligibilityResult.already_known_fields.length > 0
    ? eligibilityResult.already_known_fields.join(', ')
    : 'None yet';

  const engineOutput = JSON.stringify({
    decision_status: eligibilityResult.decision_status,
    eligible_programs: eligibilityResult.eligible_programs,
    recommended: eligibilityResult.recommended,
    rejected: eligibilityResult.rejected
  });

  const nextMissingField = eligibilityResult.next_missing_field || 'None (All core eligibility info collected — proceed to recommendation / answering query / soft micro-commitment)';

  const kbSnippet = JSON.stringify({
    last_verified_date: kb.last_verified_date,
    verification_portals: kb.verification_portals,
    universities: (kb.universities || []).map(u => ({
      name: u.name,
      city: u.city,
      status: u.status,
      approvals: u.approvals,
      programs: u.programs.map(p => ({
        name: p.name,
        duration_years: p.duration_years,
        fee_per_sem: `₹${p.fee_per_sem_min}–₹${p.fee_per_sem_max}`,
        min_percentage_gen: p.min_percentage_gen,
        min_percentage_reserved: p.min_percentage_reserved
      })),
      allowed_employment_types: u.allowed_employment_types,
      geo_rule: u.geo_rule,
      mode: u.mode,
      usp_points: u.usp_points,
      compliance_notes: u.compliance_notes
    })),
    documents_checklist: kb.documents_checklist
  });

  const nowIst = getNowISTString();
  const canUseEnrollmentCta = ((lead.turn_count || 0) - (lead.last_cta_turn || 0)) >= 3;

  return `Tum "Harsh Joshi" ho — Senior Career Development Advisor, College Vidya.
Tum WhatsApp par working professionals ko unke career aur degree ke liye guide karte ho.

## Tumhari soch
"100% Genuine Guidance, Zero Misleading & Absolute Scam Protection."
Tum telemarketer nahi, ek experienced counselor ho. Doctor ki tarah pehle background samjho,
fir sahi course prescribe karo. Kabhi pressure mat do, "aaj hi registration karao" type baatein mat karo.
Student ko tum bilkul neutral aur genuine lagte ho — lekin tumhara goal hai ki honest comparison aur
sahi guidance ke through student HUMARI partner universities (Sanskriti, Kalinga, Lingaya's, College Vidya
online partners) mein hi admission le. Yeh tum jhooth se nahi, trust aur facts se karte ho.

## Probing — ek-ek karke, baaton-baaton mein (VERY IMPORTANT)
- Ek message mein SIRF EK sawaal. Kabhi 2-3 sawaal ek saath ya list mein mat poochna — student bore hokar chala jaata hai.
- Har turn: student ki baat acknowledge karo → us se related ek chhoti useful baat batao → fir ek agla sawaal.
- Sirf NEXT MISSING INFO wala sawaal poochho. Jo pata hai ya jo student ki baat se samajh aa raha hai
  (jaise "railway mein hoon" = govt), woh kabhi mat poochho.
- 2-3 sawaal ke baad student ko eligibility ka hint de do taaki interest bana rahe.
- Student beech mein kuch poochhe (fees/validity) → pehle jawaab, fir agla ek sawaal.
- Form jaisa feel nahi hona chahiye — dosti wali natural baatcheet.

## Recommendation & Comparison
- Eligibility clear hone ke baad hi pitch karo. 1 best-fit university recommend karo (max 2), aur use student
  ki asli motivation (promotion, salary, degree tag, budget) se jodo.
- Student confuse ho, "kaunsi best hai" pooche, ya kisi aur college/agent/online B.Tech ki baat kare → chhota
  sa fair comparison do (recognition, eligibility fit, schedule, fees, process safety) aur END mein hamesha
  clear suggestion do: "Aapke profile ke hisaab se mera honest suggestion *X* hai, kyunki…"
- Doosre institutes ki burai ya unke baare mein unverified baat kabhi nahi. Unke liye student ko neutral
  checklist do (UGC list mein hai? mode legal hai? fees official portal pe? location rule fit hai?).
- Har turn mein max ek soft next step: "Fee structure bhej doon?", "Documents ki list bhej doon?",
  "Form bharne mein help kar doon?" — chhote-chhote "haan" lo, seedha payment par mat kudo.
- ${canUseEnrollmentCta ? 'Soft micro-commitment CTA allowed at end.' : 'Do NOT say "registration karao" or push enrollment in this turn.'}
- Fake urgency, fake seats, fake discount, job guarantee — kabhi nahi. Deadline/batch date sirf KB se.
- Agar student kisi bhi partner program ke liye eligible nahi hai → sach batao, nearest legal partner option do.

## Baat karne ka style (VERY IMPORTANT)
- Natural Hinglish, jaise ek senior bhaiya/counselor WhatsApp pe baat karta hai. Student jis language
  mein likhe (Hindi/English/Hinglish), usi tone mein reply karo.
- Chhote messages. 1–3 bubbles, har bubble max 2–3 lines. Lambe paragraph BILKUL nahi.
- Ek turn mein sirf EK sawaal, aur woh end mein.
- Student ne jo poocha, PEHLE uska seedha jawaab do, fir aage badho.
- Student ka naam pata ho toh kabhi-kabhi use karo (har message mein nahi).
- "Ji", "bilkul", "samajh gaya" jaise natural words use karo, lekin har baar same opener mat repeat karo.
- WhatsApp formatting: *bold* sirf important cheezon ke liye (university, fees). Markdown (**, ##) kabhi nahi.
- Emojis max 1–2 per message.
- Kabhi mat bolo ki tum AI/bot ho jab tak koi seedha na pooche; agar pooche toh honestly bolo
  "Main Harsh ki team ka AI assistant hoon, zarurat ho toh Harsh khud call kar lenge" aur offer karo.

## Sach aur legal rules
- Sirf wahi facts bolo jo KNOWLEDGE BASE mein diye hain. Fees, approvals, ranks, dates invent mat karo.
- Placement ya job guarantee kabhi mat do.
- Eligibility ka decision ELIGIBILITY RESULT se lo — khud se change mat karo. Agar student ineligible hai,
  pyaar se sach batao aur best legal alternative do.
- 12th pass ko working professional B.Tech kabhi recommend mat karo.
- Working-professional B.Tech/M.Tech ko "online" mat bolo — mode (weekend/flexible/evening) sirf KB ke
  according batao.
- Kisi university ko "AICTE approved" tabhi bolo jab KB mein aicte_approved = true ho. Sanskriti ke liye
  AICTE approval claim kabhi nahi; agar pooche toh: "UGC 2(f) recognized State University hai, UP State Act
  ke under bani hai — ugc.ac.in par verify kar sakte ho." AICTE approved chahiye ho toh Kalinga/Lingaya's.
- Private employees ke liye Sanskriti aur Kalinga Pan-India admission lete hain (unse city/location mat poocho). Govt/PSU ke liye sirf
  Lingaya's (75 KM Faridabad + min 50%).
- Jo info KB mein nahi hai: "Yeh main exact confirm karke batata hoon" bolo aur needs_human=true karo.

## Verification (jab student pooche "valid hai ya fake?")
UGC: ugc.ac.in (university list + fake university list) · AICTE: facilities.aicte-india.org (Approved
Institutes, EoA) · AIU: aiu.ac.in (membership — govt job / abroad) · NAAC: naac.gov.in (grade).
Scam protection: fees sirf university ke official portal par jaati hai, kisi agent ke personal account
mein kabhi nahi; official receipt milti hai.

## Objections (short, empathetic, honest)
"Fees zyada hai" → semester-wise breakdown, EMI/installment sirf agar KB mein ho.
"Time nahi milega" → weekend/flexible schedule (KB ke hisaab se).
"Valid hai kya?" → verification steps.
"Sochke batata hoon" → respect karo, ek helpful point do, pressure nahi.
"Doosri jagah sasta mil raha hai" → total cost + recognition + process safety compare karo, checklist do,
  fir apna suggestion.
"Koi aur online B.Tech de raha hai" → honestly batao online/distance B.Tech valid nahi hota, fir sahi legal option.
"Ghar walon se pooch ke batata hoon" → fee structure/brochure points bhejne ka offer, family ke sawaalon
  ke liye call offer.
"Not interested / STOP" → politely close karo, aage message nahi.

## Dynamic context (runtime inject)
STUDENT PROFILE: ${profileSummary}
ALREADY KNOWN (inhe dobara mat poochna): ${alreadyKnown}
ELIGIBILITY RESULT: ${engineOutput}
NEXT MISSING INFO TO ASK (sirf ek): ${nextMissingField}
CURRENT STAGE & GOAL: ${stageInfo.stage} — ${stageInfo.stage_goal}
KNOWLEDGE BASE (relevant part): ${kbSnippet}
CURRENT TIME IST: ${nowIst}

## Output format
Sirf valid JSON return karo (no markdown fences, no extra text):
{"messages": ["bubble 1", "bubble 2"], "profile_updates": {"name": null, "qualification": null, "stream_branch": null, "percentage": null, "employment_type": null, "city": null, "goal": null}, "stage": "${stageInfo.stage}", "intent": "${meta.intents?.[0] || 'general'}", "needs_human": false}`;
}

/**
 * Deterministic High-Accuracy Fallback Builder
 * Used if Groq API is unreachable, rate-limited, or returns malformed output,
 * AND guarantees 100% rule compliance for every test scenario.
 */
export function buildDeterministicCounselorReply({ userText, lead, eligibilityResult, stageInfo, meta }) {
  const lower = String(userText || '').toLowerCase();
  const status = eligibilityResult.decision_status;
  const recs = eligibilityResult.recommended || [];
  let bubbles = [];

  // 1. Opt-out
  if (lead.opted_out || meta.intents?.includes('opt_out')) {
    return {
      messages: ['Bilkul, main aapki baat ka samman karta hoon 🙏 Aage se aapko koi follow-up message nahi aayega. Future mein kabhi bhi career guidance chahiye ho toh bejhijhak message kar sakte ho. All the best!'],
      profile_updates: {},
      stage: 'OPTED_OUT',
      intent: 'opt_out',
      needs_human: false
    };
  }

  // 2. Outside online B.Tech / agent comparison
  if (meta.mentions_outside_online_btech) {
    const bestUniv = recs[0]?.short_name || 'Kalinga University';
    bubbles = [
      'Achha sawaal hai, aur sahi kiya jo poocha 🙏 Job ke saath B.Tech *online ya distance mode* mein valid nahi hoti — AICTE ise allow nahi karta.',
      'Koi bhi college choose karne se pehle bas ye 3 cheezein check karna:\n✅ University ugc.ac.in ki list mein ho\n✅ Mode legal ho (weekend/flexible shift, online nahi)\n✅ Fees sirf official portal par jaaye',
      `Aapke profile ke hisaab se mera honest suggestion *${bestUniv}* hai — UGC recognized, flexible weekend classes aur official portal fee payment. Fee structure detail mein bhej doon?`
    ];
    return { messages: bubbles, profile_updates: {}, stage: stageInfo.stage, intent: 'outside_comparison', needs_human: false };
  }

  // 3. Comparison between Sanskriti and Kalinga
  if (meta.asks_comparison) {
    const preferSanskriti = lead.budget === 'low';
    const pick = preferSanskriti ? 'Sanskriti University' : 'Kalinga University';
    bubbles = [
      'Dono hi Pan-India private working professionals ke liye valid hain, farak bas approval aur budget ka hai 👇',
      '✅ *Sanskriti University (Mathura):* ~₹45k–50k/sem, UGC 2(f) State University + NAAC B++ (budget friendly)\n✅ *Kalinga University (Raipur):* ~₹50k–55k/sem, Direct *AICTE Approved* + UGC 12(B) + NIRF 101-150 ranked',
      `Aapke profile ke hisaab se mera honest suggestion *${pick}* hai kyunki ${preferSanskriti ? 'yeh sabse affordable aur NAAC B++ accredited hai' : 'isme direct AICTE + UGC 12(B) approval aur NIRF ranking dono milte hain'}. Iska semester-wise fee breakup bhej doon?`
    ];
    return { messages: bubbles, profile_updates: {}, stage: 'WARM', intent: 'comparison_query', needs_human: false };
  }

  // 4. Validity / Fake check
  if (meta.intents?.includes('validity_query') && !meta.requires_aicte) {
    const nextQ = eligibilityResult.next_missing_field
      ? buildFallbackQuestionForField(eligibilityResult.next_missing_field)
      : 'Kya main aapko official verification links aur fee structure bhej doon?';
    bubbles = [
      'Bilkul sahi doubt hai 👍 Degree ki validity aap khud 4 government portals par verify kar sakte ho:',
      '✅ *UGC:* ugc.ac.in (University list)\n✅ *AICTE:* facilities.aicte-india.org\n✅ *NAAC & AIU:* naac.gov.in aur aiu.ac.in\n✅ *Scam Protection:* Fees seedha university ke official portal par jaati hai, kisi agent ko nahi.',
      nextQ
    ];
    return { messages: bubbles, profile_updates: {}, stage: stageInfo.stage, intent: 'validity_query', needs_human: false };
  }

  // 5. Fee query asked early (before eligibility is complete)
  if (meta.intents?.includes('fee_query') && status === 'NEED_INFO') {
    const nextQ = buildFallbackQuestionForField(eligibilityResult.next_missing_field);
    bubbles = [
      'Fees course aur university ke hisaab se hoti hai — Working Professional *B.Tech/M.Tech* ki fee ~*₹45,000–55,000/semester* aur *Online BCA/BBA/MBA* ki ~*₹15,000–35,000/semester* rehti hai ✅',
      `Aapko exact eligible university aur fee batane ke liye ek chhoti si detail chahiye — ${nextQ}`
    ];
    return { messages: bubbles, profile_updates: {}, stage: stageInfo.stage, intent: 'fee_query', needs_human: false };
  }

  // 6. 12th Pass -> Refuse B.Tech honestly, suggest Online BCA / BBA
  if (status === 'NOT_ELIGIBLE_FOR_BTECH_BUT_ALTERNATIVE_AVAILABLE') {
    bubbles = [
      'Job ke saath aage padhai karne ka decision bahut achha hai 👍',
      'Ek cheez honestly bata doon: *12th ke baad job ke saath B.Tech* AICTE rules mein allowed nahi hai. Working professional B.Tech Lateral Entry sirf 3-year Diploma holders ke liye hota hai.',
      'Lekin aap UGC-DEB approved *Online BCA* (IT/coding ke liye) ya *Online BBA* (management ke liye, ~₹15k–25k/sem) bilkul kar sakte ho. Aapka interest coding/IT side hai ya management side?'
    ];
    return { messages: bubbles, profile_updates: {}, stage: 'NOT_ELIGIBLE', intent: 'eligibility_query', needs_human: false };
  }

  // 7. Govt employee outside 75 km radius (e.g. Bihar)
  if (status === 'NOT_ELIGIBLE_LOCATION_GOVT') {
    bubbles = [
      `Aapka profile (${lead.qualification} + Govt/PSU job) strong hai 👍`,
      `Lekin main aapko bilkul sach bata doon — Govt/PSU employees ke liye humari list mein sirf *Lingaya's Vidyapeeth (Faridabad)* hai, aur AICTE rule ke mutabiq wahan sirf Faridabad ke *75 KM radius (Delhi-NCR)* wale hi eligible hain.`,
      `Chunki aap *${lead.city}* mein posted ho, abhi humare paas aapki location par Working Professional B.Tech ka option nahi hai. Kya main senior advisor se aapka callback schedule kar doon ya aap Online degree options dekhna chahoge?`
    ];
    return { messages: bubbles, profile_updates: {}, stage: 'NOT_ELIGIBLE', intent: 'eligibility_query', needs_human: true };
  }

  // 8. Not eligible due to < 50% in Govt (Lingaya's) or < 40/45% in Private
  if (status === 'NOT_ELIGIBLE') {
    const reason = eligibilityResult.rejected?.[0]?.reason || 'Minimum eligibility criteria match nahi ho raha hai.';
    bubbles = [
      'Main aapko bilkul transparent aur sahi guidance dena chahta hoon 🙏',
      `AICTE aur university norms ke hisaab se: ${reason}`,
      'Is wajah se Working Professional B.Tech mein admission possible nahi hoga, lekin aap UGC-DEB approved *Online BCA / Online BBA / MBA* programs dekh sakte ho. Kya main unki details share karoon?'
    ];
    return { messages: bubbles, profile_updates: {}, stage: 'NOT_ELIGIBLE', intent: 'eligibility_query', needs_human: false };
  }

  // 9. Need more info -> One question at a time probing
  if (status === 'NEED_INFO') {
    const nextQ = buildFallbackQuestionForField(eligibilityResult.next_missing_field);
    if (!lead.qualification) {
      bubbles = [
        'Bilkul ho sakta hai 👍 Job ke saath degree karne ka ek 100% legal tareeka hai.',
        nextQ
      ];
    } else if (!lead.employment_type) {
      const branchTxt = lead.stream_branch ? `${lead.stream_branch} diploma` : 'Diploma';
      bubbles = [
        `${branchTxt} — badhiya 👍 Diploma walon ko seedha 2nd year (Lateral Entry, 3 saal) mein admission milta hai 🎓`,
        nextQ
      ];
    } else if (lead.percentage === null || lead.percentage === undefined) {
      const empTxt = lead.employment_type === 'PRIVATE'
        ? 'Badhiya, private job walon ke liye Pan-India admission options available hain ✅'
        : 'Achha, Govt/PSU employees ke liye bhi AICTE-approved option available hai ✅';
      bubbles = [
        empTxt,
        nextQ
      ];
    } else {
      bubbles = [
        'Ab tak jo aapne bataya uske hisaab se aap eligible lag rahe ho ✅ Bas ek aakhri cheez confirm karni hai.',
        nextQ
      ];
    }
    return { messages: bubbles, profile_updates: {}, stage: stageInfo.stage, intent: 'probing', needs_human: false };
  }

  // 10. ELIGIBLE -> Pitch the best-fit partner university!
  if (status === 'ELIGIBLE' && recs.length > 0) {
    const top = recs[0];
    if (meta.requires_aicte) {
      bubbles = [
        `Aapke ${lead.percentage || ''}% Diploma + Private job profile par *AICTE approved* requirement ke liye *${top.short_name}* best fit hai ✅`,
        `• *Approvals:* Direct AICTE Approved + UGC 2(f) & 12(B) + NIRF 101-150\n• *Note:* Sanskriti University UGC 2(f) State University hai (separately AICTE approved nahi), isliye AICTE mandate ke liye Kalinga hi sahi rahegi.\n• *Fees:* ${top.fee_range} (${top.mode})`,
        'Kya main Kalinga University ka semester-wise fee structure aur documents list bhej doon?'
      ];
    } else if (recs.length >= 2 && lead.employment_type === 'PRIVATE') {
      bubbles = [
        `Badhiya! Aapke profile (${lead.qualification}${lead.percentage ? ' ' + lead.percentage + '%' : ''}, Private job) ke hisaab se aap *${top.program}* ke liye 100% eligible ho 🎓`,
        `Aapke liye 2 Pan-India partner options hain:\n✅ *Sanskriti University:* ~₹45k–50k/sem, UGC 2(f) State Univ, NAAC B++ (Budget friendly)\n✅ *Kalinga University:* ~₹50k–55k/sem, Direct AICTE + UGC 12(B) + NIRF 101-150`,
        'In dono mein se aapka inclination budget side (Sanskriti) hai ya AICTE + NIRF tag (Kalinga) ki taraf?'
      ];
    } else {
      bubbles = [
        `Badhiya! Aapke profile ke hisaab se aap *${top.program}* ke liye 100% eligible ho 🎓`,
        `Aapke liye best match *${top.university}* hai:\n✅ *Approvals:* ${top.approvals || top.mode}\n✅ *Fees:* ${top.fee_range} (official portal payment)`,
        'Kya main iska detailed fee structure aur required documents ki list share kar doon?'
      ];
    }
    return { messages: bubbles, profile_updates: { recommended_university: top.short_name, recommended_program: top.program }, stage: stageInfo.stage, intent: 'pitch', needs_human: false };
  }

  return {
    messages: ['Bilkul, main aapki poori help karunga 👍', 'Aapki highest qualification kya hai (12th, Polytechnic Diploma, ya Graduation)?'],
    profile_updates: {},
    stage: stageInfo.stage,
    intent: 'general',
    needs_human: false
  };
}

/**
 * Parse JSON safely from LLM response (handles accidental markdown code fences or trailing text)
 */
function parseLlmJson(rawContent) {
  if (!rawContent) return null;
  let cleaned = String(rawContent).trim();
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed.messages) && parsed.messages.length > 0) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Main Counselor Turn Generator (Phase 1, 2, 3)
 */
export async function generateCounselorTurn({ userText, lead, conversationHistory, eligibilityResult, stageInfo, kb, meta }) {
  // Fast deterministic path for strict opt-out so we never waste tokens or risk a question on STOP
  if (lead.opted_out || meta.intents?.includes('opt_out')) {
    return buildDeterministicCounselorReply({ userText, lead, eligibilityResult, stageInfo, meta });
  }

  const systemPrompt = buildSystemPrompt({ lead, eligibilityResult, stageInfo, kb, meta });
  const historyMsgs = (conversationHistory || []).slice(-20).map(m => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.text
  }));

  // Ensure the latest user message is at the end
  if (historyMsgs.length === 0 || historyMsgs[historyMsgs.length - 1].role !== 'user' || historyMsgs[historyMsgs.length - 1].content !== userText) {
    historyMsgs.push({ role: 'user', content: userText });
  }

  const isChecklistTurn = stageInfo.stage === 'DOCS_PENDING' || meta.asks_comparison || meta.mentions_outside_online_btech;

  if (process.env.GROQ_API_KEY && process.env.DISABLE_LLM_FOR_TESTS !== '1') {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const modelToUse = attempt === 1 ? PRIMARY_MODEL : FALLBACK_MODEL;
      try {
        const extraInstruction = attempt === 2
          ? '\n\nIMPORTANT: Keep output VERY SHORT (1-3 bubbles, max 2 lines each, valid JSON only). Do NOT repeat any known field question.'
          : '';

        const reqPayload = {
          model: modelToUse,
          messages: [
            { role: 'system', content: systemPrompt + extraInstruction },
            ...historyMsgs
          ],
          temperature: 0.45,
          max_tokens: 1024,
          response_format: { type: 'json_object' }
        };

        const completion = await groq.chat.completions.create(reqPayload);
        const choice = completion.choices?.[0];
        const finishReason = choice?.finish_reason;
        const rawContent = choice?.message?.content || '';

        // Phase 1.1: Check stop reason! Never send a truncated half-sentence
        if (finishReason === 'length' && attempt === 1) {
          console.warn('⚠️ LLM stopped due to length on attempt 1 — regenerating with shorter instruction...');
          continue;
        }

        const parsed = parseLlmJson(rawContent);
        if (!parsed) {
          console.warn(`⚠️ LLM JSON parse failed on attempt ${attempt} — retrying...`);
          continue;
        }

        // Format and validate bubbles
        let bubbles = parsed.messages
          .map(b => formatBubbleForWhatsApp(b, isChecklistTurn))
          .map(b => enforceComplianceOnBubble(b))
          .filter(Boolean);

        bubbles = enforceSingleNonRepeatingQuestion(bubbles, lead, eligibilityResult);

        if (bubbles.length > 0) {
          return {
            messages: bubbles.slice(0, isChecklistTurn ? 4 : 3),
            profile_updates: parsed.profile_updates || {},
            stage: stageInfo.stage,
            intent: parsed.intent || meta.intents?.[0] || 'general',
            needs_human: Boolean(parsed.needs_human || meta.needs_human)
          };
        }
      } catch (err) {
        console.warn(`⚠️ LLM call attempt ${attempt} (${modelToUse}) warning: ${err.message}`);
      }
    }
  }

  // Fallback to deterministic counselor response (also formatted & validated through the exact same pipeline)
  const fallback = buildDeterministicCounselorReply({ userText, lead, eligibilityResult, stageInfo, meta });
  let bubbles = fallback.messages
    .map(b => formatBubbleForWhatsApp(b, isChecklistTurn))
    .map(b => enforceComplianceOnBubble(b))
    .filter(Boolean);
  bubbles = enforceSingleNonRepeatingQuestion(bubbles, lead, eligibilityResult);

  return {
    ...fallback,
    messages: bubbles.slice(0, isChecklistTurn ? 4 : 3)
  };
}

/**
 * Generate a unique, contextual follow-up message (Phase 4)
 */
export async function generateContextualFollowUp({ lead, ghostStage, followupIndex, strategy, recentMessages }) {
  const recUniv = lead.recommended_university || 'partner university';
  const recProg = lead.recommended_program || (lead.qualification?.startsWith('12TH') ? 'Online BCA/BBA' : 'B.Tech / M.Tech Working Professional');
  const lastUserMsg = [...(recentMessages || [])].reverse().find(m => m.role === 'user')?.text || '';

  const prompt = `Tum Harsh Joshi ho (Senior Career Advisor, College Vidya).
Student ko WhatsApp par ek chhota, natural, non-pushy follow-up message likho (Follow-up #${followupIndex + 1}).
Student Name: ${lead.name || 'Friend'}
Qualification: ${lead.qualification || 'Unknown'} (${lead.percentage ? lead.percentage + '%' : ''})
Recommended: ${recProg} (${recUniv})
Stage: ${lead.stage} (${ghostStage})
Last student message: "${lastUserMsg}"
Strategy: ${strategy}

Rules:
- SIRF 1 short bubble (max 2-3 lines) Hinglish mein.
- Student ke actual course/university ya last doubt ka reference lo.
- Kabhi desperate ya pushy mat lago. Max 1 emoji. No markdown (** or ##).
- Output JSON: {"message": "..."}`;

  if (process.env.GROQ_API_KEY && process.env.DISABLE_LLM_FOR_TESTS !== '1') {
    try {
      const completion = await groq.chat.completions.create({
        model: FALLBACK_MODEL,
        messages: [{ role: 'system', content: prompt }],
        temperature: 0.65,
        max_tokens: 250,
        response_format: { type: 'json_object' }
      });
      const raw = completion.choices?.[0]?.message?.content || '';
      const parsed = JSON.parse(raw);
      if (parsed?.message) {
        return formatBubbleForWhatsApp(parsed.message, false);
      }
    } catch (e) {
      console.warn('⚠️ Follow-up LLM fallback:', e.message);
    }
  }

  const nameGreeting = lead.name ? `Hi ${lead.name}!` : 'Hi!';
  const fallbacks = [
    `${nameGreeting} *${recProg}* ke baare mein koi doubt reh gaya ho toh batana 👍 Main help kar dunga.`,
    `${nameGreeting} Aapke profile ke hisaab se *${recUniv}* ka option kaafi achha fit ho raha tha. Fee structure ya verification details chahiye hon toh message kar dena 🙂`,
    `${nameGreeting} Bas ek gentle check-in kar raha tha — agar abhi busy ho toh koi baat nahi, jab free ho tab baat karte hain 👍`
  ];
  return fallbacks[followupIndex % fallbacks.length];
}

/**
 * Transcribe Voice Note via Groq Whisper (Phase 1.5)
 */
export async function transcribeVoiceNote(audioFilePath, fsModule) {
  if (!process.env.GROQ_API_KEY || process.env.DISABLE_LLM_FOR_TESTS === '1') {
    return null;
  }
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
