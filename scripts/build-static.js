/**
 * Build static JSON files for Vercel static hosting.
 * Reads from server/data/* and writes to public/api/
 *
 * Output:
 *   public/api/index.json          — all leaders summary (lightweight, for dashboard)
 *   public/api/leaders/{id}.json   — per-leader detail WITHOUT tweets
 *   public/api/tweets/{id}.json    — per-leader tweets (for TweetModal)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'server', 'data');
const OUT_DIR = path.join(ROOT, 'public', 'api');
const OUT_LEADERS = path.join(OUT_DIR, 'leaders');
const OUT_TWEETS = path.join(OUT_DIR, 'tweets');

function readJSON(file) {
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
}

/** Compute aggregates for a leader in a given date range */
function aggregate(leaderId, history, engagement, since, until) {
  // Mentions from history
  let filteredHist = history[leaderId] ?? [];
  if (since) filteredHist = filteredHist.filter(h => h.date >= since);
  if (until) filteredHist = filteredHist.filter(h => h.date <= until);
  const mentions = filteredHist.reduce((s, h) => s + (h.count || 0), 0);

  // Engagement aggregates: sum from tweetCountsHistory (per-day digest
  // computed from the FULL tweet list before the 500-tweet storage cap).
  // Using engagement.tweets here would underreport prolific accounts —
  // e.g. Milei posts ~7K tweets in 30d but only the top 500 by engagement
  // are stored, so any period filter against that array misses ~93%.
  const digest = engagement[leaderId]?.tweetCountsHistory ?? [];
  let filteredDigest = digest;
  if (since) filteredDigest = filteredDigest.filter(d => d.date >= since);
  if (until) filteredDigest = filteredDigest.filter(d => d.date <= until);

  if (filteredDigest.length === 0) return { totalMentions: mentions, engagement: null };

  let totalLikes = 0, totalRTs = 0, totalImpressions = 0, totalReplies = 0;
  let tp = 0, rtsSent = 0, repliesSent = 0;
  for (const d of filteredDigest) {
    totalLikes += d.likes || 0;
    totalRTs += d.rts || 0;
    totalImpressions += d.impressions || 0;
    totalReplies += d.replies || 0;
    tp += d.count || 0;
    rtsSent += d.retweetsSent || 0;
    repliesSent += d.repliesSent || 0;
  }
  // Originals aren't stored in the digest but are derivable: any tweet
  // that's not a retweet-sent and not a reply-sent is an original.
  const originals = Math.max(0, tp - rtsSent - repliesSent);
  return {
    totalMentions: mentions,
    engagement: {
      totalLikes, totalRTs, totalImpressions, totalReplies,
      engagementRate: totalImpressions > 0 ? +((totalLikes + totalRTs + totalReplies) / totalImpressions * 100).toFixed(2) : 0,
      tweetsPosted: tp, originalTweets: originals, retweetsSent: rtsSent, repliesSent,
      avgLikesPerTweet: tp > 0 ? Math.round(totalLikes / tp) : 0,
      avgRTsPerTweet: tp > 0 ? Math.round(totalRTs / tp) : 0,
    },
  };
}

/** Get date range for a preset period */
function periodToDates(period) {
  const today = new Date();
  const fmt = d => d.toISOString().slice(0, 10);
  switch (period) {
    case 'today': return { since: fmt(today), until: null };
    case 'yesterday': {
      const y = new Date(today); y.setDate(y.getDate() - 1);
      return { since: fmt(y), until: fmt(today) };
    }
    case '7d': { const d = new Date(today); d.setDate(d.getDate() - 7); return { since: fmt(d), until: null }; }
    case '30d': { const d = new Date(today); d.setDate(d.getDate() - 30); return { since: fmt(d), until: null }; }
    case '365d': { const d = new Date(today); d.setFullYear(d.getFullYear() - 1); return { since: fmt(d), until: null }; }
    case 'all': return { since: null, until: null };
    default: return { since: null, until: null };
  }
}

function main() {
  const leaders = readJSON(path.join(ROOT, 'server', 'leaders.json'));
  const counts = readJSON(path.join(DATA_DIR, 'counts.json'));
  const history = readJSON(path.join(DATA_DIR, 'history.json'));
  const engagement = readJSON(path.join(DATA_DIR, 'engagement.json'));
  const trackers = readJSON(path.join(DATA_DIR, 'trackers.json'));
  const rtsReceived = readJSON(path.join(DATA_DIR, 'rts-received.json'));

  // 1) INDEX: per-preset precomputed summaries.
  //    Fixed presets + one preset per year and per month covering the data
  //    range — lets the client pick a year/month from the date picker without
  //    re-aggregating client-side. The per-month presets dominate size but
  //    each entry is small (one number per metric per leader).
  const presets = ['today', 'yesterday', '7d', '30d', '365d', 'all'];

  // Range for year/month presets: from the earliest date present in history
  // or engagement digest, to today.
  const todayStr = new Date().toISOString().slice(0, 10);
  let earliestDate = todayStr;
  for (const id of Object.keys(history)) {
    const d = history[id]?.[0]?.date;
    if (d && d < earliestDate) earliestDate = d;
  }
  for (const id of Object.keys(engagement)) {
    const d = engagement[id]?.tweetCountsHistory?.[0]?.date;
    if (d && d < earliestDate) earliestDate = d;
  }
  const startYear = parseInt(earliestDate.slice(0, 4), 10);
  const endYear = parseInt(todayStr.slice(0, 4), 10);
  const endMonth = parseInt(todayStr.slice(5, 7), 10);

  for (let y = startYear; y <= endYear; y++) {
    presets.push(`year-${y}`);
    for (let m = 1; m <= 12; m++) {
      // skip future months in the current year
      if (y === endYear && m > endMonth) break;
      presets.push(`month-${y}-${String(m).padStart(2, '0')}`);
    }
  }

  function presetToDates(preset) {
    if (preset.startsWith('year-')) {
      const y = preset.slice(5);
      return { since: `${y}-01-01`, until: `${y}-12-31` };
    }
    if (preset.startsWith('month-')) {
      const [y, m] = preset.slice(6).split('-');
      const lastDay = new Date(parseInt(y, 10), parseInt(m, 10), 0).getDate();
      return { since: `${y}-${m}-01`, until: `${y}-${m}-${lastDay}` };
    }
    return periodToDates(preset);
  }

  const index = {
    _meta: {
      lastMentionsUpdate: counts._lastGlobalUpdate || null,
      lastTrackersUpdate: trackers._lastGlobalUpdate || null,
      buildAt: new Date().toISOString(),
      presets: presets.length,
    },
  };
  for (const period of presets) {
    const { since, until } = presetToDates(period);
    index[period] = leaders.map(l => {
      const agg = period === 'all'
        ? { totalMentions: counts[l.id]?.total ?? null, engagement: engagement[l.id]?.engagement ?? null }
        : aggregate(l.id, history, engagement, since, until);
      const tracker = trackers[l.id];
      const latest = tracker?.snapshots?.[tracker.snapshots.length - 1] ?? null;
      return {
        id: l.id, name: l.name, country: l.country, countryCode: l.countryCode, handle: l.handle,
        totalMentions: agg.totalMentions,
        engagement: agg.engagement,
        tracker: latest ? {
          followers: latest.followers,
          following: latest.following,
          tweetsTotal: latest.tweets,
          mentionsReceivedTotal: latest.mentionsReceived,
          retweetsReceivedTotal: latest.retweetsReceived,
          followersFollowing: latest.followersFollowing,
          snapshotDate: latest.date,
        } : null,
      };
    });
  }
  writeJSON(path.join(OUT_DIR, 'index.json'), index);

  // 2) Per-leader detail WITHOUT tweets (for LeaderPage — fast)
  //    Includes: history, engagement, topRetweeted, topMentioned, topHashtags, tracker snapshots
  for (const l of leaders) {
    const eng = engagement[l.id] ?? {};
    const tracker = trackers[l.id];
    const detail = {
      ...l,
      totalMentions: counts[l.id]?.total ?? null,
      history: history[l.id] ?? [],
      engagement: eng.engagement ?? null,
      topRetweeted: eng.topRetweeted ?? [],
      topMentioned: eng.topMentioned ?? [],
      topHashtags: eng.topHashtags ?? [],
      tracker: tracker ? {
        snapshots: tracker.snapshots ?? [],
        fetchedAt: tracker.fetchedAt,
      } : null,
      rtsReceivedHistory: rtsReceived[l.id] ?? [],
      tweetCountsHistory: eng.tweetCountsHistory ?? [],
    };
    writeJSON(path.join(OUT_LEADERS, l.id + '.json'), detail);
  }

  // 3) Per-leader tweets (for TweetModal — lazy loaded)
  for (const l of leaders) {
    const tweets = engagement[l.id]?.tweets;
    if (!tweets?.length) continue;
    writeJSON(path.join(OUT_TWEETS, l.id + '.json'), tweets);
  }

  // Stats
  console.log('Built static files:');
  console.log('  index.json:', index.length, 'leaders');
  console.log('  leaders/*.json:', fs.readdirSync(OUT_LEADERS).length, 'files');
  console.log('  tweets/*.json:', fs.existsSync(OUT_TWEETS) ? fs.readdirSync(OUT_TWEETS).length : 0, 'files');
}

main();
