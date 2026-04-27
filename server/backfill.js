/**
 * Backfill script — fetches all data for all leaders.
 * Mentions: 1 count per MONTH (gives real daily data points).
 * Tweets: 1 report per YEAR (no limit).
 * Usage: node server/backfill.js [startYear] [endYear]
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { processTweets } from './tweets.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LEADERS_FILE = path.join(__dirname, 'leaders.json');
const DATA_DIR = path.join(__dirname, 'data');
const COUNTS_FILE = path.join(DATA_DIR, 'counts.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const ENGAGEMENT_FILE = path.join(DATA_DIR, 'engagement.json');

const API_URL = process.env.TWEETBINDER_API_URL;
const API_KEY = process.env.TWEETBINDER_API_KEY;
const headers = { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' };

const leaders = JSON.parse(fs.readFileSync(LEADERS_FILE, 'utf-8'));
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function loadJSON(file) { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : {}; }
function saveJSON(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function apiPost(endpoint, body) {
  const res = await fetch(`${API_URL}${endpoint}`, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`POST ${endpoint} (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return res.json();
}
async function apiGet(endpoint) {
  const res = await fetch(`${API_URL}${endpoint}`, { headers });
  if (!res.ok) throw new Error(`GET ${endpoint} (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return res.json();
}
async function waitForReport(resourceId) {
  for (let i = 0; i < 60; i++) {
    const data = await apiGet(`/reports/${resourceId}`);
    const status = data?.data?.status || data?.status;
    if (status === 'generated') return;
    if (status === 'deleted') throw new Error('deleted');
    await sleep(5000);
  }
  throw new Error('timeout');
}
async function getAllTweets(resourceId) {
  const all = [];
  let offset = 0;
  while (true) {
    const res = await apiGet(`/reports/${resourceId}/transcript/tweets?offset=${offset}&limit=500`);
    const tweets = res?.data || [];
    if (tweets.length === 0) break;
    all.push(...tweets);
    if (!res?.pagination?.nextResults || tweets.length < 500) break;
    offset++;
    await sleep(1000);
  }
  return all;
}

// For COUNT reports, /transcript/tweets returns the full list of hourly
// (or sub-hourly) bucket points, each shaped { _id, counts: { min, max, count } }.
// We use this rather than /stats.timeline because the latter is sampled
// (~30 buckets regardless of date range), which deflates daily counts ~4x.
async function getAllCountPoints(resourceId) {
  const all = [];
  let page = 0;
  const LIMIT = 500;
  while (true) {
    const res = await apiGet(`/reports/${resourceId}/transcript/tweets?offset=${page}&limit=${LIMIT}`);
    const points = res?.data || [];
    if (points.length === 0) break;
    all.push(...points);
    if (!res?.pagination?.nextResults || points.length < LIMIT) break;
    page++;
    await sleep(300);
  }
  return all;
}

// Generate month ranges for a year
function getMonthRanges(year) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-indexed
  const ranges = [];

  for (let m = 0; m < 12; m++) {
    if (year === currentYear && m > currentMonth) break;
    const since = `${year}-${String(m + 1).padStart(2, '0')}-01`;
    const isCurrentMonth = year === currentYear && m === currentMonth;
    const until = isCurrentMonth ? null : `${year}-${String(m + 2 > 12 ? 1 : m + 2).padStart(2, '0')}-01`;
    const untilYear = m + 2 > 12 ? year + 1 : year;
    const untilStr = isCurrentMonth ? null : `${untilYear}-${String((m + 1) % 12 + 1).padStart(2, '0')}-01`;
    ranges.push({ month: m + 1, since, until: untilStr });
  }
  return ranges;
}

async function backfillMentionsMonthly(leader, year) {
  const months = getMonthRanges(year);
  let yearTotal = 0;
  const dailyPoints = [];

  for (const { month, since, until } of months) {
    const untilClause = until ? ` until:${until}` : '';
    const query = `${leader.query} since:${since}${untilClause}`;
    const monthLabel = `${year}-${String(month).padStart(2, '0')}`;

    try {
      const created = await apiPost('/reports/twitter-count/historical', { query: { raw: query } });
      const resourceId = created?.resourceId || created?.data?.resourceId;
      if (!resourceId) throw new Error('No resourceId');
      await waitForReport(resourceId);

      // Total comes from /stats; the per-day breakdown from /transcript/tweets
      const stats = await apiGet(`/reports/${resourceId}/stats`);
      const total = stats?.stats?.general?.total || 0;
      const points = await getAllCountPoints(resourceId);

      yearTotal += total;
      // Aggregate hourly buckets by date — each point has nested counts.{min,max,count}
      const dailySums = {};
      for (const p of points) {
        const c = p.counts || p;
        const ts = (c.min || c.max);
        if (!ts) continue;
        const date = new Date(ts * 1000).toISOString().slice(0, 10);
        dailySums[date] = (dailySums[date] || 0) + (c.count || 0);
      }
      for (const [date, count] of Object.entries(dailySums)) {
        dailyPoints.push({ date, count });
      }
      process.stdout.write(`    ${monthLabel}: ${total.toLocaleString()} (${points.length}b → ${Object.keys(dailySums).length}d) `);
      await sleep(2000);
    } catch (err) {
      process.stdout.write(`    ${monthLabel}: ERROR ${err.message.slice(0, 50)} `);
    }
  }
  console.log('');
  return { total: yearTotal, daily: dailyPoints };
}

async function backfillTweets(leader, year) {
  if (!leader.handle) return null;
  const username = leader.handle.replace('@', '');
  const currentYear = new Date().getFullYear();
  const untilClause = year === currentYear ? '' : ` until:${year + 1}-01-01`;
  const query = `from:${username} since:${year}-01-01${untilClause}`;

  console.log(`  [REPORT] ${query}`);
  const created = await apiPost('/reports/twitter/historical', { query: { raw: query } });
  const resourceId = created?.resourceId || created?.data?.resourceId;
  if (!resourceId) throw new Error('No resourceId');
  await waitForReport(resourceId);
  const tweets = await getAllTweets(resourceId);
  console.log(`  Got ${tweets.length} tweets`);
  return processTweets(tweets, username, leader.id);
}

function rebuildMergedEngagement(engagement, leaderId) {
  const yearKeys = Object.keys(engagement).filter(k => k.startsWith(leaderId + '_'));
  if (yearKeys.length === 0) return;

  const allTweets = [];
  let totalLikes = 0, totalRTs = 0, totalImpressions = 0, totalReplies = 0;
  let totalTweets = 0, originals = 0, rtsSent = 0, repliesSent = 0;

  for (const yk of yearKeys) {
    const yd = engagement[yk];
    if (!yd?.engagement) continue;
    totalLikes += yd.engagement.totalLikes || 0;
    totalRTs += yd.engagement.totalRTs || 0;
    totalImpressions += yd.engagement.totalImpressions || 0;
    totalReplies += yd.engagement.totalReplies || 0;
    totalTweets += yd.engagement.tweetsPosted || 0;
    originals += yd.engagement.originalTweets || 0;
    rtsSent += yd.engagement.retweetsSent || 0;
    repliesSent += yd.engagement.repliesSent || 0;
    if (yd.tweets) allTweets.push(...yd.tweets);
  }

  const rtCounts = {}, mentionCounts = {}, hashCounts = {};
  for (const t of allTweets) {
    if (t.type === 'retweet') {
      const m = (t.text || '').match(/^RT @(\w+)/i);
      if (m) { const h = m[1].toLowerCase(); rtCounts[h] = (rtCounts[h] || 0) + 1; }
    }
    if (t.type !== 'retweet' && t.relatedHandles) {
      const counted = new Set();
      for (const h of t.relatedHandles) { if (!counted.has(h)) { mentionCounts[h] = (mentionCounts[h] || 0) + 1; counted.add(h); } }
    }
    for (const tag of ((t.text || '').match(/#\w+/g) || [])) { hashCounts[tag.toLowerCase()] = (hashCounts[tag.toLowerCase()] || 0) + 1; }
  }

  const topRetweeted = Object.entries(rtCounts)
    .map(([h, c]) => { const ml = leaders.find(l => l.handle && l.handle.replace('@', '').toLowerCase() === h); return { handle: '@' + h, name: ml?.name || h, count: c, isLeader: !!ml, leaderId: ml?.id || null }; })
    .sort((a, b) => b.count - a.count).slice(0, 15);
  const topMentioned = Object.entries(mentionCounts)
    .map(([h, c]) => { const ml = leaders.find(l => l.handle && l.handle.replace('@', '').toLowerCase() === h); const bi = leaders.find(l => l.id === h); return { handle: ml?.handle || bi?.handle || '@' + h, name: ml?.name || bi?.name || h, count: c, isLeader: !!(ml || bi), leaderId: ml?.id || bi?.id || null }; })
    .sort((a, b) => { if (a.isLeader !== b.isLeader) return a.isLeader ? -1 : 1; return b.count - a.count; }).slice(0, 15);
  const topHashtags = Object.entries(hashCounts).map(([t, c]) => ({ tag: t, count: c })).sort((a, b) => b.count - a.count).slice(0, 15);

  engagement[leaderId] = {
    engagement: {
      totalLikes, totalRTs, totalImpressions, totalReplies, totalQuotes: 0, totalBookmarks: 0,
      engagementRate: totalImpressions > 0 ? +((totalLikes + totalRTs + totalReplies) / totalImpressions * 100).toFixed(2) : 0,
      tweetsPosted: totalTweets, originalTweets: originals, retweetsSent: rtsSent, repliesSent,
      avgLikesPerTweet: totalTweets > 0 ? Math.round(totalLikes / totalTweets) : 0,
      avgRTsPerTweet: totalTweets > 0 ? Math.round(totalRTs / totalTweets) : 0,
    },
    topRetweeted, topMentioned, topHashtags, tweets: allTweets,
    lastUpdated: new Date().toISOString(), tweetCount: allTweets.length,
  };
}

async function main() {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const flags = process.argv.slice(2).filter(a => a.startsWith('--'));
  const startYear = parseInt(args[0]) || 2025;
  const endYear = parseInt(args[1]) || 2026;
  const reset = flags.includes('--reset');
  const mentionsOnly = flags.includes('--mentions-only');
  const years = [];
  for (let y = startYear; y <= endYear; y++) years.push(y);

  const monthsTotal = years.reduce((s, y) => {
    const now = new Date();
    return s + (y === now.getFullYear() ? now.getMonth() + 1 : 12);
  }, 0);

  console.log(`\n========================================`);
  console.log(`BACKFILL: ${leaders.length} leaders × ${years.join(', ')}${reset ? ' (RESET)' : ''}${mentionsOnly ? ' (mentions only)' : ''}`);
  console.log(`Mention counts: ~${leaders.length * monthsTotal} calls (monthly)`);
  if (!mentionsOnly) console.log(`Tweet reports: ~${leaders.filter(l => l.handle).length * years.length} calls`);
  console.log(`========================================\n`);

  const counts = loadJSON(COUNTS_FILE);
  const history = loadJSON(HISTORY_FILE);
  const engagement = loadJSON(ENGAGEMENT_FILE);

  // --reset: clear cached SKIP keys for the years being processed so we
  // re-fetch everything (used when query semantics or aggregation changed).
  if (reset) {
    for (const leader of leaders) {
      for (const y of years) {
        delete counts[`${leader.id}_mentions_${y}`];
        if (!mentionsOnly) delete engagement[`${leader.id}_${y}`];
      }
      // Also drop history points within the year range so re-fetched
      // values fully replace any older deflated data.
      if (history[leader.id]) {
        const minDate = `${startYear}-01-01`;
        const maxDate = `${endYear}-12-31`;
        history[leader.id] = history[leader.id].filter(h => h.date < minDate || h.date > maxDate);
      }
    }
    saveJSON(COUNTS_FILE, counts);
    saveJSON(HISTORY_FILE, history);
    if (!mentionsOnly) saveJSON(ENGAGEMENT_FILE, engagement);
    console.log(`Reset cleared cached keys for ${leaders.length} leaders × ${years.length} years\n`);
  }

  for (const leader of leaders) {
    console.log(`\n=== ${leader.name} (${leader.country}) ===`);

    for (const year of years) {
      // --- Mentions (monthly for daily granularity) ---
      const mentionKey = `${leader.id}_mentions_${year}`;
      if (counts[mentionKey]) {
        console.log(`  SKIP mentions ${year}: ${counts[mentionKey].total.toLocaleString()}`);
      } else {
        try {
          console.log(`  [MENTIONS ${year}] monthly counts...`);
          const data = await backfillMentionsMonthly(leader, year);
          counts[mentionKey] = { total: data.total, year, fetchedAt: new Date().toISOString() };

          if (!history[leader.id]) history[leader.id] = [];
          for (const d of data.daily) {
            const existing = history[leader.id].find(h => h.date === d.date);
            if (existing) existing.count = d.count;
            else history[leader.id].push(d);
          }
          // Sort history by date
          history[leader.id].sort((a, b) => a.date.localeCompare(b.date));

          // Update grand total
          const allMentionKeys = Object.keys(counts).filter(k => k.startsWith(leader.id + '_mentions_'));
          counts[leader.id] = { total: allMentionKeys.reduce((s, k) => s + (counts[k].total || 0), 0), lastUpdated: new Date().toISOString() };

          saveJSON(COUNTS_FILE, counts);
          saveJSON(HISTORY_FILE, history);
          console.log(`  ✓ Mentions ${year}: ${data.total.toLocaleString()} total, ${data.daily.length} daily points`);
        } catch (err) {
          console.error(`  ✗ Mentions ${year}: ${err.message}`);
        }
      }

      // --- Tweets ---
      if (leader.handle && !mentionsOnly) {
        const engKey = `${leader.id}_${year}`;
        if (engagement[engKey]) {
          console.log(`  SKIP tweets ${year}: ${engagement[engKey].tweetCount} tweets`);
        } else {
          try {
            const tweetData = await backfillTweets(leader, year);
            if (tweetData) {
              engagement[engKey] = { ...tweetData, year, lastUpdated: new Date().toISOString(), tweetCount: tweetData.tweets.length };
              rebuildMergedEngagement(engagement, leader.id);
              saveJSON(ENGAGEMENT_FILE, engagement);
              console.log(`  ✓ Tweets ${year}: ${tweetData.tweets.length} tweets, ${tweetData.engagement.totalLikes.toLocaleString()} likes`);
            }
            await sleep(3000);
          } catch (err) {
            console.error(`  ✗ Tweets ${year}: ${err.message}`);
          }
        }
      }
    }
  }

  console.log('\n========================================');
  console.log('BACKFILL COMPLETE');
  console.log('========================================\n');
}

main().catch(console.error);
