const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const { getJobs, fetchDescription } = require('../scrapers');

const now = Date.parse('2026-09-05T12:00:00Z');
const careerProfile = {
  headline: 'Backend Engineer',
  years_experience: 3,
  education: 'Computer Science',
  skills: ['Node.js', 'PostgreSQL'],
  languages: ['English'],
  target_roles: ['Backend Engineer'],
};
const description = 'Build Node.js services and PostgreSQL databases. Work with backend engineers and maintain automated tests. Requires 2 years of experience.';

function setup(t, jsearch = false) {
  t.mock.method(Date, 'now', () => now);
  const previous = process.env.JSEARCH_API_KEY;
  if (jsearch) process.env.JSEARCH_API_KEY = 'test-key';
  else delete process.env.JSEARCH_API_KEY;
  t.after(() => {
    if (previous === undefined) delete process.env.JSEARCH_API_KEY;
    else process.env.JSEARCH_API_KEY = previous;
  });
}

function card({ company = 'Example', title = 'Backend Engineer', location = 'Kuala Lumpur, Malaysia', datetime = '', relative = '', id = company }) {
  return `<li><a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/${id}"></a>
    <h3 class="base-search-card__title">${title}</h3>
    <h4 class="base-search-card__subtitle">${company}</h4>
    <span class="job-search-card__location">${location}</span>
    <time datetime="${datetime}">${relative}</time></li>`;
}

function jsearchJob(overrides = {}) {
  return {
    job_title: 'Backend Engineer',
    employer_name: 'JSearch Example',
    job_city: 'Kuala Lumpur',
    job_country: 'MY',
    job_posted_at_datetime_utc: '2026-09-05T10:00:00.000Z',
    job_description: description,
    job_publisher: 'Example Careers',
    job_apply_link: 'https://example.test/careers/backend',
    ...overrides,
  };
}

test('under-five-hour matches outrank country and score without searching older postings', async t => {
  setup(t, true);
  t.mock.method(axios, 'get', async (url, options) => {
    if (url.includes('jobs-guest')) {
      assert.equal(new URL(url).searchParams.get('f_TPR'), 'r18000');
      return { data: '' };
    }
    assert.equal(options.params.date_posted, 'today');
    if (options.params.country === 'om') {
      return { data: { data: [jsearchJob({
        employer_name: 'Oman recent', job_country: 'OM', job_city: 'Muscat',
        job_posted_at_datetime_utc: '2026-09-05T11:00:00Z',
      })] } };
    }
    return { data: { data: [
      jsearchJob({ employer_name: 'Higher score', job_posted_at_datetime_utc: '2026-09-05T08:00:00Z' }),
      jsearchJob({
        employer_name: 'Newest lower score', job_title: 'Developer',
        job_posted_at_datetime_utc: '2026-09-05T11:30:00Z',
      }),
      jsearchJob({ employer_name: 'Exactly five hours', job_posted_at_datetime_utc: '2026-09-05T07:00:00Z' }),
      jsearchJob({ employer_name: 'Older', job_posted_at_datetime_utc: '2026-09-04T12:00:00Z' }),
    ] } };
  });
  const result = await getJobs('Backend Engineer', { countries: ['MY', 'OM'], careerProfile });
  assert.deepEqual(result.jobs.map(job => job.company), ['Newest lower score', 'Oman recent', 'Higher score']);
  assert.ok(result.jobs[0].evaluation.score < result.jobs[2].evaluation.score);
  assert.deepEqual(result.sources, { LinkedIn: 0, JSearch: 3 });
});

test('no recent profile matches triggers older fallback in newest-first order across providers', async t => {
  setup(t, true);
  t.mock.method(axios, 'get', async (url, options) => {
    if (url.includes('jobs-guest')) {
      const params = new URL(url).searchParams;
      if (params.has('f_TPR')) return { data: card({ company: 'Unrelated', title: 'Pastry Chef', relative: '1 hour ago' }) };
      return { data: [
        card({ company: 'Oldest', relative: '3 days ago' }),
        card({ company: 'Day old', relative: '24 hours ago' }),
      ].join('') };
    }
    if (url.includes('jsearch')) {
      if (options.params.date_posted === 'today') return { data: { data: [] } };
      return { data: { data: [jsearchJob({
        employer_name: 'Five-hour fallback', job_title: 'Developer',
        job_posted_at_datetime_utc: '2026-09-05T07:00:00Z',
      })] } };
    }
    return { data: `<div class="show-more-less-html__markup">${url.endsWith('/Unrelated')
      ? 'Prepare pastries and desserts, manage kitchen stock and maintain food hygiene. Requires 2 years of culinary experience.'
      : description}</div>` };
  });
  const result = await getJobs('Backend Engineer', { countries: ['MY'], careerProfile });
  assert.deepEqual(result.jobs.map(job => [job.company, job.hoursAgo]), [
    ['Five-hour fallback', 5], ['Day old', 24], ['Oldest', 72],
  ]);
  assert.ok(result.jobs[0].evaluation.score < result.jobs[1].evaluation.score);
  assert.deepEqual(result.sources, { LinkedIn: 2, JSearch: 1 });
});

test('fallback preserves timestamp authority and rejects unverified or future posting times', async t => {
  setup(t);
  const candidates = [
    { company: 'Exact time', datetime: '2026-09-05T07:00:00Z', relative: '2 days ago' },
    { company: 'Offset time', datetime: '2026-09-05T08:00:00+02:00' },
    { company: 'Relative fresh', relative: '23 hours ago' },
    { company: 'Date today', datetime: '2026-09-05' },
    { company: 'Date with hour precision', datetime: '2026-09-05', relative: '5 hours ago' },
    { company: 'Recent yesterday', datetime: '2026-09-04', relative: '23 hours ago' },
    { company: 'Contradictory stale label', datetime: '2026-09-05', relative: '2 days ago' },
    { company: 'Boundary', datetime: '2026-09-04T12:00:00Z', relative: '1 minute ago' },
    { company: 'Stale exact', datetime: '2026-09-03T12:00:00Z', relative: 'just now' },
    { company: 'Old date only', datetime: '2026-09-03' },
    { company: 'Future', datetime: '2026-09-05T13:00:00Z', relative: 'just now' },
    { company: 'Future day', datetime: '2026-09-06' },
    { company: 'Ambiguous yesterday', datetime: '2026-09-04', relative: '1 hour ago' },
    { company: 'Relative boundary', relative: '24 hours ago' },
    { company: 'Unknown text', relative: 'actively recruiting' },
    { company: 'Missing' },
    { company: 'Invalid', datetime: 'not-a-date', relative: 'just now' },
    { company: 'Rollover date', datetime: '2026-02-30T12:00:00Z', relative: 'just now' },
    { company: 'Invalid clock', datetime: '2026-09-04T24:00:00Z', relative: 'just now' },
    { company: 'Unzoned', datetime: '2026-09-05T11:00:00' },
  ];
  const descriptionRequests = [];
  t.mock.method(axios, 'get', async url => {
    if (url.includes('jobs-guest')) return { data: candidates.map(card).join('') };
    descriptionRequests.push(url);
    return { data: `<div class="show-more-less-html__markup">${description}</div>` };
  });
  const result = await getJobs('Backend Engineer', { countries: ['MY'], careerProfile });
  assert.deepEqual(result.jobs.map(job => job.company), [
    'Exact time', 'Date with hour precision', 'Offset time', 'Date today', 'Relative fresh', 'Recent yesterday',
    'Boundary', 'Relative boundary', 'Stale exact', 'Old date only',
  ]);
  assert.equal(result.jobs.find(job => job.company === 'Date with hour precision').hoursAgo, 5);
  assert.equal(descriptionRequests.length, 10);
  assert.equal(result.sources.LinkedIn, 10);
  assert.equal(result.jobs.find(job => job.company === 'Old date only').hoursAgo, 60);
  assert.match(result.jobs.find(job => job.company === 'Old date only').freshnessLabel, /2026-09-03.*time unknown/);
});

test('crossing five hours while loading descriptions triggers fallback instead of an empty list', async t => {
  setup(t);
  let current = now;
  t.mock.method(Date, 'now', () => current);
  const windows = [];
  t.mock.method(axios, 'get', async url => {
    if (url.includes('jobs-guest')) {
      windows.push(new URL(url).searchParams.get('f_TPR'));
      return { data: card({ datetime: '2026-09-05T07:00:01Z' }) };
    }
    current += 2000;
    return { data: `<div class="show-more-less-html__markup">${description}</div>` };
  });
  const result = await getJobs('Backend Engineer', { countries: ['MY'], careerProfile });
  assert.deepEqual(windows, ['r18000', null]);
  assert.deepEqual(result.jobs.map(job => job.company), ['Example']);
  assert.ok(result.jobs[0].hoursAgo > 5);
  assert.deepEqual(result.sources, { LinkedIn: 1, JSearch: 0 });
});

test('all four countries scope both providers and reject leaked or unverified remote locations', async t => {
  setup(t, true);
  const countries = [['MY', 'Malaysia'], ['OM', 'Oman'], ['SG', 'Singapore'], ['SA', 'Saudi Arabia']];
  let selected;
  const requests = [];
  t.mock.method(axios, 'get', async (url, options) => {
    if (url.includes('jobs-guest')) {
      const params = new URL(url).searchParams;
      requests.push(params.get('location'));
      assert.equal(params.get('location'), selected[1]);
      assert.equal(params.get('keywords'), 'Backend Engineer');
      return { data: [
        card({ company: 'Local LinkedIn', location: selected[1], relative: '1 hour ago' }),
        card({ company: 'Wrong LinkedIn', location: selected[0] === 'MY' ? 'Oman' : 'Malaysia', relative: '1 hour ago' }),
        card({ company: 'Global remote', location: 'Remote', relative: '1 hour ago' }),
        card({ company: 'Ambiguous regional', location: `${selected[1]}, ${selected[0] === 'MY' ? 'Oman' : 'Malaysia'}`, relative: '1 hour ago' }),
      ].join('') };
    }
    if (url.includes('jsearch')) {
      assert.equal(options.params.country, selected[0].toLowerCase());
      assert.equal(options.params.query, `Backend Engineer in ${selected[1]}`);
      return { data: { data: [
        jsearchJob({ job_country: selected[0], job_city: '', employer_name: 'Local JSearch' }),
        jsearchJob({ job_country: 'US', job_city: 'Remote', employer_name: 'Wrong JSearch' }),
        jsearchJob({ job_country: '', job_city: 'Remote', employer_name: 'Unverified JSearch' }),
      ] } };
    }
    return { data: `<div class="show-more-less-html__markup">${description}</div>` };
  });
  for (selected of countries) {
    const result = await getJobs('Backend Engineer', { countries: [selected[0]], careerProfile });
    assert.deepEqual(result.jobs.map(job => job.company), ['Local LinkedIn', 'Local JSearch']);
    assert.deepEqual(result.jobs.map(job => job.country), [selected[0], selected[0]]);
    const apiJob = result.jobs.find(job => job.source === 'JSearch');
    assert.equal(apiJob.hoursAgo, 2);
    assert.deepEqual(result.sources, { LinkedIn: 1, JSearch: 1 });
  }
  assert.deepEqual(requests, countries.map(country => country[1]));
});

test('dedup retains distinct locations and countries while sorting freshness before country priority', async t => {
  setup(t);
  t.mock.method(axios, 'get', async url => {
    if (!url.includes('jobs-guest')) return { data: `<div class="show-more-less-html__markup">${description}</div>` };
    const country = new URL(url).searchParams.get('location');
    return { data: (country === 'Malaysia' ? [
      card({ location: 'Kuala Lumpur, Malaysia', relative: '4 hours ago', id: 'kl-old' }),
      card({ location: 'Kuala Lumpur, Malaysia', relative: '3 hours ago', id: 'kl-new' }),
      card({ location: 'Penang, Malaysia', relative: '270 minutes ago', id: 'penang' }),
    ] : [card({ location: 'Muscat, Oman', relative: '1 hour ago', id: 'muscat' })]).join('') };
  });
  const result = await getJobs('Backend Engineer', { countries: ['OM', 'MY'], careerProfile });
  assert.deepEqual(result.jobs.map(job => [job.country, job.location, job.hoursAgo]), [
    ['OM', 'Muscat, Oman', 1],
    ['MY', 'Kuala Lumpur, Malaysia', 3],
    ['MY', 'Penang, Malaysia', 4.5],
  ]);
  assert.equal(result.sources.LinkedIn, 3);
});

test('newly available fresh matches in the broader search still exclude older postings', async t => {
  setup(t);
  t.mock.method(axios, 'get', async url => {
    if (url.includes('jobs-guest')) {
      if (new URL(url).searchParams.has('f_TPR')) return { data: '' };
      return { data: [
        card({ company: 'Newly available', relative: '1 hour ago' }),
        card({ company: 'Older', relative: '2 days ago' }),
      ].join('') };
    }
    return { data: `<div class="show-more-less-html__markup">${description}</div>` };
  });
  const result = await getJobs('Backend Engineer', { countries: ['MY'], careerProfile });
  assert.deepEqual(result.jobs.map(job => job.company), ['Newly available']);
  assert.deepEqual(result.sources, { LinkedIn: 1, JSearch: 0 });
});

test('local relevance uses retrieved descriptions and rejects unrelated roles and unavailable evidence', async t => {
  setup(t, true);
  t.mock.method(axios, 'get', async url => {
    if (url.includes('jobs-guest')) return { data: [
      card({ company: 'Matched', relative: '1 hour ago' }),
      card({ company: 'Unavailable', relative: '1 hour ago' }),
    ].join('') };
    if (url.includes('jsearch')) return { data: { data: [jsearchJob({
      employer_name: 'Unrelated',
      job_title: 'Pastry Chef',
      job_description: 'Prepare pastries and desserts, manage kitchen stock and maintain food hygiene. Requires 2 years of culinary experience.',
    })] } };
    if (url.endsWith('/Unavailable')) throw new Error('network failure');
    return { data: `<div class="show-more-less-html__markup">${description}</div>` };
  });
  const result = await getJobs('Backend Engineer', { countries: ['MY'], careerProfile });
  assert.deepEqual(result.jobs.map(job => job.company), ['Matched']);
  assert.equal(result.jobs[0].evaluation.verdict, 'apply');
  assert.equal(result.jobs[0].evaluation.analysis_method, 'local');
  assert.deepEqual(result.sources, { LinkedIn: 1, JSearch: 0 });
  assert.ok(result.warnings.some(warning => /Malaysia.*LinkedIn.*description unavailable/.test(warning)));
  assert.equal(await fetchDescription({ link: 'https://example.test/Unavailable' }), '');
  assert.equal(await fetchDescription({}), '');
});

test('partial country/provider failures preserve successful results and report the missing sources', async t => {
  setup(t, true);
  t.mock.method(axios, 'get', async (url, options) => {
    if (url.includes('jobs-guest')) throw new Error('provider unavailable');
    if (options.params.country === 'om') throw new Error('country quota exhausted');
    return { data: { data: [jsearchJob()] } };
  });
  const result = await getJobs('Backend Engineer', { countries: ['MY', 'OM'], careerProfile });
  assert.deepEqual(result.jobs.map(job => job.company), ['JSearch Example']);
  assert.deepEqual(result.sources, { LinkedIn: 0, JSearch: 1 });
  assert.equal(result.warnings.length, 3);
  assert.ok(result.warnings.some(warning => /Malaysia: LinkedIn search failed/.test(warning)));
  assert.ok(result.warnings.some(warning => /Oman: LinkedIn search failed/.test(warning)));
  assert.ok(result.warnings.some(warning => /Oman: JSearch search failed/.test(warning)));
});

test('demo is synthetic, country-specific, network-free and still locally relevance-filtered', async t => {
  setup(t);
  let networkRequests = 0;
  t.mock.method(axios, 'get', async () => {
    networkRequests++;
    throw new Error('Demo must not access providers');
  });
  const result = await getJobs('Backend Engineer', { countries: ['SA', 'SG', 'OM', 'MY'], demo: true, careerProfile });
  assert.deepEqual(result.jobs.map(job => job.country), ['MY', 'OM', 'SG', 'SA']);
  for (const job of result.jobs) {
    assert.equal(job.evaluation.verdict, 'apply');
  }
  assert.deepEqual(result.sources, { Demo: 4 });
  const unrelated = await getJobs('Backend Engineer', {
    countries: ['MY'], demo: true,
    careerProfile: { ...careerProfile, skills: ['Baking'], target_roles: ['Pastry Chef'] },
  });
  assert.deepEqual(unrelated.jobs, []);
  assert.equal(networkRequests, 0);
});
