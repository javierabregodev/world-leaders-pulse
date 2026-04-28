/**
 * Fetch 7-day mentions count + 7-day engagement reports for all leaders.
 * Updates server/data/{counts,history,engagement}.json
 *
 * Designed to run in GitHub Actions every 6h.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { processTweets } from '../server/tweets.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'server', 'data');
const LEADERS_FILE = path.join(ROOT, 'server', 'leaders.json');
const COUNTS_FILE = path.join(DATA_DIR, 'counts.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const ENGAGEMENT_FILE = path.join(DATA_DIR, 'engagement.json');
const RTS_RECEIVED_FILE = path.join(DATA_DIR, 'rts-received.json');

const API_URL = process.env.TWEETBINDER_API_URL;
const API_KEY = process.env.TWEETBINDER_API_KEY;
if (!API_KEY || !API_URL) { console.error('Missing TWEETBINDER_API_KEY or TWEETBINDER_API_URL'); process.exit(1); }

const headers = { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' };
const leaders = JSON.parse(fs.readFileSync(LEADERS_FILE, 'utf-8'));

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function loadJSON(f) { return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf-8')) : {}; }
function saveJSON(f, d) { fs.writeFileSync(f, JSON.stringify(d, null, 2)); }

async function apiPost(endpoint, body) {
  const res = await fetch(`${API_URL}${endpoint}`, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`POST ${endpoint} (${res.status}): ${(await res.text()).slice(0, 150)}`);
  return res.json();
}
async function apiGet(endpoint) {
  const res = await fetch(`${API_URL}${endpoint}`, { headers });
  if (!res.ok) throw new Error(`GET ${endpoint} (${res.status}): ${(await res.text()).slice(0, 150)}`);
  return res.json();
}
async function waitForReport(resourceId) {
  for (let i = 0; i < 60; i++) {
    const data = await apiGet(`/reports/${resourceId}`);
    const s = data?.data?.status || data?.status;
    if (s === 'generated') return;
    if (s === 'deleted') throw new Error('deleted');
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

// /reports/{id}/stats.timeline returns a sampled summary that severely
// underreports daily totals (saw ~4x deflation). The raw hourly buckets
// live on /transcript/counts and are paginated.
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

function reprocessFromTweets(tweets, leadersList) {
  let totalLikes = 0, totalRTs = 0, totalImpressions = 0, totalReplies = 0;
  let originals = 0, rtsSent = 0, repliesSent = 0;
  const rtCounts = {}, mentionCounts = {}, hashCounts = {};

  for (const t of tweets) {
    totalLikes += t.likes || 0;
    totalRTs += t.rts || 0;
    totalImpressions += t.impressions || 0;
    totalReplies += t.replies || 0;
    if (t.type === 'original') originals++;
    else if (t.type === 'retweet') {
      rtsSent++;
      const m = (t.text || '').match(/^RT @(\w+)/i);
      if (m) { const h = m[1].toLowerCase(); rtCounts[h] = (rtCounts[h] || 0) + 1; }
    }
    else if (t.type === 'reply') repliesSent++;
    if (t.type !== 'retweet' && t.relatedHandles) {
      const counted = new Set();
      for (const h of t.relatedHandles) { if (!counted.has(h)) { mentionCounts[h] = (mentionCounts[h] || 0) + 1; counted.add(h); } }
    }
    for (const tag of ((t.text || '').match(/#\w+/g) || [])) { hashCounts[tag.toLowerCase()] = (hashCounts[tag.toLowerCase()] || 0) + 1; }
  }

  const tp = tweets.length;
  return {
    engagement: {
      totalLikes, totalRTs, totalImpressions, totalReplies, totalQuotes: 0, totalBookmarks: 0,
      engagementRate: totalImpressions > 0 ? +((totalLikes + totalRTs + totalReplies) / totalImpressions * 100).toFixed(2) : 0,
      tweetsPosted: tp, originalTweets: originals, retweetsSent: rtsSent, repliesSent,
      avgLikesPerTweet: tp > 0 ? Math.round(totalLikes / tp) : 0,
      avgRTsPerTweet: tp > 0 ? Math.round(totalRTs / tp) : 0,
    },
    topRetweeted: Object.entries(rtCounts).map(([h, c]) => { const ml = leadersList.find(l => l.handle && l.handle.replace('@', '').toLowerCase() === h); return { handle: '@' + h, name: ml?.name || h, count: c, isLeader: !!ml, leaderId: ml?.id || null }; }).sort((a, b) => b.count - a.count).slice(0, 15),
    topMentioned: Object.entries(mentionCounts).map(([h, c]) => { const ml = leadersList.find(l => l.handle && l.handle.replace('@', '').toLowerCase() === h); const bi = leadersList.find(l => l.id === h); return { handle: ml?.handle || bi?.handle || '@' + h, name: ml?.name || bi?.name || h, count: c, isLeader: !!(ml || bi), leaderId: ml?.id || bi?.id || null }; }).sort((a, b) => { if (a.isLeader !== b.isLeader) return a.isLeader ? -1 : 1; return b.count - a.count; }).slice(0, 15),
    topHashtags: Object.entries(hashCounts).map(([t, c]) => ({ tag: t, count: c })).sort((a, b) => b.count - a.count).slice(0, 15),
    tweets,
  };
}

function rebuildMerged(engagement, leaderId, leadersList) {
  const yearKeys = Object.keys(engagement).filter(k => k.startsWith(leaderId + '_'));
  if (yearKeys.length === 0) return;
  const allTweets = [];
  for (const yk of yearKeys) { if (engagement[yk]?.tweets) allTweets.push(...engagement[yk].tweets); }
  const rebuilt = reprocessFromTweets(allTweets, leadersList);
  engagement[leaderId] = { ...rebuilt, lastUpdated: new Date().toISOString(), tweetCount: allTweets.length };
}

async function main() {
  const counts = loadJSON(COUNTS_FILE);
  const history = loadJSON(HISTORY_FILE);
  const engagement = loadJSON(ENGAGEMENT_FILE);
  const rtsReceived = loadJSON(RTS_RECEIVED_FILE);
  const currentYear = new Date().getFullYear();
  const sevenDaysAgoTs = (Date.now() / 1000) - (7 * 86400);

  for (const leader of leaders) {
    console.log(`\n=== ${leader.name} ===`);

    // 1) 7-day mentions count
    try {
      const query = leader.query; // already has -is:retweet
      const created = await apiPost('/reports/twitter-count/7-day', { query: { raw: query } });
      const rid = created?.resourceId || created?.data?.resourceId;
      if (!rid) throw new Error('no resourceId');
      await waitForReport(rid);
      const stats = await apiGet(`/reports/${rid}/stats`);
      const total = stats?.stats?.general?.total || 0;
      counts[leader.id] = { ...counts[leader.id], last7d: total, lastUpdated: new Date().toISOString() };

      // Pull the full hourly bucket timeline from /transcript/counts.
      // /stats.timeline is sampled/truncated and severely underreports.
      const points = await getAllCountPoints(rid);

      // Aggregate hourly buckets by date — each point has nested counts.{min,max,count}
      const dailySums = {};
      for (const p of points) {
        const c = p.counts || p;
        const ts = (c.min || c.max);
        if (!ts) continue;
        const date = new Date(ts * 1000).toISOString().slice(0, 10);
        dailySums[date] = (dailySums[date] || 0) + (c.count || 0);
      }

      // The oldest date in the 7-day window only has partial trailing data
      // (the window cuts mid-day), so don't overwrite it with a deflated count.
      const sortedDates = Object.keys(dailySums).sort();
      const partialOldestDate = sortedDates.length > 1 ? sortedDates[0] : null;
      const todayUTC = new Date().toISOString().slice(0, 10);

      if (!history[leader.id]) history[leader.id] = [];
      for (const [date, count] of Object.entries(dailySums)) {
        // Skip the partial-window boundary day unless it's also today
        if (date === partialOldestDate && date !== todayUTC) continue;
        const existing = history[leader.id].find(h => h.date === date);
        if (existing) existing.count = count;
        else history[leader.id].push({ date, count });
      }
      history[leader.id].sort((a, b) => a.date.localeCompare(b.date));
      saveJSON(COUNTS_FILE, counts);
      saveJSON(HISTORY_FILE, history);
      console.log(`  [7-day count] ${total.toLocaleString()} mentions, ${points.length} hourly buckets → ${Object.keys(dailySums).length} dates`);
      await sleep(2000);
    } catch (err) {
      console.error(`  [7-day count] ERROR: ${err.message}`);
    }

    // 2) 7-day tweet report (only for leaders with handle)
    if (!leader.handle) continue;
    try {
      const username = leader.handle.replace('@', '');
      const query = `from:${username}`;
      const created = await apiPost('/reports/twitter/7-day', { query: { raw: query } });
      const rid = created?.resourceId || created?.data?.resourceId;
      if (!rid) throw new Error('no resourceId');
      await waitForReport(rid);
      const rawTweets = await getAllTweets(rid);
      console.log(`  [7-day report] Got ${rawTweets.length} tweets`);
      const processed = processTweets(rawTweets, username, leader.id);
      if (!processed) continue;

      // Replace last 7 days in current year bucket
      const yearKey = `${leader.id}_${currentYear}`;
      const existing = engagement[yearKey] || {};
      const olderTweets = (existing.tweets || []).filter(t => (t.date || 0) < sevenDaysAgoTs);
      const newTweets = [...olderTweets, ...(processed.tweets || [])];
      const reproc = reprocessFromTweets(newTweets, leaders);
      engagement[yearKey] = { ...reproc, year: currentYear, lastUpdated: new Date().toISOString(), tweetCount: newTweets.length };

      // Rebuild merged key
      rebuildMerged(engagement, leader.id, leaders);
      saveJSON(ENGAGEMENT_FILE, engagement);
      console.log(`  [7-day report] ${newTweets.length} tweets in ${currentYear} bucket, merged: ${engagement[leader.id].tweetCount}`);
      await sleep(3000);
    } catch (err) {
      console.error(`  [7-day report] ERROR: ${err.message}`);
    }

    // 3) 7-day retweets-received count: how many RTs to ANY of the leader's
    //    tweets happened in the last week, by day. The tweet itself can be
    //    from any year — it's the RT timestamp that matters here.
    if (!leader.handle) continue;
    try {
      const username = leader.handle.replace('@', '');
      const query = `(retweets_of:${username})`;
      const created = await apiPost('/reports/twitter-count/7-day', { query: { raw: query } });
      const rid = created?.resourceId || created?.data?.resourceId;
      if (!rid) throw new Error('no resourceId');
      await waitForReport(rid);
      const points = await getAllCountPoints(rid);

      const dailySums = {};
      for (const p of points) {
        const c = p.counts || p;
        const ts = (c.min || c.max);
        if (!ts) continue;
        const date = new Date(ts * 1000).toISOString().slice(0, 10);
        dailySums[date] = (dailySums[date] || 0) + (c.count || 0);
      }
      // Same partial-window guard as mentions.
      const sortedDates = Object.keys(dailySums).sort();
      const partialOldestDate = sortedDates.length > 1 ? sortedDates[0] : null;
      const todayUTC = new Date().toISOString().slice(0, 10);

      if (!rtsReceived[leader.id]) rtsReceived[leader.id] = [];
      for (const [date, count] of Object.entries(dailySums)) {
        if (date === partialOldestDate && date !== todayUTC) continue;
        const existing = rtsReceived[leader.id].find(h => h.date === date);
        if (existing) existing.count = count;
        else rtsReceived[leader.id].push({ date, count });
      }
      rtsReceived[leader.id].sort((a, b) => a.date.localeCompare(b.date));
      saveJSON(RTS_RECEIVED_FILE, rtsReceived);
      const lastWeekTotal = Object.values(dailySums).reduce((s, v) => s + v, 0);
      console.log(`  [7-day RTs-rcv] ${lastWeekTotal.toLocaleString()} RTs received, ${points.length} buckets → ${Object.keys(dailySums).length} dates`);
      await sleep(2000);
    } catch (err) {
      console.error(`  [7-day RTs-rcv] ERROR: ${err.message}`);
    }
  }

  counts._lastGlobalUpdate = new Date().toISOString();
  saveJSON(COUNTS_FILE, counts);
  console.log('\n[fetch-mentions] Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
