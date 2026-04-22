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

  // If no tweets data, just return mentions filtered
  const allTweets = leader.tweets || [];
  let engagement = leader.engagement;
  let topRetweeted = leader.topRetweeted || [];
  let topMentioned = leader.topMentioned || [];
  let topHashtags = leader.topHashtags || [];

  if (allTweets.length > 0) {
    const sinceTs = since ? new Date(since).getTime() / 1000 : 0;
    const untilTs = until ? new Date(until + 'T23:59:59').getTime() / 1000 : Infinity;
    const filteredTweets = allTweets.filter(t => (t.date || 0) >= sinceTs && (t.date || 0) <= untilTs);

    if (filteredTweets.length > 0) {
      // Recompute engagement
      let totalLikes = 0, totalRTs = 0, totalImpressions = 0, totalReplies = 0;
      let originals = 0, rtsSent = 0, repliesSent = 0;
      const rtCounts = {}, mentionCounts = {}, hashCounts = {};

      for (const t of filteredTweets) {
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

      const tp = filteredTweets.length;
      engagement = {
        totalLikes, totalRTs, totalImpressions, totalReplies, totalQuotes: 0, totalBookmarks: 0,
        engagementRate: totalImpressions > 0
          ? +((totalLikes + totalRTs + totalReplies) / totalImpressions * 100).toFixed(2)
          : 0,
        tweetsPosted: tp, originalTweets: originals, retweetsSent: rtsSent, repliesSent,
        avgLikesPerTweet: tp > 0 ? Math.round(totalLikes / tp) : 0,
        avgRTsPerTweet: tp > 0 ? Math.round(totalRTs / tp) : 0,
      };

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
      engagement = null;
    }

    return {
      ...leader,
      totalMentions: filteredMentions,
      history: filteredHistory,
      engagement,
      topRetweeted,
      topMentioned,
      topHashtags,
      tweets: filteredTweets,
    };
  }

  return { ...leader, totalMentions: filteredMentions, history: filteredHistory };
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
