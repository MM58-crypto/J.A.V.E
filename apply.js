#!/usr/bin/env node

const chalk      = require('chalk');
const readline   = require('readline');
const fs         = require('fs');
const path       = require('path');
const { getJobs, fetchDescription } = require('./scrapers');
const { evaluateJob }  = require('./evaluator');
const { tailorResume } = require('./tailor');
const { applyToJob }   = require('./applier');
require('dotenv').config();

const MAX_JOBS      = 15;
const LOG_FILE      = './applications.json';
const SCORE_THRESHOLD = 50;

// ── logger ────────────────────────────────────────────────────────────────────

function logApplication(job, evaluation, result) {
  const entry = {
    date:      new Date().toISOString(),
    title:     job.title,
    company:   job.company,
    location:  job.location,
    link:      job.link,
    score:     evaluation.score,
    matched:   evaluation.matched,
    missing:   evaluation.missing,
    reasoning: evaluation.reasoning,
    status:    result.status,
    reason:    result.reason || '',
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

function printEvaluation(job, ev) {
  const scoreColor = ev.score >= 70 ? chalk.greenBright : ev.score >= 50 ? chalk.yellow : chalk.red;

  console.log(chalk.dim('\n  ────────────────────────────────────────────'));
  console.log(chalk.white.bold(`  ${job.title}`));
  console.log(chalk.cyan(`  ${job.company}  ·  ${job.location}  ·  ${job.freshnessLabel}`));
  console.log(`  Match: ${scoreColor(`${ev.score}%`)}  —  ${chalk.dim(ev.reasoning)}`);

  if (ev.matched.length)    console.log(chalk.green(`  ✓ ${ev.matched.slice(0, 5).join('  ✓ ')}`));
  if (ev.missing.length)    console.log(chalk.red(`  ✗ ${ev.missing.slice(0, 3).join('  ✗ ')}`));
  if (ev.red_lines.length)  console.log(chalk.red(`  ⚠  ${ev.red_lines.join(', ')}`));

  console.log(chalk.dim('\n  [Y] Apply   [N] Skip   [V] View JD   [Q] Quit\n'));
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  const keyword = process.argv[2];
  if (!keyword) {
    console.log(chalk.red('\n  Usage: node apply.js "Software Engineer"\n'));
    process.exit(1);
  }

  console.clear();
  console.log(chalk.blueBright.bold('\n  JAVE Agent — LinkedIn Auto-Apply\n'));
  console.log(chalk.dim(`  Searching for "${keyword}"...\n`));

  const { jobs } = await getJobs(keyword);

  if (!jobs.length) {
    console.log(chalk.red('  No jobs found. Exiting.\n'));
    process.exit(0);
  }

  const batch = jobs.slice(0, MAX_JOBS);
  console.log(chalk.dim(`  Found ${jobs.length} jobs — processing up to ${batch.length}.\n`));

  let applied = 0;
  let skipped = 0;

  for (const job of batch) {
    // fetch description if not already loaded
    if (!job.description) {
      process.stdout.write(chalk.dim(`  Fetching description for "${job.title}"...`));
      job.description = await fetchDescription(job);
      process.stdout.write('\r' + ' '.repeat(60) + '\r');
    }

    // evaluate
    process.stdout.write(chalk.dim(`  Evaluating "${job.title}"...`));
    const ev = await evaluateJob(job);
    process.stdout.write('\r' + ' '.repeat(60) + '\r');

    // auto-skip low scores and red lines
    if (ev.score < SCORE_THRESHOLD || ev.verdict === 'skip') {
      console.log(chalk.dim(`  Skipped: ${job.title} at ${job.company} (score: ${ev.score}%)`));
      logApplication(job, ev, { status: 'auto_skipped' });
      skipped++;
      continue;
    }

    // human in the loop
    printEvaluation(job, ev);
    let key = null;
    while (!['y', 'n', 'q'].includes(key)) {
      key = await waitForKey(['y', 'n', 'v', 'q']);
      if (key === 'v') {
        console.log(chalk.dim('\n' + (job.description || '').slice(0, 800) + '\n'));
      }
    }

    if (key === 'q') {
      console.log(chalk.dim('\n  Quitting.\n'));
      break;
    }

    if (key === 'n') {
      logApplication(job, ev, { status: 'manually_skipped' });
      skipped++;
      continue;
    }

    // approved — tailor resume
    console.log(chalk.dim('\n  Tailoring resume...'));
    let resumePath = null;
    try {
      const { savedTo, pdfPath } = await tailorResume(job);
      resumePath = pdfPath ? path.resolve(pdfPath) : path.resolve(savedTo);
      console.log(chalk.green(`  Resume saved: ${savedTo}`));
      if (pdfPath) console.log(chalk.green(`  PDF ready:   ${pdfPath}`));
    } catch (err) {
      console.log(chalk.yellow(`  Tailor failed (${err.message}) — using base resume.`));
      resumePath = path.resolve(process.env.RESUME_PATH || './base_resume.pdf');
    }

    // apply
    console.log(chalk.dim('  Launching browser...\n'));
    const result = await applyToJob(job, resumePath);

    logApplication(job, ev, result);

    if (result.status === 'applied') {
      console.log(chalk.greenBright(`  ✓ Applied to ${job.title} at ${job.company}`));
      applied++;
    } else {
      console.log(chalk.yellow(`  ⚠  ${result.status}: ${result.reason}`));
      skipped++;
    }
  }

  console.log(chalk.blueBright.bold(`\n  Session complete — Applied: ${applied}  Skipped: ${skipped}\n`));
}

main().catch(err => {
  console.error(chalk.red('\n  Fatal error: ' + err.message));
  process.exit(1);
});