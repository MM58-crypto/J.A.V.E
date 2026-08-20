const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Document, Packer, Paragraph, TextRun, AlignmentType, LevelFormat, BorderStyle, TabStopType } = require('docx');
const fs       = require('fs');
const path     = require('path');
const pdfParse = require('pdf-parse');
require('dotenv').config();

// ── config ────────────────────────────────────────────────────────────────────

const RESUME_PATH  = process.env.RESUME_PATH || './base_resume.pdf';
const OUTPUT_DIR   = process.env.OUTPUT_DIR  || './output';
const GEMINI_MODEL = 'gemini-3.1-flash-lite';
const MAX_JD_CHARS = 3000;
const MAX_RES_CHARS= 3000;

// ── system prompt (placeholder) ───────────────────────────────────────────────

const SYSTEM_PROMPT = `
You are a professional resume tailoring assistant.
Given a job description and a base resume, rewrite the resume to better match the job.
Focus on relevant skills, reorder bullet points by relevance, and adjust language to mirror the JD.
Do not fabricate experience or skills that are not in the base resume.

CRITICAL FORMATTING RULES — strictly follow these:
- Do NOT use markdown of any kind. No asterisks, no bold (**text**), no italics (*text*), no hashes (#), no backticks.
- Use ONLY these exact section markers on their own line: NAME: CONTACT: EXPERIENCE: PROJECTS: SKILLS: EDUCATION: CERTIFICATIONS: LANGUAGES:
- Job/project headers use pipe format: Title | Company | Location | Date
- Bullets start with "- " (dash space)
- Skills use "Label: values" format
- Return nothing else — no commentary, no fences, no extra symbols.
`.trim();

// ── strip markdown symbols Gemini may sneak in ────────────────────────────────

function cleanMarkdown(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')   // **bold** → bold
    .replace(/\*(.+?)\*/g,     '$1')   // *italic* → italic
    .replace(/^#{1,6}\s+/gm,   '')     // ## headings → plain
    .replace(/`{1,3}/g,        '')     // backticks
    .replace(/^\s*\*\s+/gm,    '- ')  // * bullet → - bullet
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'); // [text](url) → text
}

// ── convert .docx to .pdf via LibreOffice headless ────────────────────────────

async function convertToPdf(docxPath) {
  const { execSync } = require('child_process');
  const outDir = path.dirname(docxPath);
  try {
    execSync(`libreoffice --headless --convert-to pdf --outdir "${outDir}" "${docxPath}"`, { timeout: 30000 });
    const pdfPath = docxPath.replace(/\.docx$/, '.pdf');
    if (fs.existsSync(pdfPath)) return pdfPath;
  } catch {
    // LibreOffice not available — return null silently
  }
  return null;
}

function trimText(text, maxChars) {
  if (!text || text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n[...truncated]';
}

// ── PDF text extraction using pdfjs-dist (ESM via dynamic import) ─────────────

async function loadBaseResume() {
  if (!fs.existsSync(RESUME_PATH)) throw new Error(`Resume not found at: ${RESUME_PATH}`);
  const ext = path.extname(RESUME_PATH).toLowerCase();

  if (ext === '.pdf') {
    const buffer = fs.readFileSync(RESUME_PATH);
    const parsed = await pdfParse(buffer);
    if (!parsed.text || !parsed.text.trim()) throw new Error('PDF appears image-based. Use a selectable PDF.');
    return parsed.text;
  }

  return fs.readFileSync(RESUME_PATH, 'utf8');
}

// ── docx builder ──────────────────────────────────────────────────────────────

function sectionHeader(text) {
  return new Paragraph({
    children: [new TextRun({ text: text.toUpperCase(), bold: true, size: 20, font: 'Arial' })],
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '000000', space: 1 } },
    spacing: { before: 160, after: 80 },
  });
}

function jobHeader(text) {
  const parts = text.split('|').map(p => p.trim());
  const left  = parts.slice(0, -1).join('  |  ');
  const date  = parts[parts.length - 1] || '';
  return new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: 9360 }],
    children: [
      new TextRun({ text: left, bold: true, size: 20, font: 'Arial' }),
      new TextRun({ text: '\t', size: 20 }),
      new TextRun({ text: date, size: 18, font: 'Arial', italics: true }),
    ],
    spacing: { before: 120, after: 40 },
  });
}

function bulletLine(text) {
  return new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    children: [new TextRun({ text, size: 19, font: 'Arial' })],
    spacing: { before: 18, after: 18 },
  });
}

function skillLine(text) {
  const colon = text.indexOf(':');
  if (colon === -1) return normalLine(text);
  return new Paragraph({
    children: [
      new TextRun({ text: text.slice(0, colon).trim() + ': ', bold: true, size: 19, font: 'Arial' }),
      new TextRun({ text: text.slice(colon + 1).trim(), size: 19, font: 'Arial' }),
    ],
    spacing: { before: 26, after: 26 },
  });
}

function normalLine(text) {
  return new Paragraph({
    children: [new TextRun({ text, size: 19, font: 'Arial' })],
    spacing: { before: 30, after: 30 },
  });
}

function parseIntoParagraphs(raw) {
  const lines    = raw.split('\n').map(l => l.trim());
  const children = [];
  let section    = '';

  for (const line of lines) {
    if (!line) continue;

    if (line.startsWith('NAME:')) {
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: line.replace('NAME:', '').trim(), bold: true, size: 36, font: 'Arial' })],
        spacing: { after: 50 },
      }));
      continue;
    }
    if (line.startsWith('CONTACT:')) {
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: line.replace('CONTACT:', '').trim(), size: 18, font: 'Arial', color: '444444' })],
        spacing: { after: 60 },
      }));
      continue;
    }
    if (['EXPERIENCE:', 'PROJECTS:', 'SKILLS:', 'EDUCATION:', 'LANGUAGES:', 'CERTIFICATIONS:'].includes(line)) {
      section = line.replace(':', '');
      children.push(sectionHeader(section));
      continue;
    }
    if (line.startsWith('- ')) { children.push(bulletLine(line.slice(2))); continue; }
    if (section === 'SKILLS' && line.includes(':')) { children.push(skillLine(line)); continue; }
    if (line.includes('|')) { children.push(jobHeader(line)); continue; }
    children.push(normalLine(line));
  }
  return children;
}

async function saveDocx(text, job) {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const doc = new Document({
    numbering: {
      config: [{
        reference: 'bullets',
        levels: [{
          level: 0, format: LevelFormat.BULLET, text: '•',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 320, hanging: 220 } } },
        }],
      }],
    },
    sections: [{
      properties: {
        page: { size: { width: 12240, height: 15840 }, margin: { top: 860, right: 1100, bottom: 860, left: 1100 } },
      },
      children: parseIntoParagraphs(text),
    }],
  });

  const company  = (job.company || 'company').replace(/[^a-z0-9]/gi, '_');
  const filename = `tailored_${company}_${Date.now()}.docx`;
  const outPath  = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(outPath, await Packer.toBuffer(doc));
  return outPath;
}

// ── main export ───────────────────────────────────────────────────────────────

async function tailorResume(job) {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set in .env');

  const baseResume = await loadBaseResume();
  const jd         = trimText(job.description || '', MAX_JD_CHARS);
  const resume     = trimText(baseResume, MAX_RES_CHARS);

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL, systemInstruction: SYSTEM_PROMPT });

  const prompt = `JOB TITLE: ${job.title}\nCOMPANY: ${job.company}\n\nJOB DESCRIPTION:\n${jd}\n\nBASE RESUME:\n${resume}`;

  const result   = await model.generateContent(prompt);
  const rawText  = result.response.text();
  const text     = cleanMarkdown(rawText);
  const outPath  = await saveDocx(text, job);

  // attempt PDF conversion
  const pdfPath = await convertToPdf(outPath);

  return { text, savedTo: outPath, pdfPath };
}

module.exports = { tailorResume };