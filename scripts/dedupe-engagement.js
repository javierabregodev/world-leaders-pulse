/**
 * One-off cleanup: dedupe duplicated tweets that accumulated in
 * server/data/engagement.json across cron runs.
 *
 * Each fetch-twitter-data run concatenated `older[].tweets` + `7-day API
 * tweets`; near the 7-day boundary, one tweet could end up in both
 * arrays, leaving 2 copies in the bucket. Subsequent runs read the
 * already-duplicated bucket and (when the tweet still hovered around
 * the boundary) added another copy, etc. — we saw ratios up to 11x.
 *
 * For each leader bucket: dedupe by tweet id, keeping the freshest
 * snapshot (highest impressions). Aggregates are recomputed from the
 * deduped list so totals are correct.
 *
 * Usage:
 *   node scripts/dedupe-engagement.js          # writes in place
 *   node scripts/dedupe-engagement.js --dry-run
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ENG_FILE = path.join(ROOT, 'server', 'data', 'engagement.json');
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

// Recompute totals/top-lists directly from the (already-condensed) tweet
// shape. We can't use server/tweets.js processTweets here — that one
// expects raw Tweet Binder tweets, not the condensed { id, text, date,
// type, likes, rts, ... } shape that lives in engagement.json.
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

  let totalRemoved = 0;
  let bucketsTouched = 0;

  for (const key of Object.keys(eng)) {
    if (key.startsWith('_')) continue;
    const bucket = eng[key];
    if (!bucket?.tweets?.length) continue;

    const beforeN = bucket.tweets.length;
    const deduped = dedupeWithFreshest(bucket.tweets);
    const afterN = deduped.length;
    if (beforeN === afterN) continue;

    bucketsTouched++;
    totalRemoved += beforeN - afterN;
    console.log(`  ${key.padEnd(24)} ${beforeN.toString().padStart(6)} → ${afterN.toString().padStart(6)}  (removed ${beforeN - afterN})`);

    const recomputed = recomputeAggregates(deduped);
    eng[key] = {
      ...bucket,
      engagement: recomputed.engagement,
      topRetweeted: recomputed.topRetweeted,
      topMentioned: recomputed.topMentioned,
      topHashtags: recomputed.topHashtags,
      tweets: deduped,
      tweetCount: deduped.length,
    };
  }

  console.log(`\nTouched ${bucketsTouched} buckets, removed ${totalRemoved} duplicate tweets total.`);
  if (DRY_RUN) {
    console.log('[dry-run] not writing.');
  } else {
    fs.writeFileSync(ENG_FILE, JSON.stringify(eng, null, 2));
    console.log(`Wrote ${path.relative(ROOT, ENG_FILE)}.`);
  }
}

main();
