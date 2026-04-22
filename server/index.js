import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getCountForQuery, getFullHistoricalCount, getReportWithTweets, createReport, waitForReport, getAllTweets } from './api.js';
import { processTweets } from './tweets.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, 'data', 'counts.json');
const LEADERS_FILE = path.join(__dirname, 'leaders.json');
const HISTORY_FILE = path.join(__dirname, 'data', 'history.json');
const ENGAGEMENT_FILE = path.join(__dirname, 'data', 'engagement.json');
const TRACKERS_FILE = path.join(__dirname, 'data', 'trackers.json');

const leaders = JSON.parse(fs.readFileSync(LEADERS_FILE, 'utf-8'));

const app = express();
app.use(cors());
app.use(express.json());

// --- Data persistence ---

function loadCounts() {
  if (fs.existsSync(DATA_FILE)) {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  }
  return {};
}

function saveCounts(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function loadHistory() {
  if (fs.existsSync(HISTORY_FILE)) {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
  }
  return {};
}

function saveHistory(data) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2));
}

function loadEngagement() {
  if (fs.existsSync(ENGAGEMENT_FILE)) {
    return JSON.parse(fs.readFileSync(ENGAGEMENT_FILE, 'utf-8'));
  }
  return {};
}

function saveEngagement(data) {
  fs.writeFileSync(ENGAGEMENT_FILE, JSON.stringify(data, null, 2));
}

function loadTrackers() {
  if (fs.existsSync(TRACKERS_FILE)) {
    return JSON.parse(fs.readFileSync(TRACKERS_FILE, 'utf-8'));
  }
  return {};
}

/** Get the latest snapshot — always the most recent, ignores date filter */
function getLatestSnapshot(trackerData) {
  if (!trackerData?.snapshots?.length) return null;
  return trackerData.snapshots[trackerData.snapshots.length - 1];
}

/** Get growth between first snapshot in range and last snapshot */
function getGrowth(trackerData, sinceIso, untilIso) {
  if (!trackerData?.snapshots?.length) return null;
  let filtered = trackerData.snapshots;
  if (sinceIso) filtered = filtered.filter(s => s.date >= sinceIso);
  if (untilIso) filtered = filtered.filter(s => s.date <= untilIso);
  if (filtered.length < 2) return null;
  const first = filtered[0];
  const last = filtered[filtered.length - 1];
  return {
    followers: (last.followers ?? 0) - (first.followers ?? 0),
    tweets: (last.tweets ?? 0) - (first.tweets ?? 0),
    mentionsReceived: (last.mentionsReceived ?? 0) - (first.mentionsReceived ?? 0),
    retweetsReceived: (last.retweetsReceived ?? 0) - (first.retweetsReceived ?? 0),
  };
}

// --- API endpoints ---

/**
 * GET /api/leaders — return all leaders with counts + engagement.
 * Accepts ?since=YYYY-MM-DD&until=YYYY-MM-DD to filter from cached data.
 */
app.get('/api/leaders', (req, res) => {
  const { since, until } = req.query;
  const counts = loadCounts();
  const history = loadHistory();
  const engData = loadEngagement();
  const trackers = loadTrackers();

  const result = leaders.map(leader => {
    // Tracker data (followers, account totals)
    const trackerData = trackers[leader.id];
    const latestSnapshot = getLatestSnapshot(trackerData);
    const growth = getGrowth(trackerData, since, until);
    // Filter mentions from history
    let filteredHistory = history[leader.id] ?? [];
    if (since) filteredHistory = filteredHistory.filter(h => h.date >= since);
    if (until) filteredHistory = filteredHistory.filter(h => h.date <= until);
    const filteredMentions = (since || until)
      ? filteredHistory.reduce((sum, h) => sum + (h.count || 0), 0)
      : (counts[leader.id]?.total ?? 0);

    // Filter tweets and recompute engagement
    const allTweets = engData[leader.id]?.tweets ?? [];
    let engagement = engData[leader.id]?.engagement ?? null;

    if ((since || until) && allTweets.length > 0) {
      const sinceTs = since ? new Date(since).getTime() / 1000 : 0;
      const untilTs = until ? new Date(until + 'T23:59:59').getTime() / 1000 : Infinity;
      const filtered = allTweets.filter(t => (t.date || 0) >= sinceTs && (t.date || 0) <= untilTs);

      if (filtered.length > 0) {
        let totalLikes = 0, totalRTs = 0, totalImpressions = 0, totalReplies = 0;
        let originals = 0, rtsSent = 0, repliesSent = 0;
        for (const t of filtered) {
          totalLikes += t.likes || 0;
          totalRTs += t.rts || 0;
          totalImpressions += t.impressions || 0;
          totalReplies += t.replies || 0;
          if (t.type === 'original') originals++;
          else if (t.type === 'retweet') rtsSent++;
          else if (t.type === 'reply') repliesSent++;
        }
        const tp = filtered.length;
        engagement = {
          totalLikes, totalRTs, totalImpressions, totalReplies,
          engagementRate: totalImpressions > 0 ? +((totalLikes + totalRTs + totalReplies) / totalImpressions * 100).toFixed(2) : 0,
          tweetsPosted: tp, originalTweets: originals, retweetsSent: rtsSent, repliesSent,
          avgLikesPerTweet: tp > 0 ? Math.round(totalLikes / tp) : 0,
          avgRTsPerTweet: tp > 0 ? Math.round(totalRTs / tp) : 0,
        };
      } else {
        engagement = null;
      }
    }

    return {
      ...leader,
      totalMentions: filteredMentions,
      engagement,
      tracker: latestSnapshot ? {
        followers: latestSnapshot.followers,
        following: latestSnapshot.following,
        tweetsTotal: latestSnapshot.tweets,
        mentionsReceivedTotal: latestSnapshot.mentionsReceived,
        retweetsReceivedTotal: latestSnapshot.retweetsReceived,
        growth,
        snapshotDate: latestSnapshot.date,
      } : null,
    };
  });

  result.sort((a, b) => (b.totalMentions ?? 0) - (a.totalMentions ?? 0));
  res.json(result);
});

/**
 * GET /api/leaders/:id — return a single leader with history + engagement.
 * Accepts optional ?since=YYYY-MM-DD&until=YYYY-MM-DD to filter cached data.
 * This is INSTANT (no API calls) — filters from stored data.
 */
app.get('/api/leaders/:id', (req, res) => {
  const leader = leaders.find(l => l.id === req.params.id);
  if (!leader) return res.status(404).json({ error: 'Leader not found' });

  const { since, until } = req.query;
  const counts = loadCounts();
  const history = loadHistory();
  const engData = loadEngagement();
  const trackers = loadTrackers();
  const trackerData = trackers[leader.id];
  const latestSnapshot = getLatestSnapshot(trackerData);
  const growth = getGrowth(trackerData, since, until);

  // Filter daily history by date range
  let filteredHistory = history[leader.id] ?? [];
  if (since) {
    filteredHistory = filteredHistory.filter(h => h.date >= since);
  }
  if (until) {
    filteredHistory = filteredHistory.filter(h => h.date <= until);
  }
  const filteredMentions = filteredHistory.reduce((sum, h) => sum + (h.count || 0), 0);

  // Filter tweets by date range and recompute engagement
  const allTweets = engData[leader.id]?.tweets ?? [];
  let filteredTweets = allTweets;
  if (since || until) {
    const sinceTs = since ? new Date(since).getTime() / 1000 : 0;
    const untilTs = until ? new Date(until + 'T23:59:59').getTime() / 1000 : Infinity;
    filteredTweets = allTweets.filter(t => {
      const ts = t.date || 0;
      return ts >= sinceTs && ts <= untilTs;
    });
  }

  // Recompute engagement from filtered tweets
  let engagement = null;
  let topRetweeted = [];
  let topMentioned = [];
  let topHashtags = [];

  if (filteredTweets.length > 0) {
    let totalLikes = 0, totalRTs = 0, totalImpressions = 0, totalReplies = 0;
    let originalTweets = 0, retweetsSent = 0, repliesSent = 0;
    const rtAccounts = {}; // handle → count
    const mentionAccounts = {}; // handle → { count, handles... }

    for (const t of filteredTweets) {
      totalLikes += t.likes || 0;
      totalRTs += t.rts || 0;
      totalImpressions += t.impressions || 0;
      totalReplies += t.replies || 0;

      if (t.type === 'original') originalTweets++;
      else if (t.type === 'retweet') {
        retweetsSent++;
        // Extract RT target from text: "RT @username: ..."
        const rtMatch = (t.text || '').match(/^RT @(\w+)/i);
        if (rtMatch) {
          const h = rtMatch[1].toLowerCase();
          rtAccounts[h] = (rtAccounts[h] || 0) + 1;
        }
      }
      else if (t.type === 'reply') repliesSent++;

      // Mentions: use relatedHandles from non-RT tweets
      if (t.type !== 'retweet' && t.relatedHandles) {
        const counted = new Set();
        for (const h of t.relatedHandles) {
          if (!counted.has(h)) {
            mentionAccounts[h] = (mentionAccounts[h] || 0) + 1;
            counted.add(h);
          }
        }
      }
    }

    const tweetsPosted = filteredTweets.length;
    engagement = {
      totalLikes, totalRTs, totalImpressions, totalReplies,
      totalQuotes: 0, totalBookmarks: 0,
      engagementRate: totalImpressions > 0
        ? +((totalLikes + totalRTs + totalReplies) / totalImpressions * 100).toFixed(2)
        : 0,
      tweetsPosted,
      originalTweets, retweetsSent, repliesSent,
      avgLikesPerTweet: tweetsPosted > 0 ? Math.round(totalLikes / tweetsPosted) : 0,
      avgRTsPerTweet: tweetsPosted > 0 ? Math.round(totalRTs / tweetsPosted) : 0,
    };

    // Build topRetweeted from filtered tweets
    const leadersList = JSON.parse(fs.readFileSync(LEADERS_FILE, 'utf-8'));
    topRetweeted = Object.entries(rtAccounts)
      .map(([handle, count]) => {
        const ml = leadersList.find(l => l.handle && l.handle.replace('@', '').toLowerCase() === handle);
        return { handle: '@' + handle, name: ml?.name || handle, count, isLeader: !!ml, leaderId: ml?.id || null };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Build topMentioned from filtered tweets
    topMentioned = Object.entries(mentionAccounts)
      .map(([handle, count]) => {
        const ml = leadersList.find(l => l.handle && l.handle.replace('@', '').toLowerCase() === handle);
        const isLeaderById = leadersList.find(l => l.id === handle);
        return {
          handle: ml ? ml.handle : (isLeaderById ? isLeaderById.handle : '@' + handle),
          name: ml?.name || isLeaderById?.name || handle,
          count,
          isLeader: !!(ml || isLeaderById),
          leaderId: ml?.id || isLeaderById?.id || null,
        };
      })
      .sort((a, b) => {
        if (a.isLeader !== b.isLeader) return a.isLeader ? -1 : 1;
        return b.count - a.count;
      })
      .slice(0, 15);

    // Build topHashtags — extract from tweet text (hashtags in #xxx format)
    const hashCounts = {};
    for (const t of filteredTweets) {
      const tags = (t.text || '').match(/#\w+/g) || [];
      for (const tag of tags) {
        const norm = tag.toLowerCase();
        hashCounts[norm] = (hashCounts[norm] || 0) + 1;
      }
    }
    topHashtags = Object.entries(hashCounts)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

  } else if (!since && !until) {
    // No filter: use stored engagement as-is
    engagement = engData[leader.id]?.engagement ?? null;
    topRetweeted = engData[leader.id]?.topRetweeted ?? [];
    topMentioned = engData[leader.id]?.topMentioned ?? [];
    topHashtags = engData[leader.id]?.topHashtags ?? [];
  }

  res.json({
    ...leader,
    totalMentions: (since || until) ? filteredMentions : (counts[leader.id]?.total ?? null),
    lastUpdated: counts[leader.id]?.lastUpdated ?? null,
    history: filteredHistory,
    engagement,
    topRetweeted,
    topMentioned,
    topHashtags,
    tweets: filteredTweets,
    tracker: latestSnapshot ? {
      followers: latestSnapshot.followers,
      following: latestSnapshot.following,
      tweetsTotal: latestSnapshot.tweets,
      mentionsReceivedTotal: latestSnapshot.mentionsReceived,
      retweetsReceivedTotal: latestSnapshot.retweetsReceived,
      growth,
      snapshotDate: latestSnapshot.date,
      snapshots: trackerData?.snapshots ?? [],
    } : null,
    since: since || null,
    until: until || null,
  });
});

/**
 * POST /api/leaders/:id/query — on-demand data for a date range.
 * Body: { since: "2026-01-01", until: "2026-04-15" }  (until optional)
 * Returns mentions count + engagement data for that range.
 * Runs count + report in parallel for speed.
 */
app.post('/api/leaders/:id/query', async (req, res) => {
  const leader = leaders.find(l => l.id === req.params.id);
  if (!leader) return res.status(404).json({ error: 'Leader not found' });

  const { since, until } = req.body;
  if (!since) return res.status(400).json({ error: 'since is required' });

  const dateClause = until ? `since:${since} until:${until}` : `since:${since}`;
  const mentionQuery = `${leader.query} ${dateClause}`;
  const hasHandle = !!leader.handle;
  const username = hasHandle ? leader.handle.replace('@', '') : null;
  const tweetQuery = hasHandle ? `from:${username} ${dateClause}` : null;

  console.log(`[Query] ${leader.name}: mentions="${mentionQuery}"${tweetQuery ? ` tweets="${tweetQuery}"` : ''}`);

  try {
    // Run mention count + tweet report in parallel
    const promises = [
      getCountForQuery(mentionQuery, 'historical'),
    ];
    if (tweetQuery) {
      promises.push(getReportWithTweets(tweetQuery, 'historical', 500));
    }

    const results = await Promise.all(promises);
    const countResult = results[0];
    let engagementData = null;

    if (results[1]) {
      engagementData = processTweets(results[1].tweets, username, leader.id);
    }

    res.json({
      ...leader,
      totalMentions: countResult.total,
      timeline: countResult.timeline,
      engagement: engagementData?.engagement ?? null,
      topRetweeted: engagementData?.topRetweeted ?? [],
      topMentioned: engagementData?.topMentioned ?? [],
      topHashtags: engagementData?.topHashtags ?? [],
      tweets: engagementData?.tweets ?? [],
      since,
      until: until || null,
    });
  } catch (err) {
    console.error(`[Query] Error for ${leader.name}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/status — system status */
app.get('/api/status', (req, res) => {
  const counts = loadCounts();
  const totalLeaders = leaders.length;
  const fetchedLeaders = Object.keys(counts).filter(k => k !== '_lastGlobalUpdate').length;
  res.json({
    totalLeaders,
    fetchedLeaders,
    lastGlobalUpdate: counts._lastGlobalUpdate ?? null,
    cronActive: true,
  });
});

/** POST /api/fetch-historical — trigger quarterly historical fetch */
app.post('/api/fetch-historical', async (req, res) => {
  const { leaderId } = req.body;
  const targets = leaderId ? leaders.filter(l => l.id === leaderId) : leaders;

  res.json({ message: `Starting historical fetch for ${targets.length} leader(s) (quarterly counts since 2020)...` });

  fetchHistoricalCounts(targets).catch(err =>
    console.error('Historical fetch error:', err)
  );
});

/** POST /api/fetch-7day — trigger 7-day fetch */
app.post('/api/fetch-7day', async (req, res) => {
  const { leaderId } = req.body;
  const targets = leaderId ? leaders.filter(l => l.id === leaderId) : leaders;

  res.json({ message: `Starting 7-day fetch for ${targets.length} leader(s)...` });

  fetch7DayCounts(targets).catch(err =>
    console.error('7-day fetch error:', err)
  );
});

/** POST /api/fetch-engagement — trigger engagement fetch (tweets from leaders) */
app.post('/api/fetch-engagement', async (req, res) => {
  const { leaderId } = req.body;
  const targets = leaderId
    ? leaders.filter(l => l.id === leaderId && l.handle)
    : leaders.filter(l => l.handle);

  res.json({ message: `Starting engagement fetch for ${targets.length} leader(s) with Twitter accounts...` });

  fetchEngagement(targets, '7-day').catch(err =>
    console.error('Engagement fetch error:', err)
  );
});

// --- Fetch logic ---

async function fetchHistoricalCounts(targets) {
  const counts = loadCounts();
  const history = loadHistory();

  for (const leader of targets) {
    try {
      console.log(`\n[Historical] Fetching: ${leader.name} (quarterly since 2020)`);
      const result = await getFullHistoricalCount(leader.query, 2020);

      counts[leader.id] = {
        ...counts[leader.id],
        total: result.total,
        lastUpdated: new Date().toISOString(),
      };
      saveCounts(counts);

      // Store daily timeline from historical data
      if (result.dailyTimeline.length > 0) {
        history[leader.id] = result.dailyTimeline;
        saveHistory(history);
      }

      console.log(`  TOTAL ${leader.name}: ${result.total.toLocaleString()} mentions (${result.dailyTimeline.length} daily points)`);
    } catch (err) {
      console.error(`  ✗ ${leader.name}: ${err.message}`);
    }
  }

  counts._lastGlobalUpdate = new Date().toISOString();
  saveCounts(counts);
  console.log('\n[Historical] Done.');
}

async function fetch7DayCounts(targets) {
  const counts = loadCounts();
  const history = loadHistory();

  for (const leader of targets) {
    try {
      console.log(`[7-day] Fetching: ${leader.name}`);
      const result = await getCountForQuery(leader.query, '7-day');
      counts[leader.id] = {
        ...counts[leader.id],
        last7d: result.total,
        lastUpdated: new Date().toISOString(),
      };
      saveCounts(counts);

      // Merge daily data from 7-day timeline into history
      if (!history[leader.id]) history[leader.id] = [];
      for (const point of result.timeline) {
        const dateMs = (point.min || point.max) * 1000;
        const date = new Date(dateMs).toISOString().slice(0, 10);
        const existing = history[leader.id].find(h => h.date === date);
        if (existing) {
          existing.count = point.count;
        } else {
          history[leader.id].push({ date, count: point.count });
        }
      }
      saveHistory(history);

      console.log(`  ✓ ${leader.name}: ${result.total.toLocaleString()} (7d)`);
      await new Promise(r => setTimeout(r, 3000));
    } catch (err) {
      console.error(`  ✗ ${leader.name}: ${err.message}`);
    }
  }

  counts._lastGlobalUpdate = new Date().toISOString();
  saveCounts(counts);
  console.log('[7-day] Done.');
}

// --- Engagement fetch ---

/**
 * Hourly 7-day engagement refresh.
 * Fetches last 7 days of tweets from each leader and REPLACES those tweets
 * in the current-year engagement bucket (engagement preserved for older tweets).
 * Then rebuilds the merged main key.
 */
async function fetchEngagement(targets, type = '7-day') {
  const engagement = loadEngagement();
  const leadersList = JSON.parse(fs.readFileSync(LEADERS_FILE, 'utf-8'));
  const currentYear = new Date().getFullYear();
  const sevenDaysAgo = (Date.now() / 1000) - (7 * 86400);

  for (const leader of targets) {
    if (!leader.handle) continue;

    const username = leader.handle.replace('@', '');
    const query = `from:${username}`;

    try {
      console.log(`[Engagement] Fetching 7-day for: ${leader.name}`);
      // No limit — get all tweets from last 7 days
      const created = await createReport(query, type);
      const resourceId = created?.resourceId || created?.data?.resourceId;
      if (!resourceId) throw new Error('No resourceId');
      await waitForReport(resourceId);
      const tweets = await getAllTweets(resourceId);
      console.log(`  Got ${tweets.length} tweets (7d)`);

      const processed = processTweets(tweets, username, leader.id);
      if (!processed) continue;

      // Update current year's bucket: keep older tweets, replace last-7-day ones
      const yearKey = `${leader.id}_${currentYear}`;
      const existingYear = engagement[yearKey] || {};
      const olderTweets = (existingYear.tweets || []).filter(t => (t.date || 0) < sevenDaysAgo);
      const newTweets = [...olderTweets, ...(processed.tweets || [])];

      // Reprocess the combined tweets to get fresh aggregates
      const reprocessed = reprocessFromTweets(newTweets, leadersList);
      engagement[yearKey] = {
        ...reprocessed,
        year: currentYear,
        lastUpdated: new Date().toISOString(),
        tweetCount: newTweets.length,
      };

      // Rebuild merged main key
      rebuildMergedEngagementInPlace(engagement, leader.id, leadersList);
      saveEngagement(engagement);

      console.log(`  ✓ ${leader.name}: ${newTweets.length} total in ${currentYear}, merged: ${engagement[leader.id].tweetCount}`);
      await new Promise(r => setTimeout(r, 5000));
    } catch (err) {
      console.error(`  ✗ ${leader.name}: ${err.message}`);
    }
  }

  engagement._lastUpdate = new Date().toISOString();
  saveEngagement(engagement);
  console.log('[Engagement] Done.');
}

/** Reprocess a tweet array into the full engagement object */
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

function rebuildMergedEngagementInPlace(engagement, leaderId, leadersList) {
  const yearKeys = Object.keys(engagement).filter(k => k.startsWith(leaderId + '_'));
  if (yearKeys.length === 0) return;
  const allTweets = [];
  for (const yk of yearKeys) { if (engagement[yk]?.tweets) allTweets.push(...engagement[yk].tweets); }
  const rebuilt = reprocessFromTweets(allTweets, leadersList);
  engagement[leaderId] = {
    ...rebuilt,
    lastUpdated: new Date().toISOString(),
    tweetCount: allTweets.length,
  };
}

// --- Tracker snapshot fetcher (stored in trackers.json) ---
async function fetchTrackerSnapshots() {
  const withTracker = leaders.filter(l => l.trackerId);
  const result = {};
  const endDate = Math.floor(Date.now() / 1000);
  const startDate = endDate - (5 * 365 * 86400);

  for (const leader of withTracker) {
    try {
      const url = `${process.env.TWEETBINDER_API_URL}/user-trackers/${leader.trackerId}/stats?startDate=${startDate}&endDate=${endDate}&isTimeline=true`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.TWEETBINDER_API_KEY}` } });
      if (!res.ok) continue;
      const data = await res.json();
      const snapshots = Array.isArray(data) ? data : (data?.data || []);
      if (snapshots.length === 0) continue;
      result[leader.id] = {
        trackerId: leader.trackerId,
        snapshots: snapshots.map(s => ({
          timestamp: s._id,
          date: new Date(s._id * 1000).toISOString().slice(0, 10),
          followers: s.followers ?? null,
          following: s.following ?? null,
          tweets: s.tweets ?? null,
          lists: s.lists ?? null,
          mentionsReceived: s.mentions ?? null,
          retweetsReceived: s.retweets ?? null,
          followersFollowing: s.followersFollowing ?? null,
        })),
        fetchedAt: new Date().toISOString(),
      };
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      console.error(`[CRON tracker] ${leader.name}: ${err.message}`);
    }
  }
  fs.writeFileSync(TRACKERS_FILE, JSON.stringify(result, null, 2));
  console.log(`[CRON tracker] Updated ${Object.keys(result).length} leaders' tracker data`);
}

// --- Cron: every 6 hours — mentions + engagement ---
cron.schedule('0 */6 * * *', () => {
  console.log(`[CRON] 6h update at ${new Date().toISOString()}`);

  // Fetch mention counts (7-day)
  fetch7DayCounts(leaders).catch(err =>
    console.error('[CRON] Mention count error:', err)
  );

  // Fetch engagement data (7-day reports) — with 5min offset to spread API load
  setTimeout(() => {
    const withHandle = leaders.filter(l => l.handle);
    fetchEngagement(withHandle, '7-day').catch(err =>
      console.error('[CRON] Engagement error:', err)
    );
  }, 5 * 60 * 1000);
});

// --- Cron: daily at 03:00 — tracker snapshots (followers, account stats) ---
cron.schedule('0 3 * * *', () => {
  console.log(`[CRON] Daily tracker snapshots at ${new Date().toISOString()}`);
  fetchTrackerSnapshots().catch(err =>
    console.error('[CRON] Tracker error:', err)
  );
});

// --- Start ---
const PORT = process.env.SERVER_PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Cron job scheduled: every hour at :00`);
  console.log(`Leaders loaded: ${leaders.length}`);
});
