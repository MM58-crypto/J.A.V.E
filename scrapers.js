const axios   = require('axios');
const cheerio = require('cheerio');
require('dotenv').config();

const GEO_KSA  = '100459316';
const LI_GUEST = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Referer': 'https://www.google.com/',
};

// ── time helpers ──────────────────────────────────────────────────────────────

const NATURAL_LANG = /minute|hour|day|week|month|just|moment|now|ago/i;

function parseNaturalLang(s) {
  const lower = s.toLowerCase().trim();
  if (/just|moment|now/.test(lower)) return 0.1;
  const n = parseInt(lower) || 1;
  if (lower.includes('minute')) return n / 60;
  if (lower.includes('hour'))   return n;
  if (lower.includes('day'))    return n * 24;
  if (lower.includes('week'))   return n * 168;
  if (lower.includes('month'))  return n * 720;
  return null;
}

function toHoursAgo(textContent, datetimeAttr) {
  if (textContent && NATURAL_LANG.test(textContent)) {
    const r = parseNaturalLang(textContent);
    if (r !== null) return r;
  }
  const attr = datetimeAttr || '';
  if (attr.includes('T')) return Math.max(0, (Date.now() - new Date(attr).getTime()) / 3_600_000);
  if (/^\d{4}-\d{2}-\d{2}$/.test(attr)) return Math.max(0, (Date.now() - new Date(attr + 'T12:00:00Z').getTime()) / 3_600_000);
  if (textContent) { const r = parseNaturalLang(textContent); if (r !== null) return r; }
  return 9999;
}

function freshnessLabel(hours) {
  if (hours <  1)  return '< 1 hr ago';
  if (hours <  6)  return `${Math.round(hours)} hrs ago`;
  if (hours < 24)  return `${Math.round(hours)} hrs ago`;
  if (hours < 48)  return '1 day ago';
  return `${Math.floor(hours / 24)} days ago`;
}

function makeJob(title, company, location, timeText, datetimeAttr, link, source) {
  const hoursAgo = toHoursAgo(timeText, datetimeAttr);
  return { title, company, location, hoursAgo, freshnessLabel: freshnessLabel(hoursAgo), link, source, description: null };
}

// ── LinkedIn guest API ────────────────────────────────────────────────────────

async function scrapeLinkedIn(keyword) {
  try {
    const url = `${LI_GUEST}?keywords=${encodeURIComponent(keyword)}&location=Saudi+Arabia&geoId=${GEO_KSA}&sortBy=DD&f_TPR=r86400&start=0`;
    const { data } = await axios.get(url, { headers: HEADERS, timeout: 12000 });
    const $ = cheerio.load(data);
    const jobs = [];
    $('li').each((_, el) => {
      const title        = $(el).find('.base-search-card__title').text().trim();
      const company      = $(el).find('.base-search-card__subtitle').text().trim();
      const location     = $(el).find('.job-search-card__location').text().trim();
      const timeEl       = $(el).find('time');
      const timeText     = timeEl.text().trim();
      const datetimeAttr = timeEl.attr('datetime') || '';
      const link         = ($(el).find('a.base-card__full-link').attr('href') || '').split('?')[0];
      if (title && company) jobs.push(makeJob(title, company, location, timeText, datetimeAttr, link, 'LinkedIn'));
    });
    return jobs;
  } catch { return []; }
}

// ── LinkedIn npm package ──────────────────────────────────────────────────────

async function scrapeLinkedInPackage(keyword) {
  try {
    const linkedIn = require('linkedin-jobs-api');
    const results  = await linkedIn.query({ keyword, location: 'Saudi Arabia', dateSincePosted: '24hr', limit: '20', sortBy: 'recent' });
    return results.map(r => makeJob(r.position || '', r.company || '', r.location || '', r.agoTime || '', '', r.jobUrl || '', 'LinkedIn'));
  } catch { return []; }
}

// ── JSearch API (RapidAPI) ────────────────────────────────────────────────────
// Free tier: 200 requests/month
// Sign up: https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch
// Add JSEARCH_API_KEY to .env to enable

async function scrapeJSearch(keyword) {
  if (!process.env.JSEARCH_API_KEY) return [];
  try {
    const { data } = await axios.get('https://jsearch.p.rapidapi.com/search', {
      params: {
        query:       `${keyword} in Saudi Arabia`,
        page:        '1',
        num_pages:   '1',
        date_posted: 'today',
        country:     'SA',
      },
      headers: {
        'X-RapidAPI-Key':  process.env.JSEARCH_API_KEY,
        'X-RapidAPI-Host': 'jsearch.p.rapidapi.com',
      },
      timeout: 12000,
    });
    return (data.data || []).map(j => makeJob(
      j.job_title       || '',
      j.employer_name   || '',
      j.job_city        || 'Saudi Arabia',
      j.job_posted_at_datetime_utc || '',
      '',
      j.job_apply_link  || '',
      j.job_publisher   || 'JSearch'
    ));
  } catch { return []; }
}

// ── mock data for --demo flag ─────────────────────────────────────────────────

function getMockJobs(keyword) {
  return [
    makeJob(`${keyword} – Senior Level`,       'Saudi Aramco Digital', 'Dhahran, Eastern Province', '25 minutes ago', '', 'https://linkedin.com/jobs/view/1', 'LinkedIn'),
    makeJob(`Junior ${keyword}`,               'stc solutions',        'Riyadh, Saudi Arabia',      '1 hour ago',     '', 'https://linkedin.com/jobs/view/2', 'LinkedIn'),
    makeJob(`${keyword} – AI Focus`,           'Lucidya',              'Jeddah, Saudi Arabia',      '3 hours ago',    '', 'https://linkedin.com/jobs/view/3', 'LinkedIn'),
    makeJob(`${keyword} II`,                   'Master Works',         'Riyadh, Saudi Arabia',      '5 hours ago',    '', 'https://jsearch.com/jobs/4',        'JSearch'),
    makeJob(`Lead ${keyword}`,                 'EPAM Systems',         'Al Khobar, Saudi Arabia',   '20 hours ago',   '', 'https://jsearch.com/jobs/5',        'JSearch'),
    makeJob(`${keyword} – Remote (KSA-based)`, 'IntelliSense.io',      'Remote, Saudi Arabia',      'Just now',       '', 'https://linkedin.com/jobs/view/6',  'LinkedIn'),
    makeJob(`${keyword} Intern`,               'Mozn',                 'Riyadh, Saudi Arabia',      '2 days ago',     '', 'https://jsearch.com/jobs/7',         'JSearch'),
  ];
}

// ── fetch description on demand ───────────────────────────────────────────────

async function fetchDescription(job) {
  if (job.description) return job.description;
  if (!job.link)       return 'No link available.';
  try {
    const { data } = await axios.get(job.link, { headers: HEADERS, timeout: 12000 });
    const $ = cheerio.load(data);
    if (job.source === 'LinkedIn') return $('.show-more-less-html__markup').text().trim() || $('.description__text').text().trim() || 'Description not available.';
    return $('body').text().replace(/\s+/g, ' ').trim().slice(0, 2000) || 'Description not available.';
  } catch { return 'Could not load description — visit the link below for full details.'; }
}

// ── rank + dedup ──────────────────────────────────────────────────────────────

function rankJobs(jobs, keyword) {
  const kw    = keyword.toLowerCase();
  const words = kw.split(/\s+/);
  const seen  = new Set();

  return jobs
    .filter(j => {
      const key = `${j.title.toLowerCase()}|${j.company.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(job => {
      let score = 0;
      const h = job.hoursAgo;
      if      (h <  1)  score += 60;
      else if (h <  6)  score += 50;
      else if (h < 24)  score += 40;
      else if (h < 72)  score += 20;
      else              score += 5;

      const t = job.title.toLowerCase();
      if (t.includes(kw))                          score += 30;
      else if (words.some(w => t.includes(w)))     score += 15;

      return { ...job, score };
    })
    .sort((a, b) => b.score - a.score);
}

// ── main export ───────────────────────────────────────────────────────────────

async function getJobs(keyword, demo = false) {
  if (demo) {
    const jobs = rankJobs(getMockJobs(keyword), keyword);
    return {
      jobs,
      sources: { LinkedIn: 4, JSearch: 3 },
      fetchDescription: j => Promise.resolve(`[DEMO] Sample description for "${j.title}" at ${j.company}.\n\nResponsibilities:\n- Build scalable backend systems\n- Collaborate with cross-functional teams\n- Write clean, testable code\n\nRequirements:\n- 2+ years experience\n- Python or Node.js\n- Strong communication skills`)
    };
  }

  process.stdout.write('  Searching LinkedIn...');
  const [liGuest, liPkg] = await Promise.all([scrapeLinkedIn(keyword), scrapeLinkedInPackage(keyword)]);
  process.stdout.write(' JSearch...\n');
  const jsearch = await scrapeJSearch(keyword);

  const liAll = rankJobs([...liGuest, ...liPkg], keyword).filter((j, i, arr) =>
    arr.findIndex(x => x.title === j.title && x.company === j.company) === i
  );

  const jobs    = rankJobs([...liAll, ...jsearch], keyword);
  const sources = { LinkedIn: liAll.length, JSearch: jsearch.length };

  return { jobs, sources, fetchDescription };
}

module.exports = { getJobs, fetchDescription };
