#!/usr/bin/env node

const inquirer = require('inquirer');
const chalk    = require('chalk');
const { getJobs, fetchDescription } = require('./scrapers');
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

function printHeader(keyword) {
  console.clear();
  console.log(chalk.blueBright.bold('\n  SCOUT — Job Finder'));
  console.log(chalk.dim(`  Searching for: "${keyword}"\n`));
}

function printLegend() {
  console.log(
    chalk.greenBright('● < 1 hr') + '  ' +
    chalk.yellow('● < 24 hrs') + '  ' +
    chalk.gray('● older') + '\n'
  );
}

function buildChoices(jobs) {
  return jobs.map((job, i) => {
    const num      = chalk.dim(`${String(i + 1).padStart(2, ' ')}. `);
    const title    = colorTitle(job.title, job.hoursAgo);
    const company  = chalk.cyan(job.company);
    const location = chalk.dim(job.location || 'Saudi Arabia');
    const time     = colorFreshness(job.freshnessLabel, job.hoursAgo);
    const source   = chalk.dim(`[${job.source}]`);

    const name = `${num}${title}\n      ${company} · ${location} · ${time} · ${source}`;

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

async function showDetail(job, keyword) {
  console.clear();
  console.log(chalk.blueBright.bold('\n  JOB DETAIL\n'));
  console.log(chalk.white.bold(`  ${job.title}`));
  console.log(chalk.cyan(`  ${job.company}`));
  console.log(chalk.dim(`  ${job.location || 'Saudi Arabia'}  ·  ${job.freshnessLabel}  ·  ${job.source}\n`));
  console.log(chalk.dim('  ─────────────────────────────────────────────\n'));

  if (!job.description) {
    process.stdout.write(chalk.dim('  Fetching description...'));
    job.description = await fetchDescription(job);
    process.stdout.write('\r' + ' '.repeat(40) + '\r');
  }

  // wrap description at 70 chars
  const lines = job.description
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
    return showDetail(job, keyword);
  }

  if (action === 'exit') {
    console.log(chalk.dim('\n  Goodbye.\n'));
    process.exit(0);
  }

  // back → return to list
  return 'back';
}

// ── job list view ─────────────────────────────────────────────────────────────

async function showList(jobs, keyword, sources) {
  printHeader(keyword);
  printLegend();

  // source summary
  if (sources) {
    const parts = Object.entries(sources)
      .filter(([, n]) => n > 0)
      .map(([src, n]) => chalk.dim(`${src}: ${n}`));
    if (parts.length) console.log('  Sources  ' + parts.join('  ·  ') + '\n');
  }

  if (jobs.length === 0) {
    console.log(chalk.red('  No jobs found. Try a different keyword.\n'));
    const { again } = await inquirer.prompt([{
      type: 'confirm', name: 'again', message: 'Search again?', default: true,
    }]);
    if (again) return searchAgain();
    console.log(chalk.dim('\n  Goodbye.\n'));
    process.exit(0);
  }

  console.log(chalk.dim(`  Found ${jobs.length} job(s). Use arrow keys to select.\n`));

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

  if (selected === 'search') return searchAgain();

  const result = await showDetail(jobs[selected], keyword);
  if (result === 'back') return showList(jobs, keyword, sources);
}

// ── pause helper ──────────────────────────────────────────────────────────────

function pause(ms = 1500) {
  return new Promise(r => setTimeout(r, ms));
}

// ── search ────────────────────────────────────────────────────────────────────

async function searchAgain() {
  console.clear();
  console.log(chalk.blueBright.bold('\n  SCOUT — Job Finder\n'));

  const { keyword } = await inquirer.prompt([{
    type: 'input',
    name: 'keyword',
    message: 'Enter job role or keyword:',
    validate: v => v.trim().length > 0 || 'Please enter a keyword',
  }]);

  const demo = process.argv.includes('--demo');
  console.clear();
  console.log(chalk.blueBright.bold('\n  SCOUT — Job Finder\n'));
  console.log(chalk.dim(`  Fetching jobs for "${keyword.trim()}"...\n`));

  const { jobs, sources } = await getJobs(keyword.trim(), demo);
  await showList(jobs, keyword.trim(), sources);
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  await searchAgain();
}

main().catch(err => {
  console.error(chalk.red('\n  Error: ' + err.message));
  process.exit(1);
});
