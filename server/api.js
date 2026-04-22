import 'dotenv/config';

const API_URL = process.env.TWEETBINDER_API_URL;
const API_KEY = process.env.TWEETBINDER_API_KEY;

const headers = {
  'Authorization': `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Create a count report. Dates go in the query string as since:/until: operators */
export async function createCount(query, type = 'historical') {
  const body = { query: { raw: query } };

  const res = await fetch(`${API_URL}/reports/twitter-count/${type}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`createCount failed (${res.status}): ${text}`);
  }

  return res.json();
}

/** Poll report state until generated (or timeout) */
export async function waitForReport(resourceId, maxAttempts = 60, intervalMs = 5000) {
  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(`${API_URL}/reports/${resourceId}`, { headers });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`getReportState failed (${res.status}): ${text}`);
    }

    const data = await res.json();
    const status = data?.data?.status || data?.status;

    if (status === 'generated') return data;
    if (status === 'deleted') throw new Error(`Report ${resourceId} was deleted`);

    console.log(`  [${resourceId}] status: ${status}, attempt ${i + 1}/${maxAttempts}`);
    await sleep(intervalMs);
  }

  throw new Error(`Report ${resourceId} timed out after ${maxAttempts} attempts`);
}

/** Get report stats */
export async function getReportStats(resourceId) {
  const res = await fetch(`${API_URL}/reports/${resourceId}/stats`, { headers });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`getReportStats failed (${res.status}): ${text}`);
  }

  return res.json();
}

/**
 * Full count workflow: create → wait → get stats.
 * Use since/until in the query string for date filtering:
 *   e.g. '("Donald Trump") since:2020-01-01 until:2020-04-01'
 */
export async function getCountForQuery(query, type = 'historical') {
  console.log(`  Creating ${type} count for: ${query}`);
  const created = await createCount(query, type);

  const resourceId = created?.data?.resourceId || created?.resourceId;
  if (!resourceId) throw new Error(`No resourceId returned: ${JSON.stringify(created)}`);

  console.log(`  Waiting for report ${resourceId}...`);
  await waitForReport(resourceId);

  const stats = await getReportStats(resourceId);
  const rawStats = stats?.data?.stats || stats?.stats || {};
  const total = rawStats?.general?.total ?? 0;
  const timeline = rawStats?.timeline ?? [];

  return { resourceId, total, timeline, stats: rawStats };
}

// ============================================================
// REPORTS (full tweet data)
// ============================================================

/** Create a full report (returns individual tweets) */
export async function createReport(query, type = '7-day', limit = 500) {
  const body = { query: { raw: query, limit } };

  const res = await fetch(`${API_URL}/reports/twitter/${type}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`createReport failed (${res.status}): ${text}`);
  }

  return res.json();
}

/** Get tweet transcript (paginated) */
export async function getReportTranscript(resourceId, type = 'tweets', offset = 0, limit = 500) {
  const res = await fetch(
    `${API_URL}/reports/${resourceId}/transcript/${type}?offset=${offset}&limit=${limit}`,
    { headers }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`getTranscript failed (${res.status}): ${text}`);
  }

  return res.json();
}

/** Get ALL tweets from a report (handles pagination) */
export async function getAllTweets(resourceId) {
  const allTweets = [];
  let offset = 0;
  const pageSize = 500;

  while (true) {
    const res = await getReportTranscript(resourceId, 'tweets', offset, pageSize);
    const tweets = res?.data || res?.tweets || [];
    if (tweets.length === 0) break;

    allTweets.push(...tweets);

    // Check if there are more pages
    const pagination = res?.pagination;
    if (!pagination?.nextResults || tweets.length < pageSize) break;

    offset++;
    await sleep(1000);
  }

  return allTweets;
}

/**
 * Full report workflow: create → wait → get all tweets.
 * Used for engagement data: from:username
 */
export async function getReportWithTweets(query, type = '7-day', limit = 500) {
  console.log(`  Creating ${type} report for: ${query}`);
  const created = await createReport(query, type, limit);

  const resourceId = created?.data?.resourceId || created?.resourceId;
  if (!resourceId) throw new Error(`No resourceId returned: ${JSON.stringify(created)}`);

  console.log(`  Waiting for report ${resourceId}...`);
  await waitForReport(resourceId);

  // Get stats
  const stats = await getReportStats(resourceId);
  const rawStats = stats?.data?.stats || stats?.stats || {};

  // Get all tweets
  console.log(`  Fetching tweets for ${resourceId}...`);
  const tweets = await getAllTweets(resourceId);
  console.log(`  Got ${tweets.length} tweets`);

  return { resourceId, stats: rawStats, tweets };
}

/**
 * Generate date ranges (quarters) from startDate to now.
 * Returns array of { since: 'YYYY-MM-DD', until: 'YYYY-MM-DD' | null }
 * The last range has until=null (current quarter — no end date to avoid Twitter errors).
 */
export function generateQuarterRanges(startYear = 2020, startMonth = 1) {
  const ranges = [];
  const now = new Date();

  let year = startYear;
  let month = startMonth;

  while (true) {
    const since = `${year}-${String(month).padStart(2, '0')}-01`;
    let endMonth = month + 3;
    let endYear = year;
    if (endMonth > 12) {
      endMonth -= 12;
      endYear++;
    }

    // Stop if this quarter starts after today
    const sinceDate = new Date(since);
    if (sinceDate > now) break;

    const untilDate = new Date(`${endYear}-${String(endMonth).padStart(2, '0')}-01`);
    // If the quarter end is in the future, don't set until (gets data up to now)
    const until = untilDate <= now
      ? `${endYear}-${String(endMonth).padStart(2, '0')}-01`
      : null;

    ranges.push({ since, until });

    month = endMonth;
    year = endYear;
  }

  return ranges;
}

/**
 * Fetch full historical count for a leader by summing quarterly counts.
 * Returns { total, dailyTimeline: [{ date, count }] }
 */
export async function getFullHistoricalCount(baseQuery, startYear = 2020) {
  const quarters = generateQuarterRanges(startYear);
  let grandTotal = 0;
  const dailyTimeline = [];

  for (const { since, until } of quarters) {
    // For the current quarter, don't add until: (avoids Twitter future-date error)
    const query = until
      ? `${baseQuery} since:${since} until:${until}`
      : `${baseQuery} since:${since}`;
    const label = until ? `${since} → ${until}` : `${since} → now`;
    try {
      const result = await getCountForQuery(query, 'historical');
      grandTotal += result.total;
      console.log(`    ${label}: ${result.total.toLocaleString()}`);

      // Extract daily data from timeline
      for (const point of result.timeline) {
        const dateMs = (point.min || point.max) * 1000;
        const date = new Date(dateMs).toISOString().slice(0, 10);
        dailyTimeline.push({ date, count: point.count });
      }

      // Delay between API calls
      await sleep(3000);
    } catch (err) {
      console.error(`    ${label}: ERROR - ${err.message}`);
    }
  }

  return { total: grandTotal, dailyTimeline };
}
