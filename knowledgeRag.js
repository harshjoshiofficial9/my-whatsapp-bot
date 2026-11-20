import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db, STORAGE_PATHS } from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SEED_DIR = path.join(__dirname, 'seed_knowledge');

/**
 * Parse a markdown document with optional header metadata:
 * # [DOC: doc_id]
 * Tags: tag1, tag2
 * Category: Engineering Branches
 * Summary: ...
 */
export function parseKnowledgeMarkdown(filename, rawText) {
  const clean = String(rawText || '').replace(/\r\n/g, '\n').trim();
  const baseId = path.basename(filename, path.extname(filename)).toLowerCase().replace(/[^a-z0-9_-]/g, '_');

  const docMatch = clean.match(/^#\s*\[DOC:\s*([a-zA-Z0-9_-]+)\]/m);
  const doc_id = docMatch ? docMatch[1].trim() : baseId;

  const tagsMatch = clean.match(/^Tags:\s*(.+)$/mi);
  const categoryMatch = clean.match(/^Category:\s*(.+)$/mi);
  const summaryMatch = clean.match(/^Summary:\s*(.+)$/mi);
  const titleMatch = clean.match(/^#\s+(.+)$/m);

  const tags = tagsMatch ? tagsMatch[1].trim() : doc_id.replace(/_/g, ', ');
  const category = categoryMatch ? categoryMatch[1].trim() : 'Career Guidance';
  const summary = summaryMatch ? summaryMatch[1].trim() : '';
  const title = summary || (titleMatch ? titleMatch[1].replace(/\[DOC:\s*[^\]]+\]/i, '').trim() : doc_id) || doc_id;

  return {
    doc_id,
    title,
    tags,
    category,
    summary,
    content: clean
  };
}

/**
 * Split document content into ~240–300 word searchable chunks at section/paragraph boundaries
 */
export function chunkDocumentText(content, maxWordsPerChunk = 260) {
  const lines = String(content || '')
    .split('\n')
    .filter(l => !/^(\s*#\s*\[DOC:|Tags:|Category:|Summary:)/i.test(l));

  const sections = [];
  let currentSection = [];

  for (const line of lines) {
    if (/^#{1,3}\s+/.test(line) && currentSection.length > 0) {
      sections.push(currentSection.join('\n').trim());
      currentSection = [line];
    } else {
      currentSection.push(line);
    }
  }
  if (currentSection.length > 0) {
    sections.push(currentSection.join('\n').trim());
  }

  const chunks = [];
  let buffer = '';
  let bufferWords = 0;

  for (const sec of sections) {
    if (!sec) continue;
    const words = sec.split(/\s+/).filter(Boolean).length;
    if (bufferWords + words <= maxWordsPerChunk || bufferWords < 60) {
      buffer = buffer ? `${buffer}\n\n${sec}` : sec;
      bufferWords += words;
    } else {
      if (buffer) chunks.push(buffer.trim());
      buffer = sec;
      bufferWords = words;
    }
  }
  if (buffer) chunks.push(buffer.trim());

  return chunks.length > 0 ? chunks : [content.trim()];
}

export const KnowledgeRAG = {
  /**
   * Seed knowledge_library from ./seed_knowledge on boot without overwriting user-edited files,
   * and index all files into SQLite FTS5.
   */
  initAndSeed() {
    try {
      if (fs.existsSync(SEED_DIR)) {
        const seedFiles = fs.readdirSync(SEED_DIR).filter(f => f.endsWith('.md') || f.endsWith('.txt'));
        for (const file of seedFiles) {
          const targetPath = path.join(STORAGE_PATHS.knowledgeDir, file);
          if (!fs.existsSync(targetPath)) {
            fs.copyFileSync(path.join(SEED_DIR, file), targetPath);
          }
        }
      }

      const libFiles = fs.readdirSync(STORAGE_PATHS.knowledgeDir).filter(f => f.endsWith('.md') || f.endsWith('.txt'));
      for (const file of libFiles) {
        const fullPath = path.join(STORAGE_PATHS.knowledgeDir, file);
        const rawText = fs.readFileSync(fullPath, 'utf8');
        const parsed = parseKnowledgeMarkdown(file, rawText);
        this.indexDocumentInDb(parsed, false);
      }
    } catch (err) {
      console.error('⚠️ KnowledgeRAG init error:', err.message);
    }
  },

  indexDocumentInDb({ doc_id, title, tags = '', category = 'Career Guidance', summary = '', content }, writeToDisk = true) {
    const cleanId = String(doc_id || 'doc_' + Date.now()).toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const cleanContent = String(content || '').trim();
    const wordCount = cleanContent.split(/\s+/).filter(Boolean).length;
    const chunks = chunkDocumentText(cleanContent, 260);
    const now = Date.now();

    db.prepare(`
      INSERT INTO knowledge_docs (doc_id, title, tags, category, summary, content, word_count, chunk_count, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(doc_id) DO UPDATE SET
        title = excluded.title,
        tags = excluded.tags,
        category = excluded.category,
        summary = excluded.summary,
        content = excluded.content,
        word_count = excluded.word_count,
        chunk_count = excluded.chunk_count,
        updated_at = excluded.updated_at
    `).run(cleanId, title || cleanId, tags, category, summary, cleanContent, wordCount, chunks.length, now);

    db.prepare('DELETE FROM knowledge_chunks_fts WHERE doc_id = ?').run(cleanId);
    const insertChunk = db.prepare(`
      INSERT INTO knowledge_chunks_fts (doc_id, title, tags, category, chunk_text)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const chunk of chunks) {
      insertChunk.run(cleanId, title || cleanId, tags, category, chunk);
    }

    if (writeToDisk) {
      try {
        const filePath = path.join(STORAGE_PATHS.knowledgeDir, `${cleanId}.md`);
        const fileHeader = cleanContent.startsWith('# [DOC:')
          ? cleanContent
          : `# [DOC: ${cleanId}]\nTags: ${tags}\nCategory: ${category}\nSummary: ${summary || title}\n\n${cleanContent}`;
        fs.writeFileSync(filePath, fileHeader, 'utf8');
      } catch (e) {
        console.warn('⚠️ Knowledge disk write warning:', e.message);
      }
    }

    return this.getDoc(cleanId);
  },

  listDocs() {
    const docs = db.prepare(`
      SELECT doc_id, title, tags, category, summary, word_count, chunk_count, updated_at
      FROM knowledge_docs
      ORDER BY updated_at DESC
    `).all();

    const totalWords = docs.reduce((acc, d) => acc + (d.word_count || 0), 0);
    const totalChunks = docs.reduce((acc, d) => acc + (d.chunk_count || 0), 0);

    return {
      total_docs: docs.length,
      total_words: totalWords,
      total_chunks: totalChunks,
      docs
    };
  },

  getDoc(docId) {
    return db.prepare('SELECT * FROM knowledge_docs WHERE doc_id = ?').get(docId);
  },

  deleteDoc(docId) {
    const cleanId = String(docId).trim();
    db.prepare('DELETE FROM knowledge_docs WHERE doc_id = ?').run(cleanId);
    db.prepare('DELETE FROM knowledge_chunks_fts WHERE doc_id = ?').run(cleanId);
    const filePath = path.join(STORAGE_PATHS.knowledgeDir, `${cleanId}.md`);
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    }
    return { deleted: true, doc_id: cleanId };
  },

  /**
   * Smart Turn-Time FTS5 Retrieval (Section 3.3)
   * Returns top 2 chunks hard-capped at <= 480 tokens total!
   * Skips retrieval on pure greetings, simple acks, confusion, identity questions, or opt-outs.
   */
  retrieveTopChunks({ userText = '', lead = {}, detectedIntent = null, topK = 2, maxTokens = 480 }) {
    const raw = String(userText || '').trim();
    const lower = raw.toLowerCase();

    // Skip retrieval on pure greeting, short ack, identity check, confusion, or opt-out
    const skipIntents = new Set(['GREETING_ONLY', 'IDENTITY_CHECK', 'CONFUSION_OR_GLITCH', 'OPT_OUT_OR_EXIT']);
    if (skipIntents.has(detectedIntent)) {
      return { chunks: [], doc_ids: [], estimated_tokens: 0 };
    }
    if (/^(hi+|hello+|hyy+|hey+|namaste|ok+|okay|acha|achha|thank\s*you|thanks|bye|stop|arre\s*ky\s*hogya\??)$/i.test(raw)) {
      return { chunks: [], doc_ids: [], estimated_tokens: 0 };
    }

    // Build keyword tokens from userText + known lead profile
    const stopWords = new Set([
      'hai', 'hain', 'hoon', 'mein', 'main', 'aur', 'kya', 'kaise', 'karna', 'krna', 'karni', 'krni',
      'mujhe', 'mera', 'meri', 'mere', 'aap', 'tum', 'kaun', 'kyu', 'kyun', 'se', 'ke', 'ki', 'ka',
      'ko', 'par', 'pe', 'bhi', 'toh', 'hi', 'hello', 'hyy', 'sir', 'bhai', 'ji', 'ek', 'do', 'ye',
      'woh', 'tha', 'thi', 'the', 'abhi', 'sath', 'saath', 'liye', 'baad', 'achha', 'theek', 'batao',
      'bataiye', 'chahiye', 'kr', 'kar', 'ho', 'hu', 'for', 'the', 'and', 'with', 'from', 'what', 'how'
    ]);

    const combinedContext = [
      raw,
      lead.qualification || '',
      lead.stream_branch || '',
      lead.employment_type || '',
      lead.goal || ''
    ].join(' ').toLowerCase();

    const rawTokens = combinedContext
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 2 && !stopWords.has(w));

    // Add domain synonym expansions for accurate FTS5 matching
    const expanded = new Set(rawTokens);
    if (/\b(fayda|future|scope|growth|promotion|ceiling|supervisor|foreman)\b/i.test(lower) && /\b(diploma|polytechnic|btech)\b/i.test(combinedContext)) {
      expanded.add('ceiling');
      expanded.add('supervisor');
      expanded.add('promotion');
    }
    if (/\b(nahi\s*krna\s*btech|no\s*btech|skip\s*btech|bca|bba)\b/i.test(lower)) {
      expanded.add('bca');
      expanded.add('bba');
      expanded.add('alternatives');
    }
    if (/\b(gulf|dubai|saudi|qatar|abroad|noc|psu|railway|je|ae)\b/i.test(combinedContext)) {
      expanded.add('gulf');
      expanded.add('noc');
      expanded.add('psu');
    }
    if (/\b(mtech|mba)\b/i.test(lower) && /\b(btech|be|confusion|karun|better)\b/i.test(combinedContext)) {
      expanded.add('mtech');
      expanded.add('mba');
    }

    const searchTerms = Array.from(expanded).slice(0, 14);
    if (searchTerms.length === 0) {
      return { chunks: [], doc_ids: [], estimated_tokens: 0 };
    }

    const ftsQuery = searchTerms.map(t => `"${t}"*`).join(' OR ');

    let rows = [];
    try {
      rows = db.prepare(`
        SELECT doc_id, title, tags, category, chunk_text,
               bm25(knowledge_chunks_fts, 2.0, 2.0, 3.0, 1.0, 1.0) as score
        FROM knowledge_chunks_fts
        WHERE knowledge_chunks_fts MATCH ?
        ORDER BY score ASC
        LIMIT 8
      `).all(ftsQuery);
    } catch (e) {
      console.warn('⚠️ FTS5 query warning:', e.message);
      return { chunks: [], doc_ids: [], estimated_tokens: 0 };
    }

    // Re-score to prioritize distinct documents and exact branch/intent alignment
    const branchLower = (lead.stream_branch || '').toLowerCase();
    const scored = rows.map(r => {
      let bonus = 0;
      const docLow = r.doc_id.toLowerCase();
      const tagLow = (r.tags || '').toLowerCase();
      if (branchLower && (docLow.includes(branchLower) || tagLow.includes(branchLower))) bonus -= 5;
      if (/\b(fayda|future|promotion|growth|salary)\b/i.test(lower) && docLow.includes('glass_ceiling')) bonus -= 6;
      if (/\b(nahi\s*krna|no\s*btech)\b/i.test(lower) && docLow.includes('non_btech')) bonus -= 8;
      if (/\b(mtech.*mba|mba.*mtech)\b/i.test(lower) && docLow.includes('mtech_vs_mba')) bonus -= 8;
      if (/\b(gulf|dubai|saudi|bim|revit)\b/i.test(lower) && docLow.includes('civil')) bonus -= 6;
      if (/\b(vlsi|semiconductor|chip|embedded)\b/i.test(lower) && docLow.includes('ece')) bonus -= 6;
      return { ...r, finalScore: (r.score || 0) + bonus };
    }).sort((a, b) => a.finalScore - b.finalScore);

    // Pick up to topK chunks (preferring distinct doc_ids first) within maxTokens budget
    const selected = [];
    const seenDocs = new Set();
    let totalWords = 0;
    const maxWordsBudget = Math.floor(maxTokens * 0.72); // ~1.35 tokens per word

    for (const item of scored) {
      if (selected.length >= topK) break;
      if (seenDocs.has(item.doc_id) && scored.length > topK) continue;

      let text = item.chunk_text.trim();
      const words = text.split(/\s+/);
      const remainingWords = maxWordsBudget - totalWords;
      if (remainingWords < 40) break;

      if (words.length > remainingWords) {
        text = words.slice(0, remainingWords).join(' ') + '...';
      }

      selected.push({
        doc_id: item.doc_id,
        title: item.title,
        excerpt: text
      });
      seenDocs.add(item.doc_id);
      totalWords += text.split(/\s+/).length;
    }

    const estimatedTokens = Math.round(totalWords * 1.35);
    return {
      chunks: selected,
      doc_ids: Array.from(seenDocs),
      estimated_tokens: estimatedTokens
    };
  }
};

// Initialize and seed FTS5 on module load
KnowledgeRAG.initAndSeed();
