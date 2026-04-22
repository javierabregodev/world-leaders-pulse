/**
 * Seed script: fetches historical counts for all leaders since 2020.
 * Uses quarterly count requests with since:/until: operators.
 * Usage: npm run seed
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getFullHistoricalCount } from './api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, 'data', 'counts.json');
const HISTORY_FILE = path.join(__dirname, 'data', 'history.json');
const LEADERS_FILE = path.join(__dirname, 'leaders.json');

const leaders = JSON.parse(fs.readFileSync(LEADERS_FILE, 'utf-8'));

async function seed() {
  let counts = {};
  if (fs.existsSync(DATA_FILE)) {
    counts = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  }
  let history = {};
  if (fs.existsSync(HISTORY_FILE)) {
    history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
  }

  console.log(`Seeding historical counts for ${leaders.length} leaders (quarterly since 2020)...\n`);

  for (const leader of leaders) {
    // Skip if already fetched
    if (counts[leader.id]?.total != null) {
      console.log(`SKIP ${leader.name}: already has ${counts[leader.id].total.toLocaleString()}\n`);
      continue;
    }

    try {
      console.log(`=== ${leader.name} (${leader.country}) ===`);
      console.log(`Query: ${leader.query}`);
      const result = await getFullHistoricalCount(leader.query, 2020);

      counts[leader.id] = {
        total: result.total,
        lastUpdated: new Date().toISOString(),
      };
      fs.writeFileSync(DATA_FILE, JSON.stringify(counts, null, 2));

      // Store daily timeline
      if (result.dailyTimeline.length > 0) {
        history[leader.id] = result.dailyTimeline;
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
      }

      console.log(`TOTAL: ${result.total.toLocaleString()} mentions (${result.dailyTimeline.length} daily data points)\n`);
    } catch (err) {
      console.error(`ERROR: ${err.message}\n`);
    }
  }

  counts._lastGlobalUpdate = new Date().toISOString();
  fs.writeFileSync(DATA_FILE, JSON.stringify(counts, null, 2));
  console.log('\nSeed complete!');
}

seed().catch(console.error);
