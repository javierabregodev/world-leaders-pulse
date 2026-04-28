import { useState, useRef, useEffect, useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { LEADER_COLORS, getLeaderColor } from '../mockData';
import MOCK_LEADERS from '../mockData';
import { interpolateTrackerToDaily } from '../lib/interpolate';

const ALL_COLORS = [
  '#ef4444', '#f59e0b', '#3b82f6', '#10b981', '#8b5cf6',
  '#ec4899', '#06b6d4', '#eab308', '#f43f5e', '#14b8a6',
  '#6366f1', '#84cc16', '#a855f7', '#22d3ee', '#fb923c',
];

const TWITTER_PIC = (handle) => handle ? `https://unavatar.io/x/${handle.replace('@', '')}` : null;
const FLAG_URL = (code) => `https://flagcdn.com/16x12/${code.toLowerCase()}.png`;

// Same metric catalog the leader detail uses, kept in sync visually so a
// user moves between dashboard and ficha without re-learning anything.
const CHART_METRICS = [
  { key: 'mentions',     label: 'Mentions',     source: 'history' },
  { key: 'tweetsPosted', label: 'Tweets posted', source: 'tweetsCount' },
  { key: 'followers',    label: 'Followers',    source: 'tracker', trackerField: 'followers' },
  { key: 'rtsReceived',  label: 'RTs received', source: 'rtsReceivedHistory' },
  { key: 'rtsSent',      label: 'Retweets sent', source: 'tweetType', tweetType: 'retweet' },
  { key: 'likes',        label: 'Likes',        source: 'tweets', tweetField: 'likes' },
  { key: 'impressions',  label: 'Impressions',  source: 'tweets', tweetField: 'impressions' },
  { key: 'replies',      label: 'Replies',      source: 'tweets', tweetField: 'replies' },
];

function formatCompact(n) {
  if (n == null) return '—';
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K';
  return n.toString();
}

function getColorForLeader(id, index) {
  return LEADER_COLORS[id] || getLeaderColor(id) || ALL_COLORS[index % ALL_COLORS.length];
}

function periodToDates(period) {
  const today = new Date();
  const fmt = d => d.toISOString().slice(0, 10);
  if (typeof period === 'object' && period?.type === 'month') {
    const y = period.year;
    const m = String(period.month).padStart(2, '0');
    const lastDay = new Date(y, period.month, 0).getDate();
    return { since: `${y}-${m}-01`, until: `${y}-${m}-${lastDay}` };
  }
  if (typeof period === 'object' && period?.type === 'year') {
    const y = period.year;
    const isCurrentYear = y === new Date().getFullYear();
    return { since: `${y}-01-01`, until: isCurrentYear ? null : `${y}-12-31` };
  }
  switch (period) {
    case 'today':     return { since: fmt(today), until: null };
    case 'yesterday': { const d = new Date(today); d.setDate(d.getDate() - 1); return { since: fmt(d), until: fmt(today) }; }
    case '7d':        { const d = new Date(today); d.setDate(d.getDate() - 7); return { since: fmt(d), until: null }; }
    case '30d':       { const d = new Date(today); d.setDate(d.getDate() - 30); return { since: fmt(d), until: null }; }
    case '365d':      { const d = new Date(today); d.setFullYear(d.getFullYear() - 1); return { since: fmt(d), until: null }; }
    case 'all':       return { since: null, until: null };
    default:          return { since: fmt(today), until: null };
  }
}

// For the X axis: with very short windows show every day, otherwise drop
// to monthly buckets so the line stays readable. Tracker (cumulative
// point-in-time) bypasses bucketing entirely — daily values are sampled.
function pickGranularity(since, until) {
  if (!since) return 'monthly';
  const start = new Date(since + 'T00:00:00Z');
  const end = until ? new Date(until + 'T00:00:00Z') : new Date();
  const days = Math.max(1, Math.round((end - start) / 86400000));
  if (days <= 60) return 'daily';
  if (days <= 365 * 2) return 'monthly';
  return 'quarterly';
}

function aggregateSeries(series, granularity) {
  if (granularity === 'daily') {
    return series.map(p => ({ date: p.date, count: p.count }));
  }
  const buckets = {};
  for (const p of series) {
    let key;
    if (granularity === 'monthly') key = (p.date || '').slice(0, 7);
    else if (granularity === 'quarterly') {
      const y = p.date.slice(0, 4);
      const m = parseInt(p.date.slice(5, 7), 10);
      key = `${y} Q${Math.ceil(m / 3)}`;
    } else key = p.date;
    if (!key) continue;
    buckets[key] = (buckets[key] || 0) + (p.count || 0);
  }
  return Object.entries(buckets).sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count }));
}

function tweetsCountByDay(tweets) {
  const byDate = {};
  for (const t of tweets || []) {
    if (!t.date) continue;
    const d = new Date(t.date * 1000).toISOString().slice(0, 10);
    byDate[d] = (byDate[d] || 0) + 1;
  }
  return Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));
}

function tweetsTypeCountByDay(tweets, type) {
  const byDate = {};
  for (const t of tweets || []) {
    if (!t.date || t.type !== type) continue;
    const d = new Date(t.date * 1000).toISOString().slice(0, 10);
    byDate[d] = (byDate[d] || 0) + 1;
  }
  return Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));
}

function tweetsFieldByDay(tweets, field) {
  const byDate = {};
  for (const t of tweets || []) {
    if (!t.date) continue;
    const d = new Date(t.date * 1000).toISOString().slice(0, 10);
    byDate[d] = (byDate[d] || 0) + (t[field] || 0);
  }
  return Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));
}

function trackerToSeries(snapshots, field) {
  return (snapshots || [])
    .filter(s => s.date && s[field] != null)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(s => ({ date: s.date, count: s[field] }));
}

function filterRange(series, since, until) {
  return (series || []).filter(p => (!since || p.date >= since) && (!until || p.date <= until));
}

export default function ComparisonChart({ period }) {
  const [selectedIds, setSelectedIds] = useState(['trump', 'modi', 'macron', 'erdogan', 'putin']);
  const [metric, setMetric] = useState('mentions');
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [leaderDetails, setLeaderDetails] = useState({}); // id → leader json
  const [leaderTweets, setLeaderTweets] = useState({});   // id → tweets[] (lazy)
  const addRef = useRef(null);

  const activeMetric = CHART_METRICS.find(m => m.key === metric) || CHART_METRICS[0];
  const needsTweets = ['tweets', 'tweetsCount', 'tweetType'].includes(activeMetric.source);

  useEffect(() => {
    const close = (e) => { if (addRef.current && !addRef.current.contains(e.target)) setShowAddMenu(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  // Always fetch leader detail (history, tracker, rts received) — small.
  useEffect(() => {
    selectedIds.forEach(id => {
      if (leaderDetails[id]) return;
      fetch(`/api/leaders/${id}.json`)
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data) setLeaderDetails(prev => ({ ...prev, [id]: data })); })
        .catch(() => {});
    });
  }, [selectedIds]);

  // Tweets are heavier — only fetch when a tweet-derived metric is active.
  useEffect(() => {
    if (!needsTweets) return;
    selectedIds.forEach(id => {
      if (leaderTweets[id]) return;
      fetch(`/api/tweets/${id}.json`)
        .then(r => r.ok ? r.json() : [])
        .then(data => setLeaderTweets(prev => ({ ...prev, [id]: data || [] })))
        .catch(() => setLeaderTweets(prev => ({ ...prev, [id]: [] })));
    });
  }, [selectedIds, metric, needsTweets]);

  const { since, until } = periodToDates(period);
  const granularity = pickGranularity(since, until);
  const isCumulative = activeMetric.source === 'tracker';

  // Build per-leader series in the chosen granularity, scoped to the period.
  const leaderSeries = useMemo(() => {
    const result = {};
    for (const id of selectedIds) {
      const detail = leaderDetails[id];
      if (!detail) { result[id] = []; continue; }
      let raw;
      if (activeMetric.source === 'history') {
        raw = (detail.history || []).map(h => ({ date: h.date, count: h.count }));
      } else if (activeMetric.source === 'rtsReceivedHistory') {
        raw = (detail.rtsReceivedHistory || []).map(h => ({ date: h.date, count: h.count }));
      } else if (activeMetric.source === 'tracker') {
        // Apply the same daily interpolation used on the leader detail
        // page so 'Last 7/30 Days' isn't a single-point line.
        const interpolated = interpolateTrackerToDaily(detail.tracker, detail.history);
        raw = trackerToSeries(interpolated?.snapshots, activeMetric.trackerField);
      } else if (activeMetric.source === 'tweetsCount') {
        raw = tweetsCountByDay(leaderTweets[id]);
      } else if (activeMetric.source === 'tweetType') {
        raw = tweetsTypeCountByDay(leaderTweets[id], activeMetric.tweetType);
      } else if (activeMetric.source === 'tweets') {
        raw = tweetsFieldByDay(leaderTweets[id], activeMetric.tweetField);
      } else raw = [];

      raw = filterRange(raw, since, until);
      result[id] = isCumulative ? raw.map(p => ({ date: p.date, count: p.count })) : aggregateSeries(raw, granularity);
    }
    return result;
  }, [selectedIds, leaderDetails, leaderTweets, activeMetric, since, until, granularity, isCumulative]);

  // Merge per-leader series on a shared X axis.
  const data = useMemo(() => {
    const allKeys = new Set();
    for (const id of selectedIds) for (const p of leaderSeries[id] || []) allKeys.add(p.date);
    const sorted = [...allKeys].sort();
    return sorted.map(k => {
      const point = { date: k };
      for (const id of selectedIds) {
        const found = (leaderSeries[id] || []).find(p => p.date === k);
        point[id] = found ? found.count : 0;
      }
      return point;
    });
  }, [selectedIds, leaderSeries]);

  function addLeader(id) {
    if (!selectedIds.includes(id)) setSelectedIds(prev => [...prev, id]);
    setShowAddMenu(false); setAddSearch('');
  }
  function removeLeader(id) {
    if (selectedIds.length > 1) setSelectedIds(prev => prev.filter(x => x !== id));
  }

  const availableToAdd = MOCK_LEADERS.filter(l => !selectedIds.includes(l.id));
  const filteredAdd = addSearch.length >= 1
    ? availableToAdd.filter(l => l.name.toLowerCase().includes(addSearch.toLowerCase()) || l.country.toLowerCase().includes(addSearch.toLowerCase()))
    : availableToAdd;

  return (
    <div>
      <div className="flex items-start justify-between mb-3 flex-col sm:flex-row gap-2">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Leader Comparison · {activeMetric.label}</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {granularity === 'daily' ? 'Daily' : granularity === 'monthly' ? 'Monthly' : 'Quarterly'}
            {' '}— click a chip's × to remove, search to add others
          </p>
        </div>
      </div>

      {/* Metric selector */}
      <div className="flex flex-wrap gap-1.5 mb-3">
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

      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {selectedIds.map((id, i) => {
          const leader = MOCK_LEADERS.find(l => l.id === id) || leaderDetails[id];
          if (!leader) return null;
          const color = getColorForLeader(id, i);
          const pic = TWITTER_PIC(leader.handle);
          return (
            <div
              key={id}
              className="flex items-center gap-1.5 pl-1 pr-1.5 py-0.5 rounded-full border border-gray-200 bg-white shadow-sm text-xs font-medium text-gray-700 group"
            >
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
              {pic ? (
                <img src={pic} alt="" className="w-4 h-4 rounded-full object-cover" loading="lazy"
                  onError={(e) => { e.target.style.display = 'none'; }} />
              ) : null}
              <span className="truncate max-w-[80px]">{leader.name?.split(' ').pop()}</span>
              {selectedIds.length > 1 && (
                <button
                  onClick={(e) => { e.stopPropagation(); removeLeader(id); }}
                  className="w-3.5 h-3.5 rounded-full bg-gray-100 hover:bg-red-100 text-gray-400 hover:text-red-500 flex items-center justify-center text-[9px] transition-colors"
                >
                  ×
                </button>
              )}
            </div>
          );
        })}

        <div className="relative" ref={addRef}>
          <button
            onClick={() => { setShowAddMenu(!showAddMenu); setAddSearch(''); }}
            className="flex items-center gap-1 px-2.5 py-1 rounded-full border border-dashed border-gray-300 text-xs font-medium text-gray-400 hover:text-indigo-500 hover:border-indigo-300 transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            Add leader
          </button>
          {showAddMenu && (
            <div className="absolute top-full mt-1.5 left-0 bg-white rounded-xl border border-gray-200 shadow-xl z-30 w-56 overflow-hidden">
              <div className="p-2 border-b border-gray-100">
                <input
                  type="text"
                  placeholder="Search..."
                  value={addSearch}
                  onChange={(e) => setAddSearch(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 placeholder:text-gray-300"
                  autoFocus
                />
              </div>
              <div className="max-h-48 overflow-y-auto">
                {filteredAdd.slice(0, 10).map(l => (
                  <button
                    key={l.id}
                    onClick={() => addLeader(l.id)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-indigo-50/50 transition-colors"
                  >
                    {l.countryCode && (
                      <img src={FLAG_URL(l.countryCode)} alt="" className="w-4 h-3 rounded-sm object-cover flex-shrink-0" />
                    )}
                    <span className="text-xs text-gray-700 truncate">{l.name}</span>
                  </button>
                ))}
                {filteredAdd.length === 0 && (
                  <div className="px-3 py-3 text-xs text-gray-400 text-center">No more leaders to add</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={data}>
          <defs>
            {selectedIds.map((id, i) => (
              <linearGradient key={id} id={`cg-${id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={getColorForLeader(id, i)} stopOpacity={0.12} />
                <stop offset="100%" stopColor={getColorForLeader(id, i)} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="date" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} interval="preserveStartEnd" />
          <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} tickFormatter={formatCompact} />
          <Tooltip
            contentStyle={{
              backgroundColor: 'white', border: '1px solid #e2e8f0', borderRadius: '12px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: '12px',
            }}
            formatter={(val, name) => {
              const leader = MOCK_LEADERS.find(l => l.id === name) || leaderDetails[name];
              return [formatCompact(val), leader?.name?.split(' ').pop() || name];
            }}
          />
          {selectedIds.map((id, i) => (
            <Area
              key={id}
              type="monotone"
              dataKey={id}
              stroke={getColorForLeader(id, i)}
              strokeWidth={1.5}
              fill={`url(#cg-${id})`}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
