import { useState, useEffect } from 'react';
import { getLeaderById, LEADER_COLORS, PERIOD_LABELS } from '../mockData';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import LeaderSocialGraph from './LeaderSocialGraph';
import DatePicker from './DatePicker';
import { filterLeader } from '../lib/filterData';

const filterClientSide = filterLeader;

function computeTracker(tracker, { since, until }) {
  if (!tracker?.snapshots?.length) return null;
  const snapshots = tracker.snapshots;
  const latest = snapshots[snapshots.length - 1]; // always freshest
  // Growth in selected period
  let filtered = snapshots;
  if (since) filtered = filtered.filter(s => s.date >= since);
  if (until) filtered = filtered.filter(s => s.date <= until);
  let growth = null;
  if (filtered.length >= 2) {
    const first = filtered[0], last = filtered[filtered.length - 1];
    growth = {
      followers: (last.followers ?? 0) - (first.followers ?? 0),
      tweets: (last.tweets ?? 0) - (first.tweets ?? 0),
      mentionsReceived: (last.mentionsReceived ?? 0) - (first.mentionsReceived ?? 0),
      retweetsReceived: (last.retweetsReceived ?? 0) - (first.retweetsReceived ?? 0),
    };
  }
  return {
    followers: latest.followers,
    following: latest.following,
    tweetsTotal: latest.tweets,
    mentionsReceivedTotal: latest.mentionsReceived,
    retweetsReceivedTotal: latest.retweetsReceived,
    snapshotDate: latest.date,
    snapshots,
    growth,
  };
}

const TWITTER_PIC = (handle) => handle ? `https://unavatar.io/x/${handle.replace('@', '')}` : null;
const FLAG_URL = (code) => `https://flagcdn.com/48x36/${code.toLowerCase()}.png`;

function formatNumber(n) {
  if (n == null) return '—';
  return n.toLocaleString();
}

function formatCompact(n) {
  if (n == null) return '—';
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
}

function formatPrettyDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[m - 1]} ${d}, ${y}`;
}

// Cross-leader rankings for the current period. Returns an object keyed by
// metric → 1-based rank for `leaderId` (null if no comparable data).
function computeRanks(leaders, leaderId) {
  function rankBy(getter) {
    const eligible = leaders.filter(l => (getter(l) ?? null) !== null);
    if (eligible.length === 0) return null;
    const sorted = [...eligible].sort((a, b) => (getter(b) || 0) - (getter(a) || 0));
    const i = sorted.findIndex(l => l.id === leaderId);
    return i >= 0 ? i + 1 : null;
  }
  return {
    mentions: rankBy(l => l.totalMentions),
    followers: rankBy(l => l.tracker?.followers),
    tweetsLifetime: rankBy(l => l.tracker?.tweets),
    mentionsReceived: rankBy(l => l.tracker?.mentionsReceived),
    tweetsPosted: rankBy(l => l.engagement?.tweetsPosted),
    likes: rankBy(l => l.engagement?.totalLikes),
    rts: rankBy(l => l.engagement?.totalRTs),
    impressions: rankBy(l => l.engagement?.totalImpressions),
    replies: rankBy(l => l.engagement?.totalReplies),
    engRate: rankBy(l => l.engagement?.engagementRate),
  };
}

// Date helpers
function periodToDates(period) {
  const today = new Date();
  const fmt = d => d.toISOString().slice(0, 10);

  if (typeof period === 'object' && period.type === 'month') {
    const y = period.year;
    const m = String(period.month).padStart(2, '0');
    const lastDay = new Date(y, period.month, 0).getDate();
    return { since: `${y}-${m}-01`, until: `${y}-${m}-${lastDay}` };
  }

  if (typeof period === 'object' && period.type === 'year') {
    const y = period.year;
    const isCurrentYear = y === new Date().getFullYear();
    return { since: `${y}-01-01`, until: isCurrentYear ? null : `${y}-12-31` };
  }

  switch (period) {
    case 'today': return { since: fmt(today), until: null };
    case 'yesterday': {
      const y = new Date(today); y.setDate(y.getDate() - 1);
      return { since: fmt(y), until: fmt(today) };
    }
    case '7d': {
      const d = new Date(today); d.setDate(d.getDate() - 7);
      return { since: fmt(d), until: null };
    }
    case '30d': {
      const d = new Date(today); d.setDate(d.getDate() - 30);
      return { since: fmt(d), until: null };
    }
    case '365d': {
      const d = new Date(today); d.setFullYear(d.getFullYear() - 1);
      return { since: fmt(d), until: null };
    }
    default: return { since: fmt(today), until: null };
  }
}

function aggregateByMonth(data) {
  const m = {};
  for (const { date, count } of data) {
    const month = date.slice(0, 7);
    m[month] = (m[month] || 0) + count;
  }
  return Object.entries(m).sort(([a], [b]) => a.localeCompare(b)).map(([date, mentions]) => ({ date, mentions }));
}

function aggregateByQuarter(data) {
  const q = {};
  for (const { date, count } of data) {
    const year = date.slice(0, 4);
    const mo = parseInt(date.slice(5, 7) || date.slice(5));
    const quarter = `${year} Q${Math.ceil((mo || 1) / 3)}`;
    q[quarter] = (q[quarter] || 0) + count;
  }
  return Object.entries(q).sort(([a], [b]) => a.localeCompare(b)).map(([date, mentions]) => ({ date, mentions }));
}

function aggregateByYear(data) {
  const y = {};
  for (const { date, count } of data) {
    const year = date.slice(0, 4);
    y[year] = (y[year] || 0) + count;
  }
  return Object.entries(y).sort(([a], [b]) => a.localeCompare(b)).map(([date, mentions]) => ({ date, mentions }));
}

// Convert API timeline (seconds-based) to {date, count}
function timelineToDaily(timeline) {
  return (timeline || []).map(p => {
    const dateMs = (p.min || p.max) * 1000;
    return { date: new Date(dateMs).toISOString().slice(0, 10), count: p.count };
  });
}

const CHART_VIEWS = [
  { key: 'daily', label: 'Daily' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'quarterly', label: 'Quarterly' },
  { key: 'yearly', label: 'Yearly' },
];

// Available metrics for the over-time chart. 'mentions' comes from the
// mention-counts history; the rest are aggregated from the leader's own
// tweets (so they're only meaningful for leaders with a handle).
const CHART_METRICS = [
  { key: 'mentions', label: 'Mentions', source: 'history', color: '#6366f1' },
  { key: 'likes', label: 'Likes', source: 'tweets', tweetField: 'likes', color: '#ec4899' },
  { key: 'rts', label: 'Retweets', source: 'tweets', tweetField: 'rts', color: '#3b82f6' },
  { key: 'impressions', label: 'Impressions', source: 'tweets', tweetField: 'impressions', color: '#06b6d4' },
  { key: 'replies', label: 'Replies', source: 'tweets', tweetField: 'replies', color: '#14b8a6' },
];

function tweetsToDailySeries(tweets, field) {
  const byDate = {};
  for (const t of tweets || []) {
    if (!t.date) continue;
    const d = new Date(t.date * 1000).toISOString().slice(0, 10);
    byDate[d] = (byDate[d] || 0) + (t[field] || 0);
  }
  return Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));
}

export default function LeaderPage({ leaderId, onBack, onSelectLeader }) {
  const mockLeader = getLeaderById(leaderId);
  const [period, setPeriod] = useState('7d');
  const [view, setView] = useState('daily');
  const [metric, setMetric] = useState('mentions');
  const [serverData, setServerData] = useState(null);
  const [indexData, setIndexData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // index.json drives the cross-leader rankings shown next to each number.
  // Loaded once per session.
  useEffect(() => {
    fetch('/api/index.json').then(r => r.ok ? r.json() : null).then(setIndexData).catch(() => {});
  }, []);

  useEffect(() => {
    setError(null);
    setLoading(true);
    // Clear stale data immediately so the period change doesn't flash
    // the previous period's numbers/lists while the new fetch is in flight.
    setServerData(null);
    Promise.all([
      fetch(`/api/leaders/${leaderId}.json`).then(r => r.ok ? r.json() : null),
      fetch(`/api/tweets/${leaderId}.json`).then(r => r.ok ? r.json() : []).catch(() => []),
    ])
      .then(([data, tweets]) => {
        if (!data) { setLoading(false); return; }
        const { since, until } = periodToDates(period);
        const dataWithTweets = { ...data, tweets };
        const filtered = filterClientSide(dataWithTweets, since, until);
        setServerData(filtered);
        setLoading(false);
      })
      .catch(err => {
        console.warn('Fetch failed:', err.message);
        setLoading(false);
        setError('Could not load data');
      });
  }, [leaderId, period]);

  // mockData.js only covers a subset of leaders. Build the leader entirely
  // from serverData when present, falling back to mockLeader for instant
  // first paint, and finally to a minimal placeholder so the loading
  // spinner can render without crashing on `leader.name`.
  const leader = serverData ? {
    ...(mockLeader || {}),
    id: serverData.id || leaderId,
    name: serverData.name || mockLeader?.name || '',
    country: serverData.country || mockLeader?.country || '',
    countryCode: serverData.countryCode || mockLeader?.countryCode || '',
    handle: serverData.handle || mockLeader?.handle || null,
    totalAll: serverData.totalMentions ?? 0,
    engagement: serverData.engagement ?? null,
    topRetweeted: serverData.topRetweeted ?? [],
    topMentioned: serverData.topMentioned ?? [],
    topHashtags: serverData.topHashtags ?? [],
    tweets: serverData.tweets ?? [],
    tracker: computeTracker(serverData.tracker, periodToDates(period)),
    history: serverData.timeline
      ? timelineToDaily(serverData.timeline)
      : serverData.history ?? [],
  } : (mockLeader || { id: leaderId, name: '', country: '', countryCode: '', handle: null });

  // Pull the right preset out of index.json for ranking. Custom month/year
  // periods don't have a precomputed preset, so fall back to 'all'.
  const presetKey = typeof period === 'string' ? period : 'all';
  const presetLeaders = indexData?.[presetKey] || indexData?.all || [];
  const ranks = computeRanks(presetLeaders, leaderId);

  const history = leader.history || [];
  const activeMetric = CHART_METRICS.find(m => m.key === metric) || CHART_METRICS[0];

  // Pick source series for the chosen metric: mentions history vs.
  // per-tweet aggregation by date. Leaders with no handle only get mentions.
  const sourceSeries = activeMetric.source === 'history'
    ? history.map(h => ({ date: h.date, count: h.count }))
    : tweetsToDailySeries(leader.tweets, activeMetric.tweetField);

  let chartData;
  switch (view) {
    case 'daily': chartData = sourceSeries.map(h => ({ date: h.date, value: h.count })); break;
    case 'monthly': chartData = aggregateByMonth(sourceSeries).map(p => ({ date: p.date, value: p.mentions })); break;
    case 'quarterly': chartData = aggregateByQuarter(sourceSeries).map(p => ({ date: p.date, value: p.mentions })); break;
    case 'yearly': chartData = aggregateByYear(sourceSeries).map(p => ({ date: p.date, value: p.mentions })); break;
    default: chartData = sourceSeries.map(h => ({ date: h.date, value: h.count }));
  }

  const pic = TWITTER_PIC(leader.handle);
  const color = LEADER_COLORS[leader.id] || '#6366f1';
  const eng = leader.engagement;
  const periodLabel = typeof period === 'string'
    ? (PERIOD_LABELS[period] || period)
    : period?.label || `${period?.start} → ${period?.end}`;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50/30">
      {/* Sticky header with date picker */}
      <header className="bg-white/90 backdrop-blur-md border-b border-gray-200/60 sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-2.5">
          <div className="flex items-center justify-between">
            <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors group">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="group-hover:-translate-x-0.5 transition-transform">
                <path d="M10 4l-4 4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Dashboard
            </button>
            <DatePicker value={period} onChange={setPeriod} />
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-5">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-32">
            <div className="w-12 h-12 border-[3px] border-indigo-200 border-t-indigo-500 rounded-full animate-spin" />
            <p className="text-sm text-gray-500 mt-4">Loading {leader.name}…</p>
          </div>
        ) : error ? (
          <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-600">
            {error}
          </div>
        ) : (
        <>

        {/* Hero */}
        <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-5 mb-5">
          <div className="flex items-start gap-4 sm:gap-5">
            <div className="relative flex-shrink-0">
              {pic ? (
                <img src={pic} alt={leader.name} className="w-14 h-14 sm:w-18 sm:h-18 rounded-2xl object-cover bg-gray-100 ring-4 ring-gray-50" loading="lazy"
                  onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} />
              ) : null}
              <div className={`w-14 h-14 sm:w-18 sm:h-18 rounded-2xl bg-gray-100 ring-4 ring-gray-50 items-center justify-center text-xl font-bold text-gray-400 ${pic ? 'hidden' : 'flex'}`}>
                {leader.name.split(' ').map(w => w[0]).join('').slice(0, 2)}
              </div>
              {leader.countryCode && (
                <img src={FLAG_URL(leader.countryCode)} alt="" className="absolute -bottom-1 -right-1 w-6 h-4 rounded border-2 border-white object-cover" />
              )}
            </div>
            <div className="flex-1">
              <h1 className="text-xl font-bold text-gray-900">{leader.name}</h1>
              <p className="text-sm text-gray-500 flex items-center gap-2 mt-0.5">
                {leader.country}
                {leader.handle && (
                  <a href={`https://x.com/${leader.handle.replace('@', '')}`} target="_blank" rel="noopener noreferrer"
                    className="text-indigo-500 hover:text-indigo-600" onClick={e => e.stopPropagation()}>
                    {leader.handle}
                  </a>
                )}
              </p>
              <div className="mt-2 text-xs text-gray-400">
                Showing: <span className="font-medium text-gray-600">{periodLabel}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Account overview — always the LATEST snapshot (not filtered by date) */}
        {(leader.tracker || leader.totalAll != null) && (
          <div className="mb-5">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1 flex items-center gap-2">
              Account overview
              {leader.tracker?.snapshotDate && (
                <span className="text-gray-300 font-normal normal-case">· data as of {formatPrettyDate(leader.tracker.snapshotDate)}</span>
              )}
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <TrackerStat
                label="Mentions"
                value={formatCompact(leader.totalAll)}
                icon="💬"
                rank={ranks.mentions}
                highlight
              />
              <TrackerStat
                label="Followers"
                value={leader.tracker?.followers != null ? formatCompact(leader.tracker.followers) : '—'}
                growth={leader.tracker?.growth?.followers}
                icon="👥"
                rank={ranks.followers}
                highlight
              />
              <TrackerStat
                label="Following"
                value={leader.tracker?.following != null ? formatCompact(leader.tracker.following) : '—'}
                icon="➡️"
              />
              <TrackerStat
                label="F / F ratio"
                value={leader.tracker?.followers && leader.tracker?.following
                  ? (leader.tracker.followers / leader.tracker.following).toFixed(1) + 'x'
                  : '—'}
                icon="⚖️"
              />
              <TrackerStat
                label="Tweets (lifetime)"
                value={leader.tracker?.tweetsTotal != null ? formatCompact(leader.tracker.tweetsTotal) : '—'}
                growth={leader.tracker?.growth?.tweets}
                icon="📝"
                rank={ranks.tweetsLifetime}
              />
              <TrackerStat
                label="Mentions received"
                value={leader.tracker?.mentionsReceivedTotal != null ? formatCompact(leader.tracker.mentionsReceivedTotal) : '—'}
                growth={leader.tracker?.growth?.mentionsReceived}
                icon="📥"
                rank={ranks.mentionsReceived}
              />
            </div>
          </div>
        )}

        {/* Engagement stats — always shown when the leader has a handle, even if
            they didn't tweet in the selected window (so the section doesn't
            disappear unexpectedly when filtering). */}
        {leader.handle && (
          <div className="mb-5">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">
              Engagement from own tweets
            </h3>
            {eng ? (
              <>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-3">
                  <EngStat label="Tweets" value={eng.tweetsPosted} icon="📝" rank={ranks.tweetsPosted} />
                  <EngStat label="Likes" value={formatCompact(eng.totalLikes)} icon="❤️" rank={ranks.likes} />
                  <EngStat label="Retweets" value={formatCompact(eng.totalRTs)} icon="🔁" rank={ranks.rts} />
                  <EngStat label="Impressions" value={formatCompact(eng.totalImpressions)} icon="👁" rank={ranks.impressions} />
                  <EngStat label="Replies" value={formatCompact(eng.totalReplies)} icon="💬" rank={ranks.replies} />
                  <EngStat label="Eng. Rate" value={eng.engagementRate + '%'} icon="📊" highlight rank={ranks.engRate} />
                </div>

                {/* Tweet breakdown bar */}
                <div className="bg-white rounded-xl border border-gray-200/60 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-gray-700">Tweet Breakdown</span>
                    <span className="text-[11px] text-gray-400">{eng.tweetsPosted} total</span>
                  </div>
                  <div className="flex rounded-full overflow-hidden h-3 bg-gray-100">
                    {eng.originalTweets > 0 && (
                      <div className="bg-indigo-500 transition-all" style={{ width: `${(eng.originalTweets / eng.tweetsPosted) * 100}%` }} />
                    )}
                    {eng.retweetsSent > 0 && (
                      <div className="bg-emerald-400 transition-all" style={{ width: `${(eng.retweetsSent / eng.tweetsPosted) * 100}%` }} />
                    )}
                    {eng.repliesSent > 0 && (
                      <div className="bg-amber-400 transition-all" style={{ width: `${(eng.repliesSent / eng.tweetsPosted) * 100}%` }} />
                    )}
                  </div>
                  <div className="flex gap-4 mt-2">
                    <LegendItem color="bg-indigo-500" label="Original" value={eng.originalTweets} />
                    <LegendItem color="bg-emerald-400" label="Retweets" value={eng.retweetsSent} />
                    <LegendItem color="bg-amber-400" label="Replies" value={eng.repliesSent} />
                  </div>
                </div>
              </>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200/60 p-8 text-center">
                <div className="text-2xl mb-2 opacity-40">🤫</div>
                <p className="text-sm text-gray-500">
                  {leader.name.split(' ')[0]} didn't tweet in <span className="font-medium text-gray-700">{periodLabel}</span>.
                </p>
                <p className="text-[11px] text-gray-400 mt-1">Try widening the date range to see engagement.</p>
              </div>
            )}
          </div>
        )}

        {/* Chart */}
        {chartData.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-5 mb-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">{activeMetric.label} Over Time</h2>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  {activeMetric.source === 'tweets' ? `Aggregated from ${leader.name.split(' ')[0]}'s own tweets` : 'Mentions across X/Twitter'}
                </p>
              </div>
              <div className="flex gap-0.5 bg-gray-100 rounded-lg p-0.5">
                {CHART_VIEWS.map(v => (
                  <button key={v.key} onClick={() => setView(v.key)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                      view === v.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}>
                    {v.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Metric selector — hidden for leaders with no handle (no tweet data) */}
            {leader.handle && (
              <div className="flex flex-wrap gap-1.5 mb-4">
                {CHART_METRICS.map(m => (
                  <button key={m.key} onClick={() => setMetric(m.key)}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-all border ${
                      metric === m.key
                        ? 'bg-gray-900 text-white border-gray-900'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                    }`}>
                    {m.label}
                  </button>
                ))}
              </div>
            )}

            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="leaderGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={activeMetric.color} stopOpacity={0.2} />
                    <stop offset="100%" stopColor={activeMetric.color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} tickFormatter={formatCompact} />
                <Tooltip
                  contentStyle={{ backgroundColor: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: '12px' }}
                  formatter={(val) => [formatNumber(val), activeMetric.label]}
                />
                <Area type="monotone" dataKey="value" stroke={activeMetric.color} strokeWidth={2} fill="url(#leaderGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Best tweets ranking + photo gallery */}
        {leader.handle && leader.tweets?.length > 0 && (
          <BestTweets tweets={leader.tweets} leaderHandle={leader.handle} periodLabel={periodLabel} />
        )}

        {/* Social graph */}
        <LeaderSocialGraph leader={leader} onSelectLeader={onSelectLeader} />
        </>
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------
// Best tweets ranking + photo gallery
// ---------------------------------------------------------------
function BestTweetCard({ tweet, leaderHandle }) {
  const tweetUrl = tweet.id
    ? `https://x.com/${leaderHandle.replace('@', '')}/status/${tweet.id}`
    : null;
  return (
    <a
      href={tweetUrl || '#'}
      target="_blank"
      rel="noopener noreferrer"
      className="block bg-white rounded-xl border border-gray-200/60 p-3.5 hover:border-indigo-300 hover:shadow-md transition-all group"
    >
      <p className="text-[13px] text-gray-800 leading-snug line-clamp-3 mb-2.5 group-hover:text-gray-900">
        {tweet.text}
      </p>
      {tweet.images?.length > 0 && (
        <div className="flex gap-1 mb-2.5 -mx-1">
          {tweet.images.slice(0, 4).map((src, i) => (
            <div key={i} className="flex-1 aspect-square rounded-lg overflow-hidden bg-gray-100">
              <img src={src.replace('http://', 'https://')} alt="" loading="lazy"
                className="w-full h-full object-cover" />
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-3 text-[11px] text-gray-400">
        <span title="Likes">❤️ {formatCompact(tweet.likes)}</span>
        <span title="Retweets">🔁 {formatCompact(tweet.rts)}</span>
        <span title="Replies">💬 {formatCompact(tweet.replies)}</span>
        <span className="ml-auto text-[10px]">
          {tweet.date ? new Date(tweet.date * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}
        </span>
      </div>
    </a>
  );
}

function PhotoTile({ src, tweet, leaderHandle }) {
  const tweetUrl = tweet?.id
    ? `https://x.com/${leaderHandle.replace('@', '')}/status/${tweet.id}`
    : null;
  return (
    <a
      href={tweetUrl || '#'}
      target="_blank"
      rel="noopener noreferrer"
      className="relative aspect-square rounded-xl overflow-hidden bg-gray-100 group block"
      title={tweet?.text?.slice(0, 120) || ''}
    >
      <img src={src.replace('http://', 'https://')} alt="" loading="lazy"
        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2">
        <div className="flex items-center gap-2 text-white text-[11px] font-medium">
          <span>❤️ {formatCompact(tweet?.likes)}</span>
          <span>🔁 {formatCompact(tweet?.rts)}</span>
        </div>
      </div>
    </a>
  );
}

function BestTweets({ tweets, leaderHandle, periodLabel }) {
  // Only consider original tweets (not RTs/replies) — those are what
  // the leader actually wrote and are meaningful for "best tweet" ranking.
  const originals = tweets.filter(t => t.type === 'original');

  const topByLikes = [...originals]
    .sort((a, b) => (b.likes || 0) - (a.likes || 0))
    .slice(0, 5);

  const topByRts = [...originals]
    .sort((a, b) => (b.rts || 0) - (a.rts || 0))
    .slice(0, 5);

  // Photo gallery: every original tweet's images, sorted by engagement
  const photoEntries = [];
  for (const t of originals) {
    if (!t.images?.length) continue;
    const score = (t.likes || 0) + (t.rts || 0) * 5; // weight RTs higher (rarer signal)
    for (const src of t.images) {
      photoEntries.push({ src, tweet: t, score });
    }
  }
  photoEntries.sort((a, b) => b.score - a.score);
  const topPhotos = photoEntries.slice(0, 12);

  if (originals.length === 0) return null;

  return (
    <>
      {/* Best tweets — two columns: most liked + most retweeted */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
        <div>
          <div className="flex items-center gap-2 mb-2 px-1">
            <span className="text-base">❤️</span>
            <h3 className="text-sm font-semibold text-gray-900">Most Liked Tweets</h3>
          </div>
          <div className="space-y-2">
            {topByLikes.map((t, i) => (
              <BestTweetCard key={t.id || i} tweet={t} leaderHandle={leaderHandle} />
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center gap-2 mb-2 px-1">
            <span className="text-base">🔁</span>
            <h3 className="text-sm font-semibold text-gray-900">Most Retweeted Tweets</h3>
          </div>
          <div className="space-y-2">
            {topByRts.map((t, i) => (
              <BestTweetCard key={t.id || i} tweet={t} leaderHandle={leaderHandle} />
            ))}
          </div>
        </div>
      </div>

      {/* Photo gallery */}
      <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-5 mb-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-base">📸</span>
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Top Photos</h3>
            <p className="text-[11px] text-gray-400">Most engaging images posted in {periodLabel}</p>
          </div>
        </div>
        {topPhotos.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-400">
            No photos in this period yet.
            <p className="text-[11px] mt-1 text-gray-300">
              (Image data is being backfilled — try again after the next data refresh.)
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {topPhotos.map((p, i) => (
              <PhotoTile key={`${p.tweet.id}-${i}`} src={p.src} tweet={p.tweet} leaderHandle={leaderHandle} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function PageStat({ label, value, color }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-3.5">
      <div className="text-[10px] text-gray-400 uppercase tracking-wider font-medium mb-1">{label}</div>
      <div className="text-lg font-bold" style={color ? { color } : {}}>{value}</div>
    </div>
  );
}

function RankBadge({ rank, size = 'sm' }) {
  if (!rank) return null;
  const isPodium = rank <= 3;
  const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null;
  const cls = isPodium
    ? 'bg-amber-50 text-amber-700 border-amber-200/60'
    : 'bg-gray-50 text-gray-500 border-gray-200/60';
  const sizeCls = size === 'xs' ? 'text-[9px] px-1 py-0' : 'text-[10px] px-1.5 py-0.5';
  return (
    <span className={`inline-flex items-center gap-0.5 font-bold rounded-full border ${cls} ${sizeCls}`}
      title={`Rank #${rank} of all leaders in this period`}>
      {medal || `#${rank}`}
    </span>
  );
}

function TrackerStat({ label, value, growth, icon, highlight, rank }) {
  const hasGrowth = growth != null && growth !== 0;
  const isUp = (growth ?? 0) >= 0;
  return (
    <div className={`rounded-2xl border shadow-sm p-3.5 ${highlight ? 'bg-gradient-to-br from-indigo-50 to-purple-50/30 border-indigo-200/50' : 'bg-white border-gray-200/60'}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">{label}</span>
        <span className="text-xs">{icon}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <div className={`text-lg font-bold ${highlight ? 'text-indigo-600' : 'text-gray-900'}`}>{value}</div>
        <RankBadge rank={rank} />
      </div>
      {hasGrowth && (
        <div className={`text-[11px] font-semibold mt-0.5 ${isUp ? 'text-emerald-600' : 'text-red-500'}`}>
          {isUp ? '↑' : '↓'} {Math.abs(growth).toLocaleString()} in period
        </div>
      )}
    </div>
  );
}

function EngStat({ label, value, icon, highlight, rank }) {
  return (
    <div className={`rounded-xl p-2.5 border text-center relative ${highlight ? 'bg-indigo-50/50 border-indigo-200/50' : 'bg-white border-gray-200/60'}`}>
      {rank && (
        <span className="absolute top-1 right-1">
          <RankBadge rank={rank} size="xs" />
        </span>
      )}
      <div className="text-sm mb-0.5">{icon}</div>
      <div className={`text-sm font-bold ${highlight ? 'text-indigo-600' : 'text-gray-900'}`}>{value}</div>
      <div className="text-[9px] text-gray-400 uppercase tracking-wider">{label}</div>
    </div>
  );
}

function LegendItem({ color, label, value }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-2.5 h-2.5 rounded-full ${color}`} />
      <span className="text-[11px] text-gray-600">{label} <span className="font-semibold">{value}</span></span>
    </div>
  );
}
