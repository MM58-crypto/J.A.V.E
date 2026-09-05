#!/usr/bin/env node

const {
  DEFAULT_COUNTRIES,
  readCliOptions,
  promptCountries,
  searchScope,
} = require('./search-options');

const options = readCliOptions('scout');

const inquirer = require('inquirer');
const chalk    = require('chalk');
const { getJobs } = require('./scrapers');
const { loadCareerProfile } = require('./career-profile');
const { tailorResume } = require('./tailor');
const {
  loadResumeConfig,
  selectResume,
  selectResumeManually,
} = require('./resume-selector');

// ── color by freshness ────────────────────────────────────────────────────────

function colorFreshness(label, hours) {
  if (hours <  1)  return chalk.greenBright(label);
  if (hours < 24)  return chalk.yellow(label);
  return chalk.gray(label);
}

function colorTitle(title, hours) {
  if (hours <  1)  return chalk.greenBright.bold(title);
  if (hours < 24)  return chalk.white.bold(title);
  return chalk.gray(title);
}

// ── display helpers ───────────────────────────────────────────────────────────

function printHeader(keyword, state) {
  console.clear();
  console.log(chalk.blueBright.bold('\n  SCOUT — Job Finder'));
  console.log(chalk.dim(`  Searching for: "${keyword}"`));
  printSearchContext(state);
}

function printSearchContext(state) {
  console.log(chalk.dim(`  ${searchScope(state.countries)}\n`));
  if (state.demo) console.log(chalk.yellow('  DEMO — synthetic postings, not real vacancies.\n'));
  for (const warning of state.warnings || []) {
    console.log(chalk.yellow(`  Source warning: ${warning}`));
  }
  if (state.warnings?.length) console.log('');
}

function buildChoices(jobs) {
  return jobs.map((job, i) => {
    const num      = chalk.dim(`${String(i + 1).padStart(2, ' ')}. `);
    const title    = colorTitle(job.title, job.hoursAgo);
    const company  = chalk.cyan(job.company);
    const location = chalk.dim(`${job.location || job.countryName} [${job.country}]`);
    const time     = colorFreshness(job.freshnessLabel, job.hoursAgo);
    const source   = chalk.dim(`[${job.source}]`);

    const match = chalk.green(`Local match: ${job.evaluation.score}%`);
    const name = `${num}${title}\n      ${company} · ${location} · ${time} · ${source} · ${match}`;

    return { name, value: i, short: job.title };
  });
}

async function chooseResumeForJob(job) {
  const config = loadResumeConfig();
  const recommendation = await selectResume(job, { config });

  console.log(chalk.blue(`\n  Recommended resume: ${recommendation.profile.label} (${Math.round(recommendation.confidence * 100)}% confidence)`));
  console.log(chalk.dim(`  ${recommendation.reason}\n`));

  const { profileId } = await inquirer.prompt([{
    type: 'list',
    name: 'profileId',
    message: 'Choose the base resume:',
    choices: config.profiles.map(profile => ({
      name: profile.id === recommendation.profile.id
        ? `${profile.label} (recommended)`
        : profile.label,
      value: profile.id,
    })),
    default: recommendation.profile.id,
  }]);

  return profileId === recommendation.profile.id
    ? recommendation
    : selectResumeManually(profileId, config);
}

// ── job detail view ───────────────────────────────────────────────────────────

async function showDetail(job, keyword, state) {
  console.clear();
  console.log(chalk.blueBright.bold('\n  JOB DETAIL\n'));
  printSearchContext(state);
  console.log(chalk.white.bold(`  ${job.title}`));
  console.log(chalk.cyan(`  ${job.company}`));
  console.log(chalk.dim(`  ${job.location || job.countryName} [${job.country}]  ·  ${job.freshnessLabel}  ·  ${job.source}\n`));
  console.log(chalk.green(`  Local profile match: ${job.evaluation.score}% — ${job.evaluation.verdict}`));
  console.log(chalk.dim(`  ${job.evaluation.reasoning}`));
  if (job.evaluation.matched.length) console.log(chalk.green(`  Matched: ${job.evaluation.matched.join(', ')}`));
  if (job.evaluation.missing.length) console.log(chalk.yellow(`  Missing: ${job.evaluation.missing.join(', ')}`));
  console.log(chalk.dim('  ─────────────────────────────────────────────\n'));

  // wrap description at 70 chars
  const lines = (job.description || '')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);

  for (const line of lines.slice(0, 40)) {
    console.log(chalk.white(`  ${line}`));
  }
  if (lines.length > 40) console.log(chalk.dim('\n  [...description truncated — visit link for full details]'));

  console.log(chalk.dim('\n  ─────────────────────────────────────────────'));
  console.log(chalk.blueBright(`\n  Link: ${job.link || 'N/A'}\n`));

  const { action } = await inquirer.prompt([{
    type: 'list',
    name: 'action',
    message: 'What would you like to do?',
    choices: [
      { name: '← Back to job list',            value: 'back' },
      { name: '✦  Tailor resume for this job', value: 'tailor' },
      { name: '✕  Exit',                        value: 'exit' },
    ],
  }]);

  if (action === 'tailor') {
    console.log(chalk.dim('\n  Selecting the best base resume...\n'));
    try {
      const selection = await chooseResumeForJob(job);
      console.log(chalk.dim(`\n  Tailoring the ${selection.profile.label} resume — this may take a moment...\n`));
      const { text, savedTo } = await tailorResume(job, selection.profile.path);
      console.log(chalk.greenBright('  Done! Tailored resume saved to: ') + chalk.white(savedTo));
      console.log(chalk.dim('\n  Preview (first 500 chars):\n'));
      console.log(chalk.white(text.slice(0, 500) + (text.length > 500 ? '\n  [...]' : '')));
    } catch (err) {
      console.log(chalk.red('\n  Tailor failed: ') + err.message);
    }
    console.log('');
    await pause(2000);
    return showDetail(job, keyword, state);
  }

  if (action === 'exit') {
    console.log(chalk.dim('\n  Goodbye.\n'));
    process.exit(0);
  }

  // back → return to list
  return 'back';
}

// ── job list view ─────────────────────────────────────────────────────────────

async function showList(jobs, keyword, sources, state) {
  printHeader(keyword, state);

  // source summary
  if (sources) {
    const parts = Object.entries(sources)
      .filter(([, n]) => n > 0)
      .map(([src, n]) => chalk.dim(`${src}: ${n}`));
    if (parts.length) console.log('  Sources  ' + parts.join('  ·  ') + '\n');
  }

  if (jobs.length === 0) {
    console.log(chalk.yellow('  No verified postings younger than 24 hours matched your local career profile in the selected countries.\n'));
    if (state.warnings.length) {
      console.log(chalk.yellow('  Search coverage was incomplete; unavailable sources may have matching jobs.\n'));
    }
    const { again } = await inquirer.prompt([{
      type: 'confirm', name: 'again', message: 'Search again?', default: true,
    }]);
    if (again) return searchAgain(state);
    console.log(chalk.dim('\n  Goodbye.\n'));
    process.exit(0);
  }

  console.log(chalk.dim(`  Found ${jobs.length} locally matched job(s) from the last 24 hours. Use arrow keys to select.\n`));

  const choices = [
    ...buildChoices(jobs),
    new inquirer.Separator(),
    { name: chalk.cyan('⟳  Search again'),  value: 'search' },
    { name: chalk.dim('✕  Exit'),            value: 'exit' },
  ];

  const { selected } = await inquirer.prompt([{
    type: 'list',
    name: 'selected',
    message: 'Select a job to view details:',
    choices,
    pageSize: 12,
  }]);

  if (selected === 'exit') {
    console.log(chalk.dim('\n  Goodbye.\n'));
    process.exit(0);
  }

  if (selected === 'search') return searchAgain(state);

  const result = await showDetail(jobs[selected], keyword, state);
  if (result === 'back') return showList(jobs, keyword, sources, state);
}

// ── pause helper ──────────────────────────────────────────────────────────────

function pause(ms = 1500) {
  return new Promise(r => setTimeout(r, ms));
}

// ── search ────────────────────────────────────────────────────────────────────

async function searchAgain(state, initial = false) {
  console.clear();
  console.log(chalk.blueBright.bold('\n  SCOUT — Job Finder\n'));

  if (!initial || !state.countryOverride) {
    state.countries = await promptCountries(state.countries);
  }
  console.log(chalk.dim(`  ${searchScope(state.countries)}\n`));
  const { keyword } = await inquirer.prompt([{
    type: 'input',
    name: 'keyword',
    message: 'Enter job role or keyword:',
    default: state.keyword || state.careerProfile.target_roles[0],
    validate: v => v.trim().length > 0 || 'Please enter a keyword',
  }]);

  state.keyword = keyword.trim();
  state.warnings = [];
  printHeader(state.keyword, state);
  console.log(chalk.dim('  Fetching and locally evaluating jobs...\n'));

  const { jobs, sources, warnings, countries } = await getJobs(state.keyword, {
    countries: state.countries,
    demo: state.demo,
    careerProfile: state.careerProfile,
  });
  state.countries = countries.map(country => country.code);
  state.warnings = warnings;
  await showList(jobs, state.keyword, sources, state);
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  await searchAgain({
    careerProfile: loadCareerProfile(),
    countries: options.countries || DEFAULT_COUNTRIES,
    countryOverride: Boolean(options.countries),
    demo: options.demo,
    warnings: [],
  }, true);
}

main().catch(err => {
  console.error(chalk.red('\n  Error: ' + err.message));
  process.exit(1);
});
