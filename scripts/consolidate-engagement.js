/**
 * One-off migration: collapse engagement.json from
 *   { leaderId, leaderId_alltime, leaderId_2025, leaderId_2026, ... }
 * down to a single canonical bucket per leader at `engagement[leaderId]`.
 *
 * Background: the merged + per-year + _alltime keys all carried the same
 * tweet objects (post-dedupe), inflating the file 2-3x. During a full
 * tweets-rts backfill the file hit 296MB and GitHub's 100MB push limit
 * rejected the workflow's commit.
 *
 * For each leader: union all tweets across their buckets, dedupe by id
 * (last-write-wins), recompute aggregates from the deduped list, write
 * to engagement[leaderId], delete the rest.
 *
 * Usage:
 *   node scripts/consolidate-engagement.js
 *   node scripts/consolidate-engagement.js --dry-run
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ENG_FILE = path.join(ROOT, 'server', 'data', 'engagement.json');
const LEADERS_FILE = path.join(ROOT, 'server', 'leaders.json');
const DRY_RUN = process.argv.includes('--dry-run');

function pickFreshest(copies) {
  return copies.reduce((best, t) => {
    const score = (t.impressions || 0) + (t.likes || 0) + (t.rts || 0);
    const bestScore = (best.impressions || 0) + (best.likes || 0) + (best.rts || 0);
    return score > bestScore ? t : best;
  }, copies[0]);
}

function dedupeWithFreshest(tweets) {
  const groups = new Map();
  for (const t of tweets || []) {
    if (!t?.id) continue;
    if (!groups.has(t.id)) groups.set(t.id, []);
    groups.get(t.id).push(t);
  }
  return [...groups.values()].map(pickFreshest);
}

function recomputeAggregates(tweets) {
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
    } else if (t.type === 'reply') repliesSent++;
    if (t.type !== 'retweet' && Array.isArray(t.relatedHandles)) {
      const seen = new Set();
      for (const h of t.relatedHandles) {
        if (!seen.has(h)) { mentionCounts[h] = (mentionCounts[h] || 0) + 1; seen.add(h); }
      }
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
    topRetweeted: Object.entries(rtCounts).map(([h, c]) => ({ handle: '@' + h, name: h, count: c })).sort((a, b) => b.count - a.count).slice(0, 15),
    topMentioned: Object.entries(mentionCounts).map(([h, c]) => ({ handle: '@' + h, name: h, count: c })).sort((a, b) => b.count - a.count).slice(0, 15),
    topHashtags: Object.entries(hashCounts).map(([t, c]) => ({ tag: t, count: c })).sort((a, b) => b.count - a.count).slice(0, 15),
  };
}

function main() {
  const eng = JSON.parse(fs.readFileSync(ENG_FILE, 'utf-8'));
  const leaders = JSON.parse(fs.readFileSync(LEADERS_FILE, 'utf-8'));

  let totalKeysBefore = 0, totalKeysAfter = 0;
  let totalTweetsBefore = 0, totalTweetsAfter = 0;

  for (const leader of leaders) {
    const lid = leader.id;
    const ownKeys = Object.keys(eng).filter(k => k === lid || k.startsWith(lid + '_'));
    if (ownKeys.length === 0) continue;

    const allTweets = [];
    for (const k of ownKeys) {
      if (eng[k]?.tweets) {
        allTweets.push(...eng[k].tweets);
        totalTweetsBefore += eng[k].tweets.length;
      }
    }
    totalKeysBefore += ownKeys.length;

    const deduped = dedupeWithFreshest(allTweets);
    totalTweetsAfter += deduped.length;

    if (deduped.length === 0) {
      console.log(`  ${lid.padEnd(12)} no tweets across ${ownKeys.length} keys, dropping all`);
      for (const k of ownKeys) delete eng[k];
      continue;
    }

    const recomputed = recomputeAggregates(deduped);

    // Drop all per-leader keys, then write the canonical one.
    for (const k of ownKeys) delete eng[k];
    eng[lid] = {
      engagement: recomputed.engagement,
      topRetweeted: recomputed.topRetweeted,
      topMentioned: recomputed.topMentioned,
      topHashtags: recomputed.topHashtags,
      tweets: deduped,
      lastUpdated: new Date().toISOString(),
      tweetCount: deduped.length,
    };
    totalKeysAfter++;

    console.log(`  ${lid.padEnd(12)} ${ownKeys.length} keys → 1, tweets ${ownKeys.map(k => eng[k]?.tweets?.length ?? 0).join('+') || '?'} → ${deduped.length}`);
  }

  console.log(`\nKeys: ${totalKeysBefore} → ${totalKeysAfter}`);
  console.log(`Tweets total (with dupes): ${totalTweetsBefore} → ${totalTweetsAfter}`);

  if (DRY_RUN) {
    console.log('[dry-run] not writing.');
  } else {
    fs.writeFileSync(ENG_FILE, JSON.stringify(eng, null, 2));
    const stat = fs.statSync(ENG_FILE);
    console.log(`Wrote ${path.relative(ROOT, ENG_FILE)} — ${(stat.size / 1024 / 1024).toFixed(1)} MB`);
  }
}

main();
