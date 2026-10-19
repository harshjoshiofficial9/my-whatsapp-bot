import { makeWASocket, useMultiFileAuthState } from '@whiskeysockets/baileys';
import Groq from 'groq-sdk';
import qrcode from 'qrcode-terminal';
import 'dotenv/config';

// ============================================================
// 🧠 AI SETUP (Groq 120B — 14,400 Free Requests/Day)
// ============================================================
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const AI_MODEL = 'openai/gpt-oss-120b';
const FAST_MODEL = 'qwen/qwen3.8-27b';

// ============================================================
// ⏰ TIME CONSTANTS
// ============================================================
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// ============================================================
// 🚨 ADMIN CONFIG
// ============================================================
const ADMIN_NUMBER = "917982412945@s.whatsapp.net"; // Aapka personal number — escalation alerts yahan aayenge

// ============================================================
// 📋 FOLLOW-UP CONFIGURATION (Per Ghost Stage)
// ============================================================
const FOLLOW_UP_CONFIG = {
    GHOST_NEW:     { delays: [4*HOUR, 24*HOUR, 72*HOUR],                              max: 3, escalate: false },
    GHOST_MID:     { delays: [3*HOUR, 24*HOUR, 48*HOUR, 5*DAY],                       max: 4, escalate: false },
    GHOST_PITCHED: { delays: [2*HOUR, 24*HOUR, 48*HOUR, 4*DAY, 7*DAY],                max: 5, escalate: false },
    GHOST_WARM:    { delays: [1*HOUR, 6*HOUR, 24*HOUR, 48*HOUR, 4*DAY, 7*DAY],        max: 6, escalate: false },
    GHOST_DOCS:    { delays: [6*HOUR, 24*HOUR, 48*HOUR, 5*DAY, 7*DAY],                max: 5, escalate: true },
    GHOST_PAY:     { delays: [4*HOUR, 24*HOUR, 48*HOUR, 5*DAY],                       max: 4, escalate: true },
};

// Which lead stage maps to which ghost stage
const STAGE_TO_GHOST = {
    NEW:             'GHOST_NEW',
    DISCOVERY:       'GHOST_MID',
    QUALIFIED:       'GHOST_MID',
    PITCHED:         'GHOST_PITCHED',
    INTERESTED:      'GHOST_WARM',
    DOCS_PENDING:    'GHOST_DOCS',
    PAYMENT_PENDING: 'GHOST_PAY',
};

// AI ko batane ke liye — har follow-up ka strategy/intent
const FOLLOW_UP_STRATEGIES = {
    GHOST_NEW: [
        "Friendly nudge — yaad dilao ki unhone reach out kiya tha, kuch jaanna chahte the",
        "Value hook — mention karo ki UGC-approved weekend B.Tech programs available hain working professionals ke liye",
        "Final gentle check-in — free counselling mention karo, door open rakho, respectful goodbye",
    ],
    GHOST_MID: [
        "Continue where left off — jo info pending hai woh maango naturally",
        "Summarize what you already know about them, simplify the ask — bas ek aur detail chahiye",
        "Soft urgency — scholarship deadlines mention karo",
        "Final respectful reminder — no pressure, jab ready ho tab message karo",
    ],
    GHOST_PITCHED: [
        "Quick check — university details ke baare mein koi sawaal hai toh poochho",
        "Objection anticipation — proactively address degree validity/UGC concerns with verification links",
        "Social proof — mention karo ki recent mein kitne professionals ne admission liya",
        "Different angle — agar fee concern hai toh cheaper alternative hint karo",
        "Final graceful exit — respect their time, leave door open",
    ],
    GHOST_WARM: [
        "Share exact info they asked about — fees breakdown / process steps",
        "Process simplify — enrollment sirf 3 steps hai, document checklist offer karo",
        "Scholarship urgency — deadline mention karo, savings amount batao",
        "Direct ask — koi specific concern hai jo rok raha hai? Main clear kar deta hoon",
        "Motivational — jo jaldi start karte hain unko pehle promotion milta hai",
        "Final respectful close — no pressure, all the best",
    ],
    GHOST_DOCS: [
        "Document checklist share karo — exactly kya kya chahiye",
        "Reassure — saare documents ek saath nahi bhi hon toh pehle jo ready hain woh bhej do",
        "Obstacle removal — agar koi document nahi mil raha toh alternative arrangements hain",
        "Seat urgency — is batch ki seats limited hain",
        "Final honest message — next batch bhi option hai, koi pressure nahi",
    ],
    GHOST_PAY: [
        "Celebratory — documents verified, sirf payment baaki, admission almost done!",
        "EMI highlight — per month installment option batao, manageable hai",
        "Deadline warning — university ki payment deadline mention karo",
        "Personal touch — suggest a quick call, 5 min mein sab clear",
    ],
};

// Valid stages for stage detection
const VALID_STAGES = ['NEW', 'DISCOVERY', 'QUALIFIED', 'PITCHED', 'INTERESTED', 'DOCS_PENDING', 'PAYMENT_PENDING', 'ENROLLED'];

// ============================================================
// 📋 COLLEGE VIDYA ADVISOR — SYSTEM INSTRUCTION
// ============================================================
const SYSTEM_INSTRUCTION = `
## Role & Identity
Tu **College Vidya** ka ek senior **Seniour Career Development Advisor** hai. Tera naam hai "Harsh Joshi". 
Tu ek professional, authoritative, aur consultative style mein baat karta hai — lekin naturally, jaise ek experienced counsellor dost se baat kare.
Tu Hinglish (Hindi + English mix) mein baat karta hai, jaise koi real senior advisor phone pe guide kare.

## College Vidya ke Core Pillars (Hamesha yaad rakh):
1. **Unbiased Suggestions** — Hum kisi ek university ki taraf biased nahi hain, student ke profile ke hisaab se best recommend karte hain, magar anyhow sale lekar aate hain.
2. **Absolute Scam Protection** — Fees seedha university ko jaati hai, koi middleman nahi. Sab kuch legally verified.
3. **Zero-Cost Service** — College Vidya ki counselling completely FREE hai, student se ek bhi paisa nahi lete.
4. **Comprehensive Student Support** — Admission se lekar degree milne tak, har step pe support.

## ⚖️ VERIFIED UNIVERSITY LEGAL & ACCREDITATION DATA
(Yeh data verified hai — in facts ko confidently use kar jab student pooche)

### 1. Sanskriti University (SU) — Mathura, Uttar Pradesh
- **Type:** State Private University — established under *Uttar Pradesh Private Universities Act, 2016* (UP Act No. 20 of 2016), notified on September 16, 2016.
- **UGC Recognition:** ✅ Recognized under **Section 2(f)** of UGC Act, 1956. Degree-conferring powers under **Section 22(1)**. Listed in UGC's Consolidated Directory of State Private Universities (UP).
- **Section 12(B):** ❌ Not yet granted (12B gives access to UGC central grants — selective for private universities).
- **AICTE Approval:** ✅ B.Tech/M.Tech programs follow AICTE curriculum & infrastructure norms. As a UGC-recognized State University, it has degree-awarding authority under Supreme Court precedent (*Bharathidasan University v. AICTE, 2001*).
- **AIU Membership:** ✅ Active Member since April 1, 2020 (approved at AIU's 358th Governing Council meeting, March 3, 2020). North Zone.
- **NAAC:** ✅ **Grade B++ (CGPA: 2.95/4.00)** — Cycle 1. Valid until **October 30, 2030**.
- **UGC Fake List:** ❌ NOT on UGC's fake/unrecognized university list. Zero regulatory warnings.
- **NIRF:** Rank Band 101-150 (Innovation/ARIIA 2023).
- **Programs:** B.Tech (CSE, ME, CE, EE, ECE) & M.Tech for working professionals — Regular Mode, Flexible Shift (Weekend/Evening batches).
- **Eligibility:** Private sector employees only. 45% General / 40% Reserved category.
- **Coverage:** Pan-India (koi geographical restriction nahi).
- **Fee Range:** ₹45,000 - ₹50,000 per semester (approx). Scholarships available.
- **Key USP:** Sabse affordable, pan-India reach, NAAC B++ grade, legitimate UGC degree.
- **Verify:** ugc.ac.in → State Private Universities → UP | sanskriti.edu.in/approvals-recognitions.php

### 2. Kalinga University (KU) — Raipur (Naya Raipur), Chhattisgarh
- **Type:** State Private University — established under *Chhattisgarh Private Universities (Establishment and Operations) Act, 2005* (CG Act No. 8 of 2011), notified March 24, 2011.
- **Historical Context:** Original Chhattisgarh private universities (2002 Act) were struck down by Supreme Court in *Prof. Yashpal v. State of Chhattisgarh (2005)*. Kalinga was re-established AFRESH in 2011 under the revised, compliant 2005 Act. Fully legal.
- **UGC Recognition:** ✅ Recognized under **Section 2(f)** AND **Section 12(B)** of UGC Act. One of the few private universities with 12(B) status — eligible for UGC central development grants.
- **AICTE Approval:** ✅ **Directly AICTE Approved** as "Kalinga University - Faculty of Technology". Holds valid Extension of Approval (EoA) letters. Covers B.Tech, M.Tech, Diploma Engineering (CSE, CE, ME, EE, Mining).
- **AIU Membership:** ✅ Active Regular Member (East/Central Zone).
- **NAAC:** ✅ **Grade B+ (CGPA: 2.60/4.00)**.
- **UGC Fake List:** ❌ NOT on UGC's fake university list.
- **NIRF Rankings:** ✅ Consistently ranked — University Category **Rank Band 101-150** (2022, 2023, 2024). Overall **Rank Band 151-200**.
- **⚠️ Caution Note (for transparency):** Kalinga's name has appeared in police cases where EXTERNAL fraud syndicates were selling forged marksheets. University itself is legitimate — these were unauthorized middlemen. This is why College Vidya ensures enrollment is ONLY through official university channels.
- **Programs:** B.Tech & M.Tech for working professionals — Regular Mode with flexible scheduling.
- **Eligibility:** Private sector employees only. 45% General / 40% Reserved category.
- **Coverage (STRICT GEO-FENCING):** NCR + approved states only → Chhattisgarh (CG), Madhya Pradesh (MP), Maharashtra (MH), Karnataka (KA), Telangana (TS), Andhra Pradesh (AP), Odisha (OD), Jharkhand (JH).
- **Fee Range:** ₹50,000 - ₹55,000 per semester (approx). Merit-based scholarships.
- **Key USP:** Direct AICTE approval, UGC 12(B) status, consistent NIRF rankings, mid-budget sweet spot.
- **Verify:** ugc.ac.in → State Private Universities → CG | aicte-india.org → Approved Institutes | kalingauniversity.ac.in/approvals.php

### 3. Lingaya's Vidyapeeth (LV) — Faridabad, Haryana
- **Type:** Deemed-to-be University (Private/Self-Financed) — declared under **Section 3** of UGC Act, 1956 by MHRD on **January 5, 2009**.
- **History:** Founded in 1998 as *Lingaya's Institute of Management & Technology (LIMAT)* affiliated to MDU. Got Deemed University status in 2009. Renamed from "Lingaya's University" to "Lingaya's Vidyapeeth" after Supreme Court's November 2017 order (deemed universities cannot use word "University" in name).
- **Tandon Committee Context:** In 2009, Tandon Committee put Lingaya's in "Category C" (recommended for de-notification). BUT — Supreme Court halted blanket de-notification (*Viplav Sharma v. Union of India*). Lingaya's completed all compliance reviews, preserved its deemed status, and went on to earn NAAC A+ grade. FULLY CLEARED.
- **UGC Recognition:** ✅ Recognized under **Section 3** of UGC Act, 1956. Degree-conferring powers under **Section 22**. Listed in UGC's Deemed-to-be Universities directory (Haryana).
- **AICTE Approval:** ✅ **Directly AICTE Approved** for B.Tech, M.Tech. Also offers WILP (Work-Integrated Learning Programs) / flexible-shift engineering degrees following AICTE's working professional guidelines.
- **AIU Membership:** ✅ Active Regular Member (listed as "Lingaya's Vidyapeeth, Formerly Lingaya's University").
- **NAAC:** ✅ **Grade A+** (current cycle). Earlier Cycle 1 was Grade B+ (CGPA: 2.62). Valid until **February 19, 2030**.
- **UGC Fake List:** ❌ NOT on UGC's fake university list. Cleared Tandon review.
- **NIRF:** Participated but unranked in top 100/150. Historical Rank Band 151-200 (NIRF 2017).
- **Programs:** B.Tech & M.Tech for working professionals (Govt + Private both eligible).
- **Eligibility:** Government AND Private sector employees. Flat 50% academic requirement (no separate reserved category relaxation).
- **Coverage (STRICT 75 KM RADIUS):** Sirf Faridabad se 75 KM radius ke andar rehne/kaam karne wale eligible hain. Mostly NCR region (Delhi, Gurgaon, Noida, Faridabad, Ghaziabad).
- **Fee Range:** University se directly confirm karna hoga, varies by program.
- **Key USP:** ONLY option for Government employees. NAAC A+ (highest among our partners). Deemed University status. NCR professionals ke liye ideal.
- **Verify:** ugc.ac.in → Deemed Universities → Haryana | aicte-india.org | lingayasvidyapeeth.edu.in

## 🔍 LEGAL VERIFICATION FRAMEWORK (Jab bhi student pooche)
Jab koi student university ki legitimacy pooche, toh yeh framework follow kar:
1. **UGC Check:** "Yeh university UGC recognized hai. Aap khud verify kar sakte ho → ugc.ac.in par jaake 'List of Universities' mein search karo. Fake universities list bhi check karo → ugc.ac.in/page/Fake-Universities.aspx"
2. **AICTE Check:** "B.Tech/M.Tech programs AICTE norms follow karte hain. Verify karo → facilities.aicte-india.org par 'Approved Institutes' dashboard mein search karo."
3. **AIU Check:** "AIU member hai, matlab degree nationally aur internationally valid hai. Check karo → aiu.ac.in par member directory mein."
4. **NAAC Check:** "NAAC accredited hai. Grade verify karo → naac.gov.in par 'Accredited Institutions' mein search karo."
5. **NIRF Check:** "NIRF rankings verify karo → nirfindia.org par archives mein."
6. **Degree Validity:** "Yeh degree Regular Mode ki hai, distance ya online nahi. Matlab promotions, govt exams, higher studies — sab mein valid hai."
7. **Scam Protection:** "College Vidya ke through enrollment ka sabse bada fayda — fees SEEDHA university ke official account mein jaati hai. Koi middleman nahi, koi agent commission nahi. Aapko university ki official receipt milti hai."

## 🚫 GOLDEN CONSTRAINTS (Kabhi violate mat karna):
1. **Sanskriti:** ONLY Private sector. 45%/40%. Pan-India.
2. **Kalinga:** ONLY Private sector. 45%/40%. GEO-FENCED states only.
3. **Lingaya's:** Govt + Private dono. 50% flat. 75 KM radius from Faridabad ONLY.
4. Agar student ka profile kisi university ke rules mein fit nahi hota → clearly bol de aur alternative suggest kar.
5. Agar Kalinga ka map fail ho → Sanskriti recommend kar (fallback).
6. Agar Govt employee hai aur 75KM radius se bahar → honestly bol de ki abhi hamari listed universities mein option limited hai.

## 💬 INTERACTION FLOW (Hamesha follow kar):

### Step 1: DISCOVERY (Pehle information lo)
Jab naya user aaye, pehle yeh 5 cheezein pata karo (ek-ek karke ya naturally conversation mein):
1. **Naam** — "Aapka naam kya hai?"
2. **Sector** — "Aap Government mein hain ya Private sector mein?"
3. **Location** — "Aap kis city/state mein hain?"
4. **Academics** — "Aapki last qualification kya thi aur kitne percentage the?"
5. **Motivation** — "Degree kisliye chahiye — promotion, salary hike, ya koi aur reason?"
6. **Budget** — (Yeh baad mein pooch, pehle value establish kar)

### Step 2: VALUE PITCHING (Credibility build kar)
- Pehle institutional legality → UGC, AICTE, AIU recognition batao
- Phir practical delivery → Weekend classes, online labs, working professionals ke liye designed
- Phir outcomes → Promotion milega, salary hike, career growth
- **LAST** mein fees aur scholarships

### Step 3: RECOMMENDATION ENGINE
- Govt Employee? → **Lingaya's** (if 50%+ AND within 75KM)
- Private + Low Budget (₹45-50K)? → **Sanskriti University**
- Private + Mid Budget (₹50-55K) + Approved State? → **Kalinga University**
- Kalinga map fail? → Fallback to **Sanskriti**
- Does not meet any criteria? → Honestly inform, don't force-fit

### Step 4: CLOSING
Hamesha response ke end mein ek soft/hard close do:
- "Kya aap Sanskriti University ke saath registration process shuru karna chahenge?"
- "Agar interested ho toh main aapko documents ki list bhej deta hoon, ready karna start kar do."
- "Scholarship lock karne ke liye jaldi action lena padega — kya aaj hi process initiate karein?"

## 🚫 STRICT DON'Ts:
- Kabhi price se baat SHURU mat kar. Pehle value, phir price.
- Kabhi "distance learning" mat bol — yeh "Regular Mode, Flexible Shift" hai.
- Kabhi jhooth mat bol. Agar kuch nahi pata toh bol de "Main confirm karke batata hoon."
- Kabhi robotic language use mat kar. Tu ek real advisor hai, chatbot nahi.
- Kabhi ek se zyada university ek saath mat recommend kar bina clear reasoning ke.
- Student ki eligibility check kiye bina kabhi university suggest mat kar.

## 🚫 STRICT ANTI-REPETITION & MEMORY RULES (MOST IMPORTANT):
1. Pehle CHAT HISTORY ko dhyan se padho!
2. Agar student ne apni qualification, percentage, location, ya sector ALREADY bata diya hai (chahe pichle messages mein bataya ho), toh usko DOBARA KABHI MAT POOCHO!
3. Agar student ne bola "50% thi" ya koi direct answer/sawaal pucha hai, toh PEHLE us sawaal/score ka clear direct jawab do! (e.g. "Great! 50% score par aap Sanskriti aur Kalinga dono mein eligible ho...")
4. Kabhi sawaalon ke loop mein mat phanso. Agar basic info (sector, % etc.) mil chuki hai toh turant university pitch karo aur aage process samjhao!

## Response Style:
- Hinglish mein baat kar (Hindi + English natural mix)
- Short, clear paragraphs — WhatsApp pe long walls of text mat bhej
- Emojis tastefully use kar (professional context mein) ✅📋🎓
- Har response 2-4 short paragraphs ka ho (WhatsApp friendly)
- Bullet points use kar jab multiple points batane hon
`;

// ============================================================
// 💾 LEAD PROFILES (CRM in Memory)
// ============================================================
const leadProfiles = new Map(); // Map<senderID, LeadProfile>

function getOrCreateLead(senderID) {
    if (!leadProfiles.has(senderID)) {
        leadProfiles.set(senderID, {
            phone: senderID,
            naam: null,
            stage: 'NEW',
            sector: null,         // "Government" or "Private"
            location: null,       // "Pune, MH"
            qualification: null,  // "Diploma", "12th", "Graduation"
            percentage: null,     // 52
            motivation: null,     // "promotion", "salary hike"
            recommendedUniv: null,// "Sanskriti", "Kalinga", "Lingayas"

            // Follow-up tracking
            followUpCount: 0,
            ghostStage: null,     // "GHOST_NEW", "GHOST_WARM", etc.
            pendingTimers: [],    // Array of setTimeout IDs to cancel

            // Conversation history (last 20 messages for AI context)
            conversationLog: [],  // [{role: "user"/"bot", text: "...", time: Date.now()}]

            // Timestamps
            firstContactTime: Date.now(),
            lastActiveTime: Date.now(),
            lastBotReplyTime: null,

            // State flags
            isGhost: false,
            isDead: false,
            isEscalated: false,

            // Internal
            _ghostDetectionTimer: null,
        });
        console.log(`🆕 Naya lead profile banaya: ${senderID}`);
    }
    return leadProfiles.get(senderID);
}

// ============================================================
// 💬 CHAT CONVERSATION MEMORY (Directly via lead.conversationLog)
// ============================================================

// ============================================================
// ⏰ BUSINESS HOURS ENGINE
// ============================================================
function isBusinessHours() {
    const now = new Date();
    const hours = now.getHours(); // System timezone (IST on your Mac)
    return hours >= 9 && hours < 21; // 9 AM to 9 PM
}

function getDelayUntilMorning() {
    const now = new Date();
    const tomorrow930 = new Date(now);

    if (now.getHours() >= 21) {
        // After 9 PM → next day 9:30 AM
        tomorrow930.setDate(tomorrow930.getDate() + 1);
    }
    tomorrow930.setHours(9, 30, 0, 0);

    return Math.max(tomorrow930.getTime() - now.getTime(), 0);
}

// ============================================================
// 🔄 FOLLOW-UP ENGINE — Core Functions
// ============================================================

/**
 * Cancel ALL pending follow-ups for a lead.
 * Called when lead replies (response resets everything).
 */
function cancelAllFollowUps(senderID) {
    const lead = leadProfiles.get(senderID);
    if (!lead) return;

    // Clear all scheduled follow-up timers
    for (const timerId of lead.pendingTimers) {
        clearTimeout(timerId);
    }
    lead.pendingTimers = [];

    // Clear ghost detection timer
    if (lead._ghostDetectionTimer) {
        clearTimeout(lead._ghostDetectionTimer);
        lead._ghostDetectionTimer = null;
    }

    // Reset ghost state
    if (lead.isGhost) {
        console.log(`🔄 Lead ${lead.naam || senderID} wapas active! (was ${lead.ghostStage})`);
    }
    lead.followUpCount = 0;
    lead.isGhost = false;
    lead.ghostStage = null;

    // Revive dead leads if they reply
    if (lead.isDead) {
        lead.isDead = false;
        console.log(`🔄 Dead lead ${lead.naam || senderID} revived! (replied after max follow-ups)`);
    }
}

/**
 * Start ghost detection timer.
 * If lead doesn't reply within the detection window, trigger follow-up sequence.
 */
function startGhostDetection(senderID, sock) {
    const lead = leadProfiles.get(senderID);
    if (!lead || lead.isDead || lead.stage === 'ENROLLED') return;

    // Clear existing ghost detection timer
    if (lead._ghostDetectionTimer) {
        clearTimeout(lead._ghostDetectionTimer);
    }

    // Ghost detection delay varies by stage importance
    const ghostDelay = (lead.stage === 'INTERESTED' || lead.stage === 'DOCS_PENDING' || lead.stage === 'PAYMENT_PENDING')
        ? 1 * HOUR   // High-priority stages → detect ghost faster (1 hour)
        : 2 * HOUR;  // Normal stages → 2 hours

    lead._ghostDetectionTimer = setTimeout(() => {
        const currentLead = leadProfiles.get(senderID);
        if (!currentLead || currentLead.isDead || currentLead.stage === 'ENROLLED') return;

        // Only mark as ghost if lead's last message was BEFORE our last reply
        // (means they haven't responded to our last message)
        if (currentLead.lastBotReplyTime && currentLead.lastActiveTime <= currentLead.lastBotReplyTime) {
            console.log(`\n👻 GHOST DETECTED: ${currentLead.naam || senderID}`);
            console.log(`   Stage: ${currentLead.stage} → Ghost since: ${Math.round((Date.now() - currentLead.lastActiveTime) / MINUTE)} min`);
            scheduleFollowUpSequence(senderID, sock);
        }
    }, ghostDelay);
}

/**
 * Schedule the entire follow-up sequence for a ghosted lead.
 * Each follow-up has its own timer with increasing delays.
 */
function scheduleFollowUpSequence(senderID, sock) {
    const lead = leadProfiles.get(senderID);
    if (!lead || lead.isDead || lead.isGhost) return; // Already ghost = already scheduled

    const ghostStage = STAGE_TO_GHOST[lead.stage];
    if (!ghostStage) return;

    const config = FOLLOW_UP_CONFIG[ghostStage];
    if (!config) return;

    lead.isGhost = true;
    lead.ghostStage = ghostStage;
    lead.followUpCount = 0;
    lead.pendingTimers = [];

    console.log(`⏰ Scheduling ${config.max} follow-ups for ${lead.naam || senderID} (${ghostStage})`);

    // Schedule each follow-up with cumulative delay from NOW
    for (let i = 0; i < config.max && i < config.delays.length; i++) {
        const delay = config.delays[i];
        const followUpIndex = i;

        const timerId = setTimeout(() => {
            executeFollowUp(senderID, sock, followUpIndex, ghostStage);
        }, delay);

        lead.pendingTimers.push(timerId);
    }
}

/**
 * Execute a single follow-up message.
 * Checks all safety guards before sending.
 */
async function executeFollowUp(senderID, sock, followUpIndex, ghostStage) {
    const lead = leadProfiles.get(senderID);

    // === SAFETY GUARDS ===
    if (!lead) return;
    if (!lead.isGhost) return;         // Lead replied → no longer ghost
    if (lead.isDead) return;           // Already dead → stop
    if (lead.stage === 'ENROLLED') return; // Already enrolled

    const config = FOLLOW_UP_CONFIG[ghostStage];
    const strategies = FOLLOW_UP_STRATEGIES[ghostStage];
    const strategy = strategies[followUpIndex] || strategies[strategies.length - 1];

    lead.followUpCount = followUpIndex + 1;

    console.log(`\n📤 FOLLOW-UP #${lead.followUpCount}/${config.max}`);
    console.log(`   Lead: ${lead.naam || senderID}`);
    console.log(`   Ghost Stage: ${ghostStage}`);
    console.log(`   Strategy: ${strategy}`);
    console.log(`   Silent for: ${Math.round((Date.now() - lead.lastActiveTime) / HOUR)}h`);

    // === BUSINESS HOURS CHECK ===
    if (!isBusinessHours()) {
        const morningDelay = getDelayUntilMorning();
        console.log(`   🌙 Not business hours → Queued for ${new Date(Date.now() + morningDelay).toLocaleTimeString('en-IN')}`);

        const rescheduledTimer = setTimeout(() => {
            executeFollowUp(senderID, sock, followUpIndex, ghostStage);
        }, morningDelay);
        lead.pendingTimers.push(rescheduledTimer);
        return;
    }

    try {
        // === GENERATE AI FOLLOW-UP MESSAGE ===
        const followUpMessage = await generateFollowUpMessage(lead, followUpIndex, strategy);

        // === SEND WITH TYPING INDICATOR ===
        await sock.presenceSubscribe(senderID);
        await sock.sendPresenceUpdate('composing', senderID);

        // Random typing delay (1.5–3.5 sec) to feel human
        await new Promise(r => setTimeout(r, 1500 + Math.random() * 2000));

        await sock.sendPresenceUpdate('paused', senderID);
        await sock.sendMessage(senderID, { text: followUpMessage });

        // Log to conversation history
        lead.conversationLog.push({ role: 'bot', text: followUpMessage, time: Date.now(), isFollowUp: true });
        lead.lastBotReplyTime = Date.now();

        console.log(`   ✅ Sent: "${followUpMessage.substring(0, 80)}..."`);

        // === CHECK IF MAX REACHED ===
        if (lead.followUpCount >= config.max) {
            lead.isDead = true;
            lead.isGhost = false;
            console.log(`   💀 Lead moved to DEAD (${config.max}/${config.max} follow-ups exhausted)`);

            // Escalate to human if configured
            if (config.escalate) {
                await escalateToHuman(lead, sock);
            }
        }

    } catch (error) {
        console.error(`   ⚠️ Follow-up send failed: ${error.message}`);
    }
}

/**
 * Generate a contextual follow-up message using AI.
 * Uses lead profile + conversation history + strategy directive.
 */
async function generateFollowUpMessage(lead, followUpIndex, strategy) {
    // Build recent conversation context (last 6 messages)
    const recentChat = lead.conversationLog
        .slice(-6)
        .map(m => `${m.role === 'user' ? 'Lead' : 'Advisor'}: ${m.text}`)
        .join('\n');

    const hoursSilent = Math.round((Date.now() - lead.lastActiveTime) / HOUR);

    const prompt = `Tu College Vidya ka senior Career Advisor hai (Harsh Joshi). Tujhe ek lead ko WhatsApp par follow-up message likhna hai.

LEAD KI INFO:
- Naam: ${lead.naam || "pata nahi (naam use mat kar)"}
- Current Stage: ${lead.stage}
- Sector: ${lead.sector || "pata nahi"}
- Location: ${lead.location || "pata nahi"}
- Qualification: ${lead.qualification || "pata nahi"}
- Percentage: ${lead.percentage || "pata nahi"}
- Motivation: ${lead.motivation || "pata nahi"}
- Recommended University: ${lead.recommendedUniv || "abhi recommend nahi ki"}

RECENT CONVERSATION:
${recentChat || "(koi significant conversation nahi hui)"}

FOLLOW-UP DETAILS:
- Yeh Follow-up #${followUpIndex + 1} hai
- Lead ne ${hoursSilent} ghante se reply nahi kiya
- Strategy: ${strategy}

STRICT RULES:
1. SIRF follow-up message likho — koi prefix, label, heading, ya explanation NAHI
2. Hinglish mein likho (Hindi + English natural mix)
3. MAXIMUM 3-4 lines (WhatsApp friendly, short paragraphs)
4. Natural human tone — jaise ek real advisor likh raha ho, bot nahi
5. Agar naam pata hai toh use karo, nahi toh "Hi!" se start karo
6. Agar university recommend ki hai toh uska naam mention karo where relevant
7. Kabhi desperate/pushy mat lago — professional aur friendly raho
8. Strategy ko naturally follow karo

SIRF FOLLOW-UP MESSAGE LIKHO (nothing else):`;

    try {
        const completion = await groq.chat.completions.create({
            model: AI_MODEL,
            messages: [{ role: 'system', content: prompt }],
            temperature: 0.7,
            max_tokens: 300,
        });

        let message = completion.choices[0]?.message?.content?.trim() || "";
        message = message.replace(/^(Follow-up:|Message:|Reply:|FU-\d+:)\s*/i, '');
        message = message.replace(/^["']|["']$/g, '');
        return message;
    } catch (e) {
        console.error("Groq follow-up generation error:", e.message);
        return `Hi ${lead.naam || ""}! Bas ek quick check-in tha College Vidya se. Koi sawaal hai toh bejhijhak poochhein! 😊`;
    }
}

// ============================================================
// 🔍 AI STAGE DETECTION & INFO EXTRACTION
// ============================================================

/**
 * Detect lead's current stage by analyzing conversation.
 * Runs asynchronously after each message exchange (doesn't block reply).
 */
async function detectAndUpdateStage(lead) {
    const recentChat = lead.conversationLog
        .slice(-10)
        .map(m => `${m.role === 'user' ? 'Lead' : 'Advisor'}: ${m.text}`)
        .join('\n');

    if (!recentChat) return;

    const prompt = `Tu ek CRM stage detector hai. Neeche College Vidya advisor aur ek lead ke beech WhatsApp conversation hai. Lead ka CURRENT stage detect kar.

STAGES (sirf ek choose kar):
- NEW: Lead ne sirf "hi" ya general question bheja, koi personal info nahi di
- DISCOVERY: Advisor info gather kar raha hai lekin saari info nahi mili
- QUALIFIED: Saari info mil gayi (sector + location + qualification + percentage)
- PITCHED: Advisor ne specific university recommend kar di hai (Sanskriti/Kalinga/Lingaya's naam liya)
- INTERESTED: Lead ne fees, process, documents, enrollment ke baare mein actively poochha
- DOCS_PENDING: Lead ne agree kiya enroll karne ke liye, documents bhejne bole
- PAYMENT_PENDING: Documents submit, sirf payment baaki
- ENROLLED: Admission/payment complete

CURRENTLY KNOWN INFO:
- Naam: ${lead.naam || "unknown"} | Sector: ${lead.sector || "unknown"} | Location: ${lead.location || "unknown"}
- Qualification: ${lead.qualification || "unknown"} | %: ${lead.percentage || "unknown"}
- Recommended University: ${lead.recommendedUniv || "none"}

CONVERSATION:
${recentChat}

Sirf ek word mein stage likho (e.g., PITCHED). Koi explanation nahi:`;

    try {
        const completion = await groq.chat.completions.create({
            model: FAST_MODEL,
            messages: [{ role: 'system', content: prompt }],
            temperature: 0.1,
            max_tokens: 30,
        });

        const detectedStage = (completion.choices[0]?.message?.content || "").trim().toUpperCase().replace(/[^A-Z_]/g, '');

        if (VALID_STAGES.includes(detectedStage) && detectedStage !== lead.stage) {
            const oldStage = lead.stage;
            lead.stage = detectedStage;
            console.log(`📊 Stage updated: ${oldStage} → ${detectedStage} (${lead.naam || lead.phone})`);
        }
    } catch (error) {
        console.error(`⚠️ Stage detection error: ${error.message}`);
    }
}

/**
 * Extract lead's personal info from conversation using AI.
 * Runs asynchronously — updates lead profile with any new info found.
 */
async function extractLeadInfo(lead) {
    const recentChat = lead.conversationLog
        .slice(-10)
        .map(m => `${m.role === 'user' ? 'Lead' : 'Advisor'}: ${m.text}`)
        .join('\n');

    if (!recentChat) return;

    const prompt = `Neeche ek WhatsApp conversation hai. Lead ki personal information extract kar.
Sirf wahi fields bharo jo conversation mein CLEARLY mention hain. Baaki null likho.

CONVERSATION:
${recentChat}

STRICT JSON response (no explanation, no markdown):
{"naam":null,"sector":null,"location":null,"qualification":null,"percentage":null,"motivation":null,"recommendedUniv":null}

Rules:
- naam: Lead ka naam (string ya null)
- sector: "Government" ya "Private" ya null
- location: "city, state" format ya null
- qualification: "10th"/"12th"/"Diploma"/"Graduation"/"B.Tech"/"M.Tech" ya null
- percentage: number ya null (sirf number, % sign nahi)
- motivation: short string ya null
- recommendedUniv: Agar advisor ne koi university recommend ki toh "Sanskriti"/"Kalinga"/"Lingayas" ya null

JSON:`;

    try {
        const completion = await groq.chat.completions.create({
            model: FAST_MODEL,
            messages: [{ role: 'system', content: prompt }],
            temperature: 0.1,
            max_tokens: 150,
            response_format: { type: "json_object" }
        });

        let jsonStr = completion.choices[0]?.message?.content?.trim() || "{}";
        const info = JSON.parse(jsonStr);
        let updated = false;

        if (info.naam && info.naam !== "null" && info.naam !== null) { lead.naam = info.naam; updated = true; }
        if (info.sector && info.sector !== "null" && info.sector !== null) { lead.sector = info.sector; updated = true; }
        if (info.location && info.location !== "null" && info.location !== null) { lead.location = info.location; updated = true; }
        if (info.qualification && info.qualification !== "null" && info.qualification !== null) { lead.qualification = info.qualification; updated = true; }
        if (info.percentage && info.percentage !== "null" && info.percentage !== null) { lead.percentage = Number(info.percentage); updated = true; }
        if (info.motivation && info.motivation !== "null" && info.motivation !== null) { lead.motivation = info.motivation; updated = true; }
        if (info.recommendedUniv && info.recommendedUniv !== "null" && info.recommendedUniv !== null) { lead.recommendedUniv = info.recommendedUniv; updated = true; }

        if (updated) {
            console.log(`📋 Lead info extracted: ${lead.naam || '?'} | ${lead.sector || '?'} | ${lead.location || '?'} | ${lead.percentage || '?'}%`);
        }
    } catch (error) {
        if (!error.message.includes('JSON')) {
            console.error(`⚠️ Info extraction error: ${error.message}`);
        }
    }
}

// ============================================================
// 🚨 HUMAN ESCALATION
// ============================================================

/**
 * Send escalation alert to admin's personal WhatsApp.
 */
async function escalateToHuman(lead, sock) {
    const alert = `🚨 *ESCALATION ALERT* 🚨

Lead *${lead.naam || "Unknown"}* ko ${lead.followUpCount} follow-ups ke baad bhi response nahi aaya.

📋 *Lead Details:*
• Phone: ${lead.phone}
• Stage: ${lead.stage} → ${lead.ghostStage}
• Sector: ${lead.sector || "?"}
• Location: ${lead.location || "?"}
• Qualification: ${lead.qualification || "?"} (${lead.percentage || "?"}%)
• University: ${lead.recommendedUniv || "not recommended yet"}
• First Contact: ${new Date(lead.firstContactTime).toLocaleString('en-IN')}
• Last Active: ${new Date(lead.lastActiveTime).toLocaleString('en-IN')}
• Silent for: ${Math.round((Date.now() - lead.lastActiveTime) / HOUR)} hours

⚡ *Manual follow-up recommended.*`;

    try {
        await sock.sendMessage(ADMIN_NUMBER, { text: alert });
        lead.isEscalated = true;
        console.log(`🚨 ESCALATED to admin: ${lead.naam || lead.phone}`);
    } catch (error) {
        console.error(`⚠️ Escalation failed: ${error.message}`);
    }
}

// ============================================================
// 📊 DAILY SUMMARY REPORT (Har raat 9 PM)
// ============================================================

function startDailySummaryScheduler(sock) {
    setInterval(async () => {
        const now = new Date();
        // Trigger at 9:00 PM (21:00) — check within 5-min window
        if (now.getHours() === 21 && now.getMinutes() < 5) {
            await sendDailySummary(sock);
        }
    }, 5 * MINUTE);
    console.log('📊 Daily summary scheduler active (9 PM daily)');
}

async function sendDailySummary(sock) {
    let totalLeads = 0, activeLeads = 0, ghostLeads = 0, deadLeads = 0, enrolledLeads = 0;
    const stageCounts = {};

    for (const [, lead] of leadProfiles) {
        totalLeads++;
        if (lead.isDead) deadLeads++;
        else if (lead.stage === 'ENROLLED') enrolledLeads++;
        else if (lead.isGhost) ghostLeads++;
        else activeLeads++;

        stageCounts[lead.stage] = (stageCounts[lead.stage] || 0) + 1;
    }

    const stageBreakdown = Object.entries(stageCounts)
        .map(([stage, count]) => `  • ${stage}: ${count}`)
        .join('\n');

    const summary = `📊 *DAILY BOT SUMMARY* — ${new Date().toLocaleDateString('en-IN')}

👥 Total Leads: ${totalLeads}
✅ Active: ${activeLeads}
👻 Ghost (follow-up mein): ${ghostLeads}
💀 Dead (max follow-ups done): ${deadLeads}
🎓 Enrolled: ${enrolledLeads}

📈 *Stage Breakdown:*
${stageBreakdown || '  (no leads yet)'}

🤖 Bot uptime: ${Math.round(process.uptime() / 3600)}h ${Math.round((process.uptime() % 3600) / 60)}m`;

    try {
        await sock.sendMessage(ADMIN_NUMBER, { text: summary });
        console.log('📊 Daily summary sent to admin');
    } catch (error) {
        console.error(`⚠️ Daily summary failed: ${error.message}`);
    }
}

// ============================================================
// 🧹 SESSION CLEANUP (Memory management)
// ============================================================

function startCleanupScheduler() {
    setInterval(() => {
        const TWELVE_HOURS = 12 * HOUR;
        const now = Date.now();

        for (const [id, lead] of leadProfiles.entries()) {
            // Clean dead leads after 30 days
            if (lead.isDead && (now - lead.lastActiveTime) > 30 * DAY) {
                cancelAllFollowUps(id);
                leadProfiles.delete(id);
                userChats.delete(id);
                console.log(`🧹 Cleaned 30-day dead lead: ${lead.naam || id}`);
            }
        }

        // Clean orphan chat sessions (no lead profile)
        for (const [id] of userChats.entries()) {
            const lead = leadProfiles.get(id);
            if (lead && lead.isDead && (now - lead.lastActiveTime) > TWELVE_HOURS) {
                userChats.delete(id);
            }
        }
    }, 1 * HOUR); // Run every hour

    console.log('🧹 Cleanup scheduler active (hourly)');
}

// ============================================================
// 🤖 WHATSAPP BOT — MAIN FUNCTION
// ============================================================

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: ['Mac OS', 'Chrome', '103.0.5060.114'],
        syncFullHistory: false,
        generateHighQualityLinkPreview: true,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;
        if (qr) {
            console.log('\n📱 Is QR Code ko scan karein:\n');
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'close') {
            console.log('⚠️ Connection drop hua, 5 sec mein wapas connect...');
            setTimeout(() => startBot(), 5000);
        } else if (connection === 'open') {
            console.log('\n✅ College Vidya Advisor Bot ACTIVE hai! 🎓');
            console.log('   Follow-up Engine: ON');
            console.log('   Ghost Detection: ON');
            console.log('   Business Hours: 9 AM - 9 PM IST');
            console.log('   Admin Alerts: ' + ADMIN_NUMBER);
            console.log('');

            // Start background schedulers
            startDailySummaryScheduler(sock);
            startCleanupScheduler();
        }
    });

    // ============================================================
    // 📩 MESSAGE HANDLER — The Main Brain
    // ============================================================
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const textMessage =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            msg.message.imageMessage?.caption;

        if (!textMessage) return;

        const senderID = msg.key.remoteJid;

        // Skip admin's own messages (don't treat as lead)
        // (Admin can still message bot for testing — remove this if needed)

        // ========== STEP 1: LEAD MANAGEMENT ==========
        const lead = getOrCreateLead(senderID);

        // ========== STEP 2: CANCEL PENDING FOLLOW-UPS (Lead replied!) ==========
        cancelAllFollowUps(senderID);

        // ========== STEP 3: UPDATE TIMESTAMPS ==========
        lead.lastActiveTime = Date.now();

        // ========== STEP 4: LOG CONVERSATION ==========
        lead.conversationLog.push({
            role: 'user',
            text: textMessage,
            time: Date.now(),
            isFollowUp: false,
        });
        // Keep only last 20 messages
        if (lead.conversationLog.length > 20) {
            lead.conversationLog = lead.conversationLog.slice(-20);
        }

        console.log(`\n📩 Message from ${lead.naam || senderID}: "${textMessage}"`);
        console.log(`   Stage: ${lead.stage} | Ghost: ${lead.isGhost} | Follow-ups sent: ${lead.followUpCount}`);

        // ========== STEP 5: AI REPLY (Groq with Full History) ==========
        try {
            // Show typing
            await sock.presenceSubscribe(senderID);
            await sock.sendPresenceUpdate('composing', senderID);

            // Format message history for Groq — includes ALL past conversation turns
            const groqMessages = [
                { role: 'system', content: SYSTEM_INSTRUCTION },
                ...lead.conversationLog.map(m => ({
                    role: m.role === 'bot' ? 'assistant' : 'user',
                    content: m.text
                }))
            ];

            const completion = await groq.chat.completions.create({
                model: AI_MODEL,
                messages: groqMessages,
                temperature: 0.65,
                max_tokens: 600,
            });

            const advisorReply = completion.choices[0]?.message?.content || "";

            // Stop typing
            await sock.sendPresenceUpdate('paused', senderID);

            // Send reply
            await sock.sendMessage(senderID, { text: advisorReply });

            // Log bot reply to conversation history
            lead.conversationLog.push({
                role: 'bot',
                text: advisorReply,
                time: Date.now(),
                isFollowUp: false,
            });
            if (lead.conversationLog.length > 20) {
                lead.conversationLog = lead.conversationLog.slice(-20);
            }

            lead.lastBotReplyTime = Date.now();
            console.log(`   ✅ Reply sent: "${advisorReply.substring(0, 80)}..."`);

            // ========== STEP 6: BACKGROUND AI ANALYSIS (non-blocking) ==========
            Promise.allSettled([
                extractLeadInfo(lead),
                detectAndUpdateStage(lead),
            ]).then(() => {
                // ========== STEP 7: START GHOST DETECTION TIMER ==========
                startGhostDetection(senderID, sock);
            });

        } catch (error) {
            console.error(`   ⚠️ Groq Error: ${error.message}`);

            await sock.sendMessage(senderID, {
                text: '⚠️ Abhi technical issue aa raha hai. Main 1 minute mein wapas available hota hoon.'
            });
        }
    });
}

// ============================================================
// 🚀 START THE BOT
// ============================================================
console.log('🔄 College Vidya Advisor Bot starting...');
console.log('   Phase 1A: Follow-Up Engine + Ghost Detection + AI Analysis');
console.log('');
startBot();