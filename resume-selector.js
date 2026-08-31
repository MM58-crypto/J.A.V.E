const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'resumes.json');

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9+#./]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsPhrase(text, phrase) {
  const normalizedPhrase = normalizeText(phrase);
  if (!normalizedPhrase) return false;
  return ` ${text} `.includes(` ${normalizedPhrase} `);
}

function requireStringArray(profile, field) {
  if (!Array.isArray(profile[field]) || profile[field].length === 0) {
    throw new Error(`Resume profile "${profile.id || '[unknown]'}" must define ${field}.`);
  }
  if (profile[field].some(value => typeof value !== 'string' || !value.trim())) {
    throw new Error(`Resume profile "${profile.id || '[unknown]'}" has an invalid ${field} entry.`);
  }
}

function validateResumeConfig(rawConfig, configDir, checkFiles = true) {
  if (!rawConfig || !Array.isArray(rawConfig.profiles) || rawConfig.profiles.length === 0) {
    throw new Error('Resume configuration must contain at least one profile.');
  }

  const ids = new Set();
  const paths = new Set();
  const profiles = rawConfig.profiles.map(profile => {
    if (!profile || typeof profile.id !== 'string' || !/^[a-z0-9_-]+$/.test(profile.id)) {
      throw new Error('Every resume profile must have a lowercase ID containing only letters, numbers, underscores, or hyphens.');
    }
    if (ids.has(profile.id)) throw new Error(`Duplicate resume profile ID: ${profile.id}`);
    ids.add(profile.id);

    if (typeof profile.label !== 'string' || !profile.label.trim()) {
      throw new Error(`Resume profile "${profile.id}" must have a label.`);
    }
    if (typeof profile.path !== 'string' || !profile.path.trim()) {
      throw new Error(`Resume profile "${profile.id}" must have a path.`);
    }
    requireStringArray(profile, 'targetTitles');
    requireStringArray(profile, 'descriptionSignals');

    const absolutePath = path.resolve(configDir, profile.path);
    if (path.extname(absolutePath).toLowerCase() !== '.docx') {
      throw new Error(`Resume profile "${profile.id}" must point to a DOCX file.`);
    }
    if (paths.has(absolutePath)) {
      throw new Error(`Multiple resume profiles point to the same file: ${absolutePath}`);
    }
    paths.add(absolutePath);
    if (checkFiles && !fs.existsSync(absolutePath)) {
      throw new Error(`Resume profile "${profile.id}" was not found at: ${absolutePath}`);
    }

    return {
      id: profile.id,
      label: profile.label.trim(),
      path: absolutePath,
      targetTitles: [...profile.targetTitles],
      descriptionSignals: [...profile.descriptionSignals],
    };
  });

  if (typeof rawConfig.defaultProfile !== 'string' || !ids.has(rawConfig.defaultProfile)) {
    throw new Error('Resume configuration defaultProfile must reference an existing profile ID.');
  }

  return { defaultProfile: rawConfig.defaultProfile, profiles };
}

function loadResumeConfig(configPath = CONFIG_PATH) {
  const absoluteConfigPath = path.resolve(configPath);
  let rawConfig;
  try {
    rawConfig = JSON.parse(fs.readFileSync(absoluteConfigPath, 'utf8'));
  } catch (error) {
    throw new Error(`Could not load resume configuration at ${absoluteConfigPath}: ${error.message}`);
  }
  return validateResumeConfig(rawConfig, path.dirname(absoluteConfigPath));
}

function scoreProfile(job, profile) {
  const title = normalizeText(job.title);
  const description = normalizeText(job.description);
  const titleMatches = [];
  const descriptionMatches = [];
  let score = 0;

  for (const targetTitle of profile.targetTitles) {
    const normalizedTarget = normalizeText(targetTitle);
    if (title === normalizedTarget) {
      score += 10;
      titleMatches.push(targetTitle);
    } else if (containsPhrase(title, targetTitle)) {
      score += 8;
      titleMatches.push(targetTitle);
    }
    if (containsPhrase(description, targetTitle)) {
      score += 4;
      descriptionMatches.push(targetTitle);
    }
  }

  for (const signal of profile.descriptionSignals) {
    if (containsPhrase(title, signal)) {
      score += 5;
      titleMatches.push(signal);
    }
    if (containsPhrase(description, signal)) {
      score += 2;
      descriptionMatches.push(signal);
    }
  }

  return {
    profile,
    score,
    titleMatches: [...new Set(titleMatches)],
    descriptionMatches: [...new Set(descriptionMatches)],
  };
}

function selectResumeBySignals(job, config = loadResumeConfig()) {
  const ranked = config.profiles
    .map((profile, index) => ({ ...scoreProfile(job, profile), index }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      const leftDefault = left.profile.id === config.defaultProfile ? 1 : 0;
      const rightDefault = right.profile.id === config.defaultProfile ? 1 : 0;
      return rightDefault - leftDefault || left.index - right.index;
    });

  const best = ranked[0];
  const secondScore = ranked[1]?.score || 0;
  const evidence = Math.min(1, best.score / 20);
  const margin = best.score > 0 ? Math.max(0, (best.score - secondScore) / best.score) : 0;
  const confidence = Number(Math.min(0.95, 0.45 + (evidence * 0.3) + (margin * 0.2)).toFixed(2));

  let reason;
  if (best.score === 0) {
    reason = `No configured role signals matched, so the default ${best.profile.label} resume was selected.`;
  } else {
    const evidenceTerms = [...best.titleMatches, ...best.descriptionMatches].slice(0, 4);
    reason = `Matched ${best.profile.label} signals: ${evidenceTerms.join(', ')}.`;
  }

  return {
    profile: best.profile,
    confidence,
    reason,
    method: 'signals',
  };
}

function selectResume(job, options = {}) {
  const config = options.config || loadResumeConfig();
  return selectResumeBySignals(job, config);
}

function selectResumeManually(profileId, config = loadResumeConfig()) {
  const profile = config.profiles.find(candidate => candidate.id === profileId);
  if (!profile) throw new Error(`Unknown resume profile: ${profileId}`);
  return {
    profile,
    confidence: 1,
    reason: 'Selected manually by the user.',
    method: 'manual',
  };
}

module.exports = {
  loadResumeConfig,
  selectResume,
  selectResumeBySignals,
  selectResumeManually,
  validateResumeConfig,
};
