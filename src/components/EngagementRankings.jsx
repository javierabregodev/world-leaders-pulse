import { useState } from 'react';
import { getEngagementRanking, ENGAGEMENT_METRICS } from '../mockData';

const TWITTER_PIC = (handle) => handle ? `https://unavatar.io/x/${handle.replace('@', '')}` : null;
const FLAG_URL = (code) => `https://flagcdn.com/20x15/${code.toLowerCase()}.png`;

function formatValue(val, format) {
  if (val == null) return '—';
  if (format === 'percent') return val.toFixed(2) + '%';
  if (val >= 1_000_000_000) return (val / 1_000_000_000).toFixed(1) + 'B';
  if (val >= 1_000_000) return (val / 1_000_000).toFixed(1) + 'M';
  if (val >= 1_000) return (val / 1_000).toFixed(1) + 'K';
  return val.toLocaleString();
}

export default function EngagementRankings({ onSelect }) {
  const [activeMetric, setActiveMetric] = useState('totalLikes');

  const metric = ENGAGEMENT_METRICS.find(m => m.key === activeMetric);
  const leaders = getEngagementRanking(activeMetric).slice(0, 10);
  const max = leaders[0]?.metricValue ?? 1;

  return (
    <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 border-b border-gray-100">
        <div className="flex items-start sm:items-center justify-between flex-col sm:flex-row gap-2">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Engagement Rankings</h2>
            <p className="text-xs text-gray-400 mt-0.5">From leaders' own tweets (last 7 days)</p>
          </div>
          <div className="flex gap-0.5 bg-gray-100 rounded-lg p-0.5">
            {ENGAGEMENT_METRICS.map(m => (
              <button
                key={m.key}
                onClick={() => setActiveMetric(m.key)}
                className={`px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-all whitespace-nowrap ${
                  activeMetric === m.key
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <span className="mr-1">{m.icon}</span>{m.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div>
        {leaders.map((leader, i) => {
          const rank = i + 1;
          const pic = TWITTER_PIC(leader.handle);
          const pct = Math.max(3, (leader.metricValue / max) * 100);

          return (
            <div
              key={leader.id}
              onClick={() => onSelect(leader.id)}
              className="flex items-center gap-3 px-5 py-2.5 hover:bg-indigo-50/40 cursor-pointer transition-colors border-b border-gray-50 last:border-0"
            >
              <span className="text-xs text-gray-400 font-mono w-5 text-right">{rank}</span>

              <div className="relative flex-shrink-0">
                {pic ? (
                  <img src={pic} alt="" className="w-7 h-7 rounded-full object-cover bg-gray-100" loading="lazy"
                    onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} />
                ) : null}
                <div className={`w-7 h-7 rounded-full bg-gray-100 items-center justify-center text-[10px] font-bold text-gray-400 ${pic ? 'hidden' : 'flex'}`}>
                  {leader.name.split(' ').map(w => w[0]).join('').slice(0, 2)}
                </div>
              </div>

              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 truncate">{leader.name}</div>
              </div>

              <div className="w-24 hidden sm:block">
                <div className="w-full bg-gray-100 rounded-full h-1.5">
                  <div className="h-1.5 rounded-full bg-gradient-to-r from-purple-400 to-indigo-500 transition-all duration-500" style={{ width: `${pct}%` }} />
                </div>
              </div>

              <span className="text-sm font-bold text-gray-900 font-mono w-16 text-right">
                {formatValue(leader.metricValue, metric?.format)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
