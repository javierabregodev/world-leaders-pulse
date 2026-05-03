/**
 * One-shot ingestion: pulls every Tweet Binder report we already generated
 * (mentions count, from:handle tweets, retweets_of:handle count) and merges
 * the data into our local JSON files. GETs are free; this does NOT create
 * any new reports.
 *
 * Reports go stale after ~40 days, so we only consider those created in
 * that window. Matching is exact against the queries fetch-twitter-data
 * and backfill-historical use, so other projects' reports are ignored.
 *
 * Run: node scripts/ingest-existing-reports.js
 *      node scripts/ingest-existing-reports.js --leader-id jmilei
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { processTweets } from '../server/tweets.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'server', 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const COUNTS_FILE = path.join(DATA_DIR, 'counts.json');
const ENGAGEMENT_FILE = path.join(DATA_DIR, 'engagement.json');
const RTS_RECEIVED_FILE = path.join(DATA_DIR, 'rts-received.json');
const LEADERS_FILE = path.join(ROOT, 'server', 'leaders.json');
const PROGRESS_FILE = path.join(ROOT, 'server', 'data', '.ingest-progress.json');

const argv = process.argv.slice(2);
function getArg(name) { const i = argv.indexOf(name); return i >= 0 ? argv[i+1] : null; }
const ONLY_LEADER = getArg('--leader-id');
const FORTY_DAYS_AGO_TS = Math.floor((Date.now() - 40 * 86400 * 1000) / 1000);

const API_URL = process.env.TWEETBINDER_API_URL;
const API_KEY = process.env.TWEETBINDER_API_KEY;
if (!API_KEY || !API_URL) { console.error('Missing TWEETBINDER_API_KEY or TWEETBINDER_API_URL'); process.exit(1); }
const headers = { 'Authorization': `Bearer ${API_KEY}` };

const leaders = JSON.parse(fs.readFileSync(LEADERS_FILE, 'utf-8'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
function loadJSON(f) { return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf-8')) : {}; }
function saveJSON(f, d) { fs.writeFileSync(f, JSON.stringify(d, null, 2)); }

// Some endpoints flap with 502s; retry with backoff before giving up.
async function apiGetJSON(endpoint, attempts = 4) {
  for (let i = 0; i < attempts; i++) {
    const r = await fetch(`${API_URL}${endpoint}`, { headers });
    if (r.ok) return r.json();
    if (r.status === 404) return null;
    if (i < attempts - 1) await sleep(2000 * (i + 1));
    else throw new Error(`GET ${endpoint} → ${r.status}`);
  }
}

// Tweet Binder pagination: offset is the PAGE INDEX (not row count), default
// limit is 20. We use 500 to drain transcripts faster.
async function listAllReports() {
  const all = [];
  for (let page = 0; page < 500; page++) {
    let arr = null;
    try {
      const j = await apiGetJSON(`/reports?offset=${page}&limit=100&order=createdAt|-1`);
      arr = Array.isArray(j) ? j : (j?.data || []);
    } catch (e) {
      console.warn(`  page ${page} failed: ${e.message} — stopping`);
      break;
    }
    if (!arr || arr.length === 0) break;
    all.push(...arr);
    process.stderr.write('.');
    if (arr.length < 100) break;
  }
  console.error(`\n  fetched ${all.length} reports`);
  return all;
}

function classify(query) {
  const q = (query || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!q) return null;
  for (const l of leaders) {
    const h = l.handle?.replace('@', '').toLowerCase();
    if (h && q.startsWith(`(retweets_of:${h})`)) return [l.id, 'rts_received'];
    if (h && q.startsWith(`from:${h}`)) return [l.id, 'own_tweets'];
    if (q.startsWith(l.query.toLowerCase())) return [l.id, 'mentions'];
  }
  return null;
}

async function getAllPages(reportId) {
  const out = [];
  for (let page = 0; page < 500; page++) {
    let arr;
    try {
      const j = await apiGetJSON(`/reports/${reportId}/transcript/tweets?offset=${page}&limit=500`);
      arr = j?.data || [];
    } catch (e) {
      console.warn(`    transcript page ${page} failed: ${e.message}`);
      break;
    }
    if (!arr || arr.length === 0) break;
    out.push(...arr);
    if (arr.length < 500) break;
    if (page % 5 === 4) await sleep(200);
  }
  return out;
}

// Mentions / RTs received reports come back as hourly buckets; aggregate by
// date. min/max are unix-ts boundaries, count is the bucket size.
function bucketsToDailyCounts(points) {
  const byDate = {};
  for (const p of points) {
    const c = p.counts || p;
    const ts = c.min || c.max;
    if (!ts) continue;
    const date = new Date(ts * 1000).toISOString().slice(0, 10);
    byDate[date] = (byDate[date] || 0) + (c.count || 0);
  }
  return byDate;
}

function engagementScore(t) {
  return (t.likes || 0) + (t.rts || 0) * 5 + (t.impressions || 0) / 100;
}

function pruneRepetitiveRTs(tweets, maxPerTarget) {
  const nonRT = [], rtsByTarget = {};
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

function aggregatesFromTweets(tweets, leadersList) {
  let totalLikes = 0, totalRTs = 0, totalImpressions = 0, totalReplies = 0;
  let originals = 0, rtsSent = 0, repliesSent = 0;
  const rtCounts = {}, mentionCounts = {}, hashCounts = {};
  for (const t of tweets) {
    totalLikes += t.likes || 0; totalRTs += t.rts || 0;
    totalImpressions += t.impressions || 0; totalReplies += t.replies || 0;
    if (t.type === 'original') originals++;
    else if (t.type === 'retweet') {
      rtsSent++;
      const m = (t.text || '').match(/^RT @(\w+)/i);
      if (m) { const h = m[1].toLowerCase(); rtCounts[h] = (rtCounts[h] || 0) + 1; }
    } else if (t.type === 'reply') repliesSent++;
    if (t.type !== 'retweet' && t.relatedHandles) {
      const counted = new Set();
      for (const h of t.relatedHandles) { if (!counted.has(h)) { mentionCounts[h] = (mentionCounts[h] || 0) + 1; counted.add(h); } }
    }
    for (const tag of ((t.text || '').match(/#\w+/g) || [])) {
      hashCounts[tag.toLowerCase()] = (hashCounts[tag.toLowerCase()] || 0) + 1;
    }
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
    topRetweeted: Object.entries(rtCounts).map(([h, c]) => {
      const ml = leadersList.find(l => l.handle && l.handle.replace('@', '').toLowerCase() === h);
      return { handle: '@' + h, name: ml?.name || h, count: c, isLeader: !!ml, leaderId: ml?.id || null };
    }).sort((a, b) => b.count - a.count).slice(0, 15),
    topMentioned: Object.entries(mentionCounts).map(([h, c]) => {
      const ml = leadersList.find(l => l.handle && l.handle.replace('@', '').toLowerCase() === h);
      return { handle: ml?.handle || '@' + h, name: ml?.name || h, count: c, isLeader: !!ml, leaderId: ml?.id || null };
    }).sort((a, b) => { if (a.isLeader !== b.isLeader) return a.isLeader ? -1 : 1; return b.count - a.count; }).slice(0, 15),
    topHashtags: Object.entries(hashCounts).map(([t, c]) => ({ tag: t, count: c })).sort((a, b) => b.count - a.count).slice(0, 15),
  };
}

function digestFromTweets(tweets) {
  const byDate = {};
  for (const t of tweets || []) {
    if (!t.date) continue;
    const d = new Date(t.date * 1000).toISOString().slice(0, 10);
    if (!byDate[d]) byDate[d] = { date: d, count: 0, likes: 0, rts: 0, impressions: 0, replies: 0, retweetsSent: 0, repliesSent: 0 };
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

async function processLeader(leaderId, leaderReports, history, counts, engagement, rtsReceived, progress) {
  const leader = leaders.find(l => l.id === leaderId);
  if (!leader) return;
  if (progress.done.includes(leaderId)) {
    console.log(`  [SKIP] ${leader.name} (already done)`);
    return;
  }
  console.log(`\n=== ${leader.name} (${leaderReports.length} reports) ===`);

  // 1) MENTIONS — merge per-date, take MAX across reports for the same date
  //    (different report windows overlap; partial-day cuts deflate counts).
  const mentionsByDate = {};
  for (const r of leaderReports.filter(r => r.kind === 'mentions')) {
    try {
      const points = await getAllPages(r.id);
      const daily = bucketsToDailyCounts(points);
      for (const [date, count] of Object.entries(daily)) {
        if (!mentionsByDate[date] || count > mentionsByDate[date]) mentionsByDate[date] = count;
      }
      console.log(`  [mentions] ${r.id.slice(0, 8)}: ${points.length} buckets → ${Object.keys(daily).length} dates`);
    } catch (e) {
      console.warn(`  [mentions] ${r.id.slice(0, 8)}: ${e.message}`);
    }
  }
  // Merge into history[leaderId] — keep existing entries, fill gaps and use
  // higher count when both have data.
  const existing = history[leaderId] || [];
  const merged = {};
  for (const h of existing) merged[h.date] = h.count;
  for (const [date, count] of Object.entries(mentionsByDate)) {
    if (!merged[date] || count > merged[date]) merged[date] = count;
  }
  history[leaderId] = Object.entries(merged).map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date));

  // 2) RTS RECEIVED — same shape
  const rtsByDate = {};
  for (const r of leaderReports.filter(r => r.kind === 'rts_received')) {
    try {
      const points = await getAllPages(r.id);
      const daily = bucketsToDailyCounts(points);
      for (const [date, count] of Object.entries(daily)) {
        if (!rtsByDate[date] || count > rtsByDate[date]) rtsByDate[date] = count;
      }
      console.log(`  [rts-rcv]  ${r.id.slice(0, 8)}: ${points.length} buckets → ${Object.keys(daily).length} dates`);
    } catch (e) {
      console.warn(`  [rts-rcv]  ${r.id.slice(0, 8)}: ${e.message}`);
    }
  }
  const existingRTs = rtsReceived[leaderId] || [];
  const mergedRTs = {};
  for (const h of existingRTs) mergedRTs[h.date] = h.count;
  for (const [date, count] of Object.entries(rtsByDate)) {
    if (!mergedRTs[date] || count > mergedRTs[date]) mergedRTs[date] = count;
  }
  rtsReceived[leaderId] = Object.entries(mergedRTs).map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date));

  // 3) OWN TWEETS — dedupe by tweet id across all reports, recompute everything
  if (leader.handle) {
    const username = leader.handle.replace('@', '');
    const seenIds = new Set();
    const allRaw = [];
    for (const r of leaderReports.filter(r => r.kind === 'own_tweets')) {
      try {
        const batch = await getAllPages(r.id);
        let added = 0;
        for (const t of batch) {
          const id = t._id || t.id;
          if (!id || seenIds.has(id)) continue;
          seenIds.add(id); allRaw.push(t); added++;
        }
        console.log(`  [own-tw]   ${r.id.slice(0, 8)}: +${added} (cum ${allRaw.length})`);
      } catch (e) {
        console.warn(`  [own-tw]   ${r.id.slice(0, 8)}: ${e.message}`);
      }
    }
    if (allRaw.length > 0) {
      const processed = processTweets(allRaw, username, leaderId);
      if (processed) {
        // Tweet union: prev (cron) wins for IDs in both, since the cron
        // re-pulls likes/RTs and those grow over time — historical reports
        // are a frozen snapshot from when they were generated.
        const prev = engagement[leaderId]?.tweets || [];
        const byTweetId = new Map();
        for (const t of processed.tweets) byTweetId.set(t.id, t);
        for (const t of prev) byTweetId.set(t.id, t);
        const fullTweets = [...byTweetId.values()];

        // Per-date digest: historical reports give pre-cap counts back to
        // 2020. The previous tweetCountsHistory has up-to-the-minute recent
        // data the historical reports don't cover. Merge per-date —
        // historical wins for dates it has, prev fills the rest.
        const newDigest = digestFromTweets(processed.tweets);
        const newByDate = Object.fromEntries(newDigest.map(d => [d.date, d]));
        const prevDigest = engagement[leaderId]?.tweetCountsHistory || [];
        const mergedDigest = {};
        for (const d of prevDigest) mergedDigest[d.date] = d;
        for (const d of newDigest) mergedDigest[d.date] = d; // historical overwrites
        const tweetCountsHistory = Object.values(mergedDigest).sort((a, b) => a.date.localeCompare(b.date));

        const aggs = aggregatesFromTweets(fullTweets, leaders);

        const MAX_STORED = 500;
        const MAX_RTS_PER_TARGET = 3;
        const pruned = pruneRepetitiveRTs(fullTweets, MAX_RTS_PER_TARGET);
        const cappedTweets = [...pruned].sort((a, b) => engagementScore(b) - engagementScore(a)).slice(0, MAX_STORED);

        engagement[leaderId] = {
          ...aggs,
          tweets: cappedTweets,
          tweetCountsHistory,
          lastUpdated: new Date().toISOString(),
          fullTweetCount: fullTweets.length,
          tweetCount: cappedTweets.length,
        };
        console.log(`  [own-tw]   merged: ${fullTweets.length} unique tweets, digest ${tweetCountsHistory.length} dates (${tweetCountsHistory[0]?.date}…${tweetCountsHistory[tweetCountsHistory.length-1]?.date}), capped to ${cappedTweets.length}`);
      }
    }
  }

  // Refresh counts.json totals from the merged history
  const grandTotal = (history[leaderId] || []).reduce((s, h) => s + (h.count || 0), 0);
  const last7Cutoff = new Date(Date.now() - 7 * 86400 * 1000).toISOString().slice(0, 10);
  const last7d = (history[leaderId] || []).filter(h => h.date >= last7Cutoff).reduce((s, h) => s + (h.count || 0), 0);
  counts[leaderId] = { ...counts[leaderId], total: grandTotal, last7d, lastUpdated: new Date().toISOString() };

  // Persist after every leader so we can resume on crash.
  saveJSON(HISTORY_FILE, history);
  saveJSON(COUNTS_FILE, counts);
  saveJSON(ENGAGEMENT_FILE, engagement);
  saveJSON(RTS_RECEIVED_FILE, rtsReceived);
  progress.done.push(leaderId);
  saveJSON(PROGRESS_FILE, progress);
}

async function main() {
  console.log('=== Ingesting existing Tweet Binder reports (last 40d, exact-query match) ===\n');
  console.log('Listing all reports...');
  const allReports = await listAllReports();
  const recent = allReports.filter(r => r.createdAt >= FORTY_DAYS_AGO_TS);
  console.log(`Recent (last 40d): ${recent.length}`);

  // Classify
  const byLeader = {};
  for (const r of recent) {
    const q = r.query?.raw || r.settings?.name || r.settings?.stream?.raw || '';
    const c = classify(q);
    if (!c) continue;
    const [id, kind] = c;
    (byLeader[id] ||= []).push({ id: r._id, kind, status: r.status, createdAt: r.createdAt });
  }

  const targetIds = ONLY_LEADER ? [ONLY_LEADER] : Object.keys(byLeader);
  console.log(`Leaders to process: ${targetIds.length}`);

  const history = loadJSON(HISTORY_FILE);
  const counts = loadJSON(COUNTS_FILE);
  const engagement = loadJSON(ENGAGEMENT_FILE);
  const rtsReceived = loadJSON(RTS_RECEIVED_FILE);
  const progress = loadJSON(PROGRESS_FILE);
  if (!progress.done) progress.done = [];

  for (const id of targetIds) {
    const reports = byLeader[id] || [];
    if (reports.length === 0) { console.log(`  [empty] ${id}`); continue; }
    await processLeader(id, reports, history, counts, engagement, rtsReceived, progress);
  }

  // Final sweep
  counts._lastGlobalUpdate = new Date().toISOString();
  saveJSON(COUNTS_FILE, counts);
  console.log('\n=== Done ===');
  console.log('Run `npm run build-static` to regenerate public/api/*.json');
}

main().catch(err => { console.error(err); process.exit(1); });
