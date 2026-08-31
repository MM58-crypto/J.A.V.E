const { loadCareerProfile } = require('./career-profile');
const {
  SYSTEM_PROMPT,
  analyzeJobRequirements,
  buildJobAnalysisPrompt,
  normalizeJobAnalysis,
  trimJobDescription,
} = require('./job-analyzer');

function normalizeTerm(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9+#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractMinimumYears(description) {
  const matches = [...String(description || '').matchAll(/(\d{1,2})\s*\+?\s*(?:years?|yrs?)/gi)]
    .map(match => Number(match[1]))
    .filter(years => years <= 50);
  return matches.length ? Math.max(...matches) : null;
}

function analyzeLocally(job, careerProfile) {
  const haystack = normalizeTerm(`${job.title || ''} ${job.description || ''}`);
  const requiredSkills = careerProfile.skills.filter(skill => {
    const term = normalizeTerm(skill);
    return term && ` ${haystack} `.includes(` ${term} `);
  });
  return {
    required_skills: requiredSkills,
    preferred_skills: [],
    minimum_years: extractMinimumYears(job.description),
    role_domain: String(job.title || 'unknown'),
    seniority: 'unknown',
    summary: 'Requirements were extracted locally because model analysis was unavailable.',
  };
}

function termMatchesSkill(term, skill) {
  const left = normalizeTerm(term);
  const right = normalizeTerm(skill);
  return Boolean(left && right && (left === right || left.includes(right) || right.includes(left)));
}

function matchSkills(requirements, candidateSkills) {
  return requirements.filter(requirement =>
    candidateSkills.some(skill => termMatchesSkill(requirement, skill)));
}

function tokenOverlap(left, right) {
  const ignored = new Set(['and', 'engineer', 'engineering', 'developer', 'specialist']);
  const leftTokens = new Set(normalizeTerm(left).split(' ').filter(token => token && !ignored.has(token)));
  const rightTokens = new Set(normalizeTerm(right).split(' ').filter(token => token && !ignored.has(token)));
  if (!leftTokens.size || !rightTokens.size) return 0;
  const common = [...leftTokens].filter(token => rightTokens.has(token)).length;
  return common / Math.max(leftTokens.size, rightTokens.size);
}

function evaluateCandidate(job, analysis, careerProfile) {
  const required = analysis.required_skills;
  const preferred = analysis.preferred_skills;
  const matchedRequired = matchSkills(required, careerProfile.skills);
  const matchedPreferred = matchSkills(preferred, careerProfile.skills);
  const missing = required.filter(skill => !matchedRequired.includes(skill));

  const requiredScore = required.length ? (matchedRequired.length / required.length) * 55 : 35;
  const preferredScore = preferred.length ? (matchedPreferred.length / preferred.length) * 10 : 5;
  const roleFit = Math.max(...careerProfile.target_roles.map(role => tokenOverlap(job.title, role)), 0);
  const roleScore = roleFit * 20;

  const experienceGap = analysis.minimum_years === null
    ? 0
    : Math.max(0, analysis.minimum_years - careerProfile.years_experience);
  const experienceScore = analysis.minimum_years === null
    ? 15
    : Math.max(0, 15 - (experienceGap * 5));

  const redLines = [];
  if (experienceGap > 2) {
    redLines.push(
      `Requires ${analysis.minimum_years} years; candidate profile has ${careerProfile.years_experience}.`,
    );
  }
  if (roleFit === 0 && matchedRequired.length === 0 && required.length > 0) {
    redLines.push('Role is outside the configured target roles and matched skills.');
  }

  const score = Math.max(0, Math.min(100, Math.round(
    requiredScore + preferredScore + roleScore + experienceScore,
  )));
  const matched = [...new Set([...matchedRequired, ...matchedPreferred])];
  const verdict = redLines.length || score < 50 ? 'skip' : 'apply';
  const reasoning = `${matched.length} requirement${matched.length === 1 ? '' : 's'} matched; `
    + `${missing.length} required skill${missing.length === 1 ? '' : 's'} missing; `
    + `local role fit ${Math.round(roleFit * 100)}%.`;

  return {
    score,
    verdict,
    matched,
    missing,
    red_lines: redLines,
    reasoning,
  };
}

async function evaluateJob(job, options = {}) {
  const jd = trimJobDescription(job.description);
  if (!jd || jd.length < 50) {
    return {
      score: 0,
      verdict: 'skip',
      matched: [],
      missing: [],
      red_lines: ['No description available'],
      reasoning: 'Cannot evaluate without a job description.',
      analysis_method: 'none',
    };
  }

  const careerProfile = options.careerProfile || loadCareerProfile();
  let analysis;
  let method;
  try {
    ({ analysis, method } = await analyzeJobRequirements(job, {
      generateContent: options.generateContent,
    }));
  } catch {
    analysis = normalizeJobAnalysis(analyzeLocally(job, careerProfile));
    method = 'local';
  }

  return {
    ...evaluateCandidate(job, analysis, careerProfile),
    analysis_method: method,
  };
}

module.exports = {
  SYSTEM_PROMPT,
  analyzeJobRequirements,
  buildJobAnalysisPrompt,
  evaluateCandidate,
  evaluateJob,
  normalizeJobAnalysis,
};
