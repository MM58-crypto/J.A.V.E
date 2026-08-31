const fs = require('fs');
const path = require('path');

const PRIVATE_PROFILE_PATH = path.join(__dirname, 'private-profile.json');

function loadPrivateProfile(profilePath = PRIVATE_PROFILE_PATH) {
  const absolutePath = path.resolve(profilePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(
      `Private profile not found: ${absolutePath}. Copy private-profile.example.json to private-profile.json and fill it in.`,
    );
  }
  if (process.platform !== 'win32' && (fs.statSync(absolutePath).mode & 0o077)) {
    throw new Error(`Private profile permissions are too broad: ${absolutePath}. Run: chmod 600 ${absolutePath}`);
  }


  let profile;
  try {
    profile = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read private profile at ${absolutePath}: ${error.message}`);
  }

  if (!profile.personal || typeof profile.personal !== 'object') {
    throw new Error('Private profile must contain a personal object.');
  }
  if (!profile.application || typeof profile.application !== 'object') {
    throw new Error('Private profile must contain an application object.');
  }
  if (!profile.field_aliases || typeof profile.field_aliases !== 'object') {
    throw new Error('Private profile must contain a field_aliases object.');
  }

  return profile;
}

module.exports = { PRIVATE_PROFILE_PATH, loadPrivateProfile };
