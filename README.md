# 🎓 College Vidya WhatsApp Counselor Bot & CRM (Render.com + Groq `openai/gpt-oss-120b`)

Production-grade autonomous WhatsApp admission counselor & CRM for **College Vidya** built with **Node.js, Express, `@whiskeysockets/baileys`, SQLite (`better-sqlite3` in WAL mode + FTS5 RAG), and Groq `openai/gpt-oss-120b` + `whisper-large-v3-turbo`**.

---

## 🏗️ Architecture & Key Modules

| File | Responsibility |
|---|---|
| `index.js` | Single-instance Baileys socket manager, Render Persistent Disk auth path (`/data/auth`), exponential backoff reconnect, `DisconnectReason.loggedOut` detection, LID ↔ Phone JID mapping, `fromMe` auto-handover (12h Human mode when replying from linked phone), voice note Whisper STT (`whisper-large-v3-turbo`), image/PDF document saving, and 5-min cron scheduler. |
| `llmBrain.js` | Locked single-model Groq engine (`openai/gpt-oss-120b`, `reasoning_effort: "low"`, `reasoning_format: "parsed"`, `response_format: { type: "json_object" }`), 100% static `messages[0]` system prompt for automatic Groq Prompt Caching (50% token discount), proactive header-based TPM/RPM pacing, non-destructive validator (regeneration on length truncation, `>1` question, `>60%` repetition, or compliance errors), and zero hardcoded question appenders. |
| `knowledgeRag.js` | Local SQLite FTS5 RAG engine (`knowledge_docs` + `knowledge_chunks_fts`), auto-seeding 11 deep career & branch encyclopedia modules into `/data/knowledge_library` on boot, ~260-word overlapping chunker, BM25 + tag-boosted retrieval returning top 2 chunks (`<= 480` tokens per turn), and live `.md`/`.txt`/`.pdf` document indexing. |
| `eligibilityEngine.js` | 14-intent & mood classifier (`GREETING_ONLY`, `IDENTITY_CHECK`, `CONFUSION_OR_GLITCH`, `COURSE_REJECTION`, `CAREER_CONFUSION_OR_ROADMAP`, `BRANCH_SCOPE_QUERY`, `OPT_OUT_OR_EXIT`, etc.), AICTE/UGC eligibility rules engine, `declined_programs` memory, Diploma Track 1 (Working-Professional B.Tech LE) + Track 2 (Online BCA/BBA/B.Com/BA as 10+2 equivalent), and lead scoring (0–100). |
| `conversationController.js` | Unified `handleIncomingMessage` shared by Baileys (`7s` debounce) and Dashboard Test Chat Simulator (`2.5s` debounce), per-user concurrency lock + `turnSeq` stale-turn cancellation, multi-bubble human rhythm, 3-try exponential backoff retry, and offline SQLite outbound queue. |
| `followupEngine.js` | Persistent SQLite-backed ghost detection & follow-up cadences (`GHOST_NEW`, `GHOST_PITCHED`, `GHOST_WARM`, `GHOST_DOCS`), strict `Asia/Kolkata` (9 AM – 9 PM IST) business-hours queueing with anti-ban jitter, 24×7 Owner Red Alerts, 9 PM IST Daily Reports, and Owner WhatsApp commands. |
| `database.js` | SQLite WAL database (`/data/crm.db`), automatic non-destructive column migrations, Render Persistent Disk auto-detection (`/data` vs `./data`), merged multi-bubble conversation history (`getMergedConversationTurns`), and Groq quota telemetry (`llm_telemetry`). |
| `crmServer.js` & `public/index.html` | Login-protected CRM Dashboard with Live Groq Quota Meter (RPD, TPD, Prompt Cache Hit %, Avg Uncached Tokens/Turn), Kanban pipeline, Live Chat with delivery ticks, **"📚 Career Knowledge Library (RAG)"** uploader (`.md`, `.txt`, `.pdf`) & live FTS5 test search, University Config JSON editor, and Test Chat Simulator with Debug Drawer (`thought`, `reasoning`, `detected_intent`, `rag_docs`, `usage`). |
| `knowledge_base.json` & `seed_knowledge/` | Structured university facts (Sanskriti, Kalinga, Lingaya's, College Vidya Online Partners) + 11 deep career counseling modules seeded from `career_knowledge_encyclopedia.md`. |

---

## ☁️ Render.com Deployment & Persistent Disk Setup

1. **Blueprint / Service Configuration (`render.yaml`):**
   - Bind Express server to `0.0.0.0` on `process.env.PORT || 3000`.
   - Health check endpoint: `GET /health` (returns `{ status: "ok", whatsapp_connected, db_path, model, groq_quota, knowledge_docs_indexed }`).
2. **Persistent Disk (`/data`):**
   - Attach a **1 GB Persistent Disk** mounted at `/data`.
   - The app automatically stores:
     - SQLite database: `/data/crm.db`
     - Baileys WhatsApp auth credentials: `/data/auth`
     - Career Knowledge Library markdown files: `/data/knowledge_library`
     - Student document uploads: `/data/uploads`
     - Daily database backups: `/data/backups`
   - *Note:* On Render's Free tier, services spin down after 15 minutes of HTTP inactivity, which drops the persistent Baileys WebSocket connection and wipes ephemeral disk if no Persistent Disk is attached. Use Render's **Starter Plan** (always-on + `/data` Persistent Disk) for 24×7 WhatsApp connectivity, or connect an external uptime monitor pinging `GET /health` every 5 minutes.
3. **Environment Variables on Render.com:**
   - `GROQ_API_KEY` (set in Render Dashboard Environment tab — **never commit to Git**)
   - `LLM_MODEL=openai/gpt-oss-120b`
   - `OWNER_NUMBER=917982412945@s.whatsapp.net`
   - `CRM_USERNAME=harsh`
   - `CRM_PASSWORD=<your_strong_password>`
   - `DATA_DIR=/data`
   - `TZ=Asia/Kolkata`

---

## 🚀 Quick Start (Local)

```bash
# 1. Install dependencies
npm install

# 2. Configure environment variables
cp .env.example .env
# Edit .env and set GROQ_API_KEY, CRM_USERNAME, CRM_PASSWORD

# 3. Run the 15-scenario live Groq verification & transcript replay suite
npm test

# 4. Start the live WhatsApp Bot + CRM Dashboard
npm start
```
