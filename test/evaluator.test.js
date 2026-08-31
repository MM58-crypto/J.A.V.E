const test = require('node:test');
const assert = require('node:assert/strict');
const {
  analyzeJobRequirements,
  buildJobAnalysisPrompt,
  evaluateJob,
} = require('../evaluator');

const privateCanaries = [
  'PRIVATE_NAME_CANARY_73A1',
  'PRIVATE_EMAIL_CANARY_92B7@example.test',
  'PRIVATE_PHONE_CANARY_48F2',
];

const careerProfile = {
  headline: 'PRIVATE_NAME_CANARY_73A1',
  years_experience: 3,
  education: 'PRIVATE_EMAIL_CANARY_92B7@example.test',
  skills: ['Node.js', 'PostgreSQL', 'PRIVATE_PHONE_CANARY_48F2'],
  languages: ['English'],
  target_roles: ['Backend Engineer'],
};

const job = {
  title: 'Backend Engineer',
  company: 'Example Company',
  description: 'Build Node.js services backed by PostgreSQL. Requires at least 2 years of experience.',
};

const modelAnalysis = {
  required_skills: ['Node.js', 'PostgreSQL'],
  preferred_skills: [],
  minimum_years: 2,
  role_domain: 'backend software engineering',
  seniority: 'mid',
  summary: 'Build and maintain backend services.',
};

test('job analysis prompt contains job data only', () => {
  const prompt = buildJobAnalysisPrompt(job);

  assert.match(prompt, /Backend Engineer/);
  assert.match(prompt, /Node\.js services/);
  for (const canary of privateCanaries) assert.equal(prompt.includes(canary), false);
});

test('model gateway never receives the local career profile', async () => {
  let capturedRequest;
  const result = await analyzeJobRequirements(job, {
    careerProfile,
    generateContent: async request => {
      capturedRequest = request;
      return modelAnalysis;
    },
  });

  const serializedRequest = JSON.stringify(capturedRequest);
  for (const canary of privateCanaries) assert.equal(serializedRequest.includes(canary), false);
  assert.equal(result.method, 'gemini');
});

test('candidate scoring happens locally after job-only analysis', async () => {
  const result = await evaluateJob(job, {
    careerProfile,
    generateContent: async () => modelAnalysis,
  });

  assert.equal(result.verdict, 'apply');
  assert.deepEqual(result.matched, ['Node.js', 'PostgreSQL']);
  assert.deepEqual(result.missing, []);
  assert.equal(result.analysis_method, 'gemini');
});

test('malformed model output falls back to local extraction', async () => {
  const result = await evaluateJob(job, {
    careerProfile,
    generateContent: async () => ({ invalid: true }),
  });

  assert.equal(result.analysis_method, 'local');
  assert.ok(result.matched.includes('Node.js'));
  assert.ok(result.matched.includes('PostgreSQL'));
});
