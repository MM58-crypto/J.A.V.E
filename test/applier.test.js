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

async function fillFixture(page, resumePath) {
  const answers = question => {
    if (question.includes('Portfolio note')) return 'Portfolio available on request';
    if (question.includes('authorized to work')) return 'Yes';
    if (question.includes('certify')) return 'Yes';
    throw new Error(`Unexpected question: ${question}`);
  };
  return fillFormStep(page, profile, resumePath, { ask: answers, delayMs: 0 });
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
  const resumePath = temporaryResume(t);
  const { page } = await openFixture(t);

  const result = await fillFixture(page, resumePath);
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
  const resumePath = temporaryResume(t);
  const { page } = await openFixture(t);

  const result = await fillFixture(page, resumePath);
  const reviewed = new Map();
  mergeReviewFields(reviewed, result.fields);
  const responses = ['not yet', 'SUBMIT'];
  const outcome = await submitReviewedApplication(
    page,
    job,
    reviewed,
    profile,
    resumePath,
    { ask: async () => responses.shift(), output: () => {} },
  );

  assert.equal(outcome.status, 'applied');
  assert.equal(outcome.reviewed, true);
  assert.equal(await page.evaluate(() => window.submitClicks), 1);
});

test('EDIT review reacquires a rerendered submit button', async t => {
  const resumePath = temporaryResume(t);
  const { page } = await openFixture(t);

  const result = await fillFixture(page, resumePath);
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
  const outcome = await applyToJob({ ...job, link: inputLink }, resumePath, {
    profile: fixture.profile,
    delayMs: 0,
    ask: async question => {
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
  await fillFormStep(page, sduiProfile, resumePath, options);
  await page.select('[id="«ra»"]', 'ae');
  await page.$eval('[id="«rc»"]', element => { element.value = '+971500000000'; });

  await fillFormStep(page, sduiProfile, resumePath, options);
  assert.equal(await page.$eval('[id="«r8»"]', element => element.value), 'account@example.invalid');
  assert.equal(await page.$eval('[id="«ra»"]', element => element.value), 'ae');
  assert.equal(await page.$eval('[id="«rc»"]', element => element.value), '+971500000000');
});

test('shared dial codes require a choice instead of selecting a default or prefix match', async t => {
  const page = await openSDUIFixture(t);
  const resumePath = temporaryResume(t);
  let prompts = 0;
  const first = await fillFormStep(page, profile, resumePath, {
    delayMs: 0,
    ask: () => { prompts++; return ''; },
  });
  assert.equal(prompts, 1);
  assert.deepEqual(first.unresolvedRequired.map(field => field.label), ['Phone country code*']);
  assert.equal(await page.$eval('[id="«ra»"]', element => element.value), '');

  const second = await fillFormStep(page, profile, resumePath, {
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
        <button onclick="window.applicationClicks++; document.getElementById('confirmation').textContent = 'Application was sent'">Submit application</button>
      ${closing}
      <p id="confirmation"></p>
      <script>window.backgroundClicks = 0; window.applicationClicks = 0;</script>
    `);
    const result = await fillFormStep(page, profile, resumePath, {
      delayMs: 0,
      ask: question => { throw new Error(`Unexpected question: ${question}`); },
    });
    assert.equal(await page.$eval('#application-email', element => element.value), profile.personal.email);
    assert.deepEqual(await page.$$eval('#background, #stale, #unrelated', elements => elements.map(element => element.value)), ['', '', '']);
    const reviewed = new Map();
    mergeReviewFields(reviewed, result.fields);
    const outcome = await submitReviewedApplication(page, job, reviewed, profile, resumePath, {
      ask: async () => 'SUBMIT',
      output: () => {},
    });
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
    await assert.rejects(fillFormStep(page, profile, resumePath, {
      delayMs: 0,
      ask: question => { throw new Error(`Unexpected question: ${question}`); },
    }));
    const outcome = await submitReviewedApplication(page, job, new Map(), profile, resumePath, {
      ask: async () => 'SUBMIT',
      output: () => {},
    });
    assert.equal(outcome.status, 'incomplete');
    assert.equal(await page.$eval('#email', element => element.value), '');
    assert.equal(await page.evaluate(() => window.submitClicks), 0);
  });
}
