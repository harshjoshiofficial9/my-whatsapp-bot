import readline from 'readline';
import { LeadDB } from './database.js';
import { processStudentTurn } from './conversationController.js';

const SIM_PHONE = '919999900000@s.whatsapp.net';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function resetSimLead() {
  LeadDB.upsert(SIM_PHONE, {
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
    opted_out: false,
    turn_count: 0,
    last_cta_turn: 0
  });
}

console.log('============================================================');
console.log('🎓 COLLEGE VIDYA COUNSELOR BOT — LOCAL CLI SIMULATOR');
console.log('Commands: /reset (new student) | /profile (inspect) | /exit');
console.log('============================================================\n');

resetSimLead();

function promptUser() {
  rl.question('\n👤 Student: ', async (input) => {
    const text = input.trim();
    if (!text) return promptUser();

    if (text === '/exit' || text === '/quit') {
      rl.close();
      process.exit(0);
    }

    if (text === '/reset') {
      resetSimLead();
      console.log('🔄 Simulator lead reset to fresh NEW student.');
      return promptUser();
    }

    if (text === '/profile') {
      console.log('\n📋 Current Lead Profile:', JSON.stringify(LeadDB.get(SIM_PHONE), null, 2));
      return promptUser();
    }

    LeadDB.addMessage(SIM_PHONE, 'user', text);
    const sentBubbles = [];
    const mockGetSock = () => ({
      readMessages: async () => {},
      presenceSubscribe: async () => {},
      sendPresenceUpdate: async () => {},
      sendMessage: async (_jid, content) => {
        sentBubbles.push(content.text);
        return { key: { id: `cli_${Date.now()}_${sentBubbles.length}` } };
      }
    });

    const res = await processStudentTurn({
      phone: SIM_PHONE,
      combinedText: text,
      incomingKeys: [],
      getSock: mockGetSock,
      sendOwnerAlertFn: async (_to, alertMsg) => {
        console.log(`\n🚨 [OWNER ALERT]:\n${alertMsg}\n`);
      },
      isGlobalAiPaused: false,
      skipDelays: true
    });

    console.log(`\n🤖 Harsh (Stage: ${res.lead?.stage} | Score: ${res.lead?.lead_score}/100):`);
    sentBubbles.forEach((b, idx) => {
      console.log(`  [Bubble ${idx + 1}]: ${b.replace(/\n/g, '\n               ')}`);
    });

    promptUser();
  });
}

promptUser();
