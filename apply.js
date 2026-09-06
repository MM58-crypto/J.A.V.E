#!/usr/bin/env node

const {
  PRIORITY_AGE_HOURS,
  readCliOptions,
  promptCountries,
  searchScope,
} = require('./search-options');

const options = readCliOptions('apply');

const chalk      = require('chalk');
const inquirer   = require('inquirer');
const fs         = require('fs');
const path       = require('path');
const { getJobs } = require('./scrapers');
const { loadCareerProfile } = require('./career-profile');
const { evaluateJob }  = require('./evaluator');
const { tailorResume } = require('./tailor');
const { applyToJob } = require('./applier');
const {
  loadResumeConfig,
  selectResume,
  selectResumeManually,
} = require('./resume-selector');
require('dotenv').config({ quiet: true });

const MAX_JOBS      = 15;
const LOG_FILE      = './applications.json';
const SCORE_THRESHOLD = 50;

// ── logger ────────────────────────────────────────────────────────────────────

function logApplication(job, evaluation, result, resumeSelection = null) {
  const entry = {
    date:      new Date().toISOString(),
    title:     job.title,
    company:   job.company,
    location:  job.location,
    country:   job.country,
    countryName: job.countryName,
    link:      job.link,
    score:     evaluation.score,
    matched:   evaluation.matched,
    missing:   evaluation.missing,
    reasoning: evaluation.reasoning,
    analysis_method: evaluation.analysis_method || 'unknown',
    status:    result.status,
    reason:    result.reason || '',
    reviewed:  Boolean(result.reviewed),
    ...(resumeSelection ? {
      resume_profile: resumeSelection.profile.id,
      resume_selection_confidence: resumeSelection.confidence,
      resume_selection_reason: resumeSelection.reason,
      resume_selection_method: resumeSelection.method,
    } : {}),
  };

  let log = [];
  if (fs.existsSync(LOG_FILE)) {
    try { log = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')); } catch { log = []; }
  }
  log.push(entry);
  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
}

// ── single keypress input ─────────────────────────────────────────────────────

function waitForKey(validKeys) {
  return new Promise(resolve => {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', key => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      if (key === '\u0003') process.exit(); // Ctrl+C
      const k = key.toLowerCase();
      if (validKeys.includes(k)) resolve(k);
      else resolve(null);
    });
  });
}

// ── human in the loop display ─────────────────────────────────────────────────

function printEvaluation(job, ev, resumeSelection) {
  const scoreColor = ev.score >= 70 ? chalk.greenBright : ev.score >= 50 ? chalk.yellow : chalk.red;

  console.log(chalk.dim('\n  ────────────────────────────────────────────'));
  console.log(chalk.white.bold(`  ${job.title}`));
  console.log(chalk.cyan(`  ${job.company}  ·  ${job.location || job.countryName} [${job.country}]  ·  ${job.freshnessLabel}`));
  console.log(chalk.green(`  Local profile match: ${job.evaluation.score}% — ${job.evaluation.reasoning}`));
  console.log(`  Match: ${scoreColor(`${ev.score}%`)}  —  ${chalk.dim(ev.reasoning)}`);

  if (ev.matched.length)    console.log(chalk.green(`  ✓ ${ev.matched.slice(0, 5).join('  ✓ ')}`));
  if (ev.missing.length)    console.log(chalk.red(`  ✗ ${ev.missing.slice(0, 3).join('  ✗ ')}`));
  if (ev.red_lines.length)  console.log(chalk.red(`  ⚠  ${ev.red_lines.join(', ')}`));
  console.log(chalk.blue(`  Resume: ${resumeSelection.profile.label}  ·  ${Math.round(resumeSelection.confidence * 100)}% confidence  ·  ${resumeSelection.method}`));
  console.log(chalk.dim(`  ${resumeSelection.reason}`));

  console.log(chalk.dim('\n  [Y] Prepare application   [R] Change resume   [N] Skip   [V] View JD   [Q] Quit\n'));
}

async function promptResumeOverride(config, currentSelection) {
  const { profileId } = await inquirer.prompt([{
    type: 'list',
    name: 'profileId',
    message: 'Choose the base resume:',
    choices: config.profiles.map(profile => ({
      name: profile.id === currentSelection.profile.id
        ? `${profile.label} (recommended)`
        : profile.label,
      value: profile.id,
    })),
    default: currentSelection.profile.id,
  }]);
  return selectResumeManually(profileId, config);
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  const keyword = options.keyword;
  if (!keyword) throw new Error('A job keyword is required. Usage: node apply.js "Software Engineer" [--countries MY,OM]. Use --help for details.');

  const countries = options.countries || await promptCountries();
  const careerProfile = loadCareerProfile();

  console.clear();
  console.log(chalk.blueBright.bold('\n  JAVE Agent — LinkedIn Auto-Apply\n'));
  console.log(chalk.dim(`  ${searchScope(countries)}\n`));
  console.log(chalk.dim(`  Searching for "${keyword}" and checking local profile relevance...\n`));

  const { jobs, sources, warnings } = await getJobs(keyword, { countries, careerProfile });
  for (const warning of warnings) {
    console.log(chalk.yellow(`  Source warning: ${warning}`));
  }
  const sourceSummary = Object.entries(sources)
    .filter(([, count]) => count > 0)
    .map(([source, count]) => `${source}: ${count}`);
  if (sourceSummary.length) console.log(chalk.dim(`  Displayed sources: ${sourceSummary.join(' · ')}\n`));

  if (!jobs.length) {
    console.log(chalk.yellow('  No verified postings matched your local career profile in the selected countries, including older postings.\n'));
    if (warnings.length) {
      console.log(chalk.yellow('  Search coverage was incomplete; unavailable sources may have matching jobs.\n'));
    }
    return;
  }

  const resumeConfig = loadResumeConfig();
  const batch = jobs.slice(0, MAX_JOBS);
  console.log(chalk.dim(`  Found ${jobs.length} locally matched jobs, newest first — processing up to ${batch.length}.`));
  console.log(jobs[0].hoursAgo < PRIORITY_AGE_HOURS
    ? chalk.greenBright(`  Priority: all postings are under ${PRIORITY_AGE_HOURS} hours old.\n`)
    : chalk.yellow(`  No verified matches under ${PRIORITY_AGE_HOURS} hours; processing the newest available older postings.\n`));

  let submitted = 0;
  let confirmed = 0;
  let skipped = 0;

  for (const job of batch) {
    // evaluate
    process.stdout.write(chalk.dim(`  Evaluating "${job.title}"...`));
    const ev = await evaluateJob(job, { careerProfile });
    process.stdout.write('\r' + ' '.repeat(60) + '\r');

    // auto-skip low scores and red lines
    if (ev.score < SCORE_THRESHOLD || ev.verdict === 'skip') {
      console.log(chalk.dim(`  Skipped: ${job.title} at ${job.company} (score: ${ev.score}%)`));
      logApplication(job, ev, { status: 'auto_skipped' });
      skipped++;
      continue;
    }

    process.stdout.write(chalk.dim(`  Selecting resume for "${job.title}"...`));
    let resumeSelection = await selectResume(job, { config: resumeConfig });
    process.stdout.write('\r' + ' '.repeat(60) + '\r');

    // human in the loop
    printEvaluation(job, ev, resumeSelection);
    let key = null;
    while (!['y', 'n', 'q'].includes(key)) {
      key = await waitForKey(['y', 'n', 'v', 'r', 'q']);
      if (key === 'v') {
        console.log(chalk.dim('\n' + (job.description || '').slice(0, 800) + '\n'));
      } else if (key === 'r') {
        resumeSelection = await promptResumeOverride(resumeConfig, resumeSelection);
        printEvaluation(job, ev, resumeSelection);
        key = null;
      }
    }

    if (key === 'q') {
      console.log(chalk.dim('\n  Quitting.\n'));
      break;
    }

    if (key === 'n') {
      logApplication(job, ev, { status: 'manually_skipped' }, resumeSelection);
      skipped++;
      continue;
    }

    // approved — tailor and convert resume
    console.log(chalk.dim('\n  Tailoring resume...'));
    let resumePath;
    try {
      const { savedTo, pdfPath } = await tailorResume(job, resumeSelection.profile.path);
      resumePath = path.resolve(pdfPath);
      console.log(chalk.green(`  Resume saved: ${savedTo}`));
      console.log(chalk.green(`  PDF ready:   ${pdfPath}`));
    } catch (error) {
      const result = { status: 'error', reason: `resume_preparation_failed:${error.message}` };
      logApplication(job, ev, result, resumeSelection);
      console.log(chalk.red(`  Resume preparation failed: ${error.message}`));
      skipped++;
      continue;
    }

    // apply
    console.log(chalk.dim('  Launching browser...\n'));
    const result = await applyToJob(job, resumePath);

    logApplication(job, ev, result, resumeSelection);

    if (result.status === 'applied') {
      console.log(chalk.greenBright(`  Application confirmed for ${job.title} at ${job.company}`));
      submitted++;
      confirmed++;
    } else if (result.status === 'submitted_unconfirmed') {
      console.log(chalk.yellow(`  Submitted, but LinkedIn confirmation was not detected: ${job.title} at ${job.company}`));
      submitted++;
    } else {
      console.log(chalk.yellow(`  ${result.status}: ${result.reason}`));
      skipped++;
    }
  }

  console.log(chalk.blueBright.bold(`\n  Session complete — Submitted: ${submitted}  Confirmed: ${confirmed}  Skipped/cancelled: ${skipped}\n`));
}

main().catch(err => {
  console.error(chalk.red('\n  Fatal error: ' + err.message));
  process.exit(1);
});