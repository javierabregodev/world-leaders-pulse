/**
 * One-off recovery: re-fetch historical mention counts from 2026-04-01 onwards
 * for every leader and overwrite the corresponding entries in history.json.
 *
 * Use case: the previous fetch-mentions cron stored sub-daily timeline buckets
 * directly into history without aggregating, deflating daily counts ~30x for
 * dates from 2026-04-08 onwards. This script repairs that range using the
 * historical (full-archive) endpoint, which gives stable per-day counts.
 *
 * Usage:
 *   node scripts/recover-from-april.js
 *   node scripts/recover-from-april.js 2026-04-01   # custom since
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'server', 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const COUNTS_FILE = path.join(DATA_DIR, 'counts.json');
const LEADERS_FILE = path.join(ROOT, 'server', 'leaders.json');

const SINCE = process.argv[2] || '2026-04-01';

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

// /reports/{id}/stats only returns a sampled/truncated timeline (gives ~4x
// less than reality for multi-day queries). The raw hourly buckets live on
// /reports/{id}/transcript/counts and are paginated.
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

async function main() {
  console.log(`\n=== Recovery: re-fetching mention history since ${SINCE} ===\n`);
  const history = loadJSON(HISTORY_FILE);
  const counts = loadJSON(COUNTS_FILE);

  let i = 0;
  for (const leader of leaders) {
    i++;
    console.log(`[${i}/${leaders.length}] ${leader.name}`);
    const query = `${leader.query} since:${SINCE}`;
    try {
      const created = await apiPost('/reports/twitter-count/historical', { query: { raw: query } });
      const rid = created?.resourceId || created?.data?.resourceId;
      if (!rid) throw new Error('no resourceId');
      await waitForReport(rid);

      // Get the report total for logging, but use full count points for the timeline
      const stats = await apiGet(`/reports/${rid}/stats`);
      const total = stats?.stats?.general?.total || 0;
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

      if (!history[leader.id]) history[leader.id] = [];
      let written = 0;
      for (const [date, count] of Object.entries(dailySums)) {
        if (date < SINCE) continue;
        const existing = history[leader.id].find(h => h.date === date);
        if (existing) {
          if (existing.count !== count) { existing.count = count; written++; }
        } else {
          history[leader.id].push({ date, count });
          written++;
        }
      }
      history[leader.id].sort((a, b) => a.date.localeCompare(b.date));

      // Refresh last7d snapshot in counts.json from the recovered history
      const last7Cutoff = new Date(Date.now() - 7 * 86400 * 1000).toISOString().slice(0, 10);
      const last7d = history[leader.id]
        .filter(h => h.date >= last7Cutoff)
        .reduce((s, h) => s + (h.count || 0), 0);
      counts[leader.id] = { ...counts[leader.id], last7d, lastUpdated: new Date().toISOString() };

      saveJSON(HISTORY_FILE, history);
      saveJSON(COUNTS_FILE, counts);
      const dailyTotal = Object.values(dailySums).reduce((s, v) => s + v, 0);
      console.log(`  ${total.toLocaleString()} reported / ${dailyTotal.toLocaleString()} from ${points.length} buckets, ${Object.keys(dailySums).length} dates, ${written} written`);
      await sleep(2000);
    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
    }
  }

  counts._lastGlobalUpdate = new Date().toISOString();
  saveJSON(COUNTS_FILE, counts);
  console.log('\nDone.');
}

main().catch(err => { console.error(err); process.exit(1); });
