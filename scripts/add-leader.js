#!/usr/bin/env node
/**
 * Onboard a new leader end-to-end:
 *   1. Validate the country (light ISO 3166-1 lookup, since "country" is the
 *      project's stand-in for whichever dimension makes sense for the vertical
 *      — partido, provincia, comunidad autónoma…).
 *   2. Propose a Tweet Binder query, picking surname-only when the surname is
 *      distinctive enough and falling back to the full name otherwise.
 *   3. Create a Tweet Binder user-tracker (POST /user-trackers) and wait until
 *      it's ready. Tweet Binder typically takes 1–several hours to populate
 *      historical snapshot data, so we don't block on backfill here.
 *   4. Append the new entry to server/leaders.json.
 *   5. Print the exact `gh workflow run` command (or run it with --backfill).
 *
 * Usage (non-interactive):
 *   node scripts/add-leader.js \
 *     --handle elonmusk \
 *     --name "Elon Musk" \
 *     --country "South Africa" [--country-code ZA] \
 *     [--id elon] [--query '("Elon Musk" OR @elonmusk) -is:retweet'] \
 *     [--backfill] [--dry-run]
 *
 * Country code is auto-resolved when omitted; pass --country-code to override.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LEADERS_FILE = path.join(ROOT, 'server', 'leaders.json');

const API_URL = process.env.TWEETBINDER_API_URL;
const API_KEY = process.env.TWEETBINDER_API_KEY;
const headers = { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' };

// ----- args -----
const argv = process.argv.slice(2);
function getArg(name, def = null) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
}
function hasFlag(name) { return argv.includes(name); }

const HANDLE_INPUT = getArg('--handle');
const NAME_INPUT = getArg('--name');
const COUNTRY_INPUT = getArg('--country');
const COUNTRY_CODE_INPUT = getArg('--country-code');
const ID_INPUT = getArg('--id');
const QUERY_OVERRIDE = getArg('--query');
const DRY_RUN = hasFlag('--dry-run');
const BACKFILL = hasFlag('--backfill');

// ----- ISO country lookup (covers the cases we'll realistically see for
// political-figures verticals + leaves room for Spanish CCAA / Liga teams later
// by treating COUNTRY_CODE as a free-form string when it doesn't match ISO).
const COUNTRY_TO_CODE = {
  'argentina': 'AR', 'australia': 'AU', 'austria': 'AT', 'bangladesh': 'BD',
  'belgium': 'BE', 'brazil': 'BR', 'canada': 'CA', 'chile': 'CL', 'china': 'CN',
  'colombia': 'CO', 'czech republic': 'CZ', 'czechia': 'CZ', 'denmark': 'DK',
  'dr congo': 'CD', 'democratic republic of the congo': 'CD',
  'ecuador': 'EC', 'egypt': 'EG', 'ethiopia': 'ET', 'finland': 'FI',
  'france': 'FR', 'germany': 'DE', 'greece': 'GR', 'hungary': 'HU',
  'india': 'IN', 'indonesia': 'ID', 'iran': 'IR', 'iraq': 'IQ', 'ireland': 'IE',
  'israel': 'IL', 'italy': 'IT', 'japan': 'JP', 'kenya': 'KE',
  'mexico': 'MX', 'morocco': 'MA', 'myanmar': 'MM', 'netherlands': 'NL',
  'new zealand': 'NZ', 'nigeria': 'NG', 'norway': 'NO', 'pakistan': 'PK',
  'peru': 'PE', 'philippines': 'PH', 'poland': 'PL', 'portugal': 'PT',
  'romania': 'RO', 'russia': 'RU', 'saudi arabia': 'SA', 'singapore': 'SG',
  'south africa': 'ZA', 'south korea': 'KR', 'spain': 'ES', 'sudan': 'SD',
  'sweden': 'SE', 'switzerland': 'CH', 'taiwan': 'TW', 'tanzania': 'TZ',
  'thailand': 'TH', 'turkey': 'TR', 'uganda': 'UG', 'ukraine': 'UA',
  'united arab emirates': 'AE', 'united kingdom': 'GB', 'uk': 'GB',
  'united states': 'US', 'usa': 'US', 'us': 'US', 'venezuela': 'VE',
  'vietnam': 'VN',
};

function resolveCountryCode(country, codeArg) {
  if (codeArg) return codeArg.toUpperCase();
  const normalized = (country || '').trim().toLowerCase();
  return COUNTRY_TO_CODE[normalized] || null;
}

// ----- query proposal: surname-only when unique enough -----
const GENERIC_SURNAMES = new Set([
  'modi', 'xi', 'lam', 'lee', 'kim', 'park', 'silva', 'sanchez', 'sharif',
  'ahmed', 'hassan', 'rahman', 'khan', 'ali', 'jr.', 'jr', 'jinping',
  'hlaing', 'marcos', 'garcia', 'ramos', 'martin',
]);

function proposeQuery({ name, handle }) {
  const lastWord = (name || '').trim().split(/\s+/).pop() || '';
  const looksUnique = lastWord.length > 4 && !GENERIC_SURNAMES.has(lastWord.toLowerCase());
  const handleClean = (handle || '').replace(/^@/, '');
  if (looksUnique && handleClean) {
    return {
      query: `(${lastWord} OR @${handleClean}) -is:retweet`,
      mode: 'broad',
      reason: `"${lastWord}" is distinctive enough — broad query catches mentions even when the full name isn't used.`,
    };
  }
  if (looksUnique) {
    return {
      query: `(${lastWord}) -is:retweet`,
      mode: 'broad',
      reason: `"${lastWord}" is distinctive — broad query without handle (no public X handle).`,
    };
  }
  if (handleClean) {
    return {
      query: `("${name}" OR @${handleClean}) -is:retweet`,
      mode: 'narrow',
      reason: `Surname "${lastWord}" is too common — sticking to the full name + handle.`,
    };
  }
  return {
    query: `("${name}") -is:retweet`,
    mode: 'narrow',
    reason: `Surname "${lastWord}" is too common — sticking to the full name (no handle).`,
  };
}

function deriveId(handle, name) {
  if (ID_INPUT) return ID_INPUT;
  if (handle) return handle.replace(/^@/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return name.toLowerCase().split(/\s+/).pop().replace(/[^a-z0-9]/g, '');
}

async function apiPost(endpoint, body) {
  const res = await fetch(`${API_URL}${endpoint}`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${endpoint} (${res.status}): ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function createTracker(handle) {
  const alias = handle.replace(/^@/, '');
  console.log(`  → POST /user-trackers { alias: "${alias}" }`);
  if (DRY_RUN) {
    return { resourceId: 'dry-run-uuid-0000', alias };
  }
  try {
    const body = await apiPost('/user-trackers', { alias });
    return body.resourceId
      ? { resourceId: body.resourceId, alias }
      : (body.data?.resourceId
          ? { resourceId: body.data.resourceId, alias }
          : { resourceId: null, alias, raw: body });
  } catch (err) {
    if (/already exists/i.test(err.message)) {
      console.warn(`  ⚠ Tracker already exists for @${alias}. You'll need the existing trackerId — check Tweet Binder UI.`);
      return { resourceId: null, alias, exists: true };
    }
    throw err;
  }
}

function ask(rl, question) {
  return new Promise(resolve => rl.question(question, ans => resolve(ans.trim())));
}

async function promptMissing() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const handle = HANDLE_INPUT || await ask(rl, 'X handle (with or without @): ');
  const name = NAME_INPUT || await ask(rl, 'Full name: ');
  const country = COUNTRY_INPUT || await ask(rl, 'Country / dimension label: ');
  rl.close();
  return { handle, name, country };
}

async function main() {
  if (!API_KEY || !API_URL) {
    console.error('Missing TWEETBINDER_API_KEY / TWEETBINDER_API_URL in .env');
    process.exit(1);
  }

  const { handle, name, country } = await promptMissing();
  if (!handle || !name || !country) {
    console.error('handle, name, and country are all required.');
    process.exit(1);
  }

  const id = deriveId(handle, name);
  const countryCode = resolveCountryCode(country, COUNTRY_CODE_INPUT);
  const handleNorm = handle.startsWith('@') ? handle : '@' + handle;
  const proposal = QUERY_OVERRIDE
    ? { query: QUERY_OVERRIDE, mode: 'override', reason: 'Provided via --query.' }
    : proposeQuery({ name, handle: handleNorm });

  console.log('\n=== New leader proposal ===');
  console.log(`  id:           ${id}`);
  console.log(`  name:         ${name}`);
  console.log(`  country:      ${country}${countryCode ? '' : ' ⚠ no ISO match'}`);
  console.log(`  countryCode:  ${countryCode || '(unset — pass --country-code to override)'}`);
  console.log(`  handle:       ${handleNorm}`);
  console.log(`  query:        ${proposal.query}`);
  console.log(`                (${proposal.mode}) ${proposal.reason}`);

  if (!countryCode) {
    console.error('\nCountry code unresolved. Pass --country-code XX to continue, or expand COUNTRY_TO_CODE.');
    process.exit(1);
  }

  // Duplicate-id check.
  const leaders = JSON.parse(fs.readFileSync(LEADERS_FILE, 'utf-8'));
  if (leaders.find(l => l.id === id)) {
    console.error(`\n✗ Leader id "${id}" already exists in leaders.json. Aborting.`);
    process.exit(1);
  }

  // Tracker creation.
  console.log(`\n→ Creating Tweet Binder user-tracker for @${handleNorm.slice(1)}`);
  const tracker = await createTracker(handleNorm);
  console.log(`  tracker resourceId: ${tracker.resourceId || '(none — may already exist)'}`);
  console.log(`  ⏳ Tweet Binder usually takes 1–several hours to populate historical snapshot data. The first cron run after that will pick it up.`);

  // Write leaders.json.
  const newEntry = {
    id, country, countryCode, name, handle: handleNorm,
    query: proposal.query,
    ...(tracker.resourceId ? { trackerId: tracker.resourceId } : {}),
  };

  if (DRY_RUN) {
    console.log('\n[dry-run] Would append to leaders.json:');
    console.log(JSON.stringify(newEntry, null, 2));
  } else {
    leaders.push(newEntry);
    fs.writeFileSync(LEADERS_FILE, JSON.stringify(leaders, null, 2) + '\n');
    console.log(`\n✓ Appended to ${path.relative(ROOT, LEADERS_FILE)}`);
  }

  // Backfill instructions / trigger.
  const cmd = `gh workflow run backfill-since-2020.yml --repo $REPO -f since=2020-01-01 -f mode=all -f leader_id=${id}`;
  if (BACKFILL && !DRY_RUN) {
    console.log('\n→ Triggering backfill workflow…');
    const { execSync } = await import('node:child_process');
    try {
      execSync(cmd.replace('$REPO', 'javierabregodev/world-leaders-pulse'), { stdio: 'inherit' });
    } catch (err) {
      console.error('  Trigger failed:', err.message);
    }
  } else {
    console.log('\nNext step — trigger the historical backfill (mentions + RTs received + tweets):');
    console.log(`  ${cmd}`);
  }

  console.log('\nDone.');
}

main().catch(err => { console.error(err); process.exit(1); });
