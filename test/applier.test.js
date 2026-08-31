const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const puppeteer = require('puppeteer-extra');
const {
  fillFormStep,
  loadApplicationProfile,
  mergeReviewFields,
  resolveField,
  submitReviewedApplication,
} = require('../applier');

const chromiumPath = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
const fixtureUrl = `file://${path.join(__dirname, 'fixtures/easy-apply.html')}`;
const resumePath = path.join(__dirname, '..', 'output', 'my_resume.pdf');
const job = { title: 'Software Engineer', company: 'Example Company' };

async function openFixture() {
  const browser = await puppeteer.launch({
    executablePath: chromiumPath,
    headless: true,
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();
  await page.goto(fixtureUrl, { waitUntil: 'domcontentloaded' });
  return { browser, page };
}

async function fillFixture(page) {
  const profile = loadApplicationProfile();
  const answers = question => {
    if (question.includes('Portfolio note')) return 'Portfolio available on request';
    if (question.includes('authorized to work')) return 'Yes';
    if (question.includes('certify')) return 'Yes';
    throw new Error(`Unexpected question: ${question}`);
  };
  const result = await fillFormStep(page, profile, resumePath, { ask: answers, delayMs: 0 });
  return { profile, result };
}

test('profile aliases resolve specific fields before general aliases', () => {
  const profile = loadApplicationProfile();
  assert.equal(resolveField('First name', profile), 'John');
  assert.equal(resolveField('Last name', profile), 'Doe');
  assert.equal(resolveField('Phone country code', profile), '+966');
  assert.equal(resolveField('Years of experience', profile), '3');
  assert.equal(resolveField('Unknown custom question', profile), null);
});

test('Easy Apply fields are populated from profile and reviewed values', async t => {
  const { browser, page } = await openFixture();
  t.after(() => browser.close());

  const { result } = await fillFixture(page);
  assert.equal(result.unresolvedRequired.length, 0);
  assert.equal(await page.$eval('#first-name', element => element.value), 'John');
  assert.equal(await page.$eval('#last-name', element => element.value), 'Doe');
  assert.equal(await page.$eval('#email', element => element.value), 'jone.doe999@example.com');
  assert.equal(await page.$eval('#country-code', element => element.value), 'sa');
  assert.equal(await page.$eval('input[name="authorization"]:checked', element => element.value), 'yes');
  assert.equal(await page.$eval('#certify', element => element.checked), true);
  assert.equal(await page.evaluate(() => window.submitClicks), 0);

  const reviewed = new Map();
  mergeReviewFields(reviewed, result.fields);
  assert.equal(reviewed.get('text:first name').value, 'John');
  assert.equal(reviewed.get('file:resume').value, 'my_resume.pdf');
});

test('declining a required checkbox blocks form progression', async t => {
  const { browser, page } = await openFixture();
  t.after(() => browser.close());

  const profile = loadApplicationProfile();
  const result = await fillFormStep(page, profile, resumePath, {
    ask: question => {
      if (question.includes('Portfolio note')) return '';
      if (question.includes('authorized to work')) return 'Yes';
      if (question.includes('certify')) return 'No';
      throw new Error(`Unexpected question: ${question}`);
    },
    delayMs: 0,
  });

  assert.equal(await page.$eval('#certify', element => element.checked), false);
  assert.deepEqual(result.unresolvedRequired.map(field => field.label), ['I certify that these answers are accurate']);
});

test('invalid review input and cancellation never submit', async t => {
  const { browser, page } = await openFixture();
  t.after(() => browser.close());

  const { profile, result } = await fillFixture(page);
  const reviewed = new Map();
  mergeReviewFields(reviewed, result.fields);
  const responses = ['yes', 'cancel'];
  const outcome = await submitReviewedApplication(
    page,
    job,
    reviewed,
    profile,
    resumePath,
    { ask: async () => responses.shift(), output: () => {} },
  );

  assert.equal(outcome.status, 'cancelled');
  assert.equal(outcome.reviewed, true);
  assert.equal(await page.evaluate(() => window.submitClicks), 0);
});

test('exact SUBMIT confirmation clicks once and observes success', async t => {
  const { browser, page } = await openFixture();
  t.after(() => browser.close());

  const { profile, result } = await fillFixture(page);
  const reviewed = new Map();
  mergeReviewFields(reviewed, result.fields);
  const responses = ['not yet', 'SUBMIT'];
  const output = [];
  const outcome = await submitReviewedApplication(
    page,
    job,
    reviewed,
    profile,
    resumePath,
    { ask: async () => responses.shift(), output: line => output.push(line) },
  );

  assert.equal(outcome.status, 'applied');
  assert.equal(outcome.reviewed, true);
  assert.equal(await page.evaluate(() => window.submitClicks), 1);
  assert.ok(output.some(line => line.includes('Nothing has been submitted')));
  assert.ok(output.some(line => line.includes('Submission not confirmed')));
});

test('EDIT review reacquires a rerendered submit button', async t => {
  const { browser, page } = await openFixture();
  t.after(() => browser.close());

  const { profile, result } = await fillFixture(page);
  const reviewed = new Map();
  mergeReviewFields(reviewed, result.fields);
  const decisions = ['EDIT', 'SUBMIT'];
  const outcome = await submitReviewedApplication(
    page,
    job,
    reviewed,
    profile,
    resumePath,
    {
      ask: async question => {
        if (question.startsWith('Edit the browser form')) {
          await page.evaluate(() => {
            const current = document.getElementById('submit');
            const replacement = current.cloneNode(true);
            replacement.addEventListener('click', () => {
              window.submitClicks += 1;
              const confirmation = document.createElement('p');
              confirmation.textContent = 'Application was sent';
              document.body.appendChild(confirmation);
            });
            current.replaceWith(replacement);
          });
          return '';
        }
        return decisions.shift();
      },
      output: () => {},
    },
  );

  assert.equal(outcome.status, 'applied');
  assert.equal(await page.evaluate(() => window.submitClicks), 1);
});
