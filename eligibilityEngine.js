/**
 * PHASE 2 & 3 — DETERMINISTIC ELIGIBILITY, INFERENCE, PROBING & STAGE ENGINE
 * The LLM NEVER decides eligibility on its own. Code computes eligibility,
 * missing fields, single next question topic, stage transitions, and lead score.
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
 * Deterministically infer profile fields, intents, objections, and escalation flags
 * from incoming student text BEFORE calling the LLM.
 */
export function inferFromUserText(text, currentProfile = {}) {
  const raw = String(text || '').trim();
  const lower = raw.toLowerCase();
  const updates = {};
  const meta = {
    intents: [],
    objections: [],
    needs_human: false,
    escalation_reason: null,
    requires_aicte: false,
    mentions_outside_online_btech: false,
    asks_comparison: false
  };

  // 1. Opt-out check (strict word/phrase match)
  if (
    /^(stop|unsubscribe|quit|cancel)$/i.test(raw) ||
    /\b(mat bhejo|msg mat karo|message mat karo|not interested|interested nahi|no more messages|dont message|don't message|block)\b/i.test(lower)
  ) {
    updates.opted_out = true;
    updates.stage = 'OPTED_OUT';
    meta.intents.push('opt_out');
    return { updates, meta };
  }

  // 2. Human escalation / complaint / call requests
  if (/\b(call karo|call me|call krna|baat karao|phone karo|number do|complaint|refund|fraud|cheating|court|legal action|police|consumer forum|gussa|angry)\b/i.test(lower)) {
    meta.needs_human = true;
    meta.escalation_reason = 'Student requested call or raised serious complaint/concern';
  }

  // 3. Qualification & Stream inference
  if (/\b(polytechnic|diploma)\b/i.test(lower)) {
    updates.qualification = 'DIPLOMA';
  } else if (/\b(b\.?tech|b\.?e\.?)\s*(pass|completed|grad|graduate|kiya|किया|done|holder|hai mera|h mera)\b/i.test(lower) || /\b(after b\.?tech|m\.?tech\s*(krna|karna|karni|chahiye|admission))\b/i.test(lower)) {
    updates.qualification = 'BTECH';
  } else if (/\b(b\.?sc)\s*(math|mathematics|pcm)\b/i.test(lower)) {
    updates.qualification = 'BSC_MATHS';
  } else if (/\b(b\.?com|b\.?a\b|bba|bca|b\.?sc|graduation|graduate)\b/i.test(lower) && !/\b(karna|krna|karni|chahiye|admission)\b/i.test(lower)) {
    updates.qualification = 'OTHER_GRAD';
  } else if (/\b(b\.?com)\b/i.test(lower) && /\b(kiya|pass|grad|completed|done|hai)\b/i.test(lower)) {
    updates.qualification = 'OTHER_GRAD';
    updates.stream_branch = 'Commerce';
  } else if (/\b(12th|12\s*th|inter|intermediate|10\+2|hsc|barahvi|12vi)\b/i.test(lower) && !/\b(12th ke baad diploma|after 12th diploma)\b/i.test(lower)) {
    if (!currentProfile.qualification || currentProfile.qualification.startsWith('12TH')) {
      if (/\b(science|pcm|pcb|math)\b/i.test(lower)) updates.qualification = '12TH_SCIENCE';
      else if (/\b(commerce|accounts)\b/i.test(lower)) updates.qualification = '12TH_COMMERCE';
      else if (/\b(arts|humanities)\b/i.test(lower)) updates.qualification = '12TH_ARTS';
      else updates.qualification = '12TH_SCIENCE';
    }
  }

  // Direct answer to "12th ke baad Diploma kiya hai ya direct job?"
  if (!updates.qualification && currentProfile.qualification === '12TH_SCIENCE') {
    if (/\b(diploma)\b/i.test(lower)) updates.qualification = 'DIPLOMA';
  }

  // Stream / Engineering branch inference
  const branchMatch = lower.match(/\b(civil|mechanical|mech|electrical|electronics|ece|cse|computer science|it|information technology|mining|automobile|chemical)\b/i);
  if (branchMatch) {
    const b = branchMatch[1].toLowerCase();
    const map = {
      mech: 'Mechanical', mechanical: 'Mechanical', civil: 'Civil',
      electrical: 'Electrical', electronics: 'ECE', ece: 'ECE',
      cse: 'CSE', 'computer science': 'CSE', it: 'IT',
      'information technology': 'IT', mining: 'Mining',
      automobile: 'Automobile', chemical: 'Chemical'
    };
    updates.stream_branch = map[b] || branchMatch[1];
  }

  // 4. Employment & Sector inference
  if (/\b(job nahi|not working|unemployed|fresher|berozgar|abhi job nhi|no job)\b/i.test(lower)) {
    updates.employed = false;
  } else if (/\b(psu|ntpc|bhel|ongc|sail|gail|iocl|hpcl|bpcl|nhpc|coal india|bsnl|hal|bel|drdo)\b/i.test(lower)) {
    updates.employed = true;
    updates.employment_type = 'PSU';
  } else if (/\b(govt|government|sarkari|railway|railways|pwd|cpwd|metro|dmrc|army|navy|airforce|defence|police|mes|state govt|central govt|nhai|irrigation|electricity board|uppcl)\b/i.test(lower)) {
    updates.employed = true;
    updates.employment_type = 'GOVT';
  } else if (/\b(private|pvt|mnc|l&t|tcs|infosys|wipro|hcl|tech mahindra|tata|maruti|hero|honda|auto parts|bosch|siemens|abb|jindal|adani|reliance|azienda|firm|factory|plant|contractor|company me|company mein)\b/i.test(lower)) {
    updates.employed = true;
    updates.employment_type = 'PRIVATE';
  } else if (/\b(job ke sath|job ke saath|working|job karta|job krta|job kar raha|naukri)\b/i.test(lower)) {
    if (currentProfile.employed === null || currentProfile.employed === undefined) {
      updates.employed = true;
    }
  }

  // Work experience years
  const expMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:saal|sal|yr|yrs|year|years)\s*(?:ka\s*)?(?:exp|experience|se job|se kaam)/i);
  if (expMatch) {
    updates.work_experience_years = Number(expMatch[1]);
    updates.employed = true;
  }

  // 5. Percentage inference
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

  // 6. Category inference
  if (/\b(obc|sc|st|reserved|ews|ebc)\b/i.test(lower)) {
    updates.category = 'RESERVED';
  } else if (/\b(general|gen|unreserved|open category)\b/i.test(lower)) {
    updates.category = 'GEN';
  }

  // 7. City / State & Distance from Faridabad (75 km rule)
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

  // 8. Goal / Motivation & Budget / AICTE preferences
  if (/\b(promotion|departmental exam|je se ae|increment)\b/i.test(lower)) {
    updates.goal = 'promotion';
  } else if (/\b(salary|hike|package|better job)\b/i.test(lower)) {
    updates.goal = 'salary hike';
  } else if (/\b(coding|software|it field|tech switch|developer)\b/i.test(lower)) {
    updates.goal = 'tech switch';
  } else if (/\b(management|manager|business)\b/i.test(lower)) {
    updates.goal = 'management';
  }

  if (/\b(sasta|sasti|low budget|kam fee|affordable|tight budget)\b/i.test(lower)) {
    updates.budget = 'low';
  }

  if (/\b(aicte)\b/i.test(lower)) {
    meta.requires_aicte = true;
    updates.preferred_mode = 'AICTE_REQUIRED';
  }

  // 9. Intents & Objections
  if (/\b(fee|fees|cost|kharcha|kitna|kitni|price|emi|installment|per sem|semester fee)\b/i.test(lower)) {
    meta.intents.push('fee_query');
  }
  if (/\b(fake|valid|validity|ugc|aicte|naac|aiu|recognized|approved|scam|blacklisted|govt job me valid)\b/i.test(lower)) {
    meta.intents.push('validity_query');
  }
  if (/\b(sanskriti ya kalinga|kalinga ya sanskriti|kaunsi best|kaunsa best|kaunsi better|kaunsa acha|compare|comparison|difference|dono me se)\b/i.test(lower)) {
    meta.intents.push('comparison_query');
    meta.asks_comparison = true;
  }
  if (/\b(online b\.?tech|distance b\.?tech|mere dost|xyz|doosri jagah|agent|kisi aur college)\b/i.test(lower)) {
    meta.intents.push('outside_comparison');
    meta.mentions_outside_online_btech = true;
  }
  if (/\b(document|documents|marksheet|aadhar|aadhaar|form|apply|enroll|admission kaise|process kya|checklist)\b/i.test(lower)) {
    meta.intents.push('admission_process');
  }

  // Objections tracking
  if (/\b(mehnga|zyada hai|budget nahi|afford|costly|expensive)\b/i.test(lower)) {
    meta.objections.push('FEES_HIGH');
  }
  if (/\b(time nahi|time nhi|shift|manage kaise|busy)\b/i.test(lower)) {
    meta.objections.push('TIME_CONSTRAINT');
  }
  if (/\b(fake|doubt|dar lagta|trust|valid hai kya)\b/i.test(lower)) {
    meta.objections.push('VALIDITY_DOUBT');
  }
  if (/\b(ghar walo|parents|papa|family se pooch|soch ke|sochke|baad me)\b/i.test(lower)) {
    meta.objections.push('FAMILY_CONSULT');
  }

  return { updates, meta };
}

/**
 * Evaluate deterministic eligibility & recommendations against Knowledge Base.
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

  const eligible_programs = [];
  const recommended = [];
  const rejected = [];
  const missing_info = [];
  const already_known_fields = [];

  // Populate already_known_fields so the LLM is strictly forbidden from re-asking them
  if (qual) already_known_fields.push(`qualification (${qual}${lead.stream_branch ? ' - ' + lead.stream_branch : ''})`);
  if (employed !== null && employed !== undefined) already_known_fields.push(`employed (${employed ? 'Yes' : 'No'})`);
  if (empType) already_known_fields.push(`employment_type (${empType})`);
  if (pct !== null) already_known_fields.push(`percentage (${pct}%)`);
  if (lead.city) already_known_fields.push(`city/location (${lead.city})`);
  if (lead.goal) already_known_fields.push(`goal/motivation (${lead.goal})`);
  if (lead.name) already_known_fields.push(`name (${lead.name})`);
  if (lead.work_experience_years) already_known_fields.push(`work_experience (${lead.work_experience_years} yrs)`);

  // Find universities in KB
  const findUniv = (id) => (kb.universities || []).find(u => u.id === id);
  const sanskriti = findUniv('sanskriti');
  const kalinga = findUniv('kalinga');
  const lingayas = findUniv('lingayas');
  const cvOnline = findUniv('cv_online_partners');

  // STEP 1: Check if qualification is known
  if (!qual) {
    missing_info.push('qualification');
    return {
      decision_status: 'NEED_INFO',
      eligible_programs,
      recommended,
      rejected,
      missing_info,
      next_missing_field: 'qualification (12th pass, 3-yr Polytechnic Diploma, ya Graduation?)',
      already_known_fields
    };
  }

  // CASE A: 12TH PASS (Science / Commerce / Arts)
  if (qual.startsWith('12TH')) {
    rejected.push({
      program: 'B.Tech for Working Professionals (Lateral Entry)',
      reason: 'AICTE rules strictly require a 3-Year Polytechnic Diploma or B.Sc. (Maths) for Working Professional B.Tech Lateral Entry. 12th pass students cannot directly enroll in working-professional B.Tech.'
    });

    eligible_programs.push(
      'Online BCA (UGC-DEB Entitled, 3 Years, ₹15,000–25,000/sem)',
      'Online BBA (UGC-DEB Entitled, 3 Years, ₹15,000–25,000/sem)',
      'Online B.Com (UGC-DEB Entitled, 3 Years, ₹12,000–20,000/sem)'
    );

    const bestProg = lead.goal === 'management' ? 'Online BBA' : 'Online BCA';
    recommended.push({
      university: cvOnline?.name || 'College Vidya Online University Partners (Manipal, Amity, Uttaranchal)',
      short_name: 'College Vidya Online Partners',
      program: bestProg,
      fee_range: '₹15,000–25,000/semester',
      mode: '100% Online (UGC-DEB Approved)',
      why: '12th ke baad job ke saath 100% legal, UGC-DEB approved degree without quitting your job.'
    });

    if (!lead.goal) {
      missing_info.push('goal');
    }

    return {
      decision_status: 'NOT_ELIGIBLE_FOR_BTECH_BUT_ALTERNATIVE_AVAILABLE',
      eligible_programs,
      recommended,
      rejected,
      missing_info,
      next_missing_field: !lead.goal ? 'career interest (IT/Coding side jaana hai ya Business/Management side?)' : null,
      already_known_fields
    };
  }

  // CASE B: OTHER GRADUATE (BA / B.Com / BCA / BBA / B.Sc non-engineering)
  if (qual === 'OTHER_GRAD') {
    rejected.push({
      program: 'B.Tech / M.Tech for Working Professionals',
      reason: 'Non-engineering graduates (BA/B.Com/BBA/BCA) are eligible for PG programs like Online MCA or Online MBA, not B.Tech Lateral Entry.'
    });

    eligible_programs.push(
      'Online MBA (UGC-DEB Approved, 2 Years, ₹25,000–45,000/sem)',
      'Online MCA (UGC-DEB Approved, 2 Years, ₹25,000–40,000/sem)'
    );

    const bestPg = lead.goal === 'tech switch' ? 'Online MCA' : 'Online MBA';
    recommended.push({
      university: cvOnline?.name || 'College Vidya Online University Partners (Manipal, Amity, D.Y. Patil)',
      short_name: 'College Vidya Online Partners',
      program: bestPg,
      fee_range: '₹25,000–45,000/semester',
      mode: '100% Online (UGC-DEB Approved)',
      why: 'Graduation ke baad job ke saath promotion aur career growth ke liye best UGC-approved PG degree.'
    });

    return {
      decision_status: 'ELIGIBLE',
      eligible_programs,
      recommended,
      rejected,
      missing_info: !lead.goal ? ['goal'] : [],
      next_missing_field: !lead.goal ? 'career track (Technical/IT role ke liye MCA dekhna hai ya Management/Promotion ke liye MBA?)' : null,
      already_known_fields
    };
  }

  // CASE C: 3-YEAR POLYTECHNIC DIPLOMA (or B.Sc Maths) OR B.TECH GRADUATE
  const isDiploma = qual === 'DIPLOMA' || qual === 'BSC_MATHS';
  const isBtech = qual === 'BTECH';
  const targetProgCode = isBtech ? 'MTECH_WP' : 'BTECH_LE';
  const targetProgLabel = isBtech
    ? 'M.Tech for Working Professionals (2 Years)'
    : 'B.Tech Lateral Entry for Working Professionals (3 Years)';

  // Check employment status
  if (employed === false) {
    rejected.push({
      program: targetProgLabel,
      reason: 'Working Professional flexible-shift B.Tech/M.Tech requires active employment experience.'
    });
    eligible_programs.push('Online BCA / Online MCA / Regular Full-Time Campus Programs');
    return {
      decision_status: 'NOT_ELIGIBLE',
      eligible_programs,
      recommended: [{
        university: 'College Vidya Online Partners',
        short_name: 'CV Online Partners',
        program: isBtech ? 'Online MBA' : 'Online BCA / Regular Full-Time B.Tech',
        fee_range: '₹15,000–35,000/semester',
        mode: 'Online / Regular',
        why: 'Working professional flexible-shift B.Tech/M.Tech ke liye job experience zaroori hota hai.'
      }],
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
      eligible_programs: [targetProgLabel],
      recommended: [],
      rejected: [],
      missing_info,
      next_missing_field: 'employment_type (Abhi aapki job Private company mein hai ya Government/PSU sector mein?)',
      already_known_fields
    };
  }

  // Need percentage
  if (pct === null) {
    missing_info.push('percentage');
    return {
      decision_status: 'NEED_INFO',
      eligible_programs: [targetProgLabel],
      recommended: [],
      rejected: [],
      missing_info,
      next_missing_field: `percentage (${isBtech ? 'B.Tech' : 'Diploma'} mein aapki aggregate percentage kitni thi, roughly?)`,
      already_known_fields
    };
  }

  // SUBCASE C1: PRIVATE SECTOR EMPLOYEE
  if (empType === 'PRIVATE') {
    // Notice: We NEVER ask city/location for PRIVATE sector employees because Sanskriti & Kalinga are both Pan-India!
    // Check if percentage is between 40 and 44.9 and category wasn't explicitly specified
    const minReq = category === 'RESERVED' ? 40 : 45;
    if (pct < 40) {
      rejected.push({
        program: targetProgLabel,
        reason: `Minimum aggregate required is 45% (40% for reserved category). Student has ${pct}%.`
      });
      return {
        decision_status: 'NOT_ELIGIBLE',
        eligible_programs: ['Online BCA / Online BBA (where eligible)'],
        recommended: [],
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
        eligible_programs: [targetProgLabel],
        recommended: [],
        rejected: [],
        missing_info,
        next_missing_field: 'category (40–45% ke beech reserved category relaxation lagta hai — aap General category se ho ya OBC/SC/ST?)',
        already_known_fields
      };
    }

    if (pct < minReq) {
      rejected.push({
        program: targetProgLabel,
        reason: `General category requires minimum 45% in Diploma (you have ${pct}%).`
      });
      return {
        decision_status: 'NOT_ELIGIBLE',
        eligible_programs: ['Online BCA / Online BBA'],
        recommended: [],
        rejected,
        missing_info: [],
        next_missing_field: null,
        already_known_fields
      };
    }

    // Eligible for Private Sector B.Tech LE / M.Tech WP!
    eligible_programs.push(targetProgLabel);
    if (isBtech) {
      eligible_programs.push('Online MBA / Executive MBA');
    }

    const kalingaRec = {
      university: kalinga?.name || 'Kalinga University, Naya Raipur',
      short_name: 'Kalinga University',
      program: targetProgLabel,
      fee_range: '₹50,000–55,000/semester',
      mode: kalinga?.mode || 'Weekend / Flexible Timing',
      approvals: 'Directly AICTE Approved + UGC 2(f) & 12(B) + NIRF 101-150 + NAAC B+',
      why: 'Direct AICTE approval, UGC 12(B) status aur NIRF ranking chahiye toh Kalinga best choice hai (Pan-India valid).'
    };

    const sanskritiRec = {
      university: sanskriti?.name || 'Sanskriti University, Mathura',
      short_name: 'Sanskriti University',
      program: targetProgLabel,
      fee_range: '₹45,000–50,000/semester',
      mode: sanskriti?.mode || 'Weekend / Flexible Shift',
      approvals: 'UGC 2(f) Recognized State Private University + NAAC B++ (2.95 CGPA) + AIU Member (Not AICTE approved; operates under UP State University Act)',
      why: 'Budget-friendly (~₹45k–50k/sem), NAAC B++ grade aur Pan-India flexible weekend batch ke liye best.'
    };

    if (needsAicte) {
      recommended.push(kalingaRec);
      rejected.push({
        program: 'Sanskriti University (for AICTE-mandated requirement)',
        reason: 'Sanskriti is a UGC 2(f) State Private University (not separately AICTE approved). Since student explicitly asked for AICTE approval, Kalinga University is the exact match.'
      });
    } else if (lead.budget === 'low') {
      recommended.push(sanskritiRec, kalingaRec);
    } else {
      recommended.push(sanskritiRec, kalingaRec);
    }

    return {
      decision_status: 'ELIGIBLE',
      eligible_programs,
      recommended,
      rejected,
      missing_info: !lead.goal ? ['goal'] : [],
      next_missing_field: !lead.goal ? 'goal (Yeh degree aap mainly promotion ke liye kar rahe ho ya job switch / salary hike ke liye?)' : null,
      already_known_fields
    };
  }

  // SUBCASE C2: GOVT / PSU EMPLOYEE
  if (empType === 'GOVT' || empType === 'PSU') {
    // Check Lingaya's flat 50% rule first
    if (pct < 50) {
      rejected.push(
        {
          program: "Lingaya's Vidyapeeth B.Tech / M.Tech",
          reason: `Lingaya's Vidyapeeth (the only option for Govt/PSU employees) strictly requires a flat minimum of 50% marks (no reserved category relaxation). Student has ${pct}%.`
        },
        { program: 'Sanskriti University', reason: 'Sanskriti University only accepts Private-sector employees.' },
        { program: 'Kalinga University', reason: 'Kalinga University only accepts Private-sector employees.' }
      );

      return {
        decision_status: 'NOT_ELIGIBLE',
        eligible_programs: ['Online BCA / Online BBA / Online MBA (UGC-DEB approved)'],
        recommended: [{
          university: 'College Vidya Online Partners',
          short_name: 'CV Online Partners',
          program: isBtech ? 'Online MBA' : 'Online BCA / BBA',
          fee_range: '₹15,000–30,000/semester',
          mode: '100% Online (UGC-DEB)',
          why: `Govt/PSU employees ke liye B.Tech LE sirf Lingaya's mein hota hai jahan minimum 50% mandatory hai (${pct}% par B.Tech LE possible nahi hai).`
        }],
        rejected,
        missing_info: [],
        next_missing_field: null,
        already_known_fields
      };
    }

    // For Govt/PSU with >= 50%, we MUST check City / Location (75 km from Faridabad rule)
    if (!lead.city) {
      missing_info.push('city');
      return {
        decision_status: 'NEED_INFO',
        eligible_programs: [targetProgLabel],
        recommended: [],
        rejected,
        missing_info,
        next_missing_field: "city/location (Govt/PSU employees ke liye Lingaya's Vidyapeeth Faridabad 75 km NCR radius mein allow karta hai — abhi aapki posting/residence kis city mein hai?)",
        already_known_fields
      };
    }

    // Check if within 75 km of Faridabad
    if (distKm !== null && distKm <= 75) {
      eligible_programs.push(targetProgLabel);
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
        rejected,
        missing_info: [],
        next_missing_field: null,
        already_known_fields
      };
    } else {
      // Govt employee outside 75 km radius -> Honestly inform no WP B.Tech option right now + flag human callback
      rejected.push({
        program: "Lingaya's Vidyapeeth B.Tech / M.Tech",
        reason: `Lingaya's Vidyapeeth requires residence/workplace within 75 km of Faridabad (Delhi-NCR). Student is in ${lead.city} (~${distKm} km away), and Sanskriti/Kalinga only take private-sector employees.`
      });

      return {
        decision_status: 'NOT_ELIGIBLE_LOCATION_GOVT',
        eligible_programs: ['Online BCA / Online BBA / Online MBA (UGC-DEB Entitled) or Senior Counselor Callback'],
        recommended: [],
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
 * Deterministic Stage Transition & Lead Score Calculator (Phase 3)
 */
export function computeStageAndScore(lead, eligibilityResult, meta = {}) {
  if (lead.opted_out || meta.intents?.includes('opt_out')) {
    return { stage: 'OPTED_OUT', lead_score: 0, stage_goal: 'Politely close conversation and confirm no further messages will be sent.' };
  }

  if (lead.ai_mode === 'HUMAN') {
    return { stage: 'HUMAN_HANDLING', lead_score: Math.max(lead.lead_score || 50, 70), stage_goal: 'Human advisor is handling this student.' };
  }

  const currentStage = lead.stage || 'NEW';
  // Sticky terminal/advanced stages unless explicitly changed
  if (['ENROLLED', 'PAYMENT_PENDING', 'DOCS_PENDING'].includes(currentStage)) {
    const score = currentStage === 'ENROLLED' ? 100 : currentStage === 'PAYMENT_PENDING' ? 95 : 85;
    return {
      stage: currentStage,
      lead_score: score,
      stage_goal: getStageGoal(currentStage)
    };
  }

  let nextStage = currentStage;
  const status = eligibilityResult.decision_status;

  if (status === 'NOT_ELIGIBLE' || status === 'NOT_ELIGIBLE_LOCATION_GOVT' || status === 'NOT_ELIGIBLE_FOR_BTECH_BUT_ALTERNATIVE_AVAILABLE') {
    nextStage = 'NOT_ELIGIBLE';
  } else if (status === 'NEED_INFO') {
    nextStage = (lead.turn_count || 0) <= 1 && !lead.qualification ? 'NEW' : 'QUALIFYING';
  } else if (status === 'ELIGIBLE') {
    if (meta.intents?.includes('admission_process')) {
      nextStage = 'DOCS_PENDING';
    } else if (meta.intents?.includes('fee_query') || meta.intents?.includes('comparison_query') || meta.intents?.includes('validity_query') || currentStage === 'PITCHED' || currentStage === 'WARM' || currentStage === 'INTERESTED') {
      nextStage = currentStage === 'NEW' || currentStage === 'QUALIFYING' || currentStage === 'DISCOVERY' ? 'PITCHED' : 'WARM';
    } else {
      nextStage = 'PITCHED';
    }
  }

  // Calculate Lead Score (0–100)
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

  return {
    stage: nextStage,
    lead_score: score,
    stage_goal: getStageGoal(nextStage, eligibilityResult)
  };
}

export function getStageGoal(stage, eligibilityResult = null) {
  switch (stage) {
    case 'NEW':
      return 'Warm, short human greeting. Acknowledge what the student wants and ask ONLY the single next missing question (qualification). No university pitching yet.';
    case 'QUALIFYING':
    case 'DISCOVERY':
      return `Collect the single next missing info naturally: ${eligibilityResult?.next_missing_field || 'next qualification detail'}. Acknowledge their previous answer, add 1 line of helpful insight/teaser, and ask ONLY ONE question at the end.`;
    case 'PITCHED':
      return 'Eligibility is now confirmed! Recommend the 1 best-fit partner university (max 2) tied to their profile, explain why it fits in short bullets/lines, and end with one soft micro-commitment question (e.g., "Fee structure detail mein bhej doon?").';
    case 'WARM':
    case 'INTERESTED':
      return 'Answer their fee, validity, or comparison question clearly using ONLY KB facts. Handle objections empathetically and ask one soft micro-commitment question toward documentschecklist or form help.';
    case 'DOCS_PENDING':
      return 'Share the required documents checklist clearly and ask them to send their marksheet/Aadhaar photo here to verify eligibility.';
    case 'PAYMENT_PENDING':
      return 'Guide them that fee payment happens 100% directly on the official university portal (scam protection) and offer step-by-step form/portal assistance.';
    case 'NOT_ELIGIBLE':
      return 'Be 100% honest and transparent about why they are not eligible for that program under AICTE/university rules. Immediately recommend the best legal alternative from our KB (e.g., Online BCA/BBA for 12th pass, or human callback for Govt outside 75 km) and ask one soft question.';
    case 'OPTED_OUT':
      return 'Politely respect their request, wish them the best, and do NOT ask any question.';
    default:
      return 'Assist the student genuinely like a senior counselor with one question max.';
  }
}
