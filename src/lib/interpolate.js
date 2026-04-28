/**
 * Tracker daily interpolation.
 *
 * fetch-trackers (and Tweet Binder's archive) gives us snapshots at
 * roughly monthly cadence. The dashboard wants to show a follower line
 * with daily granularity for any selected period — without that the
 * "Last 7/30 Days" view collapses to a single dot when no monthly
 * snapshot landed inside the window.
 *
 * For each gap between two consecutive monthly snapshots we add a
 * synthetic daily point that's a fraction of the gap delta. The
 * fraction is weighted by mention volume (the leader.history daily
 * count of mentions) so high-news days take a bigger share of the
 * follower jump in their month — closer to reality than a flat linear
 * interpolation. Days with no mention data fall back to equal weights.
 *
 * Only `followers` and `lists` are interpolated. `tweets`,
 * `mentionsReceived`, `retweetsReceived` are computed from real daily
 * sources elsewhere; `following` is held flat (rarely changes).
 */

const INTERP_FIELDS = ['followers', 'lists'];
const PASSTHROUGH_FIELDS = ['tweets', 'mentionsReceived', 'retweetsReceived', 'following'];

export function enumerateDates(startISO, endISO) {
  const out = [];
  const d = new Date(startISO + 'T00:00:00Z');
  const end = new Date(endISO + 'T00:00:00Z');
  while (d < end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export function interpolateTrackerToDaily(tracker, history) {
  if (!tracker?.snapshots?.length) return tracker;
  const snaps = [...tracker.snapshots].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  if (snaps.length < 2) return tracker;

  const mentionsByDate = {};
  for (const h of history || []) {
    if (h.date) mentionsByDate[h.date] = h.count || 0;
  }

  const daily = [];
  for (let i = 0; i < snaps.length - 1; i++) {
    const s1 = snaps[i];
    const s2 = snaps[i + 1];
    if (!s1.date || !s2.date) continue;

    daily.push({ ...s1, interpolated: false });

    const inner = enumerateDates(s1.date, s2.date).slice(1);
    if (inner.length === 0) continue;

    const mentionWeights = inner.map(d => Math.max(0, mentionsByDate[d] || 0));
    const totalMentions = mentionWeights.reduce((s, v) => s + v, 0);
    const weights = totalMentions > 0
      ? mentionWeights.map(m => m / totalMentions)
      : inner.map(() => 1 / inner.length);

    const deltas = {};
    for (const f of INTERP_FIELDS) deltas[f] = (s2[f] ?? 0) - (s1[f] ?? 0);

    const cum = Object.fromEntries(INTERP_FIELDS.map(f => [f, 0]));
    inner.forEach((d, j) => {
      for (const f of INTERP_FIELDS) cum[f] += deltas[f] * weights[j];
      const point = { date: d, interpolated: true };
      for (const f of INTERP_FIELDS) point[f] = Math.round((s1[f] ?? 0) + cum[f]);
      for (const f of PASSTHROUGH_FIELDS) point[f] = s1[f];
      daily.push(point);
    });
  }
  daily.push({ ...snaps[snaps.length - 1], interpolated: false });

  return { ...tracker, snapshots: daily };
}
