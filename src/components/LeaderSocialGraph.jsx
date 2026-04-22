import { useState } from 'react';
import TweetModal from './TweetModal';

const TWITTER_PIC = (handle) => handle ? `https://unavatar.io/x/${handle.replace('@', '')}` : null;

function PersonChip({ entry, onSelectLeader, onShowTweets }) {
  const pic = TWITTER_PIC(entry.handle);
  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-all ${
        entry.isLeader
          ? 'bg-indigo-50/50 border-indigo-200/50'
          : 'bg-gray-50/50 border-gray-200/50'
      }`}
    >
      <div className="relative flex-shrink-0">
        {pic ? (
          <img src={pic} alt="" className="w-7 h-7 rounded-full object-cover bg-gray-100" loading="lazy"
            onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} />
        ) : null}
        <div className={`w-7 h-7 rounded-full bg-gray-100 items-center justify-center text-[10px] font-bold text-gray-400 ${pic ? 'hidden' : 'flex'}`}>
          {(entry.name || entry.handle || '?').slice(0, 2).toUpperCase()}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-gray-900 truncate">{entry.name}</div>
        <div className="text-[10px] text-gray-400 truncate">{entry.handle}</div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <span className="text-xs font-bold text-gray-700">{entry.count}x</span>
        {/* View tweets button */}
        <button
          onClick={(e) => { e.stopPropagation(); onShowTweets(entry); }}
          className="w-6 h-6 rounded-md bg-gray-100 hover:bg-indigo-100 flex items-center justify-center text-gray-400 hover:text-indigo-600 transition-colors"
          title="View tweets"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
        </button>
        {entry.isLeader && (
          <button
            onClick={(e) => { e.stopPropagation(); if (entry.leaderId) onSelectLeader?.(entry.leaderId); }}
            className="text-[9px] bg-indigo-100 text-indigo-600 font-semibold px-1.5 py-0.5 rounded-full cursor-pointer hover:bg-indigo-200 transition-colors"
          >
            LEADER
          </button>
        )}
      </div>
    </div>
  );
}

function HashtagPill({ tag, count }) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 border border-gray-200/50 rounded-full">
      <span className="text-sm font-medium text-indigo-600">{tag}</span>
      <span className="text-[10px] text-gray-400 font-mono">{count}</span>
    </div>
  );
}

export default function LeaderSocialGraph({ leader, onSelectLeader }) {
  const [tweetModal, setTweetModal] = useState(null); // { handle, name }

  if (!leader.handle) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-6 text-center text-gray-400 text-sm">
        No Twitter account — engagement data unavailable
      </div>
    );
  }

  const { topRetweeted, topMentioned, topHashtags, tweets } = leader;

  function handleShowTweets(entry) {
    setTweetModal({ handle: entry.handle, name: entry.name });
  }

  return (
    <div className="space-y-4">
      {/* Tweet modal */}
      {tweetModal && (
        <TweetModal
          tweets={tweets || []}
          handle={tweetModal.handle}
          leaderName={leader.name}
          onClose={() => setTweetModal(null)}
        />
      )}

      {/* Who they RT */}
      {topRetweeted.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-base">🔁</span>
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Who does {leader.name.split(' ')[0]} retweet?</h3>
              <p className="text-[11px] text-gray-400">Most retweeted accounts — click count to see tweets</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {topRetweeted.map((entry, i) => (
              <PersonChip key={i} entry={entry} onSelectLeader={onSelectLeader} onShowTweets={handleShowTweets} />
            ))}
          </div>
        </div>
      )}

      {/* Who they mention */}
      {topMentioned.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-base">💬</span>
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Who does {leader.name.split(' ')[0]} mention?</h3>
              <p className="text-[11px] text-gray-400">Most mentioned accounts and leaders — click count to see tweets</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {topMentioned.map((entry, i) => (
              <PersonChip key={i} entry={entry} onSelectLeader={onSelectLeader} onShowTweets={handleShowTweets} />
            ))}
          </div>
        </div>
      )}

      {/* Hashtags */}
      {topHashtags.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-base">#️⃣</span>
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Top Hashtags</h3>
              <p className="text-[11px] text-gray-400">Most used by {leader.name.split(' ')[0]}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {topHashtags.map((h, i) => (
              <HashtagPill key={i} tag={h.tag} count={h.count} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
