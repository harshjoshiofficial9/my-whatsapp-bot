# 🎓 College Vidya WhatsApp Counselor Bot & CRM

Production-grade autonomous WhatsApp admission counselor & CRM for **College Vidya** built with **Node.js, Express, `@whiskeysockets/baileys`, SQLite (`better-sqlite3` in WAL mode), and Groq LLM**.

---

## 🏗️ Architecture & Key Modules

| File | Responsibility |
|---|---|
| `index.js` | Single-instance Baileys socket manager, exponential backoff reconnect, `DisconnectReason.loggedOut` detection, LID ↔ Phone JID mapping, `fromMe` auto-handover (12h Human mode when replying from linked phone), voice note Whisper STT, image/PDF document saving, and 5-min cron scheduler. |
| `eligibilityEngine.js` | Deterministic pre-LLM text inference, AICTE/UGC eligibility rules engine, smart 1-question-at-a-time probing order, stage state machine (`NEW` → `QUALIFYING` → `PITCHED` → `WARM` → `DOCS_PENDING` → `PAYMENT_PENDING` → `ENROLLED` / `NOT_ELIGIBLE` / `OPTED_OUT`), and lead scoring (0–100). |
| `llmBrain.js` | Groq LLM JSON generator (`messages[]`, `profile_updates`, `stage`, `intent`, `needs_human`), truncation check (`finish_reason === 'length'`), WhatsApp formatting post-processor (`**` → `*`, max 2 emojis, max 3 lines/bubble), compliance guard (never calls Sanskriti AICTE-approved), and single-question/anti-repetition validator. |
| `conversationController.js` | Per-user 8.5s message debouncing, per-user concurrency lock, multi-bubble human rhythm (`readMessages` blue tick → reading pause → proportional `composing` presence → send), 3-try exponential backoff retry, offline SQLite outbound queue, and global rate limit (~20 msgs/min). |
| `followupEngine.js` | Persistent SQLite-backed ghost detection (1h hot leads / 2h normal leads) & follow-up cadences (`GHOST_NEW`, `GHOST_PITCHED`, `GHOST_WARM`, `GHOST_DOCS`), strict `Asia/Kolkata` (9 AM – 9 PM IST) business-hours queueing with anti-ban jitter, 24×7 Owner Red Alerts, 9 PM IST Daily Reports, and Owner WhatsApp commands. |
| `database.js` | SQLite WAL database (`crm.db`), automatic non-destructive column migrations, persistent volume detection, LID mapping table, outbound queue, follow-up jobs table, and daily automatic DB backups. |
| `crmServer.js` & `public/index.html` | Login-protected CRM Dashboard (Kanban pipeline, Live Chat with delivery ticks, AI/Human toggle, "✨ AI Suggest Reply" button, Profile/Document editor, live Knowledge Base JSON editor, Test Chat Simulator, Analytics, CSV export, and `/health` endpoint). |
| `knowledge_base.json` | Editable university knowledge base (Sanskriti, Kalinga, Lingaya's, and College Vidya Online Partners). |

---

## 🚀 Quick Start (Local)

```bash
# 1. Install dependencies
npm install

# 2. Configure environment variables
cp .env.example .env
# Edit .env and set GROQ_API_KEY, CRM_USERNAME, CRM_PASSWORD

# 3. Run automated 23-scenario test suite
npm test

# 4. Run interactive CLI chat simulator (no WhatsApp required)
npm run simulate

# 5. Start the live WhatsApp Bot + CRM Dashboard
npm start
```

Open **`http://localhost:3000`** and sign in with your `CRM_USERNAME` and `CRM_PASSWORD`.

---

## ☁️ Railway Production & Volume Setup (DB + Baileys Auth)

Railway container filesystems are ephemeral unless backed by a **Railway Volume**:
1. **Single Replica Only:** In Railway Service Settings → Deploy → set **Replicas = 1** (two replicas would start two Baileys sockets and cause session conflicts).
2. **Volume Mount:**
   - Mount your Railway Volume at `/data` (or keep existing `/app/auth_info_baileys` — `database.js` automatically detects `/app/auth_info_baileys` on Railway and stores `crm.db`, `backups/`, and `uploads/` inside the persistent volume so redeploys never wipe your database!).
3. **Environment Variables on Railway:**
   - `GROQ_API_KEY`
   - `OWNER_NUMBER=917982412945`
   - `CRM_USERNAME=harsh`
   - `CRM_PASSWORD=<your_strong_password>`
   - `PORT=3000`

---

## 📱 WhatsApp QR / Phone Pairing Login

1. Log into the CRM Dashboard (`https://college-vidya-bot-production.up.railway.app`).
2. Click the **Connected / Disconnected** status button in the top right to open the **WhatsApp Connection Modal**.
3. Either scan the crisp square **QR Code** OR enter your WhatsApp number (e.g. `917982412945`) and click **Get Code** to receive an **8-digit Pairing Code** for *WhatsApp → Linked Devices → Link with phone number instead*.

---

## 📚 Editing the Knowledge Base

You can update university fees, approvals, geo rules (`pan_india`, `states`, `radius_km`), USPs, or deadlines anytime without changing code:
- **Via Dashboard:** Open the **Knowledge Base** tab, edit the JSON config, and click **Save Knowledge Base** (persisted in SQLite `kb_store` and `knowledge_base.json` with updated `last_verified_date`).

---

## 📲 Owner WhatsApp Commands (from `917982412945`)

Send any of these commands from the owner number:
- `/report` — Generate and receive the full daily pipeline report immediately
- `/hot` — List top hot leads (`score >= 70` or `WARM`/`DOCS_PENDING`/`PAYMENT_PENDING`)
- `/lead <phone>` — View full dossier summary for a student
- `/takeover <phone>` — Switch lead to `HUMAN` mode (bot goes silent for this lead)
- `/release <phone>` — Return lead back to `AI` mode
- `/pause` / `/resume` — Pause or resume AI auto-replies globally
- `/say <phone> <message>` — Send `<message>` to student as human advisor
