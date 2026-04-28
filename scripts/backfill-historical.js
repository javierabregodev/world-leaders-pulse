/**
 * Single-shot historical backfill: one report per leader covering a wide
 * date range (default since 2020-01-01).
 *
 * - Mentions: one /reports/twitter-count/historical per leader → paginate
 *   /transcript/tweets → aggregate hourly buckets by date → write to history.
 * - Tweets: one /reports/twitter/historical per leader handle → paginate
 *   /transcript/tweets → process → write to engagement[leaderId + '_alltime']
 *   and rebuild engagement[leaderId] from that single source.
 *
 * Usage:
 *   node scripts/backfill-historical.js                        # both, since 2020-01-01
 *   node scripts/backfill-historical.js --mode mentions         # mentions only
 *   node scripts/backfill-historical.js --mode tweets           # tweets only
 *   node scripts/backfill-historical.js --since 2018-01-01      # custom start
 *
 * Compared with server/backfill.js (which does monthly mention reports),
 * this is much cheaper but trusts the API to return the full hourly bucket
 * list for a multi-year window.
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

// Args
const argv = process.argv.slice(2);
function getArg(name, def) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
}
const SINCE = getArg('--since', '2020-01-01');
const UNTIL = getArg('--until', null);
const MODE = getArg('--mode', 'both'); // mentions | tweets | rts | all | both

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
  if (!res.ok) throw new Error(`POST ${endpoint} (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return res.json();
}
async function apiGet(endpoint) {
  const res = await fetch(`${API_URL}${endpoint}`, { headers });
  if (!res.ok) throw new Error(`GET ${endpoint} (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return res.json();
}
async function waitForReport(resourceId, maxIter = 120) {
  for (let i = 0; i < maxIter; i++) {
    const data = await apiGet(`/reports/${resourceId}`);
    const s = data?.data?.status || data?.status;
    if (s === 'generated') return;
    if (s === 'deleted') throw new Error('deleted');
    await sleep(5000);
  }
  throw new Error('timeout');
}
async function getAllPages(resourceId) {
  const all = [];
  let page = 0;
  const LIMIT = 500;
  while (true) {
    const res = await apiGet(`/reports/${resourceId}/transcript/tweets?offset=${page}&limit=${LIMIT}`);
    const items = res?.data || [];
    if (items.length === 0) break;
    all.push(...items);
    if (!res?.pagination?.nextResults || items.length < LIMIT) break;
    page++;
    await sleep(300);
  }
  return all;
}

async function backfillMentionsForLeader(leader, history, counts) {
  const untilClause = UNTIL ? ` until:${UNTIL}` : '';
  const query = `${leader.query} since:${SINCE}${untilClause}`;
  console.log(`  [MENTIONS] ${query}`);

  const created = await apiPost('/reports/twitter-count/historical', { query: { raw: query } });
  const rid = created?.resourceId || created?.data?.resourceId;
  if (!rid) throw new Error('no resourceId');
  await waitForReport(rid);

  const stats = await apiGet(`/reports/${rid}/stats`);
  const total = stats?.stats?.general?.total || 0;
  const points = await getAllPages(rid);

  // Aggregate hourly buckets by date
  const dailySums = {};
  for (const p of points) {
    const c = p.counts || p;
    const ts = (c.min || c.max);
    if (!ts) continue;
    const date = new Date(ts * 1000).toISOString().slice(0, 10);
    dailySums[date] = (dailySums[date] || 0) + (c.count || 0);
  }

  // Drop any existing history points within the range so re-fetched values
  // fully replace older deflated data, then merge in the new daily totals.
  if (!history[leader.id]) history[leader.id] = [];
  history[leader.id] = history[leader.id].filter(h => h.date < SINCE || (UNTIL && h.date >= UNTIL));
  for (const [date, count] of Object.entries(dailySums)) {
    if (date < SINCE) continue;
    if (UNTIL && date >= UNTIL) continue;
    history[leader.id].push({ date, count });
  }
  history[leader.id].sort((a, b) => a.date.localeCompare(b.date));

  // Refresh aggregates: total over the queried window + last7d snapshot
  counts[`${leader.id}_mentions_alltime`] = { total, since: SINCE, until: UNTIL, fetchedAt: new Date().toISOString() };
  // Drop legacy per-year mention keys so they don't double-count or stay stale
  for (const k of Object.keys(counts)) {
    if (k.startsWith(`${leader.id}_mentions_`) && k !== `${leader.id}_mentions_alltime`) delete counts[k];
  }
  const grandTotal = (history[leader.id] || []).reduce((s, h) => s + (h.count || 0), 0);
  const last7Cutoff = new Date(Date.now() - 7 * 86400 * 1000).toISOString().slice(0, 10);
  const last7d = (history[leader.id] || []).filter(h => h.date >= last7Cutoff).reduce((s, h) => s + (h.count || 0), 0);
  counts[leader.id] = { total: grandTotal, last7d, lastUpdated: new Date().toISOString() };

  console.log(`    ${total.toLocaleString()} total, ${points.length} buckets → ${Object.keys(dailySums).length} dates`);
}

// Tweet Binder caps each report at ~35K tweets. If we hit that, chain a
// follow-up report ending at the oldest tweet we already have, walking
// backwards in time until we exhaust the SINCE..UNTIL window.
const REPORT_CAP_THRESHOLD = 34000;

// Retweets received: count of retweets that target ANY of this leader's
// tweets, by the day the RT happened (not the day the tweet was posted).
// Lets us answer "how much was Macron RT'd today?" even if the original
// tweet is from 2020. Uses Tweet Binder's `retweets_of:` query operator
// against the historical count endpoint.
async function backfillRtsReceivedForLeader(leader, rtsReceived) {
  if (!leader.handle) { console.log(`  [RTS-RCV] skip (no handle)`); return; }
  const username = leader.handle.replace('@', '');
  const untilClause = UNTIL ? ` until:${UNTIL}` : '';
  const query = `(retweets_of:${username}) since:${SINCE}${untilClause}`;
  console.log(`  [RTS-RCV] ${query}`);

  const created = await apiPost('/reports/twitter-count/historical', { query: { raw: query } });
  const rid = created?.resourceId || created?.data?.resourceId;
  if (!rid) throw new Error('no resourceId');
  await waitForReport(rid);

  const stats = await apiGet(`/reports/${rid}/stats`);
  const total = stats?.stats?.general?.total || 0;
  const points = await getAllPages(rid);

  const dailySums = {};
  for (const p of points) {
    const c = p.counts || p;
    const ts = (c.min || c.max);
    if (!ts) continue;
    const date = new Date(ts * 1000).toISOString().slice(0, 10);
    dailySums[date] = (dailySums[date] || 0) + (c.count || 0);
  }

  const series = Object.entries(dailySums)
    .filter(([d]) => d >= SINCE && (!UNTIL || d < UNTIL))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));

  rtsReceived[leader.id] = series;
  console.log(`    ${total.toLocaleString()} total RTs received, ${points.length} buckets → ${series.length} dates`);
}

async function backfillTweetsForLeader(leader, engagement) {
  if (!leader.handle) { console.log(`  [TWEETS] skip (no handle)`); return; }
  const username = leader.handle.replace('@', '');

  const allTweets = [];
  const seenIds = new Set();
  let untilOverride = UNTIL; // null on first pass
  let step = 0;

  while (true) {
    step++;
    const untilClause = untilOverride ? ` until:${untilOverride}` : '';
    const query = `from:${username} since:${SINCE}${untilClause}`;
    console.log(`  [TWEETS step ${step}] ${query}`);

    const created = await apiPost('/reports/twitter/historical', { query: { raw: query } });
    const rid = created?.resourceId || created?.data?.resourceId;
    if (!rid) throw new Error('no resourceId');
    await waitForReport(rid, 240);
    const batch = await getAllPages(rid);
    console.log(`    fetched ${batch.length} tweets`);

    let added = 0;
    for (const t of batch) {
      if (!t._id || seenIds.has(t._id)) continue;
      seenIds.add(t._id);
      allTweets.push(t);
      added++;
    }
    console.log(`    +${added} new (cumulative ${allTweets.length})`);

    // Stop conditions: under cap, no progress, or window exhausted.
    if (batch.length < REPORT_CAP_THRESHOLD) { console.log(`    done — under cap`); break; }
    if (added === 0) { console.log(`    done — chain saturated (no new tweets)`); break; }

    // Set next until = day AFTER the oldest tweet's UTC date, so the next
    // report covers everything strictly older while still re-grabbing the
    // morning of the boundary day (any duplicates are removed via seenIds).
    const oldestTs = batch.reduce((min, t) => {
      const ts = t.createdAt || (t.counts && (t.counts.min || t.counts.max));
      return ts ? Math.min(min, ts) : min;
    }, Infinity);
    if (!isFinite(oldestTs)) { console.log(`    done — no createdAt to chain`); break; }
    const d = new Date(oldestTs * 1000);
    d.setUTCDate(d.getUTCDate() + 1);
    untilOverride = d.toISOString().slice(0, 10);
    if (untilOverride <= SINCE) { console.log(`    done — reached SINCE boundary`); break; }
    if (step >= 30) { console.log(`    done — safety cap (30 chain steps)`); break; }

    await sleep(3000);
  }

  if (allTweets.length === 0) { console.log(`    no tweets`); return; }

  const processed = processTweets(allTweets, username, leader.id);
  if (!processed) return;

  // Drop legacy per-year buckets so the merged view reads only from _alltime
  for (const k of Object.keys(engagement)) {
    if (k.startsWith(`${leader.id}_`) && k !== `${leader.id}_alltime`) delete engagement[k];
  }
  engagement[`${leader.id}_alltime`] = {
    ...processed,
    since: SINCE,
    until: UNTIL,
    lastUpdated: new Date().toISOString(),
    tweetCount: processed.tweets.length,
  };
  // Mirror to leader.id (the merged-view key the frontend reads)
  engagement[leader.id] = {
    engagement: processed.engagement,
    topRetweeted: processed.topRetweeted,
    topMentioned: processed.topMentioned,
    topHashtags: processed.topHashtags,
    tweets: processed.tweets,
    lastUpdated: new Date().toISOString(),
    tweetCount: processed.tweets.length,
  };
}

function shouldRun(phase) {
  if (MODE === 'all') return true;
  if (MODE === 'both') return phase === 'mentions' || phase === 'tweets';
  return MODE === phase;
}

async function main() {
  console.log(`\n=== Historical backfill: since=${SINCE}${UNTIL ? ' until=' + UNTIL : ''}, mode=${MODE} ===\n`);
  const history = loadJSON(HISTORY_FILE);
  const counts = loadJSON(COUNTS_FILE);
  const engagement = loadJSON(ENGAGEMENT_FILE);
  const rtsReceived = loadJSON(RTS_RECEIVED_FILE);

  let i = 0;
  for (const leader of leaders) {
    i++;
    console.log(`\n[${i}/${leaders.length}] ${leader.name} (${leader.country})`);

    if (shouldRun('mentions')) {
      try {
        await backfillMentionsForLeader(leader, history, counts);
        saveJSON(HISTORY_FILE, history);
        saveJSON(COUNTS_FILE, counts);
        await sleep(2000);
      } catch (err) {
        console.error(`    MENTIONS ERROR: ${err.message}`);
      }
    }

    if (shouldRun('rts')) {
      try {
        await backfillRtsReceivedForLeader(leader, rtsReceived);
        saveJSON(RTS_RECEIVED_FILE, rtsReceived);
        await sleep(2000);
      } catch (err) {
        console.error(`    RTS-RCV ERROR: ${err.message}`);
      }
    }

    if (shouldRun('tweets')) {
      try {
        await backfillTweetsForLeader(leader, engagement);
        saveJSON(ENGAGEMENT_FILE, engagement);
        await sleep(3000);
      } catch (err) {
        console.error(`    TWEETS ERROR: ${err.message}`);
      }
    }
  }

  counts._lastGlobalUpdate = new Date().toISOString();
  saveJSON(COUNTS_FILE, counts);
  console.log('\nDone.');
}

main().catch(err => { console.error(err); process.exit(1); });
