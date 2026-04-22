import { useEffect, useRef } from 'react';

function formatDate(unix) {
  if (!unix) return '';
  const d = new Date(unix * 1000);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatCompact(n) {
  if (n == null) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

const TYPE_BADGE = {
  original: { label: 'Tweet', class: 'bg-indigo-50 text-indigo-600' },
  retweet: { label: 'Retweet', class: 'bg-emerald-50 text-emerald-600' },
  reply: { label: 'Reply', class: 'bg-amber-50 text-amber-600' },
};

export default function TweetModal({ tweets, handle, leaderName, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    const close = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [onClose]);

  // Filter tweets that relate to this handle
  const handleClean = handle?.replace('@', '').toLowerCase();
  const filtered = (tweets || [])
    .filter(t => t.type !== 'retweet' && t.relatedHandles?.some(h => h === handleClean))
    .sort((a, b) => (b.date || 0) - (a.date || 0));

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-12 sm:pt-20 px-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div ref={ref} className="relative bg-white rounded-2xl shadow-2xl border border-gray-200 w-full max-w-2xl max-h-[75vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">
              Tweets mentioning {handle || 'this account'}
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              {filtered.length} tweet{filtered.length !== 1 ? 's' : ''} from {leaderName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 hover:text-gray-700 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M10.5 3.5l-7 7M3.5 3.5l7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Tweet list */}
        <div className="overflow-y-auto flex-1 divide-y divide-gray-50">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">
              No tweets found for this account.
            </div>
          ) : (
            filtered.map((tweet, i) => {
              const badge = TYPE_BADGE[tweet.type] || TYPE_BADGE.original;
              return (
                <div key={tweet.id || i} className="px-5 py-4 hover:bg-gray-50/50 transition-colors">
                  {/* Type + date */}
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${badge.class}`}>
                      {badge.label}
                    </span>
                    <span className="text-[11px] text-gray-400">{formatDate(tweet.date)}</span>
                    {tweet.id && (
                      <a
                        href={`https://x.com/i/status/${tweet.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] text-indigo-400 hover:text-indigo-600 ml-auto"
                        onClick={e => e.stopPropagation()}
                      >
                        View on X ↗
                      </a>
                    )}
                  </div>

                  {/* Text */}
                  <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap break-words">
                    {tweet.text}
                  </p>

                  {/* Engagement row */}
                  <div className="flex gap-4 mt-2.5 text-[11px] text-gray-400">
                    <span title="Likes">❤️ {formatCompact(tweet.likes)}</span>
                    <span title="Retweets">🔁 {formatCompact(tweet.rts)}</span>
                    <span title="Replies">💬 {formatCompact(tweet.replies)}</span>
                    <span title="Impressions">👁 {formatCompact(tweet.impressions)}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
