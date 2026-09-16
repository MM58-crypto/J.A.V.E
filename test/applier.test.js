const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const puppeteer = require('puppeteer-extra');
const { field_aliases } = require('../private-profile.example.json');
const {
  applyToJob,
  fillFormStep,
  mergeReviewFields,
  resolveField,
  submitReviewedApplication,
} = require('../applier');

const chromiumPath = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
const fixtureUrl = `file://${path.join(__dirname, 'fixtures/easy-apply.html')}`;
const job = { title: 'Software Engineer', company: 'Example Company' };
const profile = {
  personal: {
    first_name: 'Testy',
    last_name: 'Fixture',
    email: 'fixture.applicant@example.invalid',
    phone: '+12025550123',
    phone_country_code: '+1',
    country: 'United States',
  },
  application: {},
  candidate: { years_experience: 7 },
  field_aliases,
};
const sduiProfile = {
  ...profile,
  personal: { ...profile.personal, phone_country_code: '+966', phone: '+966500000000' },
};

function temporaryResume(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'easy-apply-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const resumePath = path.join(directory, 'synthetic-resume.pdf');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = Buffer.byteLength(pdf);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 4\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  fs.writeFileSync(resumePath, pdf);
  return resumePath;
}

async function openFixture(t) {
  const browser = await puppeteer.launch({
    executablePath: chromiumPath,
    headless: true,
    args: ['--no-sandbox', '--disable-background-networking'],
  });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (request.url() === fixtureUrl) return request.continue();
    return request.abort();
  });
  await page.goto(fixtureUrl, { waitUntil: 'domcontentloaded' });
  return { browser, page };
}

function isResumeConfirmation(question) {
  return question.includes('[C]') && question.includes('[X]');
}

function confirmResume(question) {
  if (isResumeConfirmation(question)) return 'C';
  throw new Error(`Unexpected question: ${question}`);
}

async function fillFixture(page, resumePath, options = {}) {
  const answers = question => {
    if (isResumeConfirmation(question)) return 'C';
    if (question.includes('Portfolio note')) return 'Portfolio available on request';
    if (question.includes('authorized to work')) return 'Yes';
    if (question.includes('certify')) return 'Yes';
    throw new Error(`Unexpected question: ${question}`);
  };
  options.ask ||= answers;
  options.delayMs = 0;
  return fillFormStep(page, profile, { mode: 'local', path: resumePath }, options);
}

test('profile aliases resolve specific fields before general aliases', () => {
  assert.equal(resolveField('First name', profile), 'Testy');
  assert.equal(resolveField('Last name', profile), 'Fixture');
  assert.equal(resolveField('Phone country code', profile), '+1');
  assert.equal(resolveField('Years of experience', profile), '7');
  assert.equal(resolveField('Unknown custom question', profile), null);
});

test('Easy Apply fields are populated from profile and reviewed values', async t => {
  const resumePath = temporaryResume(t);
  const { page } = await openFixture(t);

  const result = await fillFixture(page, resumePath);
  assert.equal(result.unresolvedRequired.length, 0);
  assert.equal(await page.$eval('#first-name', element => element.value), 'Testy');
  assert.equal(await page.$eval('#last-name', element => element.value), 'Fixture');
  assert.equal(await page.$eval('#email', element => element.value), profile.personal.email);
  assert.equal(await page.$eval('#country-code', element => element.value), 'us');
  assert.equal(await page.$eval('#phone', element => element.value), profile.personal.phone);
  assert.equal(await page.$eval('input[name="authorization"]:checked', element => element.value), 'yes');
  assert.equal(await page.$eval('#certify', element => element.checked), true);
  assert.equal(await page.$eval('#resume', element => element.files[0].name), 'synthetic-resume.pdf');
  assert.equal(await page.evaluate(() => window.submitClicks), 0);

  const reviewed = new Map();
  mergeReviewFields(reviewed, result.fields);
  assert.equal(reviewed.get('text:first name').value, 'Testy');
  assert.equal(reviewed.get('file:resume').value, 'synthetic-resume.pdf');
});

test('declining a required checkbox blocks form progression', async t => {
  const resumePath = temporaryResume(t);
  const { page } = await openFixture(t);

  const result = await fillFormStep(page, profile, { mode: 'local', path: resumePath }, {
    ask: question => {
      if (isResumeConfirmation(question)) return 'C';
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
  const resumePath = temporaryResume(t);
  const { page } = await openFixture(t);
  const options = {};

  const result = await fillFixture(page, resumePath, options);
  const reviewed = new Map();
  mergeReviewFields(reviewed, result.fields);
  const responses = ['yes', 'cancel'];
  Object.assign(options, { ask: async question => isResumeConfirmation(question) ? 'C' : responses.shift(), output: () => {} });
  const outcome = await submitReviewedApplication(page, job, reviewed, profile, { mode: 'local', path: resumePath }, options);

  assert.equal(outcome.status, 'cancelled');
  assert.equal(outcome.reviewed, true);
  assert.equal(await page.evaluate(() => window.submitClicks), 0);
});

test('exact SUBMIT confirmation clicks once and observes success', async t => {
  const resumePath = temporaryResume(t);
  const { page } = await openFixture(t);
  const options = {};

  const result = await fillFixture(page, resumePath, options);
  const reviewed = new Map();
  mergeReviewFields(reviewed, result.fields);
  const responses = ['not yet', 'SUBMIT'];
  Object.assign(options, { ask: async question => isResumeConfirmation(question) ? 'C' : responses.shift(), output: () => {} });
  const outcome = await submitReviewedApplication(page, job, reviewed, profile, { mode: 'local', path: resumePath }, options);

  assert.equal(outcome.status, 'applied');
  assert.equal(outcome.reviewed, true);
  assert.equal(await page.evaluate(() => window.submitClicks), 1);
});

test('EDIT review reacquires a rerendered submit button', async t => {
  const resumePath = temporaryResume(t);
  const { page } = await openFixture(t);
  const options = {};

  const result = await fillFixture(page, resumePath, options);
  const reviewed = new Map();
  mergeReviewFields(reviewed, result.fields);
  const decisions = ['EDIT', 'SUBMIT'];
  Object.assign(options, {
    ask: async question => {
      if (isResumeConfirmation(question)) return 'C';
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
  });
  const outcome = await submitReviewedApplication(page, job, reviewed, profile, { mode: 'local', path: resumePath }, options);

  assert.equal(outcome.status, 'applied');
  assert.equal(await page.evaluate(() => window.submitClicks), 1);
});

const contactFixtures = [
  {
    name: 'native',
    file: 'easy-apply-native.html',
    profile,
    expected: {
      'first-name': profile.personal.first_name,
      email: profile.personal.email,
      'country-code': 'us',
      phone: profile.personal.phone,
    },
  },
  {
    name: 'supplied SDUI',
    file: 'easy-apply-sdui.html',
    profile: sduiProfile,
    expected: {
      email: 'account@example.invalid',
      'country-code': 'sa',
      phone: sduiProfile.personal.phone,
    },
  },
];

async function verifyContactFixture(t, fixture) {
  const resumePath = temporaryResume(t);
  const browser = await puppeteer.launch({
    executablePath: chromiumPath,
    headless: true,
    args: ['--no-sandbox', '--disable-background-networking'],
  });
  t.after(async () => {
    if (browser.connected) await browser.close();
  });
  const page = await browser.newPage();
  const link = 'https://www.linkedin.com/jobs/view/4242424242/';
  const inputLink = fixture.link || link;
  let authenticated = !fixture.loginPath && !fixture.guest;
  let loginPrompts = 0;
  let resumedUrl;
  const guestHtml = '<html lang="ms"><body><nav><a href="/login">Daftar masuk</a></nav></body></html>';
  async function signIn() {
    await browser.setCookie({
      name: 'li_at', value: 'synthetic-session', url: 'https://www.linkedin.com',
      secure: true, httpOnly: true,
    });
  }
  if (authenticated) await signIn();
  const html = fixture.noEasyApply
    ? '<html lang="en"><body><nav>Signed in</nav><a href="/login" hidden>Sign in</a><a href="http://[">Employer link</a><button>Apply on company website</button></body></html>'
    : fs.readFileSync(path.join(__dirname, 'fixtures', fixture.file), 'utf8');
  const events = [];
  await page.exposeFunction('reportFixtureEvent', event => events.push(event));
  await page.setRequestInterception(true);
  page.on('request', async request => {
    if (!request.isNavigationRequest()) return request.abort();
    const url = new URL(request.url());
    if (url.hostname !== 'www.linkedin.com') {
      return request.respond({ status: 200, contentType: 'text/html', body: guestHtml });
    }
    if (url.pathname === new URL(link).pathname) {
      if (!authenticated && fixture.loginPath) {
        return request.respond({ status: 302, headers: { location: fixture.loginPath } });
      }
      const hasSession = (request.headers().cookie || '').includes('li_at=synthetic-session');
      const english = (request.headers()['accept-language'] || '').startsWith('en');
      return request.respond({
        status: 200, contentType: 'text/html',
        body: authenticated && hasSession && english ? html : guestHtml,
      });
    }
    return request.respond({
      status: 200, contentType: 'text/html',
      body: '<html lang="ms"><body><h1>Pengesahan diperlukan</h1></body></html>',
    });
  });
  // Keep the real driver and Chromium interaction; replace only session creation.
  t.mock.method(puppeteer, 'launch', async () => browser);
  t.mock.method(browser, 'newPage', async () => page);
  let reviewState;
  const outcome = await applyToJob({ ...job, link: inputLink }, { mode: 'local', path: resumePath }, {
    profile: fixture.profile,
    delayMs: 0,
    ask: async question => {
      if (isResumeConfirmation(question)) return 'C';
      if (question.includes('RETRY')) {
        loginPrompts++;
        assert.equal(await page.$('input'), null, 'No private answers entered before sign-in');
        if (fixture.cancelLogin) return 'CANCEL';
        // A premature retry must not classify the job as lacking Easy Apply.
        if (loginPrompts === 1) return 'RETRY';
        assert.equal(loginPrompts, 2);
        authenticated = true;
        await signIn();
        await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
        return 'RETRY';
      }
      if (!question.includes('Type SUBMIT')) throw new Error(`Unexpected question: ${question}`);
      resumedUrl = page.url();
      reviewState = await page.evaluate(() => ({
        firstStep: window.firstStepValues,
        reviewVisible: Boolean(document.getElementById('review-step')),
        untouched: ['background-email', 'stale-email', 'unrelated-phone'].map(id => document.getElementById(id).value),
        events: window.fixtureEvents,
      }));
      return 'CANCEL';
    },
    output: () => {},
  });

  if (fixture.cancelLogin) {
    assert.deepEqual(outcome, { status: 'incomplete', reason: 'authentication_required' });
    assert.equal(loginPrompts, 1);
    assert.deepEqual(events, []);
    return;
  }
  if (fixture.noEasyApply) {
    assert.deepEqual(outcome, { status: 'skipped', reason: 'no_easy_apply' });
    assert.equal(loginPrompts, 0);
    assert.deepEqual(events, []);
    return;
  }
  assert.equal(loginPrompts, fixture.loginPath || fixture.guest ? 2 : 0);
  assert.equal(resumedUrl, link);

  assert.equal(outcome.status, 'cancelled');
  assert.equal(outcome.reviewed, true);
  assert.deepEqual(reviewState.firstStep, fixture.expected);
  assert.equal(reviewState.reviewVisible, true);
  assert.deepEqual(reviewState.untouched, ['', '', '']);
  assert.deepEqual(reviewState.events, ['launch', 'mounted', 'next']);
  assert.deepEqual(events, ['launch', 'mounted', 'next']);
}

for (const fixture of contactFixtures) {
  test(`applyToJob fills ${fixture.name} contact controls and cancels at review`, t => verifyContactFixture(t, fixture));
}

test('a Malaysian job reuses the www session instead of opening the localized guest page', t => verifyContactFixture(t, {
  ...contactFixtures[0],
  link: 'https://my.linkedin.com/jobs/view/4242424242/?originalSubdomain=my&locale=ms_MY#details',
}));

for (const auth of [
  { name: 'login redirect', loginPath: '/login' },
  { name: 'verification redirect', loginPath: '/checkpoint/challenge/123' },
  { name: 'localized guest job page', guest: true },
]) {
  test(`${auth.name} resumes the same job after manual sign-in without skipping it`, t => verifyContactFixture(t, {
    ...contactFixtures[0], ...auth,
  }));
}

test('cancelling sign-in reports authentication required, not no Easy Apply', t => verifyContactFixture(t, {
  ...contactFixtures[0], loginPath: '/authwall', cancelLogin: true,
}));

test('an authenticated job without Easy Apply is skipped despite hidden login markup', t => verifyContactFixture(t, {
  ...contactFixtures[0], noEasyApply: true,
}));

async function openSDUIFixture(t) {
  const { page } = await openFixture(t);
  await page.setContent(fs.readFileSync(path.join(__dirname, 'fixtures/easy-apply-sdui.html'), 'utf8'));
  await page.click('#launch');
  return page;
}

test('existing SDUI contact answers and manual phone edits survive another fill', async t => {
  const page = await openSDUIFixture(t);
  const resumePath = temporaryResume(t);
  const options = { delayMs: 0, ask: question => { throw new Error(`Unexpected question: ${question}`); } };
  await fillFormStep(page, sduiProfile, { mode: 'local', path: resumePath }, options);
  await page.select('[id="«ra»"]', 'ae');
  await page.$eval('[id="«rc»"]', element => { element.value = '+971500000000'; });

  await fillFormStep(page, sduiProfile, { mode: 'local', path: resumePath }, options);
  assert.equal(await page.$eval('[id="«r8»"]', element => element.value), 'account@example.invalid');
  assert.equal(await page.$eval('[id="«ra»"]', element => element.value), 'ae');
  assert.equal(await page.$eval('[id="«rc»"]', element => element.value), '+971500000000');
});

test('shared dial codes require a choice instead of selecting a default or prefix match', async t => {
  const page = await openSDUIFixture(t);
  const resumePath = temporaryResume(t);
  let prompts = 0;
  const first = await fillFormStep(page, profile, { mode: 'local', path: resumePath }, {
    delayMs: 0,
    ask: () => { prompts++; return ''; },
  });
  assert.equal(prompts, 1);
  assert.deepEqual(first.unresolvedRequired.map(field => field.label), ['Phone country code*']);
  assert.equal(await page.$eval('[id="«ra»"]', element => element.value), '');

  const second = await fillFormStep(page, profile, { mode: 'local', path: resumePath }, {
    delayMs: 0,
    ask: () => { prompts++; return 'United States (+1)'; },
  });
  assert.equal(prompts, 2);
  assert.deepEqual(second.unresolvedRequired, []);
  assert.equal(await page.$eval('[id="«ra»"]', element => element.value), 'us');
  assert.equal(await page.$eval('[id="«rc»"]', element => element.value), profile.personal.phone);
});

for (const [name, opening, closing] of [
  ['non-div ARIA dialog identified by heading', '<section role="dialog"><h2>Easy Apply</h2>', '</section>'],
  ['ARIA-modal container identified by accessible name', '<section aria-modal="true" aria-label="Apply to Example Company">', '</section>'],
  ['roleless LinkedIn application wrapper', '<div class="jobs-easy-apply-modal">', '</div>'],
]) {
  test(`fills only the visible ${name}`, async t => {
    const resumePath = temporaryResume(t);
    const { page } = await openFixture(t);
    await page.setContent(`
      <label for="background">Email address</label><input id="background" type="email">
      <button id="background-submit" onclick="window.backgroundClicks++">Submit application</button>
      <div role="dialog" aria-label="Easy Apply" hidden>
        <label for="stale">Email address</label><input id="stale" type="email">
      </div>
      <section role="dialog" aria-label="Account settings">
        <label for="unrelated">Email address</label><input id="unrelated" type="email">
      </section>
      ${opening}
        <label for="application-email">Email address</label><input id="application-email" required>
        <label for="resume">Resume</label><input id="resume" type="file" accept=".pdf">
        <button onclick="window.applicationClicks++; document.getElementById('confirmation').textContent = 'Application was sent'">Submit application</button>
      ${closing}
      <p id="confirmation"></p>
      <script>window.backgroundClicks = 0; window.applicationClicks = 0;</script>
    `);
    const options = { delayMs: 0, ask: confirmResume, output: () => {} };
    const result = await fillFormStep(page, profile, { mode: 'local', path: resumePath }, options);
    assert.equal(await page.$eval('#application-email', element => element.value), profile.personal.email);
    assert.deepEqual(await page.$$eval('#background, #stale, #unrelated', elements => elements.map(element => element.value)), ['', '', '']);
    const reviewed = new Map();
    mergeReviewFields(reviewed, result.fields);
    options.ask = async question => isResumeConfirmation(question) ? 'C' : 'SUBMIT';
    const outcome = await submitReviewedApplication(page, job, reviewed, profile, { mode: 'local', path: resumePath }, options);
    assert.equal(outcome.status, 'applied');
    assert.deepEqual(await page.evaluate(() => [window.backgroundClicks, window.applicationClicks]), [0, 1]);
  });
}

for (const [name, opening, closing] of [
  ['missing', '', ''],
  ['unrelated', '<div role="dialog" aria-label="Account settings">', '</div>'],
]) {
  test(`${name} application form cannot fill or submit the page`, async t => {
    const resumePath = temporaryResume(t);
    const { page } = await openFixture(t);
    await page.setContent(`
      ${opening}
        <label for="email">Email address</label><input id="email" type="email">
        <button onclick="window.submitClicks++; document.getElementById('confirmation').textContent = 'Application was sent'">Submit application</button>
      ${closing}
      <p id="confirmation"></p>
      <script>window.submitClicks = 0;</script>
    `);
    await assert.rejects(fillFormStep(page, profile, { mode: 'local', path: resumePath }, {
      delayMs: 0,
      ask: question => { throw new Error(`Unexpected question: ${question}`); },
    }));
    const outcome = await submitReviewedApplication(page, job, new Map(), profile, { mode: 'local', path: resumePath }, {
      ask: async () => 'SUBMIT',
      output: () => {},
    });
    assert.equal(outcome.status, 'incomplete');
    assert.equal(await page.$eval('#email', element => element.value), '');
    assert.equal(await page.evaluate(() => window.submitClicks), 0);
  });
}

async function openResumeFixture(t) {
  const { browser, page } = await openFixture(t);
  await page.setContent(fs.readFileSync(path.join(__dirname, 'fixtures/easy-apply-resume-sdui.html'), 'utf8'));
  await page.click('#launch');
  return { browser, page };
}

test('chooser-only SDUI upload selects the new resume after delayed rendering and selection', async t => {
  const resumePath = temporaryResume(t);
  const { page } = await openResumeFixture(t);
  const resumeFillOptions = { delayMs: 0, ask: confirmResume };
  assert.equal(await page.$('#application input[type="file"]'), null);
  const result = await fillFormStep(page, profile, { mode: 'local', path: resumePath }, resumeFillOptions);
  assert.deepEqual(result.unresolvedRequired, []);
  assert.deepEqual(result.fields.map(field => [field.type, field.value]), [['file', path.basename(resumePath)]]);
  assert.equal(await page.$eval('#uploaded-resume', card => card.getAttribute('aria-checked')), 'true');
  assert.equal(await page.$eval('#saved-base input', input => input.checked), false);
  assert.equal(await page.$eval('#saved-same-name input', input => input.checked), false);
  assert.deepEqual(await page.evaluate(() => window.uploadEvents), ['chooser', 'synthetic-resume.pdf', 'select', 'selected']);
  assert.deepEqual(await page.$$eval('#background-file, #stale-file', inputs => inputs.map(input => input.files.length)), [0, 0]);
  assert.equal(await page.evaluate(() => window.backgroundClicks), 0);

  await fillFormStep(page, profile, { mode: 'local', path: resumePath }, resumeFillOptions);
  assert.deepEqual(await page.evaluate(() => window.uploadEvents), ['chooser', 'synthetic-resume.pdf', 'select', 'selected']);
});

test('a regenerated artifact at the same path is uploaded again, not mistaken for the saved basename', async t => {
  const resumePath = temporaryResume(t);
  const { page } = await openResumeFixture(t);
  const resumeFillOptions = { delayMs: 0, ask: confirmResume };
  await page.evaluate(() => window.selectResume(document.getElementById('saved-same-name')));
  await fillFormStep(page, profile, { mode: 'local', path: resumePath }, resumeFillOptions);
  fs.appendFileSync(resumePath, '\n% regenerated artifact\n');
  await fillFormStep(page, profile, { mode: 'local', path: resumePath }, resumeFillOptions);
  assert.deepEqual(await page.evaluate(() => window.uploadEvents), [
    'chooser', 'synthetic-resume.pdf', 'select', 'selected',
    'chooser', 'synthetic-resume.pdf', 'select', 'selected',
  ]);
});

async function runResumeApplication(t, mode, settings = {}) {
  const resumeChoice = settings.resumeChoice || { mode: 'local', path: temporaryResume(t) };
  const { browser, page } = await openFixture(t);
  const html = fs.readFileSync(path.join(__dirname, 'fixtures/easy-apply-resume-sdui.html'), 'utf8');
  page.removeAllListeners('request');
  page.on('request', request => request.isNavigationRequest()
    ? request.respond({ status: 200, contentType: 'text/html', body: html })
    : request.abort());
  await page.evaluateOnNewDocument(mode => {
    window.addEventListener('DOMContentLoaded', () => {
      window.uploadMode = mode;
      // Even a selected stale file with the requested basename cannot prove upload.
      if (mode === 'reject') window.selectResume(document.getElementById('saved-same-name'));
    });
  }, mode);
  t.mock.method(puppeteer, 'launch', async () => browser);
  t.mock.method(browser, 'newPage', async () => page);
  const close = browser.close.bind(browser);
  let state;
  t.mock.method(browser, 'close', async () => {
    if (!browser.connected) return;
    state = await page.evaluate(() => ({
      next: window.nextClicks,
      submit: window.submitClicks,
      background: window.backgroundClicks,
      uploads: window.uploadEvents,
      selected: document.querySelector('#application [role="radio"][aria-checked="true"]')?.getAttribute('aria-label'),
    }));
    await close();
  });
  const reviewAnswers = ['yes', 'CANCEL'];
  let reviews = 0;
  let confirmations = 0;
  const outcome = await applyToJob({ ...job, link: 'https://www.linkedin.com/jobs/view/4242424242/' }, resumeChoice, {
    profile,
    delayMs: 0,
    ask: question => {
      if (isResumeConfirmation(question)) {
        confirmations++;
        if (settings.confirm) return settings.confirm(page, confirmations);
        return 'C';
      }
      if (!question.includes('Type SUBMIT')) throw new Error(`Unexpected question: ${question}`);
      reviews++;
      if (settings.review) return settings.review(page, reviews);
      assert.ok(reviewAnswers.length, 'Unexpected extra final review');
      return reviewAnswers.shift();
    },
    output: () => {},
  });
  return { outcome, state, reviews, confirmations };
}

test('chooser-only application advances only after selection and still requires SUBMIT at review', async t => {
  const { outcome, state, reviews } = await runResumeApplication(t, 'delayed');
  assert.equal(outcome.status, 'cancelled');
  assert.equal(reviews, 2);
  assert.equal(state.next, 1);
  assert.equal(state.submit, 0);
  assert.equal(state.background, 0);
  assert.deepEqual(state.uploads, ['chooser', 'synthetic-resume.pdf', 'select', 'selected']);
});

for (const mode of ['reject', 'selection-rejected']) {
  test(`SDUI ${mode} blocks Next even when the requested filename appears`, async t => {
    const { outcome, state, reviews } = await runResumeApplication(t, mode);
    assert.equal(outcome.status, 'error');
    assert.match(outcome.reason, /Resume upload or selection could not be confirmed/);
    assert.equal(state.next, 0);
    assert.equal(state.submit, 0);
    assert.equal(state.background, 0);
    assert.equal(reviews, 0);
    assert.equal(state.selected, mode === 'reject' ? 'synthetic-resume.pdf' : 'base-resume.pdf');
  });
}

test('direct file uploads are reused and clearing a confirmed file blocks progression without re-uploading', async t => {
  const resumePath = temporaryResume(t);
  const { page } = await openFixture(t);
  const options = {};
  await page.$eval('#resume', input => {
    input.hidden = true;
    window.uploadChanges = 0;
    input.addEventListener('change', () => { window.uploadChanges++; });
  });
  await fillFixture(page, resumePath, options);
  await fillFixture(page, resumePath, options);
  assert.equal(await page.evaluate(() => window.uploadChanges), 1);
  await page.$eval('#resume', input => {
    input.value = '';
  });
  let confirmations = 0;
  options.ask = question => {
    assert.ok(isResumeConfirmation(question));
    assert.ok(++confirmations <= 2);
    return confirmations === 1 ? 'C' : 'X';
  };
  const result = await fillFormStep(page, profile, { mode: 'local', path: resumePath }, options);
  assert.equal(result.cancelled, true);
  assert.equal(confirmations, 2);
  assert.equal(await page.evaluate(() => window.uploadChanges), 1);
  assert.equal(await page.evaluate(() => window.submitClicks), 0);
});

test('browser mode confirms a saved resume without a local PDF or an upload', async t => {
  const { outcome, state, confirmations } = await runResumeApplication(t, 'delayed', {
    resumeChoice: { mode: 'browser' },
    confirm: async (page, count) => {
      assert.equal(count, 1);
      assert.deepEqual(await page.evaluate(() => [window.nextClicks, window.submitClicks, window.uploadEvents]), [0, 0, []]);
      return 'C';
    },
    review: async page => {
      assert.equal(await page.evaluate(() => window.submitClicks), 0);
      return 'SUBMIT';
    },
  });
  assert.equal(outcome.status, 'applied');
  assert.deepEqual(outcome.resume, { mode: 'browser', filename: 'base-resume.pdf' });
  assert.equal(confirmations, 1);
  assert.deepEqual([state.next, state.submit, state.uploads], [1, 1, []]);
});

test('blank, invalid, and SUBMIT answers cannot replace resume confirmation', async t => {
  const answers = ['', 'yes', 'SUBMIT', 'C'];
  const { outcome, state, confirmations, reviews } = await runResumeApplication(t, 'delayed', {
    resumeChoice: { mode: 'browser' },
    confirm: async (page, count) => {
      assert.ok(count <= answers.length, 'Unexpected extra resume confirmation');
      assert.deepEqual(await page.evaluate(() => [window.nextClicks, window.submitClicks]), [0, 0]);
      return answers[count - 1];
    },
    review: () => 'CANCEL',
  });
  assert.equal(outcome.status, 'cancelled');
  assert.equal(confirmations, 4);
  assert.equal(reviews, 1);
  assert.deepEqual([state.next, state.submit], [1, 0]);
});

for (const invalid of ['missing selection', 'pending upload', 'rejected upload', 'conflicting radio state']) {
  test(`${invalid} cannot advance after C and X cancels the resume checkpoint`, async t => {
    const { outcome, state, confirmations, reviews } = await runResumeApplication(t, 'delayed', {
      resumeChoice: { mode: 'browser' },
      confirm: async (page, count) => {
        assert.ok(count <= 2, 'Invalid selection must re-prompt only until cancellation');
        assert.deepEqual(await page.evaluate(() => [window.nextClicks, window.submitClicks]), [0, 0]);
        if (count === 2) return 'X';
        await page.evaluate(invalid => {
          if (invalid === 'missing selection') window.selectResume(null);
          if (invalid === 'pending upload') document.getElementById('upload-status').textContent = 'Uploading manual-resume.pdf...';
          if (invalid === 'rejected upload') document.getElementById('upload-status').textContent = 'Upload rejected: manual-resume.pdf';
          if (invalid === 'conflicting radio state') {
            document.querySelector('#saved-base input').checked = false;
            document.querySelector('#saved-same-name input').checked = true;
          }
        }, invalid);
        return 'C';
      },
    });
    assert.equal(outcome.status, 'cancelled');
    assert.equal(confirmations, 2);
    assert.equal(reviews, 0);
    assert.deepEqual([state.next, state.submit, state.uploads], [0, 0, []]);
  });
}

test('X returns cancellation from fill without confirming or advancing a selected resume', async t => {
  const { page } = await openResumeFixture(t);
  const result = await fillFormStep(page, profile, { mode: 'browser' }, {
    delayMs: 0,
    ask: question => {
      assert.ok(isResumeConfirmation(question));
      return 'X';
    },
  });
  assert.equal(result.cancelled, true);
  assert.equal(result.fields.some(field => field.type === 'file'), false);
  assert.deepEqual(await page.evaluate(() => [window.nextClicks, window.submitClicks, window.uploadEvents]), [0, 0, []]);
});

test('browser mode confirms a manually uploaded and selected PDF', async t => {
  const resumePath = temporaryResume(t);
  const { outcome, state } = await runResumeApplication(t, 'delayed', {
    resumeChoice: { mode: 'browser' },
    confirm: async (page, count) => {
      assert.equal(count, 1);
      assert.deepEqual(await page.evaluate(() => window.uploadEvents), []);
      const [chooser] = await Promise.all([page.waitForFileChooser(), page.click('#upload')]);
      await chooser.accept([resumePath]);
      await page.waitForSelector('#uploaded-resume');
      await page.click('#uploaded-resume');
      await page.waitForFunction(() => document.getElementById('uploaded-resume').getAttribute('aria-checked') === 'true');
      return 'C';
    },
    review: () => 'CANCEL',
  });
  assert.equal(outcome.status, 'cancelled');
  assert.deepEqual(outcome.resume, { mode: 'browser', filename: 'synthetic-resume.pdf' });
  assert.deepEqual(state.uploads, ['chooser', 'synthetic-resume.pdf', 'select', 'selected']);
  assert.deepEqual([state.next, state.submit], [1, 0]);
});

test('rerendering resume controls during confirmation uses the replacement selection', async t => {
  const { outcome, state } = await runResumeApplication(t, 'delayed', {
    resumeChoice: { mode: 'browser' },
    confirm: async (page, count) => {
      assert.equal(count, 1);
      await page.evaluate(() => {
        const current = document.querySelector('#application fieldset');
        const replacement = current.cloneNode(true);
        current.replaceWith(replacement);
        for (const card of replacement.querySelectorAll('[role="radio"]')) {
          card.onclick = () => window.selectResume(card);
        }
      });
      await page.click('#saved-same-name');
      return 'C';
    },
    review: () => 'CANCEL',
  });
  assert.equal(outcome.status, 'cancelled');
  assert.deepEqual(outcome.resume, { mode: 'browser', filename: 'synthetic-resume.pdf' });
  assert.deepEqual([state.next, state.submit, state.uploads], [1, 0, []]);
});

test('local upload overridden during confirmation survives repeated fill and final review', async t => {
  const resumeChoice = { mode: 'local', path: temporaryResume(t) };
  const { page } = await openResumeFixture(t);
  let confirmations = 0;
  const options = {
    delayMs: 0,
    output: () => {},
    ask: async question => {
      assert.ok(isResumeConfirmation(question));
      confirmations++;
      assert.equal(confirmations, 1);
      assert.equal(await page.$eval('#uploaded-resume', card => card.getAttribute('aria-checked')), 'true');
      await page.click('#saved-base');
      return 'C';
    },
  };
  const first = await fillFormStep(page, profile, resumeChoice, options);
  const second = await fillFormStep(page, profile, resumeChoice, options);
  const reviewed = new Map();
  mergeReviewFields(reviewed, first.fields);
  mergeReviewFields(reviewed, second.fields);
  assert.equal(reviewed.get('file:resume').value, 'base-resume.pdf');
  assert.equal(reviewed.get('file:resume').source, 'user');
  await page.click('#next');
  options.ask = async question => {
    assert.equal(isResumeConfirmation(question), false, 'Unchanged confirmed override should remain confirmed');
    assert.equal(await page.$eval('#saved-base input', input => input.checked), true);
    return 'SUBMIT';
  };
  const outcome = await submitReviewedApplication(page, job, reviewed, profile, resumeChoice, options);
  assert.equal(outcome.status, 'applied');
  assert.deepEqual(outcome.resume, { mode: 'browser', filename: 'base-resume.pdf' });
  assert.deepEqual(await page.evaluate(() => window.uploadEvents), ['chooser', 'synthetic-resume.pdf', 'select', 'selected']);
  assert.equal(await page.evaluate(() => window.submitClicks), 1);
});

test('a selection changed while answering SUBMIT needs confirmation and a renewed review', async t => {
  const { outcome, state, confirmations, reviews } = await runResumeApplication(t, 'delayed', {
    resumeChoice: { mode: 'browser' },
    confirm: async (page, count) => {
      assert.ok(count <= 2, 'Only the initial and changed selection need confirmation');
      assert.equal(await page.evaluate(() => window.submitClicks), 0);
      if (count === 2) assert.equal(await page.$eval('#saved-same-name input', input => input.checked), true);
      return 'C';
    },
    review: async (page, count) => {
      assert.ok(count <= 2, 'The changed selection needs one renewed final review');
      assert.equal(await page.evaluate(() => window.submitClicks), 0);
      if (count === 1) {
        await page.click('#saved-same-name');
        return 'SUBMIT';
      }
      return 'CANCEL';
    },
  });
  assert.equal(outcome.status, 'cancelled');
  assert.deepEqual(outcome.resume, { mode: 'browser', filename: 'synthetic-resume.pdf' });
  assert.equal(confirmations, 2);
  assert.equal(reviews, 2);
  assert.deepEqual([state.next, state.submit, state.uploads], [1, 0, []]);
});

test('changing a previously confirmed local selection never uploads over the user choice', async t => {
  const resumeChoice = { mode: 'local', path: temporaryResume(t) };
  const { page } = await openResumeFixture(t);
  const options = { delayMs: 0, ask: confirmResume };
  await fillFormStep(page, profile, resumeChoice, options);
  await page.click('#saved-base');
  let confirmations = 0;
  options.ask = async question => {
    assert.ok(isResumeConfirmation(question));
    confirmations++;
    assert.equal(await page.$eval('#saved-base input', input => input.checked), true);
    return 'C';
  };
  const changed = await fillFormStep(page, profile, resumeChoice, options);
  await fillFormStep(page, profile, resumeChoice, options);
  assert.equal(confirmations, 1);
  assert.equal(changed.fields.find(field => field.type === 'file').value, 'base-resume.pdf');
  assert.deepEqual(await page.evaluate(() => window.uploadEvents), ['chooser', 'synthetic-resume.pdf', 'select', 'selected']);
});

test('a final application without any detected resume cannot submit', async t => {
  const { page } = await openFixture(t);
  await page.setContent(`
    <section role="dialog" aria-label="Easy Apply">
      <button onclick="window.submitClicks++">Submit application</button>
    </section>
    <script>window.submitClicks = 0;</script>
  `);
  const outcome = await submitReviewedApplication(page, job, new Map(), profile, { mode: 'browser' }, {
    delayMs: 0,
    ask: () => 'SUBMIT',
    output: () => {},
  });
  assert.equal(outcome.status, 'incomplete');
  assert.equal(await page.evaluate(() => window.submitClicks), 0);
});
