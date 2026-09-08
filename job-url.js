// Use the signed-in LinkedIn host, not country-specific public job pages.
function normalizeJobUrl(link) {
  if (typeof link !== 'string' || !link) return link;
  let url;
  try {
    url = new URL(link, 'https://www.linkedin.com');
  } catch {
    return link;
  }
  if (!/^https?:$/.test(url.protocol)
    || !/^(?:[a-z0-9-]+\.)?linkedin\.com$/i.test(url.hostname)
    || !/^\/jobs\/view\/[^/]+\/?$/.test(url.pathname)) return link;

  // Job permalinks need neither guest locale/tracking parameters nor fragments.
  // Other sites retain their full URL: their query may identify the application.
  return `https://www.linkedin.com${url.pathname}`;
}

module.exports = { normalizeJobUrl };
