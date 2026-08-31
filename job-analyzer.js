const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config({ quiet: true });

const GEMINI_MODEL = 'gemini-3.1-flash-lite';
const MAX_JD_CHARS = 8000;

const SYSTEM_PROMPT = `
You extract factual requirements from a job posting.
You receive job-posting data only. Do not request or infer any candidate information.
Return only valid JSON with this shape:
{
  "required_skills": ["explicitly required skill"],
  "preferred_skills": ["explicitly preferred skill"],
  "minimum_years": <number or null>,
  "role_domain": "<short factual domain>",
  "seniority": "<intern|junior|mid|senior|lead|manager|unknown>",
  "summary": "<one factual sentence>"
}
Do not add requirements that are absent from the posting.
`.trim();

function trimJobDescription(text) {
  const value = String(text || '');
  if (value.length <= MAX_JD_CHARS) return value;
  return value.slice(0, MAX_JD_CHARS) + '\n[...truncated]';
}

function buildJobAnalysisPrompt(job) {
  return [
    `JOB TITLE: ${job.title || ''}`,
    `COMPANY: ${job.company || ''}`,
    '',
    'JOB DESCRIPTION:',
    trimJobDescription(job.description),
  ].join('\n');
}

function normalizeStringArray(value, field) {
  if (!Array.isArray(value)) throw new Error(`Job analysis must define ${field} as an array.`);
  return [...new Set(value.map(item => String(item || '').trim()).filter(Boolean))];
}

function normalizeJobAnalysis(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Job analysis must be an object.');
  const minimumYears = raw.minimum_years === null || raw.minimum_years === undefined
    ? null
    : Number(raw.minimum_years);
  if (minimumYears !== null && (!Number.isFinite(minimumYears) || minimumYears < 0 || minimumYears > 50)) {
    throw new Error('Job analysis minimum_years must be null or a number from 0 to 50.');
  }

  return {
    required_skills: normalizeStringArray(raw.required_skills, 'required_skills'),
    preferred_skills: normalizeStringArray(raw.preferred_skills, 'preferred_skills'),
    minimum_years: minimumYears,
    role_domain: String(raw.role_domain || 'unknown').trim() || 'unknown',
    seniority: String(raw.seniority || 'unknown').trim() || 'unknown',
    summary: String(raw.summary || '').trim(),
  };
}

async function generateGeminiAnalysis(job) {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set in .env');
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: { responseMimeType: 'application/json' },
  });
  const result = await model.generateContent(buildJobAnalysisPrompt(job));
  return JSON.parse(result.response.text().replace(/```json|```/g, '').trim());
}

async function analyzeJobRequirements(job, options = {}) {
  const raw = options.generateContent
    ? await options.generateContent({
      systemInstruction: SYSTEM_PROMPT,
      prompt: buildJobAnalysisPrompt(job),
    })
    : await generateGeminiAnalysis(job);
  return {
    analysis: normalizeJobAnalysis(raw),
    method: 'gemini',
  };
}

module.exports = {
  SYSTEM_PROMPT,
  analyzeJobRequirements,
  buildJobAnalysisPrompt,
  normalizeJobAnalysis,
  trimJobDescription,
};
