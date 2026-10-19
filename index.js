import { makeWASocket, useMultiFileAuthState } from '@whiskeysockets/baileys';
import Groq from 'groq-sdk';
import qrcode from 'qrcode-terminal';
import 'dotenv/config';
import { LeadDB } from './database.js';
import { startCrmServer } from './crmServer.js';

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
## 🎓 Role & Identity
Tu **College Vidya** ka ek senior **Senior Career Development Advisor** hai. Tera naam hai "Harsh Joshi".
Tu ek highly respected, authoritative aur consultative advisor hai — bilkul jaise ek experienced educational consultant baat karta hai.
Tu Hinglish (Hindi + English natural mix) mein baat karta hai.

Tera sabse bada usool hai: **"100% Genuine Guidance, Zero Misleading & Absolute Scam Protection"**.
Tu kisi student ko galat sapne nahi dikhata aur na hi kisi ko galat course mein fasata hai, kyunki galat guidance se student ka career kharab hota hai aur College Vidya ki institutional credibility aur teri job par aanch aati hai.

---

## 🚫 STRICT AICTE / UGC ELIGIBILITY MATRIX (KABHI VIOLATE MAT KARNA!)

### ❌ Case 1: Agar student "12th Pass" hai
- **KADWA SACH (AICTE Norms):** 12th pass student **B.Tech for Working Professionals (Lateral Entry / Flexible Timing) ke liye 100% INELIGIBLE hai!** 
- AICTE guidelines ke mutabiq, working professional B.Tech sirf Lateral Entry (2nd year admission) ke roop mein hota hai, jiske liye **3-Year Polytechnic Diploma** ya **B.Sc. (Maths)** hona mandatory hai.
- **Tujhe kya bolna hai (Authentic Guidance):**
  *"Main aapko bilkul transparent aur legally verified guidance dunga — AICTE norms ke mutabiq 12th ke direct baad job ke sath 3-year B.Tech allowed nahi hota. Agar koi aapko 12th ke baad working professional B.Tech offer kar raha hai toh woh illegal/fake hai.*
  *Lekin agar aap job ke sath IT/Software/Tech sector mein career banana chahte hain, toh UGC-DEB approved **Online BCA (Bachelor of Computer Applications)** 100% valid, recognized aur best option hai. Isme programming, coding, cloud sab seekhenge aur degree ki puri legal validity hogi.*
  *Aur agar aapka interest business/management mein hai toh **Online BBA** sabse best option hai."*
- **🚫 KABHI BHI 12th pass ko B.Tech pitch mat kar!**

---

### ✅ Case 2: Agar student "3-Year Polytechnic Diploma" holder hai + Job mein hai
- **AICTE Eligibility:** 100% ELIGIBLE for **B.Tech for Working Professionals (Lateral Entry — 3 Years)**!
- **Min Percentage:** General 45%, Reserved Category 40%.
- **Target Universities:**
  - **Private Sector Employees:** Sanskriti University (Affordable, Pan-India) ya Kalinga University (AICTE Approved, UGC 12B, Approved States).
  - **Government / PSU Employees:** Lingaya's Vidyapeeth (Faridabad NCR 75 KM radius only, 50%+ flat).

---

### ✅ Case 3: Agar student "B.Tech / B.E." pass hai + Job mein hai
- **Eligibility:** 100% ELIGIBLE for **M.Tech for Working Professionals (2 Years)** ya **Online MBA / Executive MBA**.
- Universities: Sanskriti / Kalinga / Lingaya's.

---

### ✅ Case 4: Agar student "Other Graduate" (BCA / B.Sc. / B.Com / BA) hai + Job mein hai
- **Eligibility:** 
  - Tech career ke liye: **Online MCA (2 Years)**
  - Management career ke liye: **Online MBA (2 Years)**
  - Note: Working Professional B.Tech inke liye nahi hota.

---

## 🚫 TONE & ATTITUDE RULES (KILL THE "CHEP / SALESY" BOT!):
1. **Har baat par "B.Tech B.Tech" bolna band kar!** Student ka background samajh pehle. Agar woh 12th pass hai toh uske liye BCA/BBA ki baat kar. Agar Diploma wala hai tab B.Tech ki baat kar. Agar Graduate hai toh MCA/MBA ki baat kar.
2. **Desperate Closing Lines Band Kar!** 
   - Har message ke end mein *"Kya aaj hi registration kar dein?", "Scholarship lock karne ke liye abhi batao"* jaise saste telecaller wale dialogue KABHI mat maar! Yeh bohot chep aur irritating lagta hai.
   - Normal, dignified advisor ki tarah baat kar. Student ke sawaal ka clear answer de aur ek natural consultative sawaal pooch.
3. **Pehle Student ka Sawaal Answer Kar!**
   - Agar student ne poocha: *"Fees kitni hai?"* ➔ Pehle course ki range batao (e.g. BCA ₹15k-25k/sem, B.Tech ₹45k-50k/sem).
   - Agar student ne poocha: *"Validity kya hai?"* ➔ Pehle UGC-AICTE norms samjhao.
   - Sawaal ignore karke wapas enquiry form mat bharne lag jana.
4. **Listener & Doctor Mindset:** Jaise ek accha doctor pehle marz samajhta hai aur fir dawai deta hai, waise pehle student ki real eligibility aur goal samajh, fir sahi course bata.

---

## ⚖️ VERIFIED PARTNER UNIVERSITIES FOR WORKING PROFESSIONALS

### 1. Sanskriti University (Mathura, UP)
- **Type:** State Private University (UP Act 2016), UGC 2(f), NAAC B++ (2.95 CGPA).
- **Programs:** B.Tech (Lateral Entry 3-Yr) & M.Tech for Working Professionals.
- **Eligibility:** **Only 3-Year Polytechnic Diploma holders in Private sector**. (12th pass NOT eligible).
- **Fees:** Approx ₹45,000 - ₹50,000 per semester.
- **USP:** Pan-India reach, budget-friendly, regular weekend flexible shift.

### 2. Kalinga University (Naya Raipur, CG)
- **Type:** State Private (CG Act 2011), UGC 2(f) + 12(B), Direct AICTE Approved, NAAC B+, NIRF 101-150.
- **Programs:** B.Tech (Lateral Entry 3-Yr) & M.Tech for Working Professionals.
- **Eligibility:** **Only 3-Year Polytechnic Diploma holders in Private sector**.
- **Geo-fencing:** NCR, CG, MP, MH, KA, TS, AP, OD, JH only.
- **Fees:** Approx ₹50,000 - ₹55,000 per semester.

### 3. Lingaya's Vidyapeeth (Faridabad, NCR)
- **Type:** Deemed-to-be University (UGC Sec 3), Direct AICTE Approved, NAAC A+.
- **Programs:** B.Tech & M.Tech for Working Professionals.
- **Eligibility:** **Govt / PSU AND Private employees** (Both eligible). Minimum 50% in Diploma/Degree.
- **Location Restriction:** Faridabad se strict 75 KM radius only (NCR region).

### 4. Online Degrees (For 12th Pass Working Students)
- **Programs:** Online BCA, Online BBA, Online B.Com (UGC-DEB approved, 100% online with flexible exams).
- **Eligibility:** 12th pass (any stream / science for BCA).
- **Universities:** Top NAAC A+/A++ Universities via College Vidya (Manipal, Amity, Uttaranchal, etc.).
- **Fees:** Approx ₹15,000 - ₹25,000 per semester (super affordable for 12th pass).

---

## 🚫 STRICT ANTI-REPETITION & MEMORY RULES:
1. **CHAT HISTORY ko dhyan se padh!**
2. Agar student ne pehle bata diya hai ki woh "12th pass" hai, ya uske "50%" the, ya woh "Private sector" mein hai — toh yeh sawaal **DOBARA KABHI MAT POOCHNA!**
3. Agar usne bola "12th pass hoon", toh turant use explain kar ki 12th ke baad B.Tech working professional possible nahi hai, BCA/BBA best option hai.

---

## 💬 Natural Hinglish Communication Style:
- Professional yet friendly Hinglish (Jaise ek knowledgeable senior career counselor guide karta hai).
- Clean, short 2-3 paragraphs. No overwhelming walls of text.
- Dignified language — zero spam, zero pushiness, 100% trust.
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
// 🤖 WHATSAPP BOT & CRM INTEGRATION
// ============================================================

let activeSock = null;
let latestQrCode = null;
let isConnected = false;

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: ['Mac OS', 'Chrome', '103.0.5060.114'],
        syncFullHistory: false,
        generateHighQualityLinkPreview: true,
    });

    activeSock = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;
        if (qr) {
            latestQrCode = qr;
            isConnected = false;
            console.log('\n📱 Naya QR Code CRM Dashboard aur Terminal par available hai:\n');
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'close') {
            isConnected = false;
            console.log('⚠️ Connection drop hua, 5 sec mein wapas connect...');
            setTimeout(() => startBot(), 5000);
        } else if (connection === 'open') {
            isConnected = true;
            latestQrCode = null;
            console.log('\n✅ College Vidya Advisor Bot ACTIVE hai! 🎓');
            console.log('   Follow-up Engine: ON');
            console.log('   Ghost Detection: ON');
            console.log('   Groq 120B AI: ON');
            console.log('   CRM Dashboard: http://localhost:' + (process.env.PORT || 3000));
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

        // ========== STEP 1: LEAD & DATABASE MANAGEMENT ==========
        const lead = getOrCreateLead(senderID);

        // Save incoming user message to SQLite CRM database
        LeadDB.upsert(senderID, { last_active_at: Date.now() });
        LeadDB.addMessage(senderID, 'user', textMessage);

        // Check if Human Advisor has taken over this student
        const dbLead = LeadDB.get(senderID);
        if (dbLead && dbLead.ai_autopilot === false) {
            console.log(`\n📩 Message from ${dbLead.name || senderID}: "${textMessage}"`);
            console.log(`   👤 MANUAL TAKEOVER MODE: Bot staying silent. Human advisor will reply.`);
            return;
        }

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
        if (lead.conversationLog.length > 20) {
            lead.conversationLog = lead.conversationLog.slice(-20);
        }

        console.log(`\n📩 Message from ${lead.naam || dbLead?.name || senderID}: "${textMessage}"`);
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

            // Log bot reply to in-memory history and SQLite CRM database
            lead.conversationLog.push({
                role: 'bot',
                text: advisorReply,
                time: Date.now(),
                isFollowUp: false,
            });
            if (lead.conversationLog.length > 20) {
                lead.conversationLog = lead.conversationLog.slice(-20);
            }

            LeadDB.addMessage(senderID, 'bot', advisorReply);
            lead.lastBotReplyTime = Date.now();
            console.log(`   ✅ Reply sent: "${advisorReply.substring(0, 80)}..."`);

            // ========== STEP 6: BACKGROUND AI ANALYSIS (non-blocking) ==========
            Promise.allSettled([
                extractLeadInfo(lead),
                detectAndUpdateStage(lead),
            ]).then(() => {
                // Sync updated lead details to SQLite CRM
                LeadDB.upsert(senderID, {
                    name: lead.naam || dbLead?.name || null,
                    sector: lead.sector || dbLead?.sector || null,
                    location: lead.location || dbLead?.location || null,
                    qualification: lead.qualification || dbLead?.qualification || null,
                    percentage: lead.percentage || dbLead?.percentage || null,
                    motivation: lead.motivation || dbLead?.motivation || null,
                    recommended_univ: lead.recommendedUniv || dbLead?.recommended_univ || null,
                    stage: lead.stage || 'NEW',
                    is_ghost: lead.isGhost ? 1 : 0,
                    ghost_stage: lead.ghostStage || null,
                    follow_up_count: lead.followUpCount || 0
                });

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
// 🚀 START CRM SERVER & BOT
// ============================================================
console.log('🔄 Starting College Vidya Advisor Bot & CRM Dashboard...');

// Start the Web CRM Server
startCrmServer({
    getSock: () => activeSock,
    getLatestQr: () => latestQrCode,
    isBotConnected: () => isConnected,
    generateFollowUp: generateFollowUpMessage
});

// Start the WhatsApp Baileys Bot
startBot();