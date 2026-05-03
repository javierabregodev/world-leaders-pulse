import { useState, useEffect, useMemo } from 'react';
import { PERIOD_LABELS } from '../mockData';
import DatePicker from './DatePicker';
import SearchDropdown from './SearchDropdown';
import SpotlightCards from './SpotlightCards';
import ComparisonChart from './ComparisonChart';
import RankingList from './RankingList';

function formatCompact(n) {
  if (n == null) return '—';
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

function getTimeInfo() {
  const now = new Date();
  const hours = now.getHours();
  const dayName = now.toLocaleDateString('en-US', { weekday: 'long' });
  const dateStr = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
  return { hours, dayName, dateStr, timeStr, pct: Math.round((hours / 24) * 100) };
}

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
    return { since: `${y}-01-01`, until: y === today.getFullYear() ? null : `${y}-12-31` };
  }

  switch (period) {
    case 'today': return { since: fmt(today), until: null };
    case 'yesterday': { const y = new Date(today); y.setDate(y.getDate() - 1); return { since: fmt(y), until: fmt(today) }; }
    case '7d': { const d = new Date(today); d.setDate(d.getDate() - 7); return { since: fmt(d), until: null }; }
    case '30d': { const d = new Date(today); d.setDate(d.getDate() - 30); return { since: fmt(d), until: null }; }
    case '365d': { const d = new Date(today); d.setFullYear(d.getFullYear() - 1); return { since: fmt(d), until: null }; }
    default: return { since: fmt(today), until: null };
  }
}

export default function Dashboard({ onSelectLeader }) {
  const [period, setPeriod] = useState('30d');
  const [timeInfo, setTimeInfo] = useState(getTimeInfo());
  const [leaders, setLeaders] = useState([]);

  // Auto-refresh time every 60s
  useEffect(() => {
    const interval = setInterval(() => setTimeInfo(getTimeInfo()), 60000);
    return () => clearInterval(interval);
  }, []);

  // Load index.json once (all presets precomputed)
  const [indexData, setIndexData] = useState(null);
  useEffect(() => {
    fetch('/api/index.json')
      .then(r => r.ok ? r.json() : null)
      .then(data => setIndexData(data))
      .catch(() => {});
  }, []);

  // Pick the right preset based on current period
  useEffect(() => {
    if (!indexData) return;
    const key = typeof period === 'string' ? period : null;
    if (key && indexData[key]) {
      setLeaders(indexData[key]);
    } else {
      // Month/year selector: filter 'all' by date client-side from history
      // For now, default to '365d' for month/year (precomputed aggregates unavailable)
      setLeaders(indexData['all'] || []);
    }
  }, [indexData, period]);

  // Compute spotlights from server data
  const spotlights = useMemo(() => {
    const withMentions = leaders
      .filter(l => l.totalMentions > 0)
      .sort((a, b) => (b.totalMentions || 0) - (a.totalMentions || 0));
    const withEngagement = leaders.filter(l => l.engagement);

    const mostMentioned = withMentions[0] ? { ...withMentions[0], mentions: withMentions[0].totalMentions } : null;

    // For riser/faller we'd need previous period data — skip for now, show engagement spotlights
    const mostLiked = [...withEngagement].sort((a, b) => (b.engagement?.totalLikes || 0) - (a.engagement?.totalLikes || 0))[0] || null;
    const mostRetweeted = [...withEngagement].sort((a, b) => (b.engagement?.totalRTs || 0) - (a.engagement?.totalRTs || 0))[0] || null;
    const highestEngRate = [...withEngagement].sort((a, b) => (b.engagement?.engagementRate || 0) - (a.engagement?.engagementRate || 0))[0] || null;
    const mostActive = [...withEngagement].sort((a, b) => (b.engagement?.tweetsPosted || 0) - (a.engagement?.tweetsPosted || 0))[0] || null;
    const mostReplies = [...withEngagement].sort((a, b) => (b.engagement?.totalReplies || 0) - (a.engagement?.totalReplies || 0))[0] || null;
    const mostImpressions = [...withEngagement].sort((a, b) => (b.engagement?.totalImpressions || 0) - (a.engagement?.totalImpressions || 0))[0] || null;
    // Top Performer: highest avg likes per tweet (min 10 tweets to avoid outliers)
    const mostProductive = [...withEngagement]
      .filter(l => (l.engagement?.tweetsPosted || 0) >= 10)
      .sort((a, b) => (b.engagement?.avgLikesPerTweet || 0) - (a.engagement?.avgLikesPerTweet || 0))[0] || null;

    return { mostMentioned, mostLiked, mostRetweeted, highestEngRate, mostActive, mostReplies, mostImpressions, mostProductive };
  }, [leaders]);

  // Map leaders for the ranking table
  const tableLeaders = useMemo(() =>
    leaders.map(l => ({
      ...l,
      mentions: l.totalMentions || 0,
    })).sort((a, b) => b.mentions - a.mentions),
  [leaders]);

  const totalMentions = tableLeaders.reduce((s, l) => s + l.mentions, 0);
  const periodLabel = typeof period === 'string' ? (PERIOD_LABELS[period] || period) : (period?.label || '');
  const isToday = period === 'today';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50/30">
      {/* === STICKY HEADER === */}
      <header className="bg-white/90 backdrop-blur-md border-b border-gray-200/60 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between py-2.5">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold shadow-lg shadow-indigo-500/25">
                WL
              </div>
              <h1 className="text-base font-bold text-gray-900 leading-tight">World Leaders Pulse</h1>
            </div>
            <div className="flex items-center gap-3">
              <FreshnessIndicator meta={indexData?._meta} />
              <span className="live-badge flex items-center gap-1.5 text-[11px] text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full font-semibold">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
                Live
              </span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pb-2.5">
            <div className="flex items-center gap-3">
              {isToday ? (
                <div className="flex items-center gap-2.5">
                  <div className="text-sm font-semibold text-gray-900">{timeInfo.dayName}, {timeInfo.dateStr}</div>
                  <div className="flex items-center gap-1.5 bg-indigo-50 px-2 py-0.5 rounded-full">
                    <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                      <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${timeInfo.pct}%` }} />
                    </div>
                    <span className="text-[11px] font-medium text-indigo-600">{timeInfo.hours}/24h</span>
                  </div>
                </div>
              ) : (
                <div className="text-sm font-semibold text-gray-900">
                  {periodLabel}
                  <span className="text-gray-400 font-normal ml-1.5">·</span>
                  <span className="text-gray-400 font-normal ml-1.5">{formatCompact(totalMentions)} mentions</span>
                </div>
              )}
            </div>
            <DatePicker value={period} onChange={setPeriod} />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-5">
        <div className="mb-5">
          <SearchDropdown onSelect={onSelectLeader} />
        </div>

        <div className="mb-5">
          <SpotlightCards spotlights={spotlights} onSelect={onSelectLeader} />
        </div>

        <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-5 mb-5">
          <ComparisonChart period={period} />
        </div>

        <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-900">Full Rankings</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {tableLeaders.length} leaders · {periodLabel} · click column headers to sort
            </p>
          </div>
          <RankingList leaders={tableLeaders} onSelect={onSelectLeader} />
        </div>
      </main>
    </div>
  );
}

// ----------------------------------------------------------------
// Data freshness indicator with cadence tooltip
// ----------------------------------------------------------------

// Cron schedule mirrors .github/workflows/fetch-twitter-data.yml + fetch-trackers.yml.
// Mentions + tweets + RTs received: every 12h at 00:00 and 12:00 UTC.
// Tracker snapshots: daily at 03:00 UTC.
const MENTIONS_CRON_HOURS_UTC = [0, 12];
const TRACKERS_CRON_HOURS_UTC = [3];

function nextCronAt(hoursUTC) {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  for (const h of [...hoursUTC].sort((a, b) => a - b)) {
    const candidate = new Date(today.getTime() + h * 3600 * 1000);
    if (candidate > now) return candidate;
  }
  // All today's slots passed — next slot is the earliest tomorrow.
  return new Date(today.getTime() + 24 * 3600 * 1000 + Math.min(...hoursUTC) * 3600 * 1000);
}

function formatRelative(date) {
  if (!date) return '—';
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function formatUntil(date) {
  if (!date) return '—';
  const diff = (date.getTime() - Date.now()) / 1000;
  if (diff < 60) return 'in <1 min';
  if (diff < 3600) return `in ${Math.floor(diff / 60)} min`;
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  return m > 0 ? `in ${h}h ${m}m` : `in ${h}h`;
}

function formatAbsolute(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZoneName: 'short',
  });
}

function FreshnessIndicator({ meta }) {
  const [open, setOpen] = useState(false);
  const lastMentions = meta?.lastMentionsUpdate ? new Date(meta.lastMentionsUpdate) : null;
  const lastTrackers = meta?.lastTrackersUpdate ? new Date(meta.lastTrackersUpdate) : null;
  const nextMentions = nextCronAt(MENTIONS_CRON_HOURS_UTC);
  const nextTrackers = nextCronAt(TRACKERS_CRON_HOURS_UTC);

  return (
    <div className="relative hidden sm:flex">
      <button
        type="button"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-gray-900 transition-colors"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        <span>Last update: {formatRelative(lastMentions)}</span>
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1.5 w-72 bg-white rounded-xl border border-gray-200 shadow-xl p-3 z-30 text-left">
          <div className="text-[11px] font-semibold text-gray-900 mb-2">Data freshness</div>

          <div className="space-y-2">
            <FreshnessRow
              icon="💬"
              title="Mentions, tweets, RTs received"
              cadence="Every 12h · 00:00 + 12:00 UTC"
              lastIso={meta?.lastMentionsUpdate}
              next={nextMentions}
            />
            <FreshnessRow
              icon="👥"
              title="Followers + account snapshots"
              cadence="Daily · 03:00 UTC"
              lastIso={meta?.lastTrackersUpdate}
              next={nextTrackers}
            />
          </div>

          <div className="mt-2.5 pt-2 border-t border-gray-100 text-[10px] text-gray-400 leading-snug">
            Crons run on GitHub Actions. Manual backfills can refresh the
            historical archive at any time.
          </div>
        </div>
      )}
    </div>
  );
}

function FreshnessRow({ icon, title, cadence, lastIso, next }) {
  return (
    <div className="flex gap-2.5">
      <span className="text-sm leading-none mt-0.5">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-semibold text-gray-700">{title}</div>
        <div className="text-[10px] text-gray-400">{cadence}</div>
        <div className="text-[10px] text-gray-500 mt-0.5">
          Last: <span className="font-medium text-gray-700">{formatAbsolute(lastIso)}</span>
        </div>
        <div className="text-[10px] text-gray-500">
          Next: <span className="font-medium text-emerald-600">{formatUntil(next)}</span>
        </div>
      </div>
    </div>
  );
}
