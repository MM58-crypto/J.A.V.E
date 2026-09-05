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

test('local fallback rejects unrelated roles when no skills were extracted', async () => {
  const result = await evaluateJob({
    title: 'Dental Hygienist',
    description: 'Provide routine dental cleaning and patient education in a licensed clinical practice.',
  }, {
    careerProfile,
    generateContent: async () => { throw new Error('offline'); },
  });

  assert.equal(result.verdict, 'skip');
  assert.deepEqual(result.matched, []);
});

test('local search screening works without a model and rejects excessive experience requirements', async () => {
  let modelRequests = 0;
  const options = {
    careerProfile,
    localOnly: true,
    generateContent: async () => {
      modelRequests++;
      return modelAnalysis;
    },
  };
  const relevant = await evaluateJob(job, options);
  assert.equal(relevant.verdict, 'apply');
  assert.ok(relevant.matched.includes('Node.js'));

  const tooSenior = await evaluateJob({
    ...job,
    description: 'Build Node.js services backed by PostgreSQL. Requires at least 10 years of experience.',
  }, options);
  assert.equal(tooSenior.verdict, 'skip');
  assert.equal(modelRequests, 0, 'Local search must not contact the model');
});

test('an out-of-domain title needs more than one incidental skill match', async () => {
  const options = {
    careerProfile: { ...careerProfile, skills: [...careerProfile.skills, 'AWS'] },
    localOnly: true,
  };
  const unrelated = await evaluateJob({
    title: 'Manager - NDT Level III',
    description: 'Supervise non-destructive testing and inspect welds under ASME, ASTM and AWS codes.',
  }, options);
  assert.deepEqual(unrelated.matched, ['AWS']);
  assert.equal(unrelated.verdict, 'skip');

  const adjacentRole = await evaluateJob({
    title: 'Data Platform Engineer',
    description: 'Maintain data ingestion services using Node.js and PostgreSQL, and collaborate with the platform team.',
  }, options);
  assert.equal(adjacentRole.verdict, 'apply');
});
