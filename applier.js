const puppeteer = require('puppeteer-extra');
const Stealth   = require('puppeteer-extra-plugin-stealth');
const readline  = require('readline');
const path      = require('path');
const fs        = require('fs');
require('dotenv').config();

puppeteer.use(Stealth());

const CHROMIUM_PATH     = process.env.CHROMIUM_PATH     || '/usr/bin/chromium';
const CHROMIUM_PROFILE  = process.env.CHROMIUM_PROFILE  || `${process.env.HOME}/.config/chromium`;
const APPLY_DELAY_MS    = 2000;  // delay between actions — looks more human

// ── inline question prompt ────────────────────────────────────────────────────

function askUser(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`\n  ❓ ${question}: `, ans => { rl.close(); resolve(ans.trim()); });
  });
}

// ── resolve a form field value from defaults ──────────────────────────────────

function resolveField(label, defaults) {
  const lower   = label.toLowerCase().trim();
  const aliases = defaults.field_aliases || {};

  // direct alias match
  for (const [alias, key] of Object.entries(aliases)) {
    if (lower.includes(alias)) {
      // find value in nested defaults
      for (const section of Object.values(defaults)) {
        if (typeof section === 'object' && section[key] !== undefined) return String(section[key]);
      }
      if (defaults[key] !== undefined) return String(defaults[key]);
    }
  }
  return null;
}

// ── delay helper ──────────────────────────────────────────────────────────────

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── fill a single form step ───────────────────────────────────────────────────

async function fillFormStep(page, defaults, resumePath) {
  await delay(APPLY_DELAY_MS);

  // text inputs and textareas
  const inputs = await page.$$('input[type="text"], input[type="number"], input[type="email"], input[type="tel"], textarea');
  for (const input of inputs) {
    const label = await page.evaluate(el => {
      const id   = el.id;
      const lbl  = id ? document.querySelector(`label[for="${id}"]`) : null;
      const aria = el.getAttribute('aria-label') || el.getAttribute('placeholder') || '';
      return lbl ? lbl.innerText.trim() : aria.trim();
    }, input);

    if (!label) continue;

    const existing = await page.evaluate(el => el.value, input);
    if (existing && existing.trim().length > 0) continue; // already filled

    const value = resolveField(label, defaults);
    if (value) {
      await input.click({ clickCount: 3 });
      await input.type(value, { delay: 40 });
    } else {
      // unknown field — ask user
      const answer = await askUser(`Unknown field "${label}"`);
      await input.click({ clickCount: 3 });
      await input.type(answer, { delay: 40 });
    }
    await delay(300);
  }

  // dropdowns (select elements)
  const selects = await page.$$('select');
  for (const select of selects) {
    const label = await page.evaluate(el => {
      const id  = el.id;
      const lbl = id ? document.querySelector(`label[for="${id}"]`) : null;
      return lbl ? lbl.innerText.trim() : el.getAttribute('aria-label') || '';
    }, select);

    const value = resolveField(label, defaults);
    if (value) {
      // try to select matching option
      await page.evaluate((el, val) => {
        const opts = Array.from(el.options);
        const match = opts.find(o => o.text.toLowerCase().includes(val.toLowerCase()));
        if (match) el.value = match.value;
      }, select, value);
    } else if (label) {
      const options = await page.evaluate(el => Array.from(el.options).map(o => o.text), select);
      const answer  = await askUser(`Dropdown "${label}" — options: ${options.slice(0, 5).join(', ')}`);
      await page.evaluate((el, val) => {
        const match = Array.from(el.options).find(o => o.text.toLowerCase().includes(val.toLowerCase()));
        if (match) el.value = match.value;
      }, select, answer);
    }
    await delay(300);
  }

  // resume upload
  const fileInputs = await page.$$('input[type="file"]');
  for (const fi of fileInputs) {
    if (resumePath && fs.existsSync(resumePath)) {
      await fi.uploadFile(resumePath);
      await delay(1000);
    }
  }

  // radio buttons — yes/no type
  const radios = await page.$$('input[type="radio"]');
  for (const radio of radios) {
    const label = await page.evaluate(el => {
      const id  = el.id;
      const lbl = id ? document.querySelector(`label[for="${id}"]`) : null;
      return lbl ? lbl.innerText.trim() : '';
    }, radio);

    const value = resolveField(label, defaults);
    if (value && (value.toLowerCase() === 'yes' || value === 'true')) {
      const isYes = label.toLowerCase().includes('yes');
      if (isYes) await radio.click();
    }
    await delay(200);
  }
}

// ── check for external redirect ───────────────────────────────────────────────

async function isExternalRedirect(page) {
  const url = page.url();
  return !url.includes('linkedin.com');
}

// ── main apply function ───────────────────────────────────────────────────────

async function applyToJob(job, resumePath) {
  const browser = await puppeteer.launch({
    executablePath:  CHROMIUM_PATH,
    userDataDir:     CHROMIUM_PROFILE,
    headless:        false,
    defaultViewport: null,
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--no-sandbox',
      '--start-maximized',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions-except',
    ],
  });

  const page = await browser.newPage();

  // mask automation fingerprints
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins',   { get: () => [1, 2, 3] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    window.chrome = { runtime: {} };
  });

  // set a real user agent
  await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  try {
    console.log(`\n  Opening: ${job.link}`);
    await page.goto(job.link, { waitUntil: 'networkidle2', timeout: 80000 });
    await delay(APPLY_DELAY_MS);

    // check for external redirect
    if (await isExternalRedirect(page)) {
      console.log('  ⚠  External site detected — skipping.');
      await browser.close();
      return { status: 'skipped', reason: 'external_redirect' };
    }

    // click Easy Apply button
    const easyApplyBtn = await page.$('[data-control-name="jobdetails_topcard_inapply"], .jobs-apply-button, button[aria-label*="Easy Apply"]');
    if (!easyApplyBtn) {
      console.log('  ⚠  No Easy Apply button found — skipping.');
      await browser.close();
      return { status: 'skipped', reason: 'no_easy_apply' };
    }

    await easyApplyBtn.click();
    await delay(APPLY_DELAY_MS);

    // multi-step form loop
    let step = 0;
    const MAX_STEPS = 10;

    while (step < MAX_STEPS) {
      step++;

      // check for external redirect after each step
      if (await isExternalRedirect(page)) {
        console.log('  ⚠  Redirected to external site — skipping.');
        await browser.close();
        return { status: 'skipped', reason: 'external_redirect_mid_apply' };
      }

      await fillFormStep(page, require('./defaults.json'), resumePath);
      await delay(APPLY_DELAY_MS);

      // look for submit button
      const submitBtn = await page.$('button[aria-label="Submit application"], button[data-control-name="submit_unify"]');
      if (submitBtn) {
        await submitBtn.click();
        await delay(2000);
        console.log('  ✓  Application submitted.');
        await browser.close();
        return { status: 'applied' };
      }

      // look for next/continue button
      const nextBtn = await page.$('button[aria-label="Continue to next step"], button[aria-label="Next"], footer button:last-child');
      if (nextBtn) {
        await nextBtn.click();
        await delay(APPLY_DELAY_MS);
        continue;
      }

      // no next, no submit — stuck
      console.log('  ⚠  Could not find next or submit button — pausing for manual intervention.');
      await askUser('Press Enter when done to continue or type "skip" to skip');
      break;
    }

    await browser.close();
    return { status: 'incomplete', reason: 'max_steps_reached' };

  } catch (err) {
    await browser.close();
    return { status: 'error', reason: err.message };
  }
}

module.exports = { applyToJob };