// Mock data for UI development — will be replaced by real API calls

const LEADERS_RAW = [
  { id: 'trump', name: 'Donald Trump', country: 'United States', countryCode: 'US', handle: '@realDonaldTrump', totalAll: 1017112873 },
  { id: 'modi', name: 'Narendra Modi', country: 'India', countryCode: 'IN', handle: '@narendramodi', totalAll: 600931469 },
  { id: 'macron', name: 'Emmanuel Macron', country: 'France', countryCode: 'FR', handle: '@EmmanuelMacron', totalAll: 112100000 },
  { id: 'erdogan', name: 'Recep Tayyip Erdogan', country: 'Turkey', countryCode: 'TR', handle: '@RTErdogan', totalAll: 89000000 },
  { id: 'putin', name: 'Vladimir Putin', country: 'Russia', countryCode: 'RU', handle: null, totalAll: 78500000 },
  { id: 'lula', name: 'Luiz Inacio Lula da Silva', country: 'Brazil', countryCode: 'BR', handle: '@LulaOficial', totalAll: 67000000 },
  { id: 'xi', name: 'Xi Jinping', country: 'China', countryCode: 'CN', handle: null, totalAll: 52000000 },
  { id: 'starmer', name: 'Keir Starmer', country: 'United Kingdom', countryCode: 'GB', handle: '@Keir_Starmer', totalAll: 41000000 },
  { id: 'petro', name: 'Gustavo Petro', country: 'Colombia', countryCode: 'CO', handle: '@petrogustavo', totalAll: 38000000 },
  { id: 'sheinbaum', name: 'Claudia Sheinbaum', country: 'Mexico', countryCode: 'MX', handle: '@Claudiashein', totalAll: 32000000 },
  { id: 'meloni', name: 'Giorgia Meloni', country: 'Italy', countryCode: 'IT', handle: null, totalAll: 28000000 },
  { id: 'merz', name: 'Friedrich Merz', country: 'Germany', countryCode: 'DE', handle: '@_FriedrichMerz', totalAll: 11163422 },
  { id: 'ramaphosa', name: 'Cyril Ramaphosa', country: 'South Africa', countryCode: 'ZA', handle: '@CyrilRamaphosa', totalAll: 9800000 },
  { id: 'marcos', name: 'Ferdinand Marcos Jr.', country: 'Philippines', countryCode: 'PH', handle: '@bongbongmarcos', totalAll: 8500000 },
  { id: 'ruto', name: 'William Ruto', country: 'Kenya', countryCode: 'KE', handle: '@WilliamsRuto', totalAll: 7200000 },
  { id: 'prabowo', name: 'Prabowo Subianto', country: 'Indonesia', countryCode: 'ID', handle: '@prabowo', totalAll: 6100000 },
  { id: 'sharif', name: 'Shehbaz Sharif', country: 'Pakistan', countryCode: 'PK', handle: '@CMShehbaz', totalAll: 4200000 },
  { id: 'museveni', name: 'Yoweri Museveni', country: 'Uganda', countryCode: 'UG', handle: '@kagutamuseveni', totalAll: 3100000 },
  { id: 'tinubu', name: 'Bola Tinubu', country: 'Nigeria', countryCode: 'NG', handle: null, totalAll: 2800000 },
  { id: 'sisi', name: 'Abdel Fattah el-Sisi', country: 'Egypt', countryCode: 'EG', handle: null, totalAll: 2400000 },
  { id: 'sanchez', name: 'Pedro Sanchez', country: 'Spain', countryCode: 'ES', handle: '@sanchezcastejon', totalAll: 15000000 },
];

// Stable pseudo-random per leader
function seededRand(seed) {
  let x = Math.sin(seed * 9301 + 49297) * 49297;
  return x - Math.floor(x);
}

// --- Fake engagement data generation ---

const FAKE_ACCOUNTS = [
  '@WhiteHouse', '@VP', '@StateDept', '@ABORTERS', '@CNN', '@BBCWorld',
  '@Reuters', '@naborters', '@UN', '@NATO', '@euaborters', '@WHO',
  '@elaborters', '@guardian', '@nytimes', '@washingtonpost', '@FoxNews',
  '@POTUS', '@10DowningStreet', '@Aborters_Elysee', '@KremlinRussia',
];

const FAKE_HASHTAGS = [
  '#G7', '#G20', '#NATO', '#UN', '#Climate', '#Trade', '#Economy',
  '#Democracy', '#Peace', '#Security', '#Health', '#Education',
  '#BRICS', '#EU', '#UNGA', '#COP30', '#Diplomacy', '#ForeignPolicy',
  '#HumanRights', '#Election2026', '#Reform', '#Infrastructure',
];

function generateEngagement(leader, idx) {
  const r = (n) => seededRand(idx * 300 + n);
  const hasHandle = !!leader.handle;
  if (!hasHandle) return null;

  // Scale engagement to leader's popularity
  const popScale = Math.log10(leader.totalAll) / 10; // 0.7 - 1.0
  const tweetsPosted = Math.round(15 + r(1) * 60); // 15-75 tweets/week

  const totalLikes = Math.round(tweetsPosted * (5000 + r(2) * 80000) * popScale);
  const totalRTs = Math.round(totalLikes * (0.15 + r(3) * 0.25));
  const totalImpressions = Math.round(totalLikes * (30 + r(4) * 120));
  const totalReplies = Math.round(totalLikes * (0.2 + r(5) * 0.4));
  const totalQuotes = Math.round(totalRTs * (0.1 + r(6) * 0.3));
  const totalBookmarks = Math.round(totalLikes * (0.01 + r(7) * 0.05));
  const engagementRate = totalImpressions > 0
    ? +((totalLikes + totalRTs + totalReplies) / totalImpressions * 100).toFixed(2)
    : 0;

  return {
    totalLikes,
    totalRTs,
    totalImpressions,
    totalReplies,
    totalQuotes,
    totalBookmarks,
    engagementRate,
    tweetsPosted,
    avgLikesPerTweet: Math.round(totalLikes / tweetsPosted),
    avgRTsPerTweet: Math.round(totalRTs / tweetsPosted),
    // Breakdown: how many are original tweets, RTs, replies
    originalTweets: Math.round(tweetsPosted * (0.3 + r(8) * 0.4)),
    retweetsSent: Math.round(tweetsPosted * (0.1 + r(9) * 0.25)),
    repliesSent: 0, // computed below
  };

  // Ensure breakdown sums to tweetsPosted
  result.repliesSent = tweetsPosted - result.originalTweets - result.retweetsSent;
  if (result.repliesSent < 0) {
    result.retweetsSent = tweetsPosted - result.originalTweets;
    result.repliesSent = 0;
  }

  return result;
}

function generateTopRetweeted(leader, idx) {
  if (!leader.handle) return [];
  const r = (n) => seededRand(idx * 400 + n);
  const count = 3 + Math.floor(r(0) * 4); // 3-6
  const pool = FAKE_ACCOUNTS.filter(a => a !== leader.handle);
  const results = [];
  const used = new Set();
  for (let i = 0; i < count; i++) {
    const ai = Math.floor(r(i + 1) * pool.length);
    if (used.has(ai)) continue;
    used.add(ai);
    // Check if it's one of our leaders
    const matchedLeader = LEADERS_RAW.find(l => l.handle && l.handle.toLowerCase() === pool[ai].toLowerCase());
    results.push({
      handle: pool[ai],
      name: matchedLeader?.name || pool[ai].replace('@', '').replace(/_/g, ' '),
      count: Math.round(3 + r(i + 10) * 12),
      isLeader: !!matchedLeader,
      leaderId: matchedLeader?.id || null,
    });
  }
  return results.sort((a, b) => b.count - a.count);
}

function generateTopMentioned(leader, idx) {
  if (!leader.handle) return [];
  const r = (n) => seededRand(idx * 500 + n);
  const results = [];
  const used = new Set();

  // Add some real leaders as mentions (1-3 leaders)
  const otherLeaders = LEADERS_RAW.filter(l => l.id !== leader.id && l.handle);
  const leaderMentionCount = 1 + Math.floor(r(0) * 3);
  for (let i = 0; i < leaderMentionCount && i < otherLeaders.length; i++) {
    const li = Math.floor(r(i + 1) * otherLeaders.length);
    const mentioned = otherLeaders[li];
    if (used.has(mentioned.id)) continue;
    used.add(mentioned.id);
    results.push({
      handle: mentioned.handle,
      name: mentioned.name,
      count: Math.round(2 + r(i + 20) * 8),
      isLeader: true,
      leaderId: mentioned.id,
    });
  }

  // Add some non-leader accounts
  const pool = FAKE_ACCOUNTS.filter(a => a !== leader.handle);
  for (let i = 0; i < 5; i++) {
    const ai = Math.floor(r(i + 30) * pool.length);
    results.push({
      handle: pool[ai],
      name: pool[ai].replace('@', '').replace(/_/g, ' '),
      count: Math.round(1 + r(i + 40) * 6),
      isLeader: false,
      leaderId: null,
    });
  }

  return results.sort((a, b) => b.count - a.count).slice(0, 8);
}

function generateTopHashtags(leader, idx) {
  if (!leader.handle) return [];
  const r = (n) => seededRand(idx * 600 + n);
  const count = 5 + Math.floor(r(0) * 6); // 5-10
  const results = [];
  const used = new Set();
  for (let i = 0; i < count; i++) {
    const hi = Math.floor(r(i + 1) * FAKE_HASHTAGS.length);
    if (used.has(hi)) continue;
    used.add(hi);
    results.push({
      tag: FAKE_HASHTAGS[hi],
      count: Math.round(2 + r(i + 10) * 18),
    });
  }
  return results.sort((a, b) => b.count - a.count);
}

// --- Build full mock leaders ---

const MOCK_LEADERS = LEADERS_RAW.map((l, idx) => {
  const r = (n) => seededRand(idx * 100 + n);

  const dailyBase = l.totalAll / (76 * 30);
  const todayMentions = Math.round(dailyBase * (0.6 + r(1) * 0.8));
  const yesterdayMentions = Math.round(dailyBase * (0.6 + r(2) * 0.8));
  const dayBeforeYesterdayMentions = Math.round(dailyBase * (0.6 + r(7) * 0.8));
  const last7d = Math.round(dailyBase * 7 * (0.7 + r(3) * 0.6));
  const prev7d = Math.round(dailyBase * 7 * (0.7 + r(4) * 0.6));
  const last30d = Math.round(dailyBase * 30 * (0.7 + r(5) * 0.6));
  const prev30d = Math.round(dailyBase * 30 * (0.7 + r(6) * 0.6));

  const currentHour = new Date().getHours();
  const hourly = [];
  for (let h = 0; h <= currentHour; h++) {
    const hourWeight = h >= 8 && h <= 22 ? 1 + r(h + 10) * 0.5 : 0.3 + r(h + 10) * 0.3;
    hourly.push({
      hour: h,
      label: `${String(h).padStart(2, '0')}:00`,
      count: Math.round((todayMentions / 24) * hourWeight * (1.5 + r(h + 20) * 1)),
    });
  }

  const monthlyTimeline = [];
  const start = new Date('2020-01-01');
  const end = new Date();
  let d = new Date(start);
  const avgMonth = l.totalAll / 76;
  while (d < end) {
    const month = d.toISOString().slice(0, 7);
    const variance = 0.3 + seededRand(idx * 200 + d.getMonth() + d.getFullYear()) * 1.4;
    monthlyTimeline.push({ date: month, count: Math.round(avgMonth * variance) });
    d.setMonth(d.getMonth() + 1);
  }

  return {
    ...l,
    todayMentions,
    yesterdayMentions,
    dayBeforeYesterdayMentions,
    last7d, prev7d, last30d, prev30d,
    hourly,
    history: monthlyTimeline,
    // Engagement (null for leaders without Twitter)
    engagement: generateEngagement(l, idx),
    topRetweeted: generateTopRetweeted(l, idx),
    topMentioned: generateTopMentioned(l, idx),
    topHashtags: generateTopHashtags(l, idx),
  };
});

// ============================================================
// GETTERS
// ============================================================

function getTodaySameHoursMentions(leader) {
  return leader.hourly.reduce((sum, h) => sum + h.count, 0);
}

function getYesterdaySameHoursMentions(leader) {
  const currentHour = new Date().getHours();
  const hourFraction = (currentHour + 1) / 24;
  return Math.round(leader.yesterdayMentions * hourFraction);
}

function getMentionsForPeriod(leader, period) {
  switch (period) {
    case 'today': return getTodaySameHoursMentions(leader);
    case 'yesterday': return leader.yesterdayMentions;
    case '7d': return leader.last7d;
    case '30d': return leader.last30d;
    case 'all': return leader.totalAll;
    default: return getTodaySameHoursMentions(leader);
  }
}

function getPreviousMentions(leader, period) {
  switch (period) {
    case 'today': return getYesterdaySameHoursMentions(leader);
    case 'yesterday': return leader.dayBeforeYesterdayMentions;
    case '7d': return leader.prev7d;
    case '30d': return leader.prev30d;
    case 'all': return null;
    default: return null;
  }
}

const isCustomPeriod = (period) => typeof period === 'object' && period?.type === 'custom';

export function getLeadersForPeriod(period = 'today') {
  const periodKey = isCustomPeriod(period) ? 'custom' : period;
  return MOCK_LEADERS
    .map(l => ({
      ...l,
      mentions: getMentionsForPeriod(l, periodKey),
      prevMentions: getPreviousMentions(l, periodKey),
      change: (() => {
        if (isCustomPeriod(period)) return null;
        const curr = getMentionsForPeriod(l, periodKey);
        const prev = getPreviousMentions(l, periodKey);
        if (!prev) return null;
        return ((curr - prev) / prev) * 100;
      })(),
    }))
    .sort((a, b) => b.mentions - a.mentions);
}

export function getSpotlights(period = 'today') {
  const leaders = getLeadersForPeriod(period);
  const withChange = leaders.filter(l => l.change != null);
  const withEngagement = leaders.filter(l => l.engagement);

  return {
    // Mention spotlights
    mostMentioned: leaders[0],
    biggestRiser: withChange.reduce((best, l) => (!best || l.change > best.change) ? l : best, null),
    biggestFaller: withChange.reduce((best, l) => (!best || l.change < best.change) ? l : best, null),
    // Engagement spotlights
    mostLiked: withEngagement.sort((a, b) => b.engagement.totalLikes - a.engagement.totalLikes)[0] || null,
    mostRetweeted: withEngagement.sort((a, b) => b.engagement.totalRTs - a.engagement.totalRTs)[0] || null,
    highestEngRate: withEngagement.sort((a, b) => b.engagement.engagementRate - a.engagement.engagementRate)[0] || null,
    mostActive: withEngagement.sort((a, b) => b.engagement.tweetsPosted - a.engagement.tweetsPosted)[0] || null,
  };
}

/** Get leaders sorted by an engagement metric */
export function getEngagementRanking(metric = 'totalLikes') {
  return MOCK_LEADERS
    .filter(l => l.engagement)
    .map(l => ({ ...l, metricValue: l.engagement[metric] ?? 0 }))
    .sort((a, b) => b.metricValue - a.metricValue);
}

export function searchLeaders(query) {
  if (!query || query.length < 3) return [];
  const q = query.toLowerCase();
  return MOCK_LEADERS
    .filter(l =>
      l.name.toLowerCase().includes(q) ||
      l.country.toLowerCase().includes(q) ||
      (l.handle && l.handle.toLowerCase().includes(q))
    )
    .slice(0, 6)
    .map(l => ({
      ...l,
      change: l.yesterdayMentions > 0 ? ((l.todayMentions - l.yesterdayMentions) / l.yesterdayMentions) * 100 : 0,
    }));
}

export function getComparisonData(months = 76, leaderIds = null) {
  const ids = leaderIds || [...MOCK_LEADERS].sort((a, b) => b.totalAll - a.totalAll).slice(0, 5).map(l => l.id);
  const leaders = ids.map(id => MOCK_LEADERS.find(l => l.id === id)).filter(Boolean);
  if (leaders.length === 0) return [];
  const allMonths = leaders[0].history.map(h => h.date);
  const sliced = allMonths.slice(-months);
  return sliced.map(month => {
    const point = { date: month };
    leaders.forEach(l => {
      const h = l.history.find(h => h.date === month);
      point[l.id] = h?.count ?? 0;
    });
    return point;
  });
}

export function getLeaderById(id) {
  const l = MOCK_LEADERS.find(l => l.id === id);
  if (!l) return null;
  return {
    ...l,
    change: l.yesterdayMentions > 0 ? ((l.todayMentions - l.yesterdayMentions) / l.yesterdayMentions) * 100 : 0,
  };
}

// Hand-picked colors for high-profile leaders. For everyone else, getLeaderColor
// derives a stable HSL color from the leader id so newly added leaders pick up
// a visually distinct chart color automatically (no manual assignment needed).
export const LEADER_COLORS = {
  trump: '#ef4444',   // red
  modi: '#f59e0b',    // amber (was orange, too close to red)
  macron: '#3b82f6',  // blue
  erdogan: '#10b981', // emerald
  putin: '#8b5cf6',   // violet
};

function hashString(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return h >>> 0;
}

export function getLeaderColor(id) {
  if (LEADER_COLORS[id]) return LEADER_COLORS[id];
  const hue = hashString(id || '') % 360;
  // Mid-saturation, mid-lightness — good contrast against white background
  // and against each other when multiple leaders share a chart.
  return `hsl(${hue}, 65%, 52%)`;
}

export const PERIOD_LABELS = {
  today: 'Today', yesterday: 'Yesterday', '7d': 'Last 7 Days', '30d': 'Last 30 Days', '365d': 'Last 365 Days',
};

export const COMPARISON_LABELS = {
  today: 'vs yesterday (same hours)', yesterday: 'vs day before',
  '7d': 'vs previous 7 days', '30d': 'vs previous 30 days', all: '',
};

export const ENGAGEMENT_METRICS = [
  { key: 'tweetsPosted', label: 'Activity', icon: '📝', format: 'number' },
  { key: 'totalLikes', label: 'Likes', icon: '❤️', format: 'number' },
  { key: 'totalRTs', label: 'Retweets', icon: '🔁', format: 'number' },
  { key: 'totalImpressions', label: 'Impressions', icon: '👁', format: 'number' },
  { key: 'totalReplies', label: 'Replies', icon: '💬', format: 'number' },
  { key: 'engagementRate', label: 'Eng. Rate', icon: '📊', format: 'percent' },
];

export default MOCK_LEADERS;
