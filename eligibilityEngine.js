/**
 * PART 2.3 & PART 3 — DETERMINISTIC INTENT, ELIGIBILITY & STAGE ENGINE
 * "Empathy & Intent First, Eligibility Engine Second"
 * ZERO hardcoded Hinglish question templates. The LLM writes 100% of message text.
 */

const NCR_75KM_CITIES = new Set([
  'faridabad', 'delhi', 'new delhi', 'noida', 'greater noida', 'gurgaon',
  'gurugram', 'ghaziabad', 'palwal', 'ballabhgarh', 'sonipat', 'bahadurgarh',
  'ncr', 'delhi ncr', 'manesar', 'badarpur', 'okhla', 'saket', 'dwarka', 'rohini'
]);

const KNOWN_CITIES_OUTSIDE_NCR = [
  ['lucknow', 'Uttar Pradesh', 500],
  ['kanpur', 'Uttar Pradesh', 450],
  ['varanasi', 'Uttar Pradesh', 800],
  ['prayagraj', 'Uttar Pradesh', 650],
  ['allahabad', 'Uttar Pradesh', 650],
  ['agra', 'Uttar Pradesh', 180],
  ['mathura', 'Uttar Pradesh', 130],
  ['meerut', 'Uttar Pradesh', 90],
  ['gorakhpur', 'Uttar Pradesh', 750],
  ['bareilly', 'Uttar Pradesh', 250],
  ['pune', 'Maharashtra', 1400],
  ['mumbai', 'Maharashtra', 1400],
  ['nagpur', 'Maharashtra', 1000],
  ['nashik', 'Maharashtra', 1250],
  ['assam', 'Assam', 1900],
  ['guwahati', 'Assam', 1900],
  ['bihar', 'Bihar', 1000],
  ['patna', 'Bihar', 1000],
  ['gaya', 'Bihar', 1050],
  ['muzaffarpur', 'Bihar', 1000],
  ['jaipur', 'Rajasthan', 260],
  ['udaipur', 'Rajasthan', 650],
  ['jodhpur', 'Rajasthan', 580],
  ['kota', 'Rajasthan', 480],
  ['bhopal', 'Madhya Pradesh', 750],
  ['indore', 'Madhya Pradesh', 800],
  ['jabalpur', 'Madhya Pradesh', 800],
  ['gwalior', 'Madhya Pradesh', 300],
  ['raipur', 'Chhattisgarh', 1150],
  ['bhilai', 'Chhattisgarh', 1150],
  ['bilaspur', 'Chhattisgarh', 1100],
  ['ranchi', 'Jharkhand', 1150],
  ['jamshedpur', 'Jharkhand', 1250],
  ['dhanbad', 'Jharkhand', 1180],
  ['bhubaneswar', 'Odisha', 1550],
  ['cuttack', 'Odisha', 1550],
  ['hyderabad', 'Telangana', 1500],
  ['bangalore', 'Karnataka', 2100],
  ['bengaluru', 'Karnataka', 2100],
  ['chennai', 'Tamil Nadu', 2200],
  ['kolkata', 'West Bengal', 1450],
  ['ahmedabad', 'Gujarat', 920],
  ['surat', 'Gujarat', 1150],
  ['vadodara', 'Gujarat', 980],
  ['chandigarh', 'Chandigarh', 260],
  ['ludhiana', 'Punjab', 320],
  ['amritsar', 'Punjab', 460],
  ['dehradun', 'Uttarakhand', 250],
  ['haridwar', 'Uttarakhand', 220],
  ['shimla', 'Himachal Pradesh', 360],
  ['jammu', 'Jammu & Kashmir', 600],
  ['srinagar', 'Jammu & Kashmir', 800]
];

/**
 * Deterministically infer profile updates, primary intent, mood, declined programs,
 * and escalation flags from incoming student text BEFORE calling the LLM.
 */
export function inferFromUserText(text, currentProfile = {}) {
  const raw = String(text || '').trim();
  const lower = raw.toLowerCase();
  const updates = {};
  const declinedAdd = [];
  const objectionsAdd = [];

  const meta = {
    detected_intent: 'PROBING_ANSWER',
    conversation_mood: currentProfile.conversation_mood || 'neutral',
    intents: [],
    objections: [],
    declined_programs_add: [],
    needs_human: false,
    escalation_reason: null,
    requires_aicte: false,
    mentions_outside_online_btech: false,
    asks_comparison: false,
    asks_if_ai_bot: false
  };

  // 1. OPT_OUT_OR_EXIT check (catches "Mujhe kuch nahi chahiye thankyou!!", "STOP", "not interested", "mat bhejo", "wrong number")
  if (
    /^(stop|unsubscribe|quit|cancel|bye|goodbye)$/i.test(raw) ||
    /\b(kuch\s*nahi\s*chahiye|kuch\s*nhi\s*chahiye|nahi\s*chahiye\s*thank|mat\s*bhejo|msg\s*mat\s*karo|message\s*mat\s*karo|not\s*interested|interested\s*nahi|no\s*more\s*messages|dont\s*message|don't\s*message|wrong\s*number|galat\s*number|koi\s*requirement\s*nahi)\b/i.test(lower)
  ) {
    updates.opted_out = true;
    updates.stage = 'OPTED_OUT';
    updates.conversation_mood = 'exiting';
    meta.detected_intent = 'OPT_OUT_OR_EXIT';
    meta.conversation_mood = 'exiting';
    meta.intents.push('opt_out');
    return { updates, meta };
  }

  // 2. PURE GREETING check ("Hello", "Hyy", "Hi", "Hello\nHyy", "Namaste")
  const strippedGreeting = lower.replace(/[\s!.,?]+/g, ' ').trim();
  if (/^(hi+|hello+|hyy+|hey+|hlo+|namaste|namaskar|good\s*morning|good\s*evening|good\s*afternoon|ram\s*ram|salaam)(\s+(hi+|hello+|hyy+|hey+|hlo+|sir|bhai|ji|harsh))*$/i.test(strippedGreeting)) {
    meta.detected_intent = 'GREETING_ONLY';
    meta.conversation_mood = 'neutral';
    meta.intents.push('greeting');
    return { updates, meta };
  }

  // 3. IDENTITY_CHECK ("Ye sb ku puch rahe ho ho kaun tum?", "kaun ho tum", "tum AI bot ho kya?", "number kahan se mila")
  if (/\b(tum\s*(ai|bot|robot)\s*ho|are\s*you\s*(an?\s*)?(ai|bot)|chatbot\s*ho|ai\s*assistant\s*ho)\b/i.test(lower)) {
    meta.detected_intent = 'IDENTITY_CHECK';
    meta.asks_if_ai_bot = true;
    meta.conversation_mood = 'curious';
    meta.intents.push('identity_check');
  } else if (/\b(kaun\s*ho\s*tum|ho\s*kaun\s*tum|tum\s*kaun\s*ho|aap\s*kaun|who\s*are\s*you|ye\s*s[ab]+\s*ky?u+\s*puch|kyu\s*puch\s*rahe|number\s*kaha[n]?\s*se\s*mila|kisne\s*diya\s*number)\b/i.test(lower)) {
    meta.detected_intent = 'IDENTITY_CHECK';
    meta.conversation_mood = 'skeptical';
    updates.conversation_mood = 'skeptical';
    meta.intents.push('identity_check');
  }

  // 4. CONFUSION_OR_GLITCH ("Arre ky hogya?", "kya ho gaya", "repeat kyu kar rahe ho", "double message")
  if (/\b(arre\s*ky[a]?\s*ho\s*g[ay]+a|kya\s*ho\s*gaya|ky\s*hogya|repeat\s*kyu|baar\s*baar\s*same|double\s*msg|glitch)\b/i.test(lower)) {
    meta.detected_intent = 'CONFUSION_OR_GLITCH';
    meta.conversation_mood = 'annoyed';
    updates.conversation_mood = 'annoyed';
    meta.intents.push('confusion');
  }

  // 5. COURSE_REJECTION ("Arre mujhe nahi krna btech", "btech nahi karna", "engineering nahi karni")
  if (/\b(nahi\s*k[ar]+na\s*b\.?tech|nhi\s*k[ar]+na\s*b\.?tech|b\.?tech\s*nahi\s*k[ar]+n[ai]|b\.?tech\s*nhi\s*k[ar]+n[ai]|no\s*b\.?tech|dont\s*want\s*b\.?tech|engineering\s*nahi\s*karni|b\.?tech\s*me\s*interest\s*nahi)\b/i.test(lower)) {
    declinedAdd.push('BTECH_LE');
    meta.declined_programs_add.push('BTECH_LE');
    meta.detected_intent = 'COURSE_REJECTION';
    meta.conversation_mood = 'skeptical';
    meta.intents.push('course_rejection');
  }
  if (/\b(mba\s*nahi\s*k[ar]+na|nahi\s*k[ar]+na\s*mba)\b/i.test(lower)) {
    declinedAdd.push('ONLINE_MBA');
    meta.declined_programs_add.push('ONLINE_MBA');
    meta.detected_intent = 'COURSE_REJECTION';
  }
  if (/\b(bca\s*nahi\s*k[ar]+na|nahi\s*k[ar]+na\s*bca)\b/i.test(lower)) {
    declinedAdd.push('ONLINE_BCA');
    meta.declined_programs_add.push('ONLINE_BCA');
    meta.detected_intent = 'COURSE_REJECTION';
  }

  if (declinedAdd.length > 0) {
    const existingDeclined = Array.isArray(currentProfile.declined_programs) ? currentProfile.declined_programs : [];
    updates.declined_programs = Array.from(new Set([...existingDeclined, ...declinedAdd]));
  }

  // 6. ANGRY_OR_FRUSTRATED / Human Escalation check
  if (/\b(call\s*karo|call\s*me|call\s*krna|baat\s*karao|phone\s*karo|complaint|refund|fraud|cheating|court|legal\s*action|police|consumer\s*forum|gussa|angry|harass)\b/i.test(lower)) {
    meta.needs_human = true;
    meta.escalation_reason = 'Student requested call or raised serious complaint/concern';
    if (/\b(complaint|refund|fraud|cheating|court|legal|police|gussa|angry)\b/i.test(lower)) {
      meta.detected_intent = 'ANGRY_OR_FRUSTRATED';
      meta.conversation_mood = 'annoyed';
      updates.conversation_mood = 'annoyed';
    }
  }

  // 7. Qualification & Stream inference
  if (/\b(10th\s*only|sirf\s*10th|10vi\s*pass|matric\s*only)\b/i.test(lower)) {
    updates.qualification = '10TH';
  } else if (/\b(polytechnic|diploma)\b/i.test(lower)) {
    updates.qualification = 'DIPLOMA';
  } else if (/\b(b\.?tech|b\.?e\.?)\s*(pass|completed|grad|graduate|kiya|किया|done|holder|hai\s*mera|h\s*mera)\b/i.test(lower) || /\b(after\s*b\.?tech|m\.?tech\s*(krna|karna|karni|chahiye|admission|karun))\b/i.test(lower)) {
    updates.qualification = 'BTECH';
  } else if (/\b(b\.?sc)\s*(math|mathematics|pcm)\b/i.test(lower)) {
    updates.qualification = 'BSC_MATHS';
  } else if (/\b(b\.?com|b\.?a\b|bba|bca|b\.?sc|graduation|graduate)\b/i.test(lower) && !/\b(online\s*bca|online\s*bba|online\s*b\.?com|bca\s*karna|bba\s*karna)\b/i.test(lower)) {
    updates.qualification = 'OTHER_GRAD';
    if (/\b(b\.?com)\b/i.test(lower)) updates.stream_branch = 'Commerce';
    else if (/\b(bca)\b/i.test(lower)) updates.stream_branch = 'Computer Applications';
    else if (/\b(bba)\b/i.test(lower)) updates.stream_branch = 'Management';
  } else if (/\b(12th|12\s*th|inter|intermediate|10\+2|hsc|barahvi|12vi)\b/i.test(lower) && !/\b(12th\s*ke\s*baad\s*diploma|after\s*12th\s*diploma)\b/i.test(lower)) {
    if (!currentProfile.qualification || currentProfile.qualification.startsWith('12TH')) {
      if (/\b(science|pcm|pcb|math)\b/i.test(lower)) updates.qualification = '12TH_SCIENCE';
      else if (/\b(commerce|accounts)\b/i.test(lower)) updates.qualification = '12TH_COMMERCE';
      else if (/\b(arts|humanities)\b/i.test(lower)) updates.qualification = '12TH_ARTS';
      else updates.qualification = '12TH_SCIENCE';
    }
  }

  // Stream / Engineering branch inference
  const branchMatch = lower.match(/\b(civil|mechanical|mech|electrical|electronics|ece|cse|computer\s*science|it|information\s*technology|mining|automobile|production|chemical|instrumentation)\b/i);
  if (branchMatch) {
    const b = branchMatch[1].toLowerCase();
    const map = {
      mech: 'Mechanical', mechanical: 'Mechanical', civil: 'Civil',
      electrical: 'Electrical', electronics: 'ECE', ece: 'ECE',
      cse: 'CSE', 'computer science': 'CSE', it: 'IT',
      'information technology': 'IT', mining: 'Mining',
      automobile: 'Automobile', production: 'Mechanical',
      chemical: 'Chemical', instrumentation: 'Instrumentation'
    };
    updates.stream_branch = map[b] || branchMatch[1];
  }

  // 8. Employment & Sector inference
  if (/\b(job\s*nahi|not\s*working|unemployed|fresher|berozgar|abhi\s*job\s*nhi|no\s*job)\b/i.test(lower)) {
    updates.employed = false;
  } else if (/\b(psu|ntpc|bhel|ongc|sail|gail|iocl|hpcl|bpcl|nhpc|coal\s*india|bsnl|hal|bel|drdo)\b/i.test(lower)) {
    updates.employed = true;
    updates.employment_type = 'PSU';
  } else if (/\b(govt|government|sarkari|railway|railways|pwd|cpwd|metro|dmrc|army|navy|airforce|defence|police|mes|state\s*govt|central\s*govt|nhai|irrigation|electricity\s*board|uppcl)\b/i.test(lower)) {
    updates.employed = true;
    updates.employment_type = 'GOVT';
  } else if (/\b(private|pvt|mnc|l&t|tcs|infosys|wipro|hcl|tech\s*mahindra|tata|maruti|hero|honda|auto\s*parts|bosch|siemens|abb|jindal|adani|reliance|firm|factory|plant|production\s*job|contractor|company\s*me|company\s*mein|working\s*in\s*a\s*bank|bank)\b/i.test(lower)) {
    updates.employed = true;
    updates.employment_type = 'PRIVATE';
  } else if (/\b(job\s*ke\s*sath|job\s*ke\s*saath|working|job\s*karta|job\s*krta|job\s*kar\s*raha|job\s*kr\s*rha|naukri)\b/i.test(lower)) {
    if (currentProfile.employed === null || currentProfile.employed === undefined) {
      updates.employed = true;
    }
  }

  // Work experience years
  const expMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:saal|sal|yr|yrs|year|years)\s*(?:ka\s*|se\s*)?(?:exp|experience|job|kaam|production)/i);
  if (expMatch) {
    updates.work_experience_years = Number(expMatch[1]);
    updates.employed = true;
    if (!updates.employment_type && !currentProfile.employment_type && /\b(production|factory|plant|company|industry)\b/i.test(lower)) {
      updates.employment_type = 'PRIVATE';
    }
  }

  // 9. Percentage inference
  const pctMatch = lower.match(/\b(\d{2}(?:\.\d+)?)\s*(%|percent\b|percentage\b|marks\b|thi\b|the\b|hai\b|aaye\b|aayi\b)/i);
  if (pctMatch) {
    const val = Number(pctMatch[1]);
    if (val >= 30 && val <= 100) {
      updates.percentage = val;
    }
  } else if (/^\s*(\d{2}(?:\.\d+)?)\s*%?\s*$/.test(raw)) {
    const val = Number(raw.replace('%', '').trim());
    if (val >= 30 && val <= 100) {
      updates.percentage = val;
    }
  }

  // 10. Category inference
  if (/\b(obc|sc|st|reserved|ews|ebc)\b/i.test(lower)) {
    updates.category = 'RESERVED';
  } else if (/\b(general|gen|unreserved|open\s*category)\b/i.test(lower)) {
    updates.category = 'GEN';
  }

  // 11. City / State & Distance from Faridabad (75 km rule)
  for (const ncrCity of NCR_75KM_CITIES) {
    const regex = new RegExp(`\\b${ncrCity}\\b`, 'i');
    if (regex.test(lower)) {
      updates.city = ncrCity.replace(/\b\w/g, c => c.toUpperCase());
      updates.state = 'Delhi-NCR';
      updates.distance_km_from_campus = ncrCity === 'faridabad' ? 5 : 30;
      break;
    }
  }

  if (!updates.city) {
    for (const [cityKey, stateName, distKm] of KNOWN_CITIES_OUTSIDE_NCR) {
      const regex = new RegExp(`\\b${cityKey}\\b`, 'i');
      if (regex.test(lower)) {
        updates.city = cityKey.replace(/\b\w/g, c => c.toUpperCase());
        updates.state = stateName;
        updates.distance_km_from_campus = distKm;
        break;
      }
    }
  }

  // 12. Goal / Motivation & Preferred Program
  if (/\b(promotion|departmental\s*exam|je\s*se\s*ae|increment)\b/i.test(lower)) {
    updates.goal = 'promotion';
  } else if (/\b(salary|hike|package|better\s*job|ctc)\b/i.test(lower)) {
    updates.goal = 'salary hike';
  } else if (/\b(coding|software|it\s*field|tech\s*switch|developer)\b/i.test(lower)) {
    updates.goal = 'tech switch';
  } else if (/\b(management|manager|business)\b/i.test(lower)) {
    updates.goal = 'management';
  } else if (/\b(gulf|dubai|saudi|qatar|abroad)\b/i.test(lower)) {
    updates.goal = 'gulf / abroad career';
  } else if (/\b(govt\s*exam|upsc|ssc|psc)\b/i.test(lower)) {
    updates.goal = 'govt exam eligibility';
  }

  if (/\b(sasta|sasti|low\s*budget|kam\s*fee|affordable|tight\s*budget)\b/i.test(lower)) {
    updates.budget = 'low';
  }

  if (/\b(aicte)\b/i.test(lower)) {
    meta.requires_aicte = true;
    updates.preferred_mode = 'AICTE_REQUIRED';
  }

  // 13. Primary Intent Refinement (if not already overridden by GREETING / IDENTITY / CONFUSION / REJECTION / OPT_OUT)
  const isSpecialIntent = new Set(['GREETING_ONLY', 'IDENTITY_CHECK', 'CONFUSION_OR_GLITCH', 'COURSE_REJECTION', 'OPT_OUT_OR_EXIT', 'ANGRY_OR_FRUSTRATED']).has(meta.detected_intent);

  if (/\b(sanskriti\s*ya\s*kalinga|kalinga\s*ya\s*sanskriti|m\.?tech\s*karu[n]?\s*ya\s*mba|mba\s*ya\s*m\.?tech|kaunsi\s*best|kaunsa\s*best|kaunsi\s*better|kaunsa\s*acha|compare|comparison|difference|dono\s*me\s*se)\b/i.test(lower)) {
    meta.intents.push('comparison_query');
    meta.asks_comparison = true;
    if (!isSpecialIntent) meta.detected_intent = 'COMPARISON_REQUEST';
  }

  if (/\b(online\s*b\.?tech|distance\s*b\.?tech|mere\s*dost|25k\s*me|xyz|doosri\s*jagah|agent|kisi\s*aur\s*college)\b/i.test(lower)) {
    meta.intents.push('outside_comparison');
    meta.mentions_outside_online_btech = true;
    if (!isSpecialIntent) meta.detected_intent = 'COMPARISON_REQUEST';
  }

  if (/\b(fake|valid|validity|ugc|aicte\s*approved\s*hai|naac|aiu|recognized|scam|blacklisted)\b/i.test(lower)) {
    meta.intents.push('validity_query');
    if (!isSpecialIntent && !meta.asks_comparison) meta.detected_intent = 'VALIDITY_DOUBT';
  }

  if (/\b(fee|fees|cost|kharcha|kitna|kitni|price|emi|installment|per\s*sem|semester\s*fee)\b/i.test(lower)) {
    meta.intents.push('fee_query');
    if (!isSpecialIntent && meta.detected_intent === 'PROBING_ANSWER') meta.detected_intent = 'DIRECT_QUESTION';
  }

  if (/\b(fayda\s*hoga|future\s*kya|scope\s*kya|career\s*growth|vlsi|semiconductor|bim|revit|gulf|ev\s*sector)\b/i.test(lower)) {
    meta.intents.push('career_scope_query');
    if (!isSpecialIntent) meta.detected_intent = 'DIRECT_QUESTION';
  }

  if (/\b(document|documents|marksheet|aadhar|aadhaar|form|apply|enroll|admission\s*kaise|process\s*kya|checklist)\b/i.test(lower)) {
    meta.intents.push('admission_process');
    if (!isSpecialIntent) meta.detected_intent = 'READY_TO_PROCEED';
  }

  // Objections tracking
  if (/\b(mehnga|zyada\s*hai|budget\s*nahi|afford|costly|expensive)\b/i.test(lower)) {
    objectionsAdd.push('FEES_HIGH');
    if (!isSpecialIntent) meta.detected_intent = 'PRICE_OBJECTION';
  }
  if (/\b(time\s*nahi|time\s*nhi|shift|manage\s*kaise|busy)\b/i.test(lower)) {
    objectionsAdd.push('TIME_CONSTRAINT');
  }
  if (/\b(fake|doubt|dar\s*lagta|trust|valid\s*hai\s*kya)\b/i.test(lower)) {
    objectionsAdd.push('VALIDITY_DOUBT');
  }
  if (/\b(ghar\s*walo|parents|papa|family\s*se\s*pooch|soch\s*ke|sochke|baad\s*me)\b/i.test(lower)) {
    objectionsAdd.push('FAMILY_CONSULT');
    if (!isSpecialIntent) meta.detected_intent = 'HESITATION';
  }

  meta.objections = objectionsAdd;
  return { updates, meta };
}

/**
 * Section 3.1 — Deterministic Eligibility & Multi-Track Recommendation Engine
 * Returns ALL valid tracks (filtering out declined_programs), rejected tracks with reasons,
 * and semantic missing_info_optional (NO hardcoded Hinglish question strings!).
 */
export function evaluateEligibility(lead, kb, meta = {}) {
  const qual = (lead.qualification || '').toUpperCase();
  const empType = (lead.employment_type || '').toUpperCase(); // PRIVATE | GOVT | PSU
  const employed = lead.employed;
  const pct = lead.percentage !== null && lead.percentage !== undefined ? Number(lead.percentage) : null;
  const category = (lead.category || 'GEN').toUpperCase();
  const city = (lead.city || '').toLowerCase();
  const distKm = lead.distance_km_from_campus !== null && lead.distance_km_from_campus !== undefined
    ? Number(lead.distance_km_from_campus)
    : (city && NCR_75KM_CITIES.has(city) ? 30 : (city ? 500 : null));
  const needsAicte = meta.requires_aicte || lead.preferred_mode === 'AICTE_REQUIRED';
  const declined = new Set(Array.isArray(lead.declined_programs) ? lead.declined_programs : []);

  const eligible_programs = [];
  const recommended = [];
  const rejected = [];
  const missing_info = [];
  const already_known_fields = [];

  if (qual) already_known_fields.push(`qualification=${qual}${lead.stream_branch ? '(' + lead.stream_branch + ')' : ''}`);
  if (employed !== null && employed !== undefined) already_known_fields.push(`employed=${employed}`);
  if (empType) already_known_fields.push(`employment_type=${empType}`);
  if (pct !== null) already_known_fields.push(`percentage=${pct}%`);
  if (lead.city) already_known_fields.push(`city=${lead.city}`);
  if (lead.goal) already_known_fields.push(`goal=${lead.goal}`);
  if (lead.name) already_known_fields.push(`name=${lead.name}`);
  if (lead.work_experience_years) already_known_fields.push(`work_experience_years=${lead.work_experience_years}`);
  if (declined.size > 0) already_known_fields.push(`declined_programs=[${Array.from(declined).join(',')}]`);

  // Check if current turn intent should suppress probing
  const noProbeIntents = new Set([
    'GREETING_ONLY',
    'IDENTITY_CHECK',
    'CONFUSION_OR_GLITCH',
    'OPT_OUT_OR_EXIT',
    'ANGRY_OR_FRUSTRATED'
  ]);
  const suppressProbing = noProbeIntents.has(meta.detected_intent);

  const findUniv = (id) => (kb.universities || []).find(u => u.id === id);
  const sanskriti = findUniv('sanskriti');
  const kalinga = findUniv('kalinga');
  const lingayas = findUniv('lingayas');
  const cvOnline = findUniv('cv_online_partners');

  const onlineUgRecs = {
    university: cvOnline?.name || 'College Vidya Online University Partners (Manipal, Amity, Uttaranchal)',
    short_name: 'College Vidya Online Partners',
    program: lead.goal === 'management' ? 'Online BBA' : 'Online BCA / Online BBA / Online B.Com / Online BA',
    fee_range: '₹15,000–25,000/semester',
    mode: '100% Online (UGC-DEB Entitled, NAAC A+/A++)',
    approvals: 'UGC-DEB Entitled + NAAC A+/A++',
    why: '100% legal UGC-DEB online degree with flexible online exams (~₹15k–25k/sem) alongside job or exam prep.'
  };

  // STEP 1: Qualification unknown
  if (!qual) {
    missing_info.push('qualification');
    return {
      decision_status: 'NEED_INFO',
      eligible_programs,
      recommended,
      rejected,
      missing_info,
      next_missing_field: suppressProbing ? null : 'qualification',
      already_known_fields
    };
  }

  // CASE 0: 10TH PASS ONLY
  if (qual === '10TH') {
    rejected.push({
      program: 'Direct Undergraduate Degree (B.Tech / BCA / BBA)',
      reason: '10th pass students cannot directly enroll in a Bachelor degree. They must complete 12th (NIOS/State Board) or a 3-Year Polytechnic Diploma first.'
    });
    return {
      decision_status: 'NOT_ELIGIBLE',
      eligible_programs: ['3-Year Polytechnic Diploma or 12th (NIOS/State Board) first'],
      recommended: [],
      rejected,
      missing_info: [],
      next_missing_field: null,
      already_known_fields
    };
  }

  // CASE A: 12TH PASS (Science / Commerce / Arts)
  if (qual.startsWith('12TH')) {
    rejected.push({
      program: 'B.Tech for Working Professionals / Online B.Tech',
      reason: 'Under AICTE norms, direct B.Tech after 12th in working-professional or online mode is strictly NOT allowed (Working Professional B.Tech is Lateral Entry for 3-year Diploma holders only).'
    });

    eligible_programs.push(
      'Online BCA (3 Yrs, UGC-DEB, ~₹15,000–25,000/sem — Tech/IT/Coding track)',
      'Online BBA (3 Yrs, UGC-DEB, ~₹15,000–25,000/sem — Management/Corporate track)',
      'Online B.Com (3 Yrs, UGC-DEB, ~₹12,000–20,000/sem — Finance/Accounts track)',
      'Online BA (3 Yrs, UGC-DEB, ~₹10,000–18,000/sem — Govt Exams/UPSC/SSC track)'
    );

    recommended.push(onlineUgRecs);
    if (!lead.goal) missing_info.push('career_interest_track');

    return {
      decision_status: 'NOT_ELIGIBLE_FOR_BTECH_BUT_ALTERNATIVE_AVAILABLE',
      eligible_programs,
      recommended,
      rejected,
      missing_info,
      next_missing_field: suppressProbing ? null : (!lead.goal ? 'career_interest_track' : null),
      already_known_fields
    };
  }

  // CASE B: OTHER GRADUATE (BA / B.Com / BCA / BBA / B.Sc non-engineering)
  if (qual === 'OTHER_GRAD') {
    rejected.push({
      program: 'B.Tech Lateral Entry',
      reason: 'Non-engineering graduates (BA/B.Com/BBA/BCA) are eligible for PG degrees (Online MBA / Online MCA), not B.Tech Lateral Entry.'
    });

    eligible_programs.push(
      'Online MBA (2 Yrs, UGC-DEB, NAAC A+/A++, ~₹25,000–45,000/sem)',
      'Online MCA (2 Yrs, UGC-DEB, NAAC A+/A++, ~₹25,000–40,000/sem)'
    );

    const bestPg = lead.goal === 'tech switch' ? 'Online MCA' : 'Online MBA';
    recommended.push({
      university: cvOnline?.name || 'College Vidya Online University Partners (Manipal, Amity, Uttaranchal, D.Y. Patil)',
      short_name: 'College Vidya Online Partners',
      program: bestPg,
      fee_range: '₹25,000–45,000/semester',
      mode: '100% Online (UGC-DEB Entitled, NAAC A+/A++)',
      approvals: 'UGC-DEB + AICTE + NAAC A+/A++',
      why: 'Working graduates ke liye promotion, management leadership, ya IT switch ke liye top UGC-DEB approved PG degree.'
    });

    if (!lead.goal) missing_info.push('goal');

    return {
      decision_status: 'ELIGIBLE',
      eligible_programs,
      recommended,
      rejected,
      missing_info,
      next_missing_field: suppressProbing ? null : (!lead.goal ? 'goal' : null),
      already_known_fields
    };
  }

  // CASE C: 3-YEAR POLYTECHNIC DIPLOMA (or B.Sc Maths) OR B.TECH GRADUATE
  const isDiploma = qual === 'DIPLOMA' || qual === 'BSC_MATHS';
  const isBtech = qual === 'BTECH';

  // CRITICAL SECTION 3.1 FIX:
  // If Diploma holder explicitly declined B.Tech ("Arre mujhe nahi krna btech" -> declined.has('BTECH_LE')),
  // immediately switch primary recommendation to Track 2 (Online BCA / Online BBA / Online B.Com / Online BA — 12th equivalent)!
  if (isDiploma && declined.has('BTECH_LE')) {
    eligible_programs.push(
      'Online BCA (3 Yrs, UGC-DEB, ~₹15,000–25,000/sem — IT/Software/Coding switch)',
      'Online BBA (3 Yrs, UGC-DEB, ~₹15,000–25,000/sem — Management/Operations/Sales)',
      'Online B.Com / Online BA (3 Yrs, UGC-DEB, ~₹12,000–20,000/sem — Commerce / Govt Exams UPSC/SSC)'
    );
    recommended.push({
      ...onlineUgRecs,
      why: '3-Year Polytechnic Diploma 12th (10+2) equivalent hota hai — bina B.Tech kiye aap Online BCA (IT/Coding), Online BBA (Management), ya Online BA/B.Com (Govt exams) ke liye 100% eligible ho!'
    });

    if (!lead.goal) missing_info.push('career_interest_track');

    return {
      decision_status: 'ELIGIBLE',
      eligible_programs,
      recommended,
      rejected: [{ program: 'B.Tech Lateral Entry', reason: 'Declined by student — pivoted to 12th-equivalent Online UG tracks (BCA/BBA/B.Com/BA).' }],
      missing_info,
      next_missing_field: suppressProbing ? null : (!lead.goal ? 'career_interest_track' : null),
      already_known_fields
    };
  }

  const targetProgLabel = isBtech
    ? 'M.Tech for Working Professionals (2 Years)'
    : 'B.Tech Lateral Entry for Working Professionals (3 Years)';

  // Always include Track 2 alternative in eligible_programs for Diploma / B.Tech holders!
  const alternativeTrackLabel = isBtech
    ? 'Online MBA / Executive MBA (2 Yrs, UGC-DEB, ~₹25,000–45,000/sem — Management/Leadership track)'
    : 'Online BCA / Online BBA / Online B.Com / Online BA (3 Yrs, UGC-DEB, ~₹15,000–25,000/sem — 12th-equivalent Non-B.Tech track)';

  // If student is unemployed / fresher -> WP B.Tech/M.Tech requires job, so recommend Online UG/PG track!
  if (employed === false) {
    rejected.push({
      program: targetProgLabel,
      reason: 'Working Professional flexible-shift B.Tech/M.Tech requires active full-time employment.'
    });
    eligible_programs.push(alternativeTrackLabel);
    recommended.push({
      ...onlineUgRecs,
      program: isBtech ? 'Online MBA / Online MCA' : 'Online BCA / Online BBA / Regular Full-Time B.Tech',
      why: 'Working-professional B.Tech/M.Tech ke liye job zaroori hai, lekin UGC-DEB Online BCA/BBA/MBA bina job ke bhi 100% valid hai.'
    });
    return {
      decision_status: 'NOT_ELIGIBLE',
      eligible_programs,
      recommended,
      rejected,
      missing_info: [],
      next_missing_field: null,
      already_known_fields
    };
  }

  // Need employment_type (PRIVATE vs GOVT/PSU)
  if (!empType) {
    missing_info.push('employment_type');
    return {
      decision_status: 'NEED_INFO',
      eligible_programs: [targetProgLabel, alternativeTrackLabel],
      recommended: [],
      rejected: [],
      missing_info,
      next_missing_field: suppressProbing ? null : 'employment_type',
      already_known_fields
    };
  }

  // Need percentage
  if (pct === null) {
    missing_info.push('percentage');
    return {
      decision_status: 'NEED_INFO',
      eligible_programs: [targetProgLabel, alternativeTrackLabel],
      recommended: [],
      rejected: [],
      missing_info,
      next_missing_field: suppressProbing ? null : 'percentage',
      already_known_fields
    };
  }

  // SUBCASE C1: PRIVATE SECTOR EMPLOYEE
  if (empType === 'PRIVATE') {
    const minReq = category === 'RESERVED' ? 40 : 45;
    if (pct < 40) {
      rejected.push({
        program: targetProgLabel,
        reason: `Minimum aggregate required is 45% (40% for reserved category). Student has ${pct}%.`
      });
      eligible_programs.push(alternativeTrackLabel);
      recommended.push(onlineUgRecs);
      return {
        decision_status: 'NOT_ELIGIBLE',
        eligible_programs,
        recommended,
        rejected,
        missing_info: [],
        next_missing_field: null,
        already_known_fields
      };
    }

    if (pct >= 40 && pct < 45 && !lead.category) {
      missing_info.push('category');
      return {
        decision_status: 'NEED_INFO',
        eligible_programs: [targetProgLabel, alternativeTrackLabel],
        recommended: [],
        rejected: [],
        missing_info,
        next_missing_field: suppressProbing ? null : 'category',
        already_known_fields
      };
    }

    if (pct < minReq) {
      rejected.push({
        program: targetProgLabel,
        reason: `General category requires minimum 45% in Diploma (you have ${pct}%).`
      });
      eligible_programs.push(alternativeTrackLabel);
      recommended.push(onlineUgRecs);
      return {
        decision_status: 'NOT_ELIGIBLE',
        eligible_programs,
        recommended,
        rejected,
        missing_info: [],
        next_missing_field: null,
        already_known_fields
      };
    }

    // Eligible for Private Sector B.Tech LE / M.Tech WP + Alternative Track!
    eligible_programs.push(targetProgLabel, alternativeTrackLabel);

    const kalingaRec = {
      university: kalinga?.name || 'Kalinga University, Naya Raipur',
      short_name: 'Kalinga University',
      program: targetProgLabel,
      fee_range: '₹50,000–55,000/semester',
      mode: kalinga?.mode || 'Weekend / Flexible Timing',
      approvals: 'Directly AICTE Approved + UGC 2(f) & 12(B) + NIRF 101-150 + NAAC B+',
      why: 'Direct AICTE approval, UGC 12(B) status aur NIRF 101-150 ranking ke liye best Pan-India choice.'
    };

    const sanskritiRec = {
      university: sanskriti?.name || 'Sanskriti University, Mathura',
      short_name: 'Sanskriti University',
      program: targetProgLabel,
      fee_range: '₹45,000–50,000/semester',
      mode: sanskriti?.mode || 'Weekend / Flexible Shift',
      approvals: 'UGC 2(f) Recognized State Private University + NAAC B++ (2.95 CGPA) + AIU Member (Not AICTE approved; operates under UP State Act 2016)',
      why: 'Budget-friendly (~₹45k–50k/sem), NAAC B++ grade aur Pan-India flexible weekend batch ke liye best.'
    };

    if (needsAicte) {
      recommended.push(kalingaRec);
      rejected.push({
        program: 'Sanskriti University (for strict AICTE requirement)',
        reason: 'Sanskriti is a UGC 2(f) State Private University (not separately AICTE approved). For Direct AICTE approval, Kalinga University is the exact match.'
      });
    } else {
      recommended.push(sanskritiRec, kalingaRec);
    }

    if (!lead.goal) missing_info.push('goal');

    return {
      decision_status: 'ELIGIBLE',
      eligible_programs,
      recommended,
      rejected,
      missing_info,
      next_missing_field: suppressProbing ? null : (!lead.goal ? 'priority_budget_or_aicte' : null),
      already_known_fields
    };
  }

  // SUBCASE C2: GOVT / PSU EMPLOYEE
  if (empType === 'GOVT' || empType === 'PSU') {
    if (pct < 50) {
      rejected.push(
        {
          program: "Lingaya's Vidyapeeth B.Tech / M.Tech",
          reason: `Lingaya's Vidyapeeth (the only WP B.Tech option for Govt/PSU employees) strictly requires a flat minimum of 50% marks. Student has ${pct}%.`
        },
        { program: 'Sanskriti University', reason: 'Sanskriti University only accepts Private-sector employees.' },
        { program: 'Kalinga University', reason: 'Kalinga University only accepts Private-sector employees.' }
      );

      eligible_programs.push(alternativeTrackLabel);
      recommended.push({
        ...onlineUgRecs,
        program: isBtech ? 'Online MBA' : 'Online BCA / Online BBA / Online BA',
        why: `Govt/PSU employees ke liye Working Professional B.Tech sirf Lingaya's mein hota hai jahan minimum 50% mandatory hai (${pct}% par WP B.Tech possible nahi hai, par UGC-DEB Online UG/PG degree le sakte hain).`
      });

      return {
        decision_status: 'NOT_ELIGIBLE',
        eligible_programs,
        recommended,
        rejected,
        missing_info: [],
        next_missing_field: null,
        already_known_fields
      };
    }

    // Govt/PSU with >= 50% requires City / Location check (75 km from Faridabad rule)
    if (!lead.city) {
      missing_info.push('city');
      return {
        decision_status: 'NEED_INFO',
        eligible_programs: [targetProgLabel, alternativeTrackLabel],
        recommended: [],
        rejected: [
          { program: 'Sanskriti University', reason: 'Private-sector employees only.' },
          { program: 'Kalinga University', reason: 'Private-sector employees only.' }
        ],
        missing_info,
        next_missing_field: suppressProbing ? null : 'city_for_govt_75km_check',
        already_known_fields
      };
    }

    if (distKm !== null && distKm <= 75) {
      eligible_programs.push(targetProgLabel, alternativeTrackLabel);
      recommended.push({
        university: lingayas?.name || "Lingaya's Vidyapeeth, Faridabad (Delhi-NCR)",
        short_name: "Lingaya's Vidyapeeth",
        program: targetProgLabel,
        fee_range: '₹50,000–60,000/semester',
        mode: lingayas?.mode || 'Weekend / Evening Flexible Shift',
        approvals: 'UGC Section 3 Deemed-to-be University + Directly AICTE Approved + NAAC A+ + AIU Member',
        why: `Govt/PSU employees ke liye humari list mein akela 100% valid option, NAAC A+ grade, aur aapki location (${lead.city}) 75 km Faridabad NCR radius ke andar fit hai.`
      });

      return {
        decision_status: 'ELIGIBLE',
        eligible_programs,
        recommended,
        rejected: [
          { program: 'Sanskriti University', reason: 'Private-sector employees only.' },
          { program: 'Kalinga University', reason: 'Private-sector employees only.' }
        ],
        missing_info: [],
        next_missing_field: null,
        already_known_fields
      };
    } else {
      rejected.push(
        {
          program: "Lingaya's Vidyapeeth B.Tech / M.Tech",
          reason: `Lingaya's Vidyapeeth requires residence/workplace within 75 km of Faridabad (Delhi-NCR). Student is in ${lead.city} (~${distKm} km away), and Sanskriti/Kalinga only take private-sector employees.`
        },
        { program: 'Sanskriti University', reason: 'Private-sector employees only.' },
        { program: 'Kalinga University', reason: 'Private-sector employees only.' }
      );

      eligible_programs.push(alternativeTrackLabel);
      recommended.push({
        ...onlineUgRecs,
        program: isBtech ? 'Online MBA (UGC-DEB)' : 'Online BCA / Online BBA / Online BA (UGC-DEB) or Senior Counselor Callback',
        why: `Govt/PSU WP B.Tech mein Lingaya's ka 75 km Faridabad rule hai (${lead.city} se possible nahi), lekin general graduation promotion/exams ke liye UGC-DEB Online degree Pan-India valid hai.`
      });

      return {
        decision_status: 'NOT_ELIGIBLE_LOCATION_GOVT',
        eligible_programs,
        recommended,
        rejected,
        missing_info: [],
        next_missing_field: null,
        already_known_fields
      };
    }
  }

  return {
    decision_status: 'NEED_INFO',
    eligible_programs,
    recommended,
    rejected,
    missing_info,
    next_missing_field: null,
    already_known_fields
  };
}

/**
 * Section 2.3 — Stage State Machine & Lead Score Calculator
 * Note: "Hello" keeps stage at NEW — never jumps to QUALIFYING until student indicates interest or answers probing!
 */
export function computeStageAndScore(lead, eligibilityResult, meta = {}) {
  if (lead.opted_out || meta.detected_intent === 'OPT_OUT_OR_EXIT' || meta.intents?.includes('opt_out')) {
    return { stage: 'OPTED_OUT', lead_score: 0 };
  }

  if (lead.ai_mode === 'HUMAN') {
    return { stage: 'HUMAN_HANDLING', lead_score: Math.max(lead.lead_score || 50, 70) };
  }

  const currentStage = lead.stage || 'NEW';
  if (['ENROLLED', 'PAYMENT_PENDING', 'DOCS_PENDING'].includes(currentStage)) {
    const score = currentStage === 'ENROLLED' ? 100 : currentStage === 'PAYMENT_PENDING' ? 95 : 85;
    return { stage: currentStage, lead_score: score };
  }

  // Keep stage at NEW on pure greeting, identity check, or confusion if no qualification is known yet
  if (['GREETING_ONLY', 'IDENTITY_CHECK', 'CONFUSION_OR_GLITCH'].includes(meta.detected_intent) && !lead.qualification) {
    return { stage: currentStage === 'NEW' ? 'NEW' : 'ENGAGED', lead_score: Math.max(lead.lead_score || 10, 15) };
  }

  let nextStage = currentStage;
  const status = eligibilityResult.decision_status;

  if (status === 'NOT_ELIGIBLE' || status === 'NOT_ELIGIBLE_LOCATION_GOVT' || status === 'NOT_ELIGIBLE_FOR_BTECH_BUT_ALTERNATIVE_AVAILABLE') {
    nextStage = 'NOT_ELIGIBLE';
  } else if (status === 'NEED_INFO') {
    nextStage = lead.qualification || meta.intents?.length > 0 ? 'QUALIFYING' : 'ENGAGED';
  } else if (status === 'ELIGIBLE') {
    if (meta.detected_intent === 'READY_TO_PROCEED' || meta.intents?.includes('admission_process')) {
      nextStage = 'DOCS_PENDING';
    } else if (
      meta.detected_intent === 'COMPARISON_REQUEST' ||
      meta.detected_intent === 'PRICE_OBJECTION' ||
      meta.detected_intent === 'VALIDITY_DOUBT' ||
      meta.intents?.includes('fee_query') ||
      ['PITCHED', 'WARM', 'INTERESTED'].includes(currentStage)
    ) {
      nextStage = ['NEW', 'ENGAGED', 'QUALIFYING', 'DISCOVERY'].includes(currentStage) ? 'PITCHED' : 'WARM';
    } else {
      nextStage = 'PITCHED';
    }
  }

  let score = 15;
  if (lead.qualification) score += 15;
  if (lead.employment_type) score += 15;
  if (lead.percentage) score += 10;
  if (status === 'ELIGIBLE') score += 20;
  if (status.startsWith('NOT_ELIGIBLE')) score = Math.min(score, 35);
  if (meta.intents?.includes('fee_query')) score += 10;
  if (meta.intents?.includes('validity_query') || meta.intents?.includes('comparison_query')) score += 10;
  if (meta.intents?.includes('admission_process')) score += 20;
  if (nextStage === 'WARM') score = Math.max(score, 75);
  if (nextStage === 'DOCS_PENDING') score = Math.max(score, 85);
  if (nextStage === 'PAYMENT_PENDING') score = Math.max(score, 95);
  score = Math.min(100, Math.max(0, score));

  return { stage: nextStage, lead_score: score };
}
