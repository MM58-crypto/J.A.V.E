const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const GEMINI_MODEL = 'gemini-3.1-flash-lite';
const MAX_JD_CHARS = 2500;

const SYSTEM_PROMPT = `
You are a job application evaluator.
Given a job description and a candidate profile, score the match from 0 to 100.
Return ONLY valid JSON with no markdown fences or commentary.
Format:
{
  "score": <0-100>,
  "verdict": "<apply|skip>",
  "matched": ["skill1", "skill2"],
  "missing": ["skill1", "skill2"],
  "red_lines": ["reason if any"],
  "reasoning": "<one sentence>"
}
Red lines that must trigger skip regardless of score:
- Required years of experience exceeds candidate years by more than 2
- Role is completely outside candidate's domain
`.trim();

const CANDIDATE_PROFILE = `
Name: Software Engineer
Experience: 2 years
Skills: Python, JavaScript, Node.js, Django,  Docker, Git, Linux, AWS,
        REST APIs, SQL (PostgreSQL, MySQL), Qdrant, Weaviate, Haystack,
        LangChain, LangGraph, Gemini API, OpenAI API, RAG pipelines,
        Microservices, Unit Testing
Education: B.Sc. Computer Science (Software Engineering), 2024
Languages: Arabic (Native), English (IELTS 8.0)
Location: Riyadh, Saudi Arabia
Target roles: Software Engineer, AI Engineer, Backend Engineer, Full Stack Engineer
`.trim();

function trimJD(text) {
  if (!text || text.length <= MAX_JD_CHARS) return text;
  return text.slice(0, MAX_JD_CHARS) + '\n[...truncated]';
}

async function evaluateJob(job) {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set in .env');

  const jd = trimJD(job.description || '');
  if (!jd || jd.length < 50) {
    return { score: 0, verdict: 'skip', matched: [], missing: [], red_lines: ['No description available'], reasoning: 'Cannot evaluate without a job description.' };
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL, systemInstruction: SYSTEM_PROMPT });

  const prompt = `
JOB TITLE: ${job.title}
COMPANY: ${job.company}

JOB DESCRIPTION:
${jd}

CANDIDATE PROFILE:
${CANDIDATE_PROFILE}
`.trim();

  const result = await model.generateContent(prompt);
  const raw    = result.response.text().replace(/```json|```/g, '').trim();

  try {
    return JSON.parse(raw);
  } catch {
    return { score: 0, verdict: 'skip', matched: [], missing: [], red_lines: ['Parse error'], reasoning: raw.slice(0, 100) };
  }
}

module.exports = { evaluateJob };
