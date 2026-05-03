/**
 * Client-side filtering of leader data by date range.
 * Reproduces what the backend used to do server-side.
 */

/** Filter a leader's history + tweets by date range and recompute stats */
export function filterLeader(leader, since, until) {
  if (!since && !until) return leader;

  // Filter history
  let filteredHistory = leader.history || [];
  if (since) filteredHistory = filteredHistory.filter(h => h.date >= since);
  if (until) filteredHistory = filteredHistory.filter(h => h.date <= until);
  const filteredMentions = filteredHistory.reduce((sum, h) => sum + (h.count || 0), 0);

  // Engagement totals come from tweetCountsHistory (full pre-cap digest).
  // Filtering leader.tweets directly would underreport prolific accounts —
  // that array is capped to the top 500 most-engaging tweets, so for someone
  // posting ~7K/30d only ~6% of the volume remains in any period filter.
  const digest = leader.tweetCountsHistory || [];
  let filteredDigest = digest;
  if (since) filteredDigest = filteredDigest.filter(d => d.date >= since);
  if (until) filteredDigest = filteredDigest.filter(d => d.date <= until);

  let digestEngagement = null;
  if (filteredDigest.length > 0) {
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
    const originals = Math.max(0, tp - rtsSent - repliesSent);
    digestEngagement = {
      totalLikes, totalRTs, totalImpressions, totalReplies, totalQuotes: 0, totalBookmarks: 0,
      engagementRate: totalImpressions > 0
        ? +((totalLikes + totalRTs + totalReplies) / totalImpressions * 100).toFixed(2)
        : 0,
      tweetsPosted: tp, originalTweets: originals, retweetsSent: rtsSent, repliesSent,
      avgLikesPerTweet: tp > 0 ? Math.round(totalLikes / tp) : 0,
      avgRTsPerTweet: tp > 0 ? Math.round(totalRTs / tp) : 0,
    };
  }

  // top* lists are derived from the stored tweet array (capped 500). They're
  // approximate for prolific accounts, but it's the only signal we have for
  // who got RT'd / mentioned / hashtagged most without keeping every tweet.
  const allTweets = leader.tweets || [];
  let topRetweeted = leader.topRetweeted || [];
  let topMentioned = leader.topMentioned || [];
  let topHashtags = leader.topHashtags || [];
  let filteredTweets = allTweets;

  if (allTweets.length > 0) {
    const sinceTs = since ? new Date(since).getTime() / 1000 : 0;
    const untilTs = until ? new Date(until + 'T23:59:59').getTime() / 1000 : Infinity;
    filteredTweets = allTweets.filter(t => (t.date || 0) >= sinceTs && (t.date || 0) <= untilTs);

    if (filteredTweets.length > 0) {
      const rtCounts = {}, mentionCounts = {}, hashCounts = {};
      for (const t of filteredTweets) {
        if (t.type === 'retweet') {
          const m = (t.text || '').match(/^RT @(\w+)/i);
          if (m) { const h = m[1].toLowerCase(); rtCounts[h] = (rtCounts[h] || 0) + 1; }
        }
        if (t.type !== 'retweet' && t.relatedHandles) {
          const counted = new Set();
          for (const h of t.relatedHandles) {
            if (!counted.has(h)) { mentionCounts[h] = (mentionCounts[h] || 0) + 1; counted.add(h); }
          }
        }
        for (const tag of ((t.text || '').match(/#\w+/g) || [])) {
          hashCounts[tag.toLowerCase()] = (hashCounts[tag.toLowerCase()] || 0) + 1;
        }
      }
      topRetweeted = Object.entries(rtCounts)
        .map(([h, c]) => ({ handle: '@' + h, name: h, count: c }))
        .sort((a, b) => b.count - a.count).slice(0, 10);
      topMentioned = Object.entries(mentionCounts)
        .map(([h, c]) => ({ handle: '@' + h, name: h, count: c }))
        .sort((a, b) => b.count - a.count).slice(0, 15);
      topHashtags = Object.entries(hashCounts)
        .map(([t, c]) => ({ tag: t, count: c }))
        .sort((a, b) => b.count - a.count).slice(0, 15);
    } else {
      // No engaging tweets in the period → drop the top lists so previous
      // periods' top accounts/hashtags don't leak through.
      topRetweeted = [];
      topMentioned = [];
      topHashtags = [];
    }
  }

  return {
    ...leader,
    totalMentions: filteredMentions,
    history: filteredHistory,
    engagement: digestEngagement,
    topRetweeted,
    topMentioned,
    topHashtags,
    tweets: filteredTweets,
  };
}

/** Enrich topRetweeted/topMentioned with leader info (merges from leaders list) */
export function enrichWithLeaderInfo(items, allLeaders) {
  return (items || []).map(item => {
    const cleanHandle = (item.handle || '').replace(/^@/, '').toLowerCase();
    const match = allLeaders.find(l =>
      (l.handle && l.handle.replace('@', '').toLowerCase() === cleanHandle) ||
      l.id === cleanHandle
    );
    if (match) {
      return { ...item, name: match.name, handle: match.handle, isLeader: true, leaderId: match.id };
    }
    return { ...item, isLeader: false };
  });
}
