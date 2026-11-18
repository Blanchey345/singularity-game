# BLASTOFF Daily API (staged backend)

This backend is deliberately separate from the current GitHub Pages game. The
existing `index.html` and `brands_data.js` are not changed by this setup.

## What it does

- Stores immutable, precomputed daily challenge packages in Cloudflare KV.
- Returns only the seven prompts when a player starts.
- Checks answers against the saved answer pool and saved rarity points; gameplay
  does not need a live Wikidata, Wikipedia, or search lookup.
- Releases the complete accepted-answer lists and rarity values only after all
  seven rounds have been submitted or skipped.
- Keeps short-lived player sessions in a separate KV namespace.

## Important current limitation

The repository currently has 55 question prompts in `daily_questions.json`.
A 90-day run needs 630 distinct prompts (90 x 7). The preparation script
intentionally refuses to publish until the question catalog has at least 630
distinct, usable prompts with eight or more verified answers each. The current
brand database is not yet a complete model/product database (for example,
Toyota vehicle models and Apple device models need their own discovery queries).
Do not enable the daily workflow or switch the live frontend until that content
gap is resolved and a full 90-day preparation passes.

## Create Cloudflare resources

1. Create a Cloudflare account and open Workers & Pages.
2. Create two KV namespaces named `BLASTOFF_DAILY_DATA` and
   `BLASTOFF_SESSIONS`.
3. Copy each namespace ID into `cloudflare/wrangler.toml`, replacing the two
   `REPLACE_WITH_...` values.
4. Set `ALLOWED_ORIGIN` to the exact deployed GitHub Pages origin. Keep it
   restricted to the website's origin rather than using `*`.
5. Create a Cloudflare API token with permission to deploy Workers and write to
   the two KV namespaces. Do not paste the token into chat or commit it.

## Local deployment (after the namespaces exist)

From the repository root:

```bash
npx wrangler deploy --config cloudflare/wrangler.toml
```

Upload prepared daily files only after the 90-day deck has passed validation:

```bash
for file in prepared/*.json; do
  day=$(basename "$file" .json)
  npx wrangler kv key put "daily:$day" --binding=DAILY_DATA \
    --path="$file" --remote --config cloudflare/wrangler.toml
done
```

## API routes

- `GET /api/daily/YYYY-MM-DD`: prompt-only daily challenge.
- `POST /api/start`: create a session; body: `{"date":"YYYY-MM-DD"}`.
- `POST /api/answer`: submit a round; body:
  `{"sessionId":"...","index":0,"answer":"..."}`.
- `POST /api/skip`: record a timed-out/skipped round.
- `GET /api/recap?session=...`: returns the complete answer explorer only
  after all seven rounds are resolved.

This is the backend foundation, not a live-site switch. The frontend migration
must be a separate tested change so the current site remains available as a
fallback throughout rollout.
