/**
 * 12h cron: pulls all per-leader Twitter data Tweet Binder gives us.
 * Per leader, runs three 7-day reports:
 *   1. mentions count    — query: (name OR @handle) -is:retweet
 *   2. own tweets+stats  — query: from:handle
 *   3. RTs received      — query: (retweets_of:handle)
 * Updates server/data/{counts,history,engagement,rts-received}.json.
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

// Dedupe a list of condensed tweets by id, last-occurrence wins. The cron
// concatenates "older bucket" + "new 7-day fetch" each run; near the
// 7-day boundary the API may include a tweet that's also in the kept
// older slice, leading to duplicates that accumulate run after run with
// only the engagement counters drifting upward each time.
function dedupeTweets(tweets) {
  const byId = new Map();
  for (const t of tweets || []) {
    if (!t?.id) continue;
    byId.set(t.id, t);
  }
  return [...byId.values()];
}

function engagementScore(t) {
  return (t.likes || 0) + (t.rts || 0) * 5 + (t.impressions || 0) / 100;
}

function pruneRepetitiveRTs(tweets, maxPerTarget) {
  const nonRT = [];
  const rtsByTarget = {};
  for (const t of tweets) {
    if (t.type !== 'retweet') { nonRT.push(t); continue; }
    const m = (t.text || '').match(/^RT @(\w+)/i);
    const key = m ? m[1].toLowerCase() : '__unknown__';
    (rtsByTarget[key] ||= []).push(t);
  }
  const keptRTs = [];
  for (const key of Object.keys(rtsByTarget)) {
    const sorted = rtsByTarget[key].sort((a, b) => engagementScore(b) - engagementScore(a));
    keptRTs.push(...sorted.slice(0, maxPerTarget));
  }
  return [...nonRT, ...keptRTs];
}

// Compact daily digest with every metric the chart needs, computed from
// the full tweet list before any cap so time-series stay accurate for
// prolific accounts (we cap stored tweets to 500 to avoid blowing
// engagement.json past GitHub's 100MB push limit).
function countTweetsByDay(tweets) {
  const byDate = {};
  for (const t of tweets || []) {
    if (!t.date) continue;
    const d = new Date(t.date * 1000).toISOString().slice(0, 10);
    if (!byDate[d]) {
      byDate[d] = { date: d, count: 0, likes: 0, rts: 0, impressions: 0, replies: 0, retweetsSent: 0, repliesSent: 0 };
    }
    const e = byDate[d];
    e.count++;
    e.likes += t.likes || 0;
    e.rts += t.rts || 0;
    e.impressions += t.impressions || 0;
    e.replies += t.replies || 0;
    if (t.type === 'retweet') e.retweetsSent++;
    else if (t.type === 'reply') e.repliesSent++;
  }
  return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
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

// rebuildMerged removed: we no longer keep _alltime or _<year> mirror
// buckets, so there's nothing to merge. engagement[leaderId] is the
// single canonical bucket.

async function main() {
  const counts = loadJSON(COUNTS_FILE);
  const history = loadJSON(HISTORY_FILE);
  const engagement = loadJSON(ENGAGEMENT_FILE);
  const rtsReceived = loadJSON(RTS_RECEIVED_FILE);
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

      // Single canonical bucket per leader. Tweets are capped to top
      // engaging to keep engagement.json under GitHub's 100MB push
      // limit; aggregates are recomputed from the full merged set so
      // totals stay correct. Daily counts go to a separate compact
      // series so the 'Tweets posted Over Time' chart doesn't lose
      // precision from the cap.
      const MAX_STORED_TWEETS = 500;
      const MAX_RTS_PER_TARGET = 3;
      const existing = engagement[leader.id] || {};
      const olderTweets = (existing.tweets || []).filter(t => (t.date || 0) < sevenDaysAgoTs);
      const newTweets = dedupeTweets([...olderTweets, ...(processed.tweets || [])]);
      const reproc = reprocessFromTweets(newTweets, leaders);

      const tweetCountsHistory = countTweetsByDay(newTweets);
      const pruned = pruneRepetitiveRTs(newTweets, MAX_RTS_PER_TARGET);
      const cappedTweets = [...pruned]
        .sort((a, b) => engagementScore(b) - engagementScore(a))
        .slice(0, MAX_STORED_TWEETS);

      engagement[leader.id] = {
        engagement: reproc.engagement,
        topRetweeted: reproc.topRetweeted,
        topMentioned: reproc.topMentioned,
        topHashtags: reproc.topHashtags,
        tweets: cappedTweets,
        tweetCountsHistory,
        lastUpdated: new Date().toISOString(),
        fullTweetCount: newTweets.length,
        tweetCount: cappedTweets.length,
      };
      saveJSON(ENGAGEMENT_FILE, engagement);
      console.log(`  [7-day report] ${newTweets.length} tweets (capped to ${cappedTweets.length} for storage)`);
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
  console.log('\n[fetch-twitter-data] Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
