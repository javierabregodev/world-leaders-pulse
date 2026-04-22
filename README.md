# World Leaders Pulse

Dashboard that tracks Twitter/X mentions and engagement for 31 world leaders, powered by the Tweet Binder API.

## Architecture

- **Frontend**: React + Vite, static SPA deployed to Vercel
- **Data**: JSON files in `server/data/` committed to the repo + precomputed static endpoints in `public/api/`
- **Crons**: GitHub Actions fetch fresh data and commit updates
  - `fetch-mentions.yml` — twice a day (00:00 + 12:00 UTC): 7-day mention counts + engagement reports
  - `fetch-trackers.yml` — daily at 03:00 UTC: user-tracker snapshots (followers, account stats)

## Local development

```bash
npm install
npm run build-static   # regenerate public/api/*.json from server/data/
npm run dev            # vite dev server at :5173
```

Set `TWEETBINDER_API_KEY` and `TWEETBINDER_API_URL` in `.env` if you need to run fetch scripts locally.

## Data layout

```
server/data/
  counts.json       # aggregate mention counts per leader
  history.json      # daily mention timeline per leader
  engagement.json   # tweets + per-tweet engagement per leader (largest)
  trackers.json     # user-tracker snapshots (followers, etc.)

public/api/
  index.json                   # precomputed summaries per preset (today, 7d, 30d, 365d, all)
  leaders/{id}.json            # per-leader detail without tweets
  tweets/{id}.json             # per-leader full tweets (lazy loaded by TweetModal)
```

## Scripts

- `npm run fetch-mentions` — runs the 7-day update (locally or in Actions)
- `npm run fetch-trackers` — runs the user-tracker snapshot fetch
- `npm run build-static` — rebuilds `public/api/*.json` from `server/data/*`
- `npm run build` — full Vite build + static regeneration

## Deployment

1. Push to GitHub
2. Connect repo to Vercel → auto-deploy on push
3. Add `TWEETBINDER_API_KEY` and `TWEETBINDER_API_URL` to **GitHub repo secrets** (for Actions)
