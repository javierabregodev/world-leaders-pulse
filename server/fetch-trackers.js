/**
 * Fetch user-tracker stats for all leaders with a trackerId.
 * Stores snapshots in data/trackers.json for instant serving.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_URL = process.env.TWEETBINDER_API_URL;
const API_KEY = process.env.TWEETBINDER_API_KEY;
const headers = { 'Authorization': `Bearer ${API_KEY}` };

const leaders = JSON.parse(fs.readFileSync(path.join(__dirname, 'leaders.json'), 'utf-8'));
const OUTPUT = path.join(__dirname, 'data', 'trackers.json');

async function main() {
  const withTracker = leaders.filter(l => l.trackerId);
  console.log(`Fetching tracker data for ${withTracker.length} leaders...\n`);

  const result = {};
  // 5 years back
  const endDate = Math.floor(Date.now() / 1000);
  const startDate = endDate - (5 * 365 * 86400);

  for (const leader of withTracker) {
    try {
      const url = `${API_URL}/user-trackers/${leader.trackerId}/stats?startDate=${startDate}&endDate=${endDate}&isTimeline=true`;
      const res = await fetch(url, { headers });
      if (!res.ok) {
        console.log(`✗ ${leader.name}: HTTP ${res.status}`);
        continue;
      }
      const data = await res.json();
      const snapshots = Array.isArray(data) ? data : (data?.data || []);
      if (snapshots.length === 0) {
        console.log(`⚠ ${leader.name}: no snapshots yet (tracker just created?)`);
        continue;
      }
      result[leader.id] = {
        trackerId: leader.trackerId,
        snapshots: snapshots.map(s => ({
          timestamp: s._id,
          date: new Date(s._id * 1000).toISOString().slice(0, 10),
          followers: s.followers ?? null,
          following: s.following ?? null,
          tweets: s.tweets ?? null,
          lists: s.lists ?? null,
          mentionsReceived: s.mentions ?? null,
          retweetsReceived: s.retweets ?? null,
          followersFollowing: s.followersFollowing ?? null,
        })),
        fetchedAt: new Date().toISOString(),
      };
      const latest = snapshots[snapshots.length - 1];
      const first = snapshots[0];
      const growth = latest.followers - first.followers;
      const sign = growth >= 0 ? '+' : '';
      console.log(`✓ ${leader.name.padEnd(28)} ${snapshots.length} snapshots · followers: ${latest.followers?.toLocaleString()} (${sign}${growth.toLocaleString()} since ${first && new Date(first._id*1000).toISOString().slice(0,10)})`);

      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      console.log(`✗ ${leader.name}: ${err.message}`);
    }
  }

  fs.writeFileSync(OUTPUT, JSON.stringify(result, null, 2));
  console.log(`\nSaved ${Object.keys(result).length} leaders' tracker data`);
}

main().catch(console.error);
