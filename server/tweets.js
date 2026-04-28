/**
 * Tweet processing module.
 * Takes raw tweets from Tweet Binder API and computes engagement metrics,
 * top retweeted accounts, top mentioned accounts, and top hashtags.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LEADERS_FILE = path.join(__dirname, 'leaders.json');

// Load leaders for name-mention detection
let leadersCache = null;
function getLeaders() {
  if (!leadersCache) {
    leadersCache = JSON.parse(fs.readFileSync(LEADERS_FILE, 'utf-8'));
  }
  return leadersCache;
}

/**
 * Build a map of name variants → leader id for detecting leader mentions in text.
 * Skips short/generic names that could cause false positives.
 */
function buildNameVariantsMap() {
  const leaders = getLeaders();
  const map = new Map(); // lowercase variant → { id, name }

  const GENERIC_NAMES = new Set([
    'hassan', 'ahmed', 'ali', 'khan', 'kim', 'lee', 'park',
    'silva', 'rahman', 'ramos', 'martin', 'garcia',
  ]);

  for (const l of leaders) {
    const parts = l.name.split(' ');

    // Full name always matches
    map.set(l.name.toLowerCase(), { id: l.id, name: l.name });

    // Last name if it's distinctive enough (>3 chars and not generic)
    const lastName = parts[parts.length - 1];
    if (lastName.length > 3 && !GENERIC_NAMES.has(lastName.toLowerCase())) {
      map.set(lastName.toLowerCase(), { id: l.id, name: l.name });
    }

    // Handle (without @) if exists
    if (l.handle) {
      map.set(l.handle.replace('@', '').toLowerCase(), { id: l.id, name: l.name });
    }

    // Special cases for well-known short names
    if (l.id === 'trump') map.set('trump', { id: l.id, name: l.name });
    if (l.id === 'putin') map.set('putin', { id: l.id, name: l.name });
    if (l.id === 'macron') map.set('macron', { id: l.id, name: l.name });
    if (l.id === 'lula') map.set('lula', { id: l.id, name: l.name });
    if (l.id === 'modi') map.set('modi', { id: l.id, name: l.name });
    if (l.id === 'erdogan') map.set('erdogan', { id: l.id, name: l.name });
    if (l.id === 'meloni') map.set('meloni', { id: l.id, name: l.name });
    if (l.id === 'xi') { map.set('xi jinping', { id: l.id, name: l.name }); map.set('jinping', { id: l.id, name: l.name }); }
    if (l.id === 'sanchez') { map.set('pedro sanchez', { id: l.id, name: l.name }); map.set('sánchez', { id: l.id, name: l.name }); }
  }

  return map;
}

let nameVariants = null;
function getNameVariants() {
  if (!nameVariants) nameVariants = buildNameVariantsMap();
  return nameVariants;
}

/**
 * Process an array of raw tweets into engagement metrics.
 *
 * @param {Array} tweets - Raw tweets from Tweet Binder transcript
 * @param {string} leaderHandle - The leader's handle (without @)
 * @param {string} leaderId - The leader's ID (to exclude self-mentions)
 * @returns {Object} Processed engagement data
 */
export function processTweets(tweets, leaderHandle, leaderId) {
  if (!tweets || tweets.length === 0) {
    return null;
  }

  // --- Aggregate engagement ---
  let totalLikes = 0;
  let totalRTs = 0;
  let totalImpressions = 0;
  let totalReplies = 0;
  let totalQuotes = 0;
  let totalBookmarks = 0;
  let originalTweets = 0;
  let retweetsSent = 0;
  let repliesSent = 0;

  // --- Tracking maps ---
  const retweetedAccounts = {}; // handle → count
  const mentionedAccounts = {}; // handle → { count, name, isLeader, leaderId }
  const hashtagCounts = {}; // tag → count

  const leaders = getLeaders();
  const variants = getNameVariants();
  const leaderHandleLower = leaderHandle?.toLowerCase();

  for (const tweet of tweets) {
    const text = tweet.text || '';
    const counts = tweet.counts || {};

    // Engagement totals (these are the engagement RECEIVED by the leader's tweets)
    totalLikes += counts.favorites || 0;
    totalRTs += counts.totalRetweets || 0;
    totalImpressions += counts.impressions || 0;
    totalReplies += counts.totalReplies || 0;
    totalQuotes += counts.quotes || 0;
    totalBookmarks += counts.bookmarks || 0;

    // Tweet type classification
    const isRT = counts.retweets === 1 || text.startsWith('RT @');
    const isReply = counts.replies === 1 || (counts.originals !== 1 && !isRT);

    if (isRT) {
      retweetsSent++;

      // Extract who they retweeted: "RT @username: ..."
      const rtMatch = text.match(/^RT @(\w+)/i);
      if (rtMatch) {
        const rtHandle = rtMatch[1].toLowerCase();
        retweetedAccounts[rtHandle] = (retweetedAccounts[rtHandle] || 0) + 1;
      }
    } else if (isReply) {
      repliesSent++;
    } else {
      originalTweets++;
    }

    // --- Mentions (only original tweets + replies, NOT RTs) ---
    // RTs go to topRetweeted instead. This keeps counts aligned with what the UI shows.
    if (!isRT) {
      const countedInThisTweet = new Set();

      // 1. @mentions from the mentions array
      const mentions = tweet.mentions || [];
      for (const m of mentions) {
        const raw = (typeof m === 'string' ? m : m?.username || m?.alias || '');
        const cleaned = raw.replace(/^@/, '').toLowerCase();
        if (!cleaned || cleaned === leaderHandleLower) continue;

        const matchedLeader = leaders.find(l =>
          l.handle && l.handle.replace('@', '').toLowerCase() === cleaned
        );

        const key = cleaned;
        if (!mentionedAccounts[key]) {
          mentionedAccounts[key] = {
            handle: '@' + cleaned,
            name: matchedLeader?.name || cleaned,
            count: 0,
            isLeader: !!matchedLeader,
            leaderId: matchedLeader?.id || null,
          };
        }
        if (!countedInThisTweet.has(key)) {
          mentionedAccounts[key].count++;
          countedInThisTweet.add(key);
        }
      }

      // 2. Name mentions: scan text for leader names
      // Only count if not already counted via @handle above
      const textLower = text.toLowerCase();
      for (const [variant, leaderInfo] of variants) {
        if (leaderInfo.id === leaderId) continue;
        const regex = new RegExp(`\\b${variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (regex.test(textLower)) {
          const matchedLeader = leaders.find(l => l.id === leaderInfo.id);
          const key = matchedLeader?.handle
            ? matchedLeader.handle.replace('@', '').toLowerCase()
            : leaderInfo.id;

          if (!mentionedAccounts[key]) {
            mentionedAccounts[key] = {
              handle: matchedLeader?.handle || null,
              name: leaderInfo.name,
              count: 0,
              isLeader: true,
              leaderId: leaderInfo.id,
            };
          }
          if (!countedInThisTweet.has(key)) {
            mentionedAccounts[key].count++;
            countedInThisTweet.add(key);
          }
        }
      }
    }

    // --- Hashtags ---
    const hashtags = tweet.hashtags || [];
    for (const tag of hashtags) {
      const t = typeof tag === 'string' ? tag : tag?.text || '';
      if (!t) continue;
      const normalized = '#' + t.replace(/^#/, '');
      hashtagCounts[normalized] = (hashtagCounts[normalized] || 0) + 1;
    }
  }

  // --- Build condensed tweet list (for UI drill-down) ---
  const condensedTweets = tweets.map(tweet => {
    const text = tweet.text || '';
    const counts = tweet.counts || {};
    const isRT = counts.retweets === 1 || text.startsWith('RT @');
    const isReply = counts.replies === 1 || (counts.originals !== 1 && !isRT);

    // Collect all handles this tweet relates to (mentions + RT target)
    const relatedHandles = [];
    if (isRT) {
      const rtMatch = text.match(/^RT @(\w+)/i);
      if (rtMatch) relatedHandles.push(rtMatch[1].toLowerCase());
    }
    const mentions = tweet.mentions || [];
    for (const m of mentions) {
      const raw = (typeof m === 'string' ? m : m?.username || m?.alias || '').replace(/^@/, '').toLowerCase();
      if (raw && raw !== leaderHandleLower) relatedHandles.push(raw);
    }
    // Also check for leader name mentions in text (non-RT only)
    if (!isRT) {
      const textLower = text.toLowerCase();
      for (const [variant, leaderInfo] of variants) {
        if (leaderInfo.id === leaderId) continue;
        const regex = new RegExp(`\\b${variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (regex.test(textLower)) {
          const ml = leaders.find(l => l.id === leaderInfo.id);
          const handle = ml?.handle ? ml.handle.replace('@', '').toLowerCase() : leaderInfo.id;
          if (!relatedHandles.includes(handle)) relatedHandles.push(handle);
        }
      }
    }

    // Tweet Binder gives us images/videos URLs and outbound links.
    // Keep them on the condensed tweet so the UI can render galleries
    // without re-fetching the raw transcript.
    const images = Array.isArray(tweet.images) ? tweet.images.filter(Boolean) : [];
    const videos = Array.isArray(tweet.videos) ? tweet.videos.filter(Boolean) : [];

    return {
      id: tweet._id,
      text,
      date: tweet.createdAt, // unix seconds
      type: isRT ? 'retweet' : isReply ? 'reply' : 'original',
      likes: counts.favorites || 0,
      rts: counts.totalRetweets || 0,
      impressions: counts.impressions || 0,
      replies: counts.totalReplies || 0,
      relatedHandles, // which accounts this tweet is about
      images,
      videos,
      lang: tweet.lang || null,
    };
  });

  // --- Compile results ---
  const tweetsPosted = tweets.length;
  const engagementRate = totalImpressions > 0
    ? +((totalLikes + totalRTs + totalReplies) / totalImpressions * 100).toFixed(2)
    : 0;

  return {
    engagement: {
      totalLikes,
      totalRTs,
      totalImpressions,
      totalReplies,
      totalQuotes,
      totalBookmarks,
      engagementRate,
      tweetsPosted,
      originalTweets,
      retweetsSent,
      repliesSent,
      avgLikesPerTweet: tweetsPosted > 0 ? Math.round(totalLikes / tweetsPosted) : 0,
      avgRTsPerTweet: tweetsPosted > 0 ? Math.round(totalRTs / tweetsPosted) : 0,
    },
    topRetweeted: Object.entries(retweetedAccounts)
      .map(([handle, count]) => {
        const matchedLeader = leaders.find(l =>
          l.handle && l.handle.replace('@', '').toLowerCase() === handle
        );
        return {
          handle: '@' + handle,
          name: matchedLeader?.name || handle,
          count,
          isLeader: !!matchedLeader,
          leaderId: matchedLeader?.id || null,
        };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    topMentioned: Object.values(mentionedAccounts)
      .sort((a, b) => {
        // Leaders first, then by count
        if (a.isLeader !== b.isLeader) return a.isLeader ? -1 : 1;
        return b.count - a.count;
      })
      .slice(0, 15),
    topHashtags: Object.entries(hashtagCounts)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15),
    tweets: condensedTweets,
  };
}
