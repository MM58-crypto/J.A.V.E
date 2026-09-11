const {
  AlignmentType,
  BorderStyle,
  Document,
  LevelFormat,
  Packer,
  Paragraph,
  TextRun,
} = require('docx');
const { PDFParse } = require('pdf-parse');
const cheerio = require('cheerio');
const mammoth = require('mammoth');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');
const { loadCareerProfile } = require('./career-profile');
const { loadPrivateProfile } = require('./private-profile');
const { generateTailoredContent } = require('./resume-tailoring');
require('dotenv').config({ quiet: true });

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './output');
const SECTION_NAMES = new Set([
  'SUMMARY',
  'PROFILE',
  'OBJECTIVE',
  'EXPERIENCE',
  'PROJECTS',
  'SKILLS',
  'EDUCATION',
  'CERTIFICATIONS',
  'LANGUAGES',
]);

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}


function convertResumeToPdf(resumePath, outputDir = path.dirname(resumePath)) {
  const absoluteResumePath = path.resolve(resumePath);
  if (!fs.existsSync(absoluteResumePath)) {
    throw new Error(`Resume not found at: ${absoluteResumePath}`);
  }
  if (path.extname(absoluteResumePath).toLowerCase() === '.pdf') return absoluteResumePath;
  if (path.extname(absoluteResumePath).toLowerCase() !== '.docx') {
    throw new Error('Resume conversion supports only DOCX and PDF files.');
  }

  const absoluteOutputDir = path.resolve(outputDir);
  fs.mkdirSync(absoluteOutputDir, { recursive: true });
  const conversionProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'jave-pdf-'));
  try {
    execFileSync('libreoffice', [
      `-env:UserInstallation=${pathToFileURL(conversionProfile).href}`,
      '--headless',
      '--convert-to',
      'pdf',
      '--outdir',
      absoluteOutputDir,
      absoluteResumePath,
    ], { timeout: 60000, stdio: 'pipe' });
  } finally {
    fs.rmSync(conversionProfile, { recursive: true, force: true });
  }

  const pdfPath = path.join(
    absoluteOutputDir,
    `${path.basename(absoluteResumePath, path.extname(absoluteResumePath))}.pdf`,
  );
  if (!fs.existsSync(pdfPath) || fs.statSync(pdfPath).size === 0) {
    throw new Error(`LibreOffice did not create the expected PDF: ${pdfPath}`);
  }
  return pdfPath;
}

async function loadBaseResume(resumePath) {
  if (!resumePath) throw new Error('Base resume path is required.');
  const absoluteResumePath = path.resolve(resumePath);
  if (!fs.existsSync(absoluteResumePath)) {
    throw new Error(`Resume not found at: ${absoluteResumePath}`);
  }

  const ext = path.extname(absoluteResumePath).toLowerCase();
  let text;
  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ path: absoluteResumePath });
    text = result.value;
  } else if (ext === '.pdf') {
    const parser = new PDFParse({ data: fs.readFileSync(absoluteResumePath) });
    try {
      text = (await parser.getText()).text;
    } finally {
      await parser.destroy();
    }
  } else if (ext === '.txt') {
    text = fs.readFileSync(absoluteResumePath, 'utf8');
  } else {
    throw new Error(`Unsupported resume format: ${ext || '[none]'}`);
  }

  if (!text || !text.trim()) {
    throw new Error(`Resume contains no readable text: ${absoluteResumePath}`);
  }
  return text.trim();
}

function sectionName(text) {
  const normalized = normalizeWhitespace(text).replace(/:$/, '').toUpperCase();
  return SECTION_NAMES.has(normalized) ? normalized : null;
}
function paragraphLines(node) {
  const clone = node.clone();
  clone.find('br').replaceWith('\n');
  return clone.text().split('\n').map(normalizeWhitespace).filter(Boolean);
}


async function loadResumeBlocks(resumePath) {
  if (!resumePath) throw new Error('Base resume path is required.');
  const absoluteResumePath = path.resolve(resumePath);
  if (!fs.existsSync(absoluteResumePath)) {
    throw new Error(`Resume not found at: ${absoluteResumePath}`);
  }
  if (path.extname(absoluteResumePath).toLowerCase() !== '.docx') {
    throw new Error('Local resume tailoring requires a DOCX base resume.');
  }

  const { value: html } = await mammoth.convertToHtml({ path: absoluteResumePath });
  const $ = cheerio.load(html);
  const blocks = [];
  let currentSection = null;
  let bodyStarted = false;

  $('body').children().each((_, element) => {
    const tag = String(element.tagName || '').toLowerCase();
    const node = $(element);
    const lines = tag === 'p' ? paragraphLines(node) : [normalizeWhitespace(node.text())];
    const text = normalizeWhitespace(lines.join(' '));
    if (!text) return;

    if (tag === 'p') {
      const detectedSection = sectionName(text);
      if (detectedSection) {
        bodyStarted = true;
        currentSection = detectedSection;
        blocks.push({ type: 'section', text: detectedSection });
        return;
      }
      if (!bodyStarted) return;

      const title = normalizeWhitespace(node.find('strong').first().text());
      const subtitle = normalizeWhitespace(node.find('em').first().text());
      if (title && subtitle) {
        blocks.push({ type: 'entry', title, subtitle, section: currentSection });
        return;
      }

      if (currentSection === 'SKILLS' && lines.some(line => line.includes(':'))) {
        for (const line of lines) {
          if (line.includes(':')) blocks.push({ type: 'skill', text: line, section: currentSection });
        }
        return;
      }
      for (const line of lines) {
        blocks.push({ type: 'text', text: line, section: currentSection, bold: Boolean(title) });
      }
      return;
    }

    if ((tag === 'ul' || tag === 'ol') && bodyStarted) {
      node.children('li').each((__, item) => {
        const bullet = normalizeWhitespace($(item).text());
        if (bullet) blocks.push({ type: 'bullet', text: bullet, section: currentSection });
      });
    }
  });

  if (!blocks.some(block => block.type === 'section')) {
    throw new Error('Base resume must contain a recognized section such as EXPERIENCE or SKILLS.');
  }
  return blocks;
}

function prepareCareerContent(blocks, careerProfile, privateProfile) {
  // Only professional fields cross the model boundary. Mask known identity
  // values even if a base resume repeats them inside its career sections.
  const profile = Object.fromEntries([
    'headline', 'years_experience', 'education', 'skills', 'languages', 'target_roles',
  ].map(key => [key, careerProfile[key]]));
  const identities = [...new Set([
    'full_name', 'email', 'phone', 'linkedin', 'github', 'location',
  ].map(key => String(privateProfile.personal[key] || '').trim()).filter(Boolean))]
    .sort((left, right) => right.length - left.length);
  const masks = identities.map((value, index) => ({
    value,
    token: `[LOCAL_CONTACT_${String.fromCharCode(65 + index)}]`,
    pattern: new RegExp(`(?<![\\p{L}\\p{N}])${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'giu'),
  }));
  const transform = (value, restore = false) => {
    if (typeof value === 'string') {
      for (const mask of masks) {
        value = restore
          ? value.replaceAll(mask.token, mask.value)
          : value.replace(mask.pattern, mask.token);
      }
      return value;
    }
    if (Array.isArray(value)) return value.map(item => transform(item, restore));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, transform(item, restore)]));
    }
    return value;
  };
  return {
    blocks: transform(blocks),
    profile: transform(profile),
    restore: content => transform(content, true),
  };
}

function requireResumeIdentity(privateProfile) {
  const required = ['full_name', 'email', 'phone'];
  const missing = required.filter(field => !String(privateProfile.personal[field] || '').trim());
  if (missing.length) {
    throw new Error(`Private profile is missing required resume identity fields: ${missing.join(', ')}`);
  }
}

function formatContact(privateProfile) {
  const personal = privateProfile.personal;
  return [
    personal.phone,
    personal.email,
    personal.linkedin,
    personal.github,
    personal.location,
  ].map(normalizeWhitespace).filter(Boolean).join(' | ');
}

function sectionHeader(text) {
  return new Paragraph({
    children: [new TextRun({ text: text.toUpperCase(), bold: true, size: 20, font: 'Arial' })],
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '000000', space: 1 } },
    spacing: { before: 160, after: 80 },
  });
}

function normalLine(text, options = {}) {
  return new Paragraph({
    alignment: options.alignment,
    children: [new TextRun({
      text,
      bold: Boolean(options.bold),
      italics: Boolean(options.italics),
      size: options.size || 19,
      font: 'Arial',
      color: options.color,
    })],
    spacing: options.spacing || { before: 30, after: 30 },
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

function entryLine(block) {
  return new Paragraph({
    children: [
      new TextRun({ text: block.title, bold: true, size: 20, font: 'Arial' }),
      new TextRun({ text: `\n${block.subtitle}`, italics: true, size: 18, font: 'Arial' }),
    ],
    spacing: { before: 120, after: 40 },
  });
}

function renderBlock(block) {
  if (block.type === 'section') return sectionHeader(block.text);
  if (block.type === 'entry') return entryLine(block);
  if (block.type === 'bullet') return bulletLine(block.text);
  if (block.type === 'skill') return skillLine(block.text);
  return normalLine(block.text, { bold: block.bold });
}

function buildResumeParagraphs(summary, blocks, privateProfile, careerProfile) {
  requireResumeIdentity(privateProfile);
  return [
    normalLine(privateProfile.personal.full_name, {
      alignment: AlignmentType.CENTER,
      bold: true,
      size: 36,
      spacing: { after: 40 },
    }),
    normalLine(careerProfile.headline, {
      alignment: AlignmentType.CENTER,
      bold: true,
      size: 22,
      spacing: { after: 30 },
    }),
    normalLine(formatContact(privateProfile), {
      alignment: AlignmentType.CENTER,
      size: 18,
      color: '444444',
      spacing: { after: 80 },
    }),
    sectionHeader('SUMMARY'),
    normalLine(summary),
    ...blocks.map(renderBlock),
  ];
}

function blockText(block) {
  if (block.type === 'section') return block.text;
  if (block.type === 'entry') return `${block.title}\n${block.subtitle}`;
  if (block.type === 'bullet') return `- ${block.text}`;
  return block.text;
}

function buildResumeText(summary, blocks, privateProfile, careerProfile) {
  requireResumeIdentity(privateProfile);
  return [
    privateProfile.personal.full_name,
    careerProfile.headline,
    formatContact(privateProfile),
    '',
    'SUMMARY',
    summary,
    '',
    ...blocks.map(blockText),
  ].join('\n');
}

function filenamePart(value, fallback, limit) {
  const words = String(value || '').normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '');
  return Array.from(words).slice(0, limit).join('').replace(/_+$/g, '') || fallback;
}

async function saveDocx(job, summary, blocks, privateProfile, careerProfile, outputDir = OUTPUT_DIR) {
  const absoluteOutputDir = path.resolve(outputDir);
  fs.mkdirSync(absoluteOutputDir, { recursive: true });
  const doc = new Document({
    numbering: {
      config: [{
        reference: 'bullets',
        levels: [{
          level: 0,
          format: LevelFormat.BULLET,
          text: '•',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 320, hanging: 220 } } },
        }],
      }],
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 860, right: 1100, bottom: 860, left: 1100 },
        },
      },
      children: buildResumeParagraphs(summary, blocks, privateProfile, careerProfile),
    }],
  });

  const name = filenamePart(privateProfile.personal.full_name, 'Candidate', 48);
  const role = filenamePart(job.title, 'Job', 72);
  const artifactDir = fs.mkdtempSync(path.join(absoluteOutputDir, 'resume-'));
  const outPath = path.join(artifactDir, `${name}_${role}_resume.docx`);
  fs.writeFileSync(outPath, await Packer.toBuffer(doc));
  return outPath;
}
// - the function just connects the blocks together and
// saves the files as docx and pdf
// no actual tailoring is involved?, career profile/exp blocks not loaded correctly
async function tailorResume(job, resumePath, options = {}) {
  const privateProfile = options.privateProfile || loadPrivateProfile();
  const careerProfile = options.careerProfile || loadCareerProfile();
  requireResumeIdentity(privateProfile);
  const sourceBlocks = await loadResumeBlocks(resumePath);
  const career = prepareCareerContent(sourceBlocks, careerProfile, privateProfile);
  const { summary, blocks } = career.restore(await generateTailoredContent(
    job, career.blocks, career.profile, { generateContent: options.generateContent },
  ));
  const outputDir = options.outputDir || OUTPUT_DIR;
  const savedTo = await saveDocx(job, summary, blocks, privateProfile, careerProfile, outputDir);
  const pdfPath = convertResumeToPdf(savedTo);
  return {
    text: buildResumeText(summary, blocks, privateProfile, careerProfile),
    savedTo,
    pdfPath,
  };
}

module.exports = {
  buildResumeText,
  convertResumeToPdf,
  loadBaseResume,
  loadResumeBlocks,
  tailorResume,
};
