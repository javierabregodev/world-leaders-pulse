import { useState, useRef, useEffect } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { LEADER_COLORS, getLeaderColor } from '../mockData';
import MOCK_LEADERS from '../mockData';
import { InlineDatePicker } from './DatePicker';

const CHART_DATE_OPTIONS = [
  { key: '6m', label: '6M' },
  { key: '1y', label: '1Y' },
  { key: 'all', label: 'All' },
];
const DATE_TO_MONTHS = { '6m': 6, '1y': 12, 'all': 200 };

const ALL_COLORS = [
  '#ef4444', '#f59e0b', '#3b82f6', '#10b981', '#8b5cf6',
  '#ec4899', '#06b6d4', '#eab308', '#f43f5e', '#14b8a6',
  '#6366f1', '#84cc16', '#a855f7', '#22d3ee', '#fb923c',
];

const TWITTER_PIC = (handle) => handle ? `https://unavatar.io/x/${handle.replace('@', '')}` : null;
const FLAG_URL = (code) => `https://flagcdn.com/16x12/${code.toLowerCase()}.png`;

function formatCompact(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K';
  return n.toString();
}

function getColorForLeader(id, index) {
  // LEADER_COLORS still wins (curated picks); fall back to the deterministic
  // hash so new leaders never collide with each other in the comparison view.
  return LEADER_COLORS[id] || getLeaderColor(id) || ALL_COLORS[index % ALL_COLORS.length];
}

// Aggregate daily history into monthly buckets
function dailyToMonthly(history) {
  const byMonth = {};
  for (const h of history || []) {
    const month = (h.date || '').slice(0, 7); // YYYY-MM
    if (!month) continue;
    byMonth[month] = (byMonth[month] || 0) + (h.count || 0);
  }
  return byMonth;
}

export default function ComparisonChart() {
  const [chartRange, setChartRange] = useState('1y');
  const [selectedIds, setSelectedIds] = useState(['trump', 'modi', 'macron', 'erdogan', 'putin']);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [leaderHistories, setLeaderHistories] = useState({}); // id → { 'YYYY-MM': count }
  const addRef = useRef(null);

  useEffect(() => {
    const close = (e) => { if (addRef.current && !addRef.current.contains(e.target)) setShowAddMenu(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  // Fetch real history for each selected leader
  useEffect(() => {
    selectedIds.forEach(id => {
      if (leaderHistories[id]) return; // already fetched
      fetch(`/api/leaders/${id}.json`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data?.history) {
            setLeaderHistories(prev => ({ ...prev, [id]: dailyToMonthly(data.history) }));
          }
        })
        .catch(() => {});
    });
  }, [selectedIds]);

  // Build chart data from real monthly aggregates
  const months = DATE_TO_MONTHS[typeof chartRange === 'string' ? chartRange : 'all'] || 200;
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // Collect all months that have data for selected leaders (no duplicates)
  const allMonthsSet = new Set();
  selectedIds.forEach(id => {
    const byMonth = leaderHistories[id] || {};
    Object.keys(byMonth).forEach(m => {
      // Exclude future months (shouldn't happen but safety)
      if (m <= currentMonth) allMonthsSet.add(m);
    });
  });
  const allMonths = [...allMonthsSet].sort().slice(-months);

  const data = allMonths.map(month => {
    const point = { date: month };
    selectedIds.forEach(id => {
      point[id] = leaderHistories[id]?.[month] ?? 0;
    });
    return point;
  });

  function addLeader(id) {
    if (!selectedIds.includes(id)) {
      setSelectedIds(prev => [...prev, id]);
    }
    setShowAddMenu(false);
    setAddSearch('');
  }

  function removeLeader(id) {
    if (selectedIds.length > 1) {
      setSelectedIds(prev => prev.filter(x => x !== id));
    }
  }

  const availableToAdd = MOCK_LEADERS.filter(l => !selectedIds.includes(l.id));
  const filteredAdd = addSearch.length >= 1
    ? availableToAdd.filter(l => l.name.toLowerCase().includes(addSearch.toLowerCase()) || l.country.toLowerCase().includes(addSearch.toLowerCase()))
    : availableToAdd;

  return (
    <div>
      <div className="flex items-start sm:items-center justify-between mb-3 flex-col sm:flex-row gap-2">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Leader Comparison</h2>
          <p className="text-xs text-gray-400 mt-0.5">Monthly mentions — click to toggle, x to remove</p>
        </div>
        <InlineDatePicker value={chartRange} onChange={setChartRange} options={CHART_DATE_OPTIONS} />
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {selectedIds.map((id, i) => {
          const leader = MOCK_LEADERS.find(l => l.id === id);
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
              <span className="truncate max-w-[80px]">{leader.name.split(' ').pop()}</span>
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
              const leader = MOCK_LEADERS.find(l => l.id === name);
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
