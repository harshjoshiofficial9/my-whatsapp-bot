import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage
} from '@whiskeysockets/baileys';
import fs from 'fs';
import path from 'path';
import qrcode from 'qrcode-terminal';
import dotenv from 'dotenv';
dotenv.config({ override: true });

import { LeadDB, STORAGE_PATHS, db } from './database.js';
import { startCrmServer } from './crmServer.js';
import {
  handleIncomingMessage,
  sendSingleBubbleWithRetry,
  sendMultiBubbleHumanTurn,
  flushOutboundQueue
} from './conversationController.js';
import { transcribeVoiceNote } from './llmBrain.js';
import {
  OWNER_NUMBER,
  MINUTE,
  HOUR,
  isBusinessHoursIST,
  getISTParts,
  runGhostAndFollowUpTick,
  buildDailyReportText,
  handleOwnerCommand
} from './followupEngine.js';

// ============================================================
// 🌐 GLOBAL STATE (Single Socket Instance & Watchdog)
// ============================================================
let activeSock = null;
let latestQrCode = null;
let connectionStatus = 'RECONNECTING'; // CONNECTED | RECONNECTING | LOGGED_OUT
let lastConnectedAt = null;
let lastDisconnectedAt = Date.now();
let reconnectAttempts = 0;
let reconnectTimer = null;
let isStartingSocket = false;
let globalAiPaused = false;
let lastDailyReportDateIST = null;

const DEBOUNCE_MS = Number(process.env.DEBOUNCE_MS || 7000);

function getSock() {
  return connectionStatus === 'CONNECTED' ? activeSock : null;
}

function getConnectionInfo() {
  return {
    status: connectionStatus,
    qr: latestQrCode,
    lastConnectedAt
  };
}

export async function sendRawWhatsAppMessage(jid, text, options = {}) {
  const norm = LeadDB.normalizePhoneJid(jid);
  const role = options.asHuman ? 'human' : 'bot';
  if (options.asHuman) {
    LeadDB.upsert(norm, { ai_mode: 'HUMAN', human_until: Date.now() + 12 * HOUR });
    LeadDB.cancelFollowUpJobs(norm);
  }
  return sendSingleBubbleWithRetry({
    jid: norm,
    text,
    getSock,
    isFollowUp: false,
    role
  });
}

function resolveAndMapSenderJid(msg) {
  const remoteJid = msg.key?.remoteJid || '';
  const senderPn = msg.key?.senderPn || msg.key?.participantPn || msg.participant || null;

  if (remoteJid.endsWith('@lid') && senderPn && senderPn.includes('@s.whatsapp.net')) {
    LeadDB.mapLidToPhone(remoteJid, senderPn);
  } else if (senderPn && senderPn.endsWith('@lid') && remoteJid.includes('@s.whatsapp.net')) {
    LeadDB.mapLidToPhone(senderPn, remoteJid);
  }

  return LeadDB.normalizePhoneJid(remoteJid);
}

function isIgnoredJid(jid) {
  if (!jid) return true;
  return (
    jid === 'status@broadcast' ||
    jid.endsWith('@g.us') ||
    jid.endsWith('@broadcast') ||
    jid.endsWith('@newsletter')
  );
}

// ============================================================
// 🤖 BAILEYS SOCKET MANAGER (Single Instance + Anti-Ban)
// ============================================================
export async function startBot() {
  if (isStartingSocket) return;
  isStartingSocket = true;

  try {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    if (activeSock) {
      try {
        activeSock.ev.removeAllListeners();
        activeSock.ws?.close();
      } catch { /* ignore */ }
      activeSock = null;
    }

    const { state, saveCreds } = await useMultiFileAuthState(STORAGE_PATHS.authDir);

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      browser: ['Mac OS', 'Chrome', '120.0.0'],
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      getMessage: async (key) => {
        return LeadDB.getRawMessageByWaId(key?.id) || { conversation: '' };
      }
    });

    activeSock = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('contacts.upsert', (contacts) => {
      for (const c of contacts || []) {
        if (c.lid && c.id && c.id.endsWith('@s.whatsapp.net')) {
          LeadDB.mapLidToPhone(c.lid, c.id);
        }
      }
    });

    sock.ev.on('messages.update', (updates) => {
      for (const u of updates || []) {
        const msgId = u.key?.id;
        const st = u.update?.status;
        if (!msgId || !st) continue;
        if (st === 3 || st === 'DELIVERY_ACK') {
          LeadDB.updateMessageStatus(msgId, 'DELIVERED');
        } else if (st === 4 || st === 5 || st === 'READ' || st === 'PLAYED') {
          LeadDB.updateMessageStatus(msgId, 'READ');
        }
      }
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        latestQrCode = qr;
        connectionStatus = 'RECONNECTING';
        console.log('\n📱 Scan QR Code on CRM Dashboard or Terminal:\n');
        qrcode.generate(qr, { small: true });
      }

      if (connection === 'open') {
        connectionStatus = 'CONNECTED';
        latestQrCode = null;
        lastConnectedAt = Date.now();
        reconnectAttempts = 0;

        console.log('\n✅ College Vidya Counselor Bot & CRM ACTIVE! 🎓');
        console.log(`   Storage DB:    ${STORAGE_PATHS.dbPath}`);
        console.log(`   Auth Dir:      ${STORAGE_PATHS.authDir}`);
        console.log(`   Knowledge Dir: ${STORAGE_PATHS.knowledgeDir}`);
        console.log(`   Locked LLM:    ${process.env.LLM_MODEL || 'openai/gpt-oss-120b'}\n`);

        const flushed = await flushOutboundQueue({ getSock });
        if (flushed > 0) {
          console.log(`📬 Flushed ${flushed} queued outbound messages after reconnect.`);
        }
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut;
        lastDisconnectedAt = Date.now();

        if (isLoggedOut) {
          connectionStatus = 'LOGGED_OUT';
          latestQrCode = null;
          console.warn('⚠️ Previous WhatsApp session expired/logged out. Clearing stale auth files and generating a fresh QR Code in 3s...');
          try {
            const files = fs.readdirSync(STORAGE_PATHS.authDir);
            for (const f of files) {
              if (f.endsWith('.json')) {
                fs.unlinkSync(path.join(STORAGE_PATHS.authDir, f));
              }
            }
          } catch (err) {
            console.warn('⚠️ Error clearing stale auth files:', err.message);
          }
          reconnectTimer = setTimeout(() => {
            startBot();
          }, 3000);
          return;
        }

        connectionStatus = 'RECONNECTING';
        reconnectAttempts++;
        const delayMs = Math.min(60000, Math.pow(2, Math.min(reconnectAttempts, 5)) * 2500);
        console.warn(`⚠️ WhatsApp connection closed (code: ${statusCode || 'unknown'}). Reconnecting in ${Math.round(delayMs / 1000)}s (attempt #${reconnectAttempts})...`);

        reconnectTimer = setTimeout(() => {
          startBot();
        }, delayMs);
      }
    });

    // ============================================================
    // 📩 INCOMING & OUTGOING MESSAGE HANDLER
    // ============================================================
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages || []) {
        if (!msg?.message || !msg?.key) continue;

        const rawRemoteJid = msg.key.remoteJid;
        if (isIgnoredJid(rawRemoteJid)) continue;

        if (
          msg.message.protocolMessage ||
          msg.message.reactionMessage ||
          msg.message.keepInChatMessage ||
          msg.message.pollUpdateMessage
        ) {
          continue;
        }

        const msgId = msg.key.id;
        const senderJid = resolveAndMapSenderJid(msg);
        const textContent = (
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          msg.message.imageMessage?.caption ||
          msg.message.documentMessage?.caption ||
          ''
        ).trim();

        const botOwnJid = sock.user?.id ? LeadDB.normalizePhoneJid(sock.user.id) : null;
        const isOwnerSender = senderJid === OWNER_NUMBER || (botOwnJid && senderJid === botOwnJid);

        // 1. Handle Owner Commands (/report, /hot, /lead, /takeover, /release, /pause, /resume, /say)
        if (textContent.startsWith('/') && (isOwnerSender || msg.key.fromMe)) {
          if (msgId && LeadDB.isMessageProcessed(msgId)) continue;
          if (msgId) LeadDB.markMessageProcessed(msgId);
          await handleOwnerCommand({
            text: textContent,
            sendRawMessageFn: sendRawWhatsAppMessage,
            setGlobalAiPausedFn: (val) => { globalAiPaused = val; },
            getGlobalAiPausedFn: () => globalAiPaused
          });
          continue;
        }

        // 2. Handle `fromMe` messages (Human advisor replying from linked WhatsApp phone!)
        if (msg.key.fromMe) {
          if (msgId && LeadDB.isBotSentId(msgId)) continue;
          if (msgId && LeadDB.isMessageProcessed(msgId)) continue;
          if (msgId) LeadDB.markMessageProcessed(msgId);

          if (!isOwnerSender && textContent) {
            console.log(`🧑 Linked-phone reply detected to ${senderJid} -> Auto-switching lead to HUMAN mode for 12h.`);
            LeadDB.addMessage(senderJid, 'human', textContent, { waMsgId: msgId, status: 'SENT' });
            LeadDB.upsert(senderJid, {
              ai_mode: 'HUMAN',
              human_until: Date.now() + 12 * HOUR
            });
            LeadDB.cancelFollowUpJobs(senderJid);
          }
          continue;
        }

        if (senderJid === OWNER_NUMBER) continue;

        // 3a. Voice Note / Audio Message
        if (msg.message.audioMessage) {
          if (msgId && LeadDB.isMessageProcessed(msgId)) continue;
          try {
            const buffer = await downloadMediaMessage(msg, 'buffer', {});
            const audioFile = path.join(STORAGE_PATHS.uploadsDir, `voice_${Date.now()}_${msgId}.ogg`);
            fs.writeFileSync(audioFile, buffer);
            const transcript = await transcribeVoiceNote(audioFile, fs);
            try { fs.unlinkSync(audioFile); } catch { /* ignore */ }

            if (transcript) {
              console.log(`🎙️ Voice note transcribed from ${senderJid}: "${transcript}"`);
              await handleIncomingMessage({
                phone: senderJid,
                text: transcript,
                source: 'baileys',
                msgKey: msg.key,
                rawProto: msg.message,
                mediaType: 'audio',
                getSock,
                sendOwnerAlertFn: sendRawWhatsAppMessage,
                isGlobalAiPaused: globalAiPaused,
                debounceMs: DEBOUNCE_MS
              });
            } else {
              if (msgId) LeadDB.markMessageProcessed(msgId);
              LeadDB.addMessage(senderJid, 'user', '[Voice Note]', { waMsgId: msgId, mediaType: 'audio' });
              await sendSingleBubbleWithRetry({
                jid: senderJid,
                text: 'Voice note abhi sun nahi pa raha, ek baar type kar doge? 🙏',
                getSock
              });
            }
          } catch (err) {
            console.warn('⚠️ Voice note download error:', err.message);
            await sendSingleBubbleWithRetry({
              jid: senderJid,
              text: 'Voice note abhi sun nahi pa raha, ek baar type kar doge? 🙏',
              getSock
            });
          }
          continue;
        }

        // 3b. Image or PDF Document Upload
        if (msg.message.imageMessage || msg.message.documentMessage) {
          if (msgId && LeadDB.isMessageProcessed(msgId)) continue;
          if (msgId) LeadDB.markMessageProcessed(msgId);
          try {
            const isDoc = Boolean(msg.message.documentMessage);
            const mime = (isDoc ? msg.message.documentMessage.mimetype : msg.message.imageMessage.mimetype) || '';
            const ext = mime.includes('pdf') ? 'pdf' : mime.includes('png') ? 'png' : 'jpg';
            const filename = `doc_${senderJid.replace(/@.*/, '')}_${Date.now()}.${ext}`;
            const fullPath = path.join(STORAGE_PATHS.uploadsDir, filename);

            const buffer = await downloadMediaMessage(msg, 'buffer', {});
            fs.writeFileSync(fullPath, buffer);

            const lead = LeadDB.getOrCreate(senderJid);
            const uploads = Array.isArray(lead.docs_uploads) ? lead.docs_uploads : [];
            const docLabel = textContent || (isDoc ? msg.message.documentMessage.fileName : 'Uploaded Document');
            uploads.push({ file: filename, type: docLabel, uploadedAt: Date.now() });

            const checklist = { ...(lead.docs_checklist || {}) };
            if (/aadhar|aadhaar/i.test(docLabel)) checklist.aadhar = true;
            else if (/10th/i.test(docLabel)) checklist.marksheet10 = true;
            else checklist.marksheet12 = true;

            LeadDB.addMessage(senderJid, 'user', textContent || `[Uploaded ${docLabel}]`, {
              waMsgId: msgId,
              mediaType: isDoc ? 'document' : 'image',
              mediaPath: filename
            });

            LeadDB.upsert(senderJid, {
              docs_uploads: uploads,
              docs_checklist: checklist,
              stage: lead.stage === 'DOCS_PENDING' || lead.stage === 'WARM' ? 'DOCS_PENDING' : lead.stage
            });

            if (lead.ai_mode !== 'HUMAN' && !globalAiPaused) {
              const nextDocNeeded = !checklist.aadhar ? 'Aadhaar card' : 'Marksheet';
              await sendMultiBubbleHumanTurn({
                jid: senderJid,
                bubbles: [`Document mil gaya ✅ Maine save kar liya hai. Ab baaki document (${nextDocNeeded}) bhi bhej do taaki verification complete ho jaaye.`],
                incomingKeys: [msg.key],
                getSock
              });
            }
          } catch (err) {
            console.warn('⚠️ Media save error:', err.message);
          }
          continue;
        }

        // 3c. Sticker
        if (msg.message.stickerMessage && !textContent) {
          if (msgId) LeadDB.markMessageProcessed(msgId);
          LeadDB.addMessage(senderJid, 'user', '[Sticker]', { waMsgId: msgId, mediaType: 'sticker' });
          continue;
        }

        if (!textContent) continue;

        // 4. Unified Ingestion Pipeline (7s Debounce + Per-User TurnSeq Lock)
        await handleIncomingMessage({
          phone: senderJid,
          text: textContent,
          source: 'baileys',
          msgKey: msg.key,
          rawProto: msg.message,
          getSock,
          sendOwnerAlertFn: sendRawWhatsAppMessage,
          isGlobalAiPaused: globalAiPaused,
          debounceMs: DEBOUNCE_MS
        });
      }
    });
  } finally {
    isStartingSocket = false;
  }
}

function startBackgroundJobs() {
  setInterval(async () => {
    try {
      await runGhostAndFollowUpTick({
        sendBotMessageFn: (jid, bubbles, opts) =>
          sendMultiBubbleHumanTurn({ jid, bubbles, getSock, isFollowUp: opts?.isFollowUp }),
        sendOwnerAlertFn: sendRawWhatsAppMessage,
        isGlobalAiPausedFn: () => globalAiPaused
      });
    } catch (err) {
      console.error('⚠️ Follow-up scheduler tick error:', err.message);
    }
  }, 5 * MINUTE);

  setInterval(async () => {
    const now = Date.now();
    const ist = getISTParts(now);
    const dateKey = `${ist.year}-${ist.month}-${ist.day}`;

    if (ist.hour === 21 && ist.minute < 5 && lastDailyReportDateIST !== dateKey) {
      lastDailyReportDateIST = dateKey;
      LeadDB.createBackup();
      const reportText = buildDailyReportText();
      await sendRawWhatsAppMessage(OWNER_NUMBER, reportText);
    }

    if (connectionStatus !== 'CONNECTED' && isBusinessHoursIST(now) && (now - lastDisconnectedAt) > 5 * MINUTE) {
      console.error(`🚨 HEALTH WATCHDOG: WhatsApp socket has been ${connectionStatus} for > 5 minutes during business hours!`);
    }
  }, 1 * MINUTE);
}

// Section 3.4: Graceful SIGTERM / SIGINT shutdown for Render redeploy
function setupGracefulShutdown() {
  const shutdown = (signal) => {
    console.log(`\n🛑 Received ${signal}. Flushing SQLite WAL and closing Baileys socket cleanly...`);
    try {
      if (activeSock) {
        activeSock.ev.removeAllListeners();
        activeSock.ws?.close();
      }
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.close();
    } catch (e) {
      console.warn('⚠️ Shutdown warning:', e.message);
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (process.env.NODE_ENV !== 'test') {
  setupGracefulShutdown();
  console.log('🔄 Starting College Vidya Counselor Bot & CRM...');
  startCrmServer({
    getSock,
    getConnectionInfo,
    requestPairingCodeFn: async (phoneInput) => {
      if (!activeSock) throw new Error('Socket not initialized');
      const cleanPhone = String(phoneInput).replace(/\D/g, '');
      return await activeSock.requestPairingCode(cleanPhone);
    },
    isGlobalAiPausedFn: () => globalAiPaused,
    setGlobalAiPausedFn: (val) => { globalAiPaused = val; }
  });

  startBackgroundJobs();
  startBot();
}
