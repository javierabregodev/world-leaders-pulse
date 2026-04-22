import { useState } from 'react';
import { useLeaderDetail } from '../hooks/useLeaders';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';

const TWITTER_PIC = (handle) => {
  if (!handle) return null;
  const username = handle.replace('@', '');
  return `https://unavatar.io/x/${username}`;
};

const FLAG_URL = (code) =>
  `https://flagcdn.com/48x36/${code.toLowerCase()}.png`;

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

function aggregateByMonth(dailyData) {
  const monthly = {};
  for (const { date, count } of dailyData) {
    const month = date.slice(0, 7); // YYYY-MM
    if (!monthly[month]) monthly[month] = 0;
    monthly[month] += count;
  }
  return Object.entries(monthly)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, total]) => ({ date: month, mentions: total }));
}

function aggregateByQuarter(dailyData) {
  const quarterly = {};
  for (const { date, count } of dailyData) {
    const year = date.slice(0, 4);
    const month = parseInt(date.slice(5, 7));
    const q = Math.ceil(month / 3);
    const key = `${year}-Q${q}`;
    if (!quarterly[key]) quarterly[key] = 0;
    quarterly[key] += count;
  }
  return Object.entries(quarterly)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([quarter, total]) => ({ date: quarter, mentions: total }));
}

function aggregateByYear(dailyData) {
  const yearly = {};
  for (const { date, count } of dailyData) {
    const year = date.slice(0, 4);
    if (!yearly[year]) yearly[year] = 0;
    yearly[year] += count;
  }
  return Object.entries(yearly)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([year, total]) => ({ date: year, mentions: total }));
}

const VIEWS = [
  { key: 'daily', label: 'Daily' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'quarterly', label: 'Quarterly' },
  { key: 'yearly', label: 'Yearly' },
];

export default function LeaderDetail({ leaderId, onBack }) {
  const { leader, loading } = useLeaderDetail(leaderId);
  const [view, setView] = useState('monthly');

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-500">
        <div className="w-6 h-6 border-2 border-gray-600 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!leader) return null;

  const sortedHistory = (leader.history || []).sort((a, b) => a.date.localeCompare(b.date));

  let chartData;
  switch (view) {
    case 'daily':
      chartData = sortedHistory.map(h => ({ date: h.date.slice(5), mentions: h.count }));
      break;
    case 'monthly':
      chartData = aggregateByMonth(sortedHistory);
      break;
    case 'quarterly':
      chartData = aggregateByQuarter(sortedHistory);
      break;
    case 'yearly':
      chartData = aggregateByYear(sortedHistory);
      break;
  }

  // Compute trend: compare last 2 periods
  let trend = null;
  if (chartData.length >= 2) {
    const last = chartData[chartData.length - 1].mentions;
    const prev = chartData[chartData.length - 2].mentions;
    if (prev > 0) {
      const pctChange = ((last - prev) / prev) * 100;
      trend = { pct: pctChange, up: pctChange >= 0 };
    }
  }

  // Peak period
  const peak = chartData.reduce((max, d) => d.mentions > (max?.mentions ?? 0) ? d : max, null);

  const pic = TWITTER_PIC(leader.handle);

  return (
    <div>
      <button
        onClick={onBack}
        className="text-sm text-gray-400 hover:text-white mb-6 flex items-center gap-1.5 transition-colors group"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="group-hover:-translate-x-0.5 transition-transform">
          <path d="M10 4l-4 4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Back to ranking
      </button>

      {/* Leader header */}
      <div className="flex items-start gap-4 mb-8">
        <div className="relative">
          {pic ? (
            <img
              src={pic}
              alt={leader.name}
              className="w-16 h-16 rounded-2xl object-cover bg-gray-800 border-2 border-gray-700"
              loading="lazy"
              onError={(e) => {
                e.target.style.display = 'none';
                e.target.nextSibling.style.display = 'flex';
              }}
            />
          ) : null}
          <div
            className={`w-16 h-16 rounded-2xl bg-gray-800 border-2 border-gray-700 items-center justify-center text-xl font-bold text-gray-500 ${pic ? 'hidden' : 'flex'}`}
          >
            {leader.name.split(' ').map(w => w[0]).join('').slice(0, 2)}
          </div>
          {leader.countryCode && (
            <img
              src={FLAG_URL(leader.countryCode)}
              alt={leader.country}
              className="absolute -bottom-1 -right-1 w-7 h-5 rounded border-2 border-gray-950 object-cover"
            />
          )}
        </div>
        <div className="flex-1">
          <h2 className="text-xl font-bold">{leader.name}</h2>
          <p className="text-sm text-gray-400 flex items-center gap-2">
            {leader.country}
            {leader.handle && (
              <a
                href={`https://x.com/${leader.handle.replace('@', '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300"
                onClick={(e) => e.stopPropagation()}
              >
                {leader.handle}
              </a>
            )}
          </p>
          {trend && (
            <div className={`inline-flex items-center gap-1 mt-2 px-2 py-0.5 rounded-full text-xs font-medium ${
              trend.up ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
            }`}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
                className={trend.up ? '' : 'rotate-180'}>
                <path d="M6 2v8M6 2l3 3M6 2L3 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              {Math.abs(trend.pct).toFixed(1)}% vs previous {view === 'daily' ? 'day' : view.replace('ly', '')}
            </div>
          )}
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard label="Total Mentions" value={formatNumber(leader.totalMentions)} highlight />
        <StatCard label="Last 7 Days" value={formatNumber(leader.last7d)} />
        <StatCard
          label="Peak Period"
          value={peak ? `${formatCompact(peak.mentions)}` : '—'}
          sub={peak?.date}
        />
        <StatCard
          label="Avg / Month"
          value={sortedHistory.length > 0
            ? formatCompact(Math.round(leader.totalMentions / (new Set(sortedHistory.map(h => h.date.slice(0, 7))).size || 1)))
            : '—'}
        />
      </div>

      {/* Chart */}
      {chartData.length > 0 ? (
        <div className="bg-gray-900/50 rounded-xl p-4 border border-gray-800/50">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-400">Mentions over time</h3>
            <div className="flex gap-1 bg-gray-800/50 rounded-lg p-0.5">
              {VIEWS.map(v => (
                <button
                  key={v.key}
                  onClick={() => setView(v.key)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    view === v.key
                      ? 'bg-blue-500/20 text-blue-400'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="mentionGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis
                dataKey="date"
                stroke="#4b5563"
                fontSize={11}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                stroke="#4b5563"
                fontSize={11}
                tickLine={false}
                tickFormatter={formatCompact}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#111827',
                  border: '1px solid #1f2937',
                  borderRadius: '12px',
                  color: '#f9fafb',
                  fontSize: '13px',
                }}
                formatter={(val) => [formatNumber(val), 'Mentions']}
              />
              <Area
                type="monotone"
                dataKey="mentions"
                stroke="#3b82f6"
                strokeWidth={2}
                fill="url(#mentionGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="bg-gray-900/50 rounded-xl p-8 border border-gray-800/50 text-center text-gray-500">
          No historical data yet. Run the seed script to load data.
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, sub, highlight }) {
  return (
    <div className={`rounded-xl p-3 border ${
      highlight
        ? 'bg-blue-500/5 border-blue-500/20'
        : 'bg-gray-900/50 border-gray-800/50'
    }`}>
      <div className="text-[11px] text-gray-500 uppercase tracking-wider mb-1">{label}</div>
      <div className={`font-bold ${highlight ? 'text-xl text-blue-400' : 'text-lg text-white'}`}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}
