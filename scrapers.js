const axios = require('axios');
const cheerio = require('cheerio');
const { loadCareerProfile } = require('./career-profile');
const { evaluateJob } = require('./evaluator');
const { COUNTRIES, PRIORITY_AGE_HOURS, resolveCountries } = require('./search-options');
const { normalizeJobUrl } = require('./job-url');
require('dotenv').config({ quiet: true });

const LI_GUEST = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';
const NETWORK_CONCURRENCY = 4;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Referer': 'https://www.google.com/',
};

function relativeHours(text) {
  const relative = String(text || '').trim().toLowerCase();
  if (/^(?:now|just now|moments? ago|a moment ago)$/.test(relative)) return 0;
  const match = /^(a|an|\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/.exec(relative);
  if (!match) return NaN;
  const count = /^(?:a|an)$/.test(match[1]) ? 1 : Number(match[1]);
  const units = { second: 1 / 3600, minute: 1 / 60, hour: 1, day: 24, week: 168, month: 720, year: 8760 };
  return count * units[match[2]];
}

// Precise timestamps outrank labels. A date plus an agreeing relative label
// retains its hour precision; a bare date is bounded from UTC midnight.
function toHoursAgo(text, datetime, now) {
  const value = String(datetime || '').trim();
  if (value) {
    const date = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(value);
    if (!date) return NaN;
    const midnight = Date.parse(`${date[1]}-${date[2]}-${date[3]}T00:00:00Z`);
    if (!Number.isFinite(midnight)
      || new Date(midnight).toISOString().slice(0, 10) !== value.slice(0, 10)) return NaN;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const hours = relativeHours(text);
      if (Number.isFinite(hours)) {
        const impliedDate = new Date(now - hours * 3_600_000);
        return Number.isFinite(impliedDate.getTime())
          && impliedDate.toISOString().slice(0, 10) === value ? hours : NaN;
      }
      return (now - midnight) / 3_600_000;
    }
    if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return NaN;
    return (now - Date.parse(value)) / 3_600_000;
  }
  return relativeHours(text);
}

function freshnessLabel(hours, dateOnly = false, postedAt) {
  if (dateOnly && Number.isFinite(postedAt)) return `Posted ${new Date(postedAt).toISOString().slice(0, 10)} (time unknown)`;
  return hours < 1 ? '< 1 hr ago' : `${Math.floor(hours)} hr${hours >= 2 ? 's' : ''} ago`;
}

function countryMatches(job, country) {
  const declared = String(job.job_country || '').trim().toLowerCase();
  if (declared && declared !== country.code.toLowerCase() && declared !== country.name.toLowerCase()) {
    return false;
  }
  const location = String(job.location || '').toLowerCase();
  const segments = location.split(/[,;|()/]+/).map(part => part.trim());
  const mentioned = COUNTRIES.filter(candidate => {
    const name = candidate.name.toLowerCase();
    const namePattern = new RegExp(`\\b${name}\\b`);
    return namePattern.test(location) || segments.includes(candidate.code.toLowerCase());
  });
  if (mentioned.some(candidate => candidate.code !== country.code)) return false;
  return Boolean(declared || mentioned.some(candidate => candidate.code === country.code));
}

function makeJob(fields, country, timeText, datetime) {
  const now = Date.now();
  const hoursAgo = toHoursAgo(timeText, datetime, now);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(String(datetime || '').trim())
    && !Number.isFinite(relativeHours(timeText));
  const postedAt = now - hoursAgo * 3_600_000;
  return {
    ...fields,
    link: normalizeJobUrl(fields.link),
    country: country.code,
    countryName: country.name,
    hoursAgo,
    postedAt,
    dateOnly,
    freshnessLabel: freshnessLabel(hoursAgo, dateOnly, postedAt),
    description: fields.description || '',
  };
}

async function scrapeLinkedIn(keyword, country, recentOnly) {
  const params = new URLSearchParams({
    keywords: keyword,
    location: country.name,
    sortBy: 'DD',
    start: '0',
  });
  if (recentOnly) params.set('f_TPR', `r${PRIORITY_AGE_HOURS * 3600}`);
  const { data } = await axios.get(`${LI_GUEST}?${params}`, { headers: HEADERS, timeout: 12000 });
  const $ = cheerio.load(data);
  const jobs = [];
  $('li').each((_, el) => {
    const card = $(el);
    const time = card.find('time');
    jobs.push(makeJob({
      title: card.find('.base-search-card__title').text().trim(),
      company: card.find('.base-search-card__subtitle').text().trim(),
      location: card.find('.job-search-card__location').text().trim(),
      link: card.find('a.base-card__full-link').attr('href') || '',
      source: 'LinkedIn',
    }, country, time.text(), time.attr('datetime')));
  });
  return jobs;
}

async function scrapeJSearch(keyword, country, recentOnly) {
  const { data } = await axios.get('https://jsearch.p.rapidapi.com/search', {
    params: {
      query: `${keyword} in ${country.name}`,
      page: '1',
      num_pages: '1',
      date_posted: recentOnly ? 'today' : 'all',
      country: country.code.toLowerCase(),
    },
    headers: {
      'X-RapidAPI-Key': process.env.JSEARCH_API_KEY,
      'X-RapidAPI-Host': 'jsearch.p.rapidapi.com',
    },
    timeout: 12000,
  });
  if (!Array.isArray(data?.data)) throw new Error('Invalid JSearch response');
  return data.data.map(job => makeJob({
    title: job.job_title || '',
    company: job.employer_name || '',
    location: [job.job_city, job.job_state, job.job_country].filter(Boolean).join(', '),
    job_country: job.job_country || '',
    description: job.job_description || '',
    publisher: job.job_publisher || '',
    link: job.job_apply_link || '',
    source: 'JSearch',
  }, country, '', job.job_posted_at_datetime_utc));
}

function getDemoJobs(keyword, countries) {
  return countries.map(country => makeJob({
    title: keyword,
    company: `[DEMO] Synthetic ${country.name} Employer`,
    location: country.name,
    link: '',
    source: 'Demo',
    description: `[DEMO — SYNTHETIC POSTING, NOT A REAL VACANCY] ${keyword} in ${country.name}.
Responsibilities: build reliable backend services using Node.js, Python and PostgreSQL;
collaborate with engineers, document designs and maintain automated tests.
Requirements: 2 years of experience delivering software and strong communication skills.`,
  }, country, '1 hour ago', ''));
}

async function loadDescription(job) {
  if (job.description) return job.description;
  if (!job.link) return '';
  const { data } = await axios.get(normalizeJobUrl(job.link), { headers: HEADERS, timeout: 12000 });
  const $ = cheerio.load(data);
  if (job.source === 'LinkedIn') {
    return $('.show-more-less-html__markup').text().trim() || $('.description__text').text().trim();
  }
  return $('body').text().replace(/\s+/g, ' ').trim().slice(0, 20000);
}

async function fetchDescription(job) {
  try {
    return await loadDescription(job);
  } catch {
    return '';
  }
}

async function mapConcurrent(items, operation) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(NETWORK_CONCURRENCY, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await operation(items[index]);
    }
  }));
  return results;
}

function rankJobs(jobs) {
  const priority = new Map(COUNTRIES.map((country, index) => [country.code, index]));
  const seen = new Set();
  return jobs.sort((a, b) =>
    a.hoursAgo - b.hoursAgo
      || priority.get(a.country) - priority.get(b.country)
      || b.evaluation.score - a.evaluation.score
  ).filter(job => {
    const key = [job.country, job.location, job.title, job.company]
      .map(value => value.toLowerCase().replace(/\s+/g, ' ').trim()).join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function getJobs(keyword, options = {}) {
  const countries = resolveCountries(options.countries);
  const careerProfile = options.careerProfile || loadCareerProfile();
  const warnings = [];
  let jobs = [];
  for (const recentOnly of [true, false]) {
    let retrieved;
    if (options.demo) {
      retrieved = getDemoJobs(keyword, countries);
    } else {
      const requests = countries.flatMap(country => [
        { country, source: 'LinkedIn', scrape: scrapeLinkedIn },
        ...(process.env.JSEARCH_API_KEY ? [{ country, source: 'JSearch', scrape: scrapeJSearch }] : []),
      ]);
      const batches = await mapConcurrent(requests, async ({ country, source, scrape }) => {
        try {
          return await scrape(keyword, country, recentOnly);
        } catch {
          warnings.push(`${country.name}: ${source} search failed; results may be incomplete.`);
          return [];
        }
      });
      retrieved = batches.flat();
    }
    const eligible = retrieved.filter(job => job.title && job.company
      && Number.isFinite(job.hoursAgo) && job.hoursAgo >= 0
      && (!recentOnly || job.hoursAgo < PRIORITY_AGE_HOURS)
      && countryMatches(job, countries.find(country => country.code === job.country)));
    const evaluated = await mapConcurrent(eligible, async job => {
      try {
        job.description = await loadDescription(job);
      } catch {
        job.description = '';
      }
      if (!job.description.trim()) {
        warnings.push(`${job.countryName}: ${job.source} description unavailable; a posting was excluded.`);
      }
      job.evaluation = await evaluateJob(job, { careerProfile, localOnly: true });
      return job;
    });
    const now = Date.now();
    jobs = rankJobs(evaluated.filter(job => {
      // Recheck the five-hour boundary after descriptions finish loading.
      job.hoursAgo = (now - job.postedAt) / 3_600_000;
      job.freshnessLabel = freshnessLabel(job.hoursAgo, job.dateOnly, job.postedAt);
      return job.evaluation.verdict === 'apply'
        && Number.isFinite(job.hoursAgo) && job.hoursAgo >= 0
        && (!recentOnly || job.hoursAgo < PRIORITY_AGE_HOURS);
    }));
    if (!recentOnly && jobs[0]?.hoursAgo < PRIORITY_AGE_HOURS) {
      jobs = jobs.filter(job => job.hoursAgo < PRIORITY_AGE_HOURS);
    }
    if (jobs.length || options.demo) break;
  }
  const sources = options.demo ? { Demo: 0 } : { LinkedIn: 0, JSearch: 0 };
  for (const job of jobs) sources[job.source] = (sources[job.source] || 0) + 1;
  return { jobs, sources, warnings: [...new Set(warnings)].sort(), countries };
}

module.exports = { getJobs, fetchDescription };
