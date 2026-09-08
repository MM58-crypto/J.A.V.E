const puppeteer = require('puppeteer-extra');
const Stealth = require('puppeteer-extra-plugin-stealth');
const readline = require('readline');
const path = require('path');
const fs = require('fs');
const { loadPrivateProfile } = require('./private-profile');
const { loadCareerProfile } = require('./career-profile');
require('dotenv').config({ quiet: true });

puppeteer.use(Stealth());

const CHROMIUM_PATH = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
const CHROMIUM_PROFILE = process.env.CHROMIUM_PROFILE || `${process.env.HOME}/.config/chromium`;
const APPLY_DELAY_MS = 1200;
const MAX_STEPS = 10;

function askUser(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`\n  ${question}: `, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+]+/gu, ' ')
    .trim();
}

function getPathValue(object, dottedPath) {
  return dottedPath.split('.').reduce((value, key) => value?.[key], object);
}

function resolveField(label, profile) {
  const normalizedLabel = normalize(label);
  const aliases = Object.entries(profile.field_aliases || {})
    .sort(([left], [right]) => right.length - left.length);

  for (const [alias, dottedPath] of aliases) {
    if (!normalizedLabel.includes(normalize(alias))) continue;

    const value = getPathValue(profile, dottedPath);
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (Array.isArray(value)) return value.join(', ');
    return String(value);
  }

  return null;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function loadApplicationProfile() {
  return {
    ...loadPrivateProfile(),
    candidate: loadCareerProfile(),
  };
}

// Runs in the page for both waiting and subsequent form lookups.
function findEasyApplyRoot() {
  const visible = element => !element.closest('[hidden], [aria-hidden="true"], [inert]')
    && element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  const navigation = /^(next|continue|review|review application|submit|submit application)$|continue to next step/i;
  const candidates = document.querySelectorAll(
    'dialog, [role="dialog"], [aria-modal="true"], .jobs-easy-apply-modal, .artdeco-modal',
  );

  for (const root of candidates) {
    if (!visible(root)) continue;
    const labelledBy = (root.getAttribute('aria-labelledby') || '').split(/\s+/)
      .map(id => document.getElementById(id)?.textContent || '').join(' ');
    const name = [
      root.getAttribute('aria-label') || '',
      labelledBy,
      root.querySelector('h1, h2, h3, [role="heading"]')?.innerText || '',
    ].join(' ');
    const isEasyApply = root.matches('.jobs-easy-apply-modal')
      || root.querySelector('.jobs-easy-apply-modal, .jobs-easy-apply-content')
      || /\beasy\s+apply\b|\bapply\s+to\b/i.test(name);
    if (!isEasyApply) continue;

    // A visible shell can precede the form. Do not advance on its Close button.
    const ready = Array.from(root.querySelectorAll('input, select, textarea, button')).some(element => {
      if (element.disabled || !visible(element)) return false;
      if (element.tagName !== 'BUTTON') return element.type !== 'hidden';
      return [element.innerText, element.getAttribute('aria-label')]
        .some(text => navigation.test((text || '').trim()));
    });
    if (ready) return root;
  }
  return null;
}

async function getFormRoot(page, wait = false) {
  let handle;
  try {
    handle = wait
      ? await page.waitForFunction(findEasyApplyRoot, { timeout: 10000 })
      : await page.evaluateHandle(findEasyApplyRoot);
  } catch (error) {
    if (error.name !== 'TimeoutError') throw error;
    throw new Error('Easy Apply form was not detected: no visible application dialog with loaded controls. Check the open form markup or login state.', { cause: error });
  }
  const root = handle.asElement();
  if (!root) await handle.dispose();
  return root;
}

async function inspectElement(page, element) {
  return page.evaluate(el => {
    const labelledBy = el.getAttribute('aria-labelledby');
    const ariaLabel = labelledBy
      ? labelledBy.split(/\s+/).map(id => document.getElementById(id)?.innerText || '').join(' ')
      : '';
    const container = el.closest('fieldset, .fb-dash-form-element, [data-test-form-element]');
    const containerLabel = container?.querySelector('legend, .fb-dash-form-element__label')?.innerText || '';
    const directLabel = el.labels?.[0]?.innerText || '';
    const label = directLabel || ariaLabel || el.getAttribute('aria-label') || el.getAttribute('placeholder') || containerLabel;
    const visible = !el.disabled && !el.readOnly && el.type !== 'hidden' && Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length);

    return {
      label: label.trim(),
      required: el.required || el.getAttribute('aria-required') === 'true',
      visible,
      value: el.value || '',
      checked: Boolean(el.checked),
      name: el.name || el.id || '',
    };
  }, element);
}

function createRecord(label, type, value, source, required = false) {
  return {
    key: `${type}:${normalize(label)}`,
    label: label || type,
    type,
    value: String(value || ''),
    source,
    required,
  };
}

async function fillTextFields(page, root, profile, ask) {
  const records = [];
  const inputs = await root.$$('input:not([type]), input[type="text"], input[type="number"], input[type="email"], input[type="tel"], textarea');

  for (const input of inputs) {
    const field = await inspectElement(page, input);
    if (!field.visible || !field.label) continue;

    if (field.value.trim()) {
      records.push(createRecord(field.label, 'text', field.value, 'existing', field.required));
      continue;
    }

    let value = resolveField(field.label, profile);
    let source = 'profile';
    if (value === null) {
      value = await ask(`Enter a value for "${field.label}"${field.required ? ' (required)' : ''}`);
      source = value ? 'user' : 'unresolved';
    }

    if (value) {
      await input.click({ clickCount: 3 });
      await input.type(value, { delay: 20 });
    }
    records.push(createRecord(field.label, 'text', value, source, field.required));
  }

  return records;
}

function matchSelectOption(options, requested, dialCode) {
  const normalizedRequest = normalize(requested);
  if (!normalizedRequest) return null;
  const exact = options.filter(option => normalize(option.text) === normalizedRequest
    || normalize(option.value) === normalizedRequest);
  if (exact.length) return exact.length === 1 ? exact[0] : null;

  if (dialCode) {
    const matches = options.filter(option => {
      const [, country, code] = option.text.match(/^(.*?)\s*\((\+\d+)\)$/) || [];
      return normalize(country) === normalizedRequest || code === normalizedRequest;
    });
    return matches.length === 1 ? matches[0] : null;
  }
  return options.find(option => normalize(option.text).includes(normalizedRequest)
    || normalizedRequest.includes(normalize(option.text)));
}

async function fillSelectFields(page, root, profile, ask) {
  const records = [];
  const selects = await root.$$('select');

  for (const select of selects) {
    const field = await inspectElement(page, select);
    if (!field.visible) continue;

    const options = await page.evaluate(el => Array.from(el.options).map(option => ({
      value: option.value,
      text: option.text.trim(),
      selected: option.selected,
      disabled: option.disabled,
    })), select);
    const available = options.filter(option => option.value && !option.disabled);
    const dialCode = available.length > 0 && available.every(option => /\(\+\d+\)$/.test(option.text));
    let requested = resolveField(field.label, profile);
    let fillingProfilePhone = false;
    if (dialCode) {
      // Select the prefix before typing a new profile phone number. A select
      // without a placeholder otherwise looks answered at its first option.
      const phones = await root.$$('input[type="tel"]');
      for (const phone of phones) {
        const metadata = await inspectElement(page, phone);
        if (metadata.visible && !metadata.value.trim() && resolveField(metadata.label, profile) !== null) {
          fillingProfilePhone = true;
        }
        await phone.dispose();
      }
    }
    const selected = options.find(option => option.selected && option.value && !option.disabled);
    if (selected && !fillingProfilePhone) {
      records.push(createRecord(field.label, 'select', selected.text, 'existing', field.required));
      continue;
    }

    let source = 'profile';
    let match = matchSelectOption(available, requested, dialCode);
    if (requested === null || (dialCode && !match)) {
      requested = await ask(`Choose "${field.label}" from: ${available.map(option => option.text).join(', ')}`);
      source = requested ? 'user' : 'unresolved';
      match = matchSelectOption(available, requested, dialCode);
    }


    if (match) {
      await select.select(match.value);
      records.push(createRecord(field.label, 'select', match.text, source, field.required));
    } else {
      // Do not leave a valid-looking implicit default after an unresolved choice.
      if (dialCode) await select.evaluate(element => {
        element.selectedIndex = -1;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      });
      records.push(createRecord(field.label, 'select', '', 'unresolved', field.required));
    }
  }

  return records;
}

async function radioMetadata(page, radio) {
  return page.evaluate(el => {
    const container = el.closest('fieldset, .fb-dash-form-element, [data-test-form-builder-radio-button-form-component]');
    const question = container?.querySelector('legend, .fb-dash-form-element__label')?.innerText
      || el.getAttribute('aria-label')
      || 'Radio choice';
    const option = el.labels?.[0]?.innerText || el.value || '';
    return {
      question: question.trim(),
      option: option.trim(),
      group: el.name || question.trim(),
      checked: el.checked,
      required: el.required || el.getAttribute('aria-required') === 'true',
      visible: !el.disabled && Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length),
    };
  }, radio);
}

async function fillRadioFields(page, root, profile, ask) {
  const records = [];
  const radios = await root.$$('input[type="radio"]');
  const groups = new Map();

  for (const radio of radios) {
    const metadata = await radioMetadata(page, radio);
    if (!metadata.visible) continue;
    if (!groups.has(metadata.group)) groups.set(metadata.group, []);
    groups.get(metadata.group).push({ radio, ...metadata });
  }

  for (const options of groups.values()) {
    const question = options[0].question;
    const required = options.some(option => option.required);
    const selected = options.find(option => option.checked);
    if (selected) {
      records.push(createRecord(question, 'radio', selected.option, 'existing', required));
      continue;
    }

    let requested = resolveField(question, profile);
    let source = 'profile';
    if (requested === null) {
      requested = await ask(`Choose "${question}" from: ${options.map(option => option.option).join(', ')}`);
      source = requested ? 'user' : 'unresolved';
    }

    const normalizedRequest = normalize(requested);
    const match = options.find(option => normalize(option.option) === normalizedRequest)
      || options.find(option => normalize(option.option).includes(normalizedRequest));
    if (match && normalizedRequest) await match.radio.click();

    records.push(createRecord(question, 'radio', match?.option || '', match ? source : 'unresolved', required));
  }

  return records;
}

async function fillCheckboxFields(page, root, profile, ask) {
  const records = [];
  const checkboxes = await root.$$('input[type="checkbox"]');

  for (const checkbox of checkboxes) {
    const field = await inspectElement(page, checkbox);
    if (!field.visible || !field.label) continue;

    if (field.checked) {
      records.push(createRecord(field.label, 'checkbox', 'Yes', 'existing', field.required));
      continue;
    }

    let requested = resolveField(field.label, profile);
    let source = 'profile';
    if (requested === null) {
      requested = await ask(`Select "${field.label}"? Enter yes or no`);
      source = requested ? 'user' : 'unresolved';
    }

    const shouldCheck = ['yes', 'true', '1'].includes(normalize(requested));
    if (shouldCheck) await checkbox.click();
    records.push(createRecord(field.label, 'checkbox', shouldCheck ? 'Yes' : (field.required ? '' : 'No'), shouldCheck ? source : 'unresolved', field.required));
  }

  return records;
}

async function uploadResume(page, root, resumePath) {
  const records = [];
  const fileInputs = await root.$$('input[type="file"]');

  for (const [index, fileInput] of fileInputs.entries()) {
    const field = await inspectElement(page, fileInput);
    const label = field.label || (fileInputs.length === 1 ? 'Resume' : `File upload ${index + 1}`);
    const isResume = /resume|cv/i.test(label) || (fileInputs.length === 1 && !/cover letter/i.test(label));
    if (!isResume) {
      records.push(createRecord(label, 'file', '', 'unresolved', field.required));
      continue;
    }

    await fileInput.uploadFile(resumePath);
    records.push(createRecord(label, 'file', path.basename(resumePath), 'profile', field.required));
  }

  return records;
}

async function fillFormStep(page, profile, resumePath, options = {}) {
  const ask = options.ask || askUser;
  const delayMs = options.delayMs ?? APPLY_DELAY_MS;
  if (delayMs) await delay(delayMs);

  const root = await getFormRoot(page, true);
  try {
    const fields = [
      ...await fillSelectFields(page, root, profile, ask),
      ...await fillTextFields(page, root, profile, ask),
      ...await fillRadioFields(page, root, profile, ask),
      ...await fillCheckboxFields(page, root, profile, ask),
      ...await uploadResume(page, root, resumePath),
    ];
    const unresolvedRequired = fields.filter(field => field.required && !field.value);
    return { fields, unresolvedRequired };
  } finally {
    await root.dispose();
  }
}

function mergeReviewFields(reviewFields, fields) {
  for (const field of fields) reviewFields.set(field.key, field);
}

function printApplicationReview(job, reviewFields, resumePath, output = console.log) {
  output('\n  Application review');
  output(`  Job: ${job.title} at ${job.company}`);
  for (const field of reviewFields.values()) {
    output(`  ${field.label}: ${field.value || '[blank]'} (${field.source})`);
  }
  output(`  Resume: ${path.basename(resumePath)}`);
  output('\n  Verify the open browser form. Nothing has been submitted.');
}

async function reviewAndConfirm(page, job, reviewFields, profile, resumePath, options = {}) {
  const ask = options.ask || askUser;
  const output = options.output || console.log;

  while (true) {
    printApplicationReview(job, reviewFields, resumePath, output);
    const decision = normalize(await ask('Type SUBMIT to submit, EDIT to change the form in the browser, or CANCEL'));

    if (decision === 'submit') return 'submit';
    if (decision === 'cancel') return 'cancel';
    if (decision !== 'edit') {
      output('  Submission not confirmed. Enter SUBMIT, EDIT, or CANCEL.');
      continue;
    }

    await ask('Edit the browser form, return to its final step, then press Enter to review again');
    const refreshed = await fillFormStep(page, profile, resumePath, { ask, delayMs: 0 });
    mergeReviewFields(reviewFields, refreshed.fields);
  }
}

async function findButton(page, patterns, withinForm = true) {
  const root = withinForm ? await getFormRoot(page) : page;
  if (!root) return null;
  try {
    const buttons = await root.$$('button');
    let match = null;
    for (const button of buttons) {
      const details = await page.evaluate(el => ({
        labels: [el.innerText || '', el.getAttribute('aria-label') || ''].map(text => text.trim()),
        available: !el.disabled && !el.closest('[hidden], [aria-hidden="true"], [inert]')
          && el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
      }), button);
      if (!match && details.available && details.labels.some(text => patterns.some(pattern => pattern.test(text)))) {
        match = button;
      } else {
        await button.dispose();
      }
    }
    return match;
  } finally {
    if (withinForm) await root.dispose();
  }
}

async function isExternalRedirect(page) {
  const url = page.url();
  return !/^https?:\/\/([a-z0-9-]+\.)?linkedin\.com\//i.test(url);
}

async function navigateToJob(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (error) {
    if (error.name !== 'TimeoutError') throw error;
    await page.waitForSelector('body', { timeout: 10000 });
    if (page.url() === 'about:blank') throw error;
  }
  await page.waitForSelector('body', { timeout: 10000 });
}

async function waitForSubmissionConfirmation(page) {
  try {
    await page.waitForFunction(() => /application (was )?(sent|submitted)|your application was sent/i.test(document.body.innerText), { timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

async function submitReviewedApplication(page, job, reviewFields, profile, resumePath, options = {}) {
  const decision = await reviewAndConfirm(page, job, reviewFields, profile, resumePath, options);
  if (decision === 'cancel') {
    return { status: 'cancelled', reason: 'user_cancelled_before_submission', reviewed: true };
  }

  const submitButton = await findButton(page, [/submit application/i, /^submit$/i]);
  if (!submitButton) {
    return { status: 'incomplete', reason: 'submit_button_missing_after_review', reviewed: true };
  }
  await submitButton.click();
  const confirmed = await waitForSubmissionConfirmation(page);
  return confirmed
    ? { status: 'applied', reviewed: true }
    : { status: 'submitted_unconfirmed', reason: 'submission_confirmation_not_detected', reviewed: true };
}

async function applyToJob(job, resumePath, options = {}) {
  const absoluteResumePath = path.resolve(resumePath);
  if (!fs.existsSync(absoluteResumePath)) {
    return { status: 'error', reason: `resume_not_found:${absoluteResumePath}` };
  }
  if (path.extname(absoluteResumePath).toLowerCase() !== '.pdf') {
    return { status: 'error', reason: 'resume_must_be_pdf' };
  }

  let profile;
  try {
    profile = options.profile || loadApplicationProfile();
  } catch (error) {
    return { status: 'error', reason: error.message };
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: CHROMIUM_PATH,
      userDataDir: CHROMIUM_PROFILE,
      headless: false,
      defaultViewport: null,
      ignoreDefaultArgs: ['--enable-automation'],
      args: [
        '--no-sandbox',
        '--start-maximized',
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
    const page = await browser.newPage();
    const reviewFields = new Map();
    console.log(`\n  Opening: ${job.link}`);
    await navigateToJob(page, job.link);
    await delay(APPLY_DELAY_MS);

    if (await isExternalRedirect(page)) {
      return { status: 'skipped', reason: 'external_redirect' };
    }

    const easyApplyButton = await findButton(page, [/easy apply/i], false);
    if (!easyApplyButton) {
      return { status: 'skipped', reason: 'no_easy_apply' };
    }

    await easyApplyButton.click();

    for (let step = 1; step <= MAX_STEPS; step++) {
      if (await isExternalRedirect(page)) {
        return { status: 'skipped', reason: 'external_redirect_mid_apply' };
      }

      const filled = await fillFormStep(page, profile, absoluteResumePath, options);
      mergeReviewFields(reviewFields, filled.fields);

      if (filled.unresolvedRequired.length) {
        const labels = filled.unresolvedRequired.map(field => field.label).join(', ');
        await (options.ask || askUser)(`Required fields still need attention in the browser: ${labels}. Press Enter when complete`);
        const refreshed = await fillFormStep(page, profile, absoluteResumePath, { ...options, delayMs: 0 });
        mergeReviewFields(reviewFields, refreshed.fields);
        if (refreshed.unresolvedRequired.length) {
          return { status: 'incomplete', reason: 'required_fields_unresolved' };
        }
      }

      const submitButton = await findButton(page, [/submit application/i, /^submit$/i]);
      if (submitButton) {
        // Keep the browser open while the user reviews and confirms.
        return await submitReviewedApplication(
          page,
          job,
          reviewFields,
          profile,
          absoluteResumePath,
          options,
        );
      }

      const nextButton = await findButton(page, [/^next$/i, /^continue$/i, /review/i]);
      if (!nextButton) {
        const action = normalize(await (options.ask || askUser)('No Next or Submit button was found. Enter RETRY after manual correction or SKIP'));
        if (action !== 'retry') return { status: 'incomplete', reason: 'form_navigation_stalled' };
        continue;
      }

      await nextButton.click();
      await delay(APPLY_DELAY_MS);
    }

    return { status: 'incomplete', reason: 'max_steps_reached' };
  } catch (error) {
    return { status: 'error', reason: error.message };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

module.exports = {
  applyToJob,
  fillFormStep,
  loadApplicationProfile,
  mergeReviewFields,
  printApplicationReview,
  resolveField,
  reviewAndConfirm,
  submitReviewedApplication,
};
