const test = require('node:test');
const assert = require('node:assert/strict');
const {
  selectResume,
  selectResumeBySignals,
  selectResumeManually,
  validateResumeConfig,
} = require('../resume-selector');

const config = validateResumeConfig({
  defaultProfile: 'swe',
  profiles: [
    {
      id: 'it',
      label: 'IT Specialist',
      path: './it.docx',
      targetTitles: ['IT Specialist', 'Help Desk Technician'],
      descriptionSignals: ['Active Directory', 'Microsoft 365', 'ticketing', 'hardware troubleshooting'],
    },
    {
      id: 'swe',
      label: 'Software Engineer',
      path: './swe.docx',
      targetTitles: ['Software Engineer', 'Backend Engineer', 'Full Stack Engineer'],
      descriptionSignals: ['REST API', 'backend', 'frontend', 'Node.js', 'SQL'],
    },
    {
      id: 'ai',
      label: 'AI Engineer',
      path: './ai.docx',
      targetTitles: ['AI Engineer', 'Machine Learning Engineer', 'LLM Engineer'],
      descriptionSignals: ['generative AI', 'LLM', 'RAG', 'embeddings', 'vector database', 'semantic search', 'LangChain'],
    },
  ],
}, '/tmp/jave-selector-tests', false);

test('IT title and support responsibilities select the IT resume', () => {
  const selection = selectResumeBySignals({
    title: 'IT Specialist',
    description: 'Provide Microsoft 365 support, manage Active Directory, and resolve ticketing requests and hardware troubleshooting incidents.',
  }, config);

  assert.equal(selection.profile.id, 'it');
  assert.equal(selection.method, 'signals');
});

test('software development role selects the SWE resume', () => {
  const selection = selectResumeBySignals({
    title: 'Backend Engineer',
    description: 'Build Node.js REST API services backed by SQL databases.',
  }, config);

  assert.equal(selection.profile.id, 'swe');
});

test('AI-heavy description overrides a broad Software Engineer title', () => {
  const selection = selectResumeBySignals({
    title: 'Software Engineer',
    description: 'Build generative AI products using LLM orchestration, RAG, embeddings, vector database retrieval, semantic search, and LangChain.',
  }, config);

  assert.equal(selection.profile.id, 'ai');
});

test('public selector uses deterministic local signals', () => {
  const selection = selectResume({
    title: 'Help Desk Technician',
    description: 'Resolve Active Directory and Microsoft 365 support tickets.',
  }, { config });

  assert.equal(selection.profile.id, 'it');
  assert.equal(selection.method, 'signals');
});

test('manual selection replaces the recommendation', () => {
  const selection = selectResumeManually('swe', config);

  assert.equal(selection.profile.id, 'swe');
  assert.equal(selection.confidence, 1);
  assert.equal(selection.method, 'manual');
});
