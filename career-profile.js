const fs = require('fs');
const path = require('path');

const CAREER_PROFILE_PATH = path.join(__dirname, 'career-profile.json');

function requireStringArray(profile, field) {
  if (!Array.isArray(profile[field]) || profile[field].some(value => typeof value !== 'string' || !value.trim())) {
    throw new Error(`Career profile must define ${field} as an array of nonempty strings.`);
  }
}

function loadCareerProfile(profilePath = CAREER_PROFILE_PATH) {
  const absolutePath = path.resolve(profilePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(
      `Career profile not found: ${absolutePath}. Copy career-profile.example.json to career-profile.json and fill it in.`,
    );
  }
  if (process.platform !== 'win32' && (fs.statSync(absolutePath).mode & 0o077)) {
    throw new Error(`Career profile permissions are too broad: ${absolutePath}. Run: chmod 600 ${absolutePath}`);
  }


  let profile;
  try {
    profile = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read career profile at ${absolutePath}: ${error.message}`);
  }

  if (typeof profile.headline !== 'string' || !profile.headline.trim()) {
    throw new Error('Career profile must define a headline.');
  }
  if (!Number.isFinite(profile.years_experience) || profile.years_experience < 0) {
    throw new Error('Career profile must define a nonnegative years_experience number.');
  }
  if (typeof profile.education !== 'string' || !profile.education.trim()) {
    throw new Error('Career profile must define education.');
  }
  requireStringArray(profile, 'skills');
  requireStringArray(profile, 'languages');
  requireStringArray(profile, 'target_roles');

  return profile;
}

module.exports = { CAREER_PROFILE_PATH, loadCareerProfile };
