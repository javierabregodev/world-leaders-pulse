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

export default function LeaderPage({ leaderId, onBack, onSelectLeader }) {
  const mockLeader = getLeaderById(leaderId);
  const [period, setPeriod] = useState('7d');
  const [view, setView] = useState('monthly');
  const [serverData, setServerData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Fetch data when period or leader changes
  // Presets use cached data filtered server-side (instant).
  // "All Time" also uses cached data. Only "Custom" hits the live API.
  // Everything uses cached data — no live API calls needed.
  const needsLiveQuery = false;

  useEffect(() => {
    setError(null);
    // Load leader detail JSON once, then filter client-side based on period
    setLoading(true);
    Promise.all([
      fetch(`/api/leaders/${leaderId}.json`).then(r => r.ok ? r.json() : null),
      fetch(`/api/tweets/${leaderId}.json`).then(r => r.ok ? r.json() : []).catch(() => []),
    ])
      .then(([data, tweets]) => {
        if (!data) { setLoading(false); return; }
        // Filter history + tweets by period
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

  if (!mockLeader) return null;

  // Use server data if available, otherwise fall back to mock (basic info only)
  const leader = serverData ? {
    ...mockLeader,
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
  } : mockLeader;

  const history = leader.history || [];
  let chartData;
  switch (view) {
    case 'daily': chartData = history.map(h => ({ date: h.date, mentions: h.count })); break;
    case 'monthly': chartData = aggregateByMonth(history); break;
    case 'quarterly': chartData = aggregateByQuarter(history); break;
    case 'yearly': chartData = aggregateByYear(history); break;
    default: chartData = history.map(h => ({ date: h.date, mentions: h.count }));
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
        {/* Loading indicator */}
        {loading && (
          <div className="mb-4 bg-white rounded-2xl border border-indigo-200/50 shadow-sm p-5 flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center flex-shrink-0">
              <div className="w-5 h-5 border-2 border-indigo-200 border-t-indigo-500 rounded-full animate-spin" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">Fetching live data</p>
              <p className="text-xs text-gray-400 mt-0.5">Querying Tweet Binder for {periodLabel}... ~20 seconds</p>
            </div>
          </div>
        )}

        {error && !loading && (
          <div className="mb-4 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-600">
            {error}
          </div>
        )}

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
                <span className="text-gray-300 font-normal normal-case">· snapshot {leader.tracker.snapshotDate}</span>
              )}
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <TrackerStat
                label="Mentions"
                value={formatCompact(leader.totalAll)}
                icon="💬"
                highlight
              />
              <TrackerStat
                label="Followers"
                value={leader.tracker?.followers != null ? formatCompact(leader.tracker.followers) : '—'}
                growth={leader.tracker?.growth?.followers}
                icon="👥"
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
              />
              <TrackerStat
                label="Mentions received"
                value={leader.tracker?.mentionsReceivedTotal != null ? formatCompact(leader.tracker.mentionsReceivedTotal) : '—'}
                growth={leader.tracker?.growth?.mentionsReceived}
                icon="📥"
              />
            </div>
          </div>
        )}

        {/* Engagement stats */}
        {eng && (
          <div className="mb-5">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">
              Engagement from own tweets
            </h3>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-3">
              <EngStat label="Tweets" value={eng.tweetsPosted} icon="📝" />
              <EngStat label="Likes" value={formatCompact(eng.totalLikes)} icon="❤️" />
              <EngStat label="Retweets" value={formatCompact(eng.totalRTs)} icon="🔁" />
              <EngStat label="Impressions" value={formatCompact(eng.totalImpressions)} icon="👁" />
              <EngStat label="Replies" value={formatCompact(eng.totalReplies)} icon="💬" />
              <EngStat label="Eng. Rate" value={eng.engagementRate + '%'} icon="📊" highlight />
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
          </div>
        )}

        {/* Chart */}
        {chartData.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-5 mb-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-900">Mentions Over Time</h2>
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
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="leaderGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity={0.2} />
                    <stop offset="100%" stopColor={color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} tickFormatter={formatCompact} />
                <Tooltip
                  contentStyle={{ backgroundColor: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: '12px' }}
                  formatter={(val) => [formatNumber(val), 'Mentions']}
                />
                <Area type="monotone" dataKey="mentions" stroke={color} strokeWidth={2} fill="url(#leaderGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Social graph */}
        <LeaderSocialGraph leader={leader} onSelectLeader={onSelectLeader} />
      </main>
    </div>
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

function TrackerStat({ label, value, growth, icon, highlight }) {
  const hasGrowth = growth != null && growth !== 0;
  const isUp = (growth ?? 0) >= 0;
  return (
    <div className={`rounded-2xl border shadow-sm p-3.5 ${highlight ? 'bg-gradient-to-br from-indigo-50 to-purple-50/30 border-indigo-200/50' : 'bg-white border-gray-200/60'}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">{label}</span>
        <span className="text-xs">{icon}</span>
      </div>
      <div className={`text-lg font-bold ${highlight ? 'text-indigo-600' : 'text-gray-900'}`}>{value}</div>
      {hasGrowth && (
        <div className={`text-[11px] font-semibold mt-0.5 ${isUp ? 'text-emerald-600' : 'text-red-500'}`}>
          {isUp ? '↑' : '↓'} {Math.abs(growth).toLocaleString()} in period
        </div>
      )}
    </div>
  );
}

function EngStat({ label, value, icon, highlight }) {
  return (
    <div className={`rounded-xl p-2.5 border text-center ${highlight ? 'bg-indigo-50/50 border-indigo-200/50' : 'bg-white border-gray-200/60'}`}>
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
