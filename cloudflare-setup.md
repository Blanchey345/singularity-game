# Cloudflare backend setup

The Worker in `worker.js` is the server-side layer for BLASTOFF. It reads the precomputed 90-day payload from a Cloudflare KV namespace named by the `CHALLENGE_DATA` binding.

## One-time setup

1. Create a Cloudflare account and a KV namespace named `BLASTOFF_CHALLENGES`.
2. Copy that namespace ID into `wrangler.toml`, replacing `REPLACE_WITH_KV_NAMESPACE_ID`.
3. Install Wrangler locally and authenticate with `npx wrangler login`.
4. Generate and validate the payload:
   ```bash
   node scripts/generate-challenges.mjs
   node scripts/validate-challenges.mjs
   ```
5. Upload the generated JSON payload:
   ```bash
   npx wrangler kv key put --binding=CHALLENGE_DATA prepared_challenges --path=prepared_challenges.json
   ```
6. Deploy the Worker:
   ```bash
   npx wrangler deploy
   ```

The API endpoints are:

- `GET /api/daily` — returns today's seven prompts without the answer banks.
- `POST /api/answer` — validates an answer against the fixed server-side answer bank and returns its fixed rarity points.
- `GET /api/review?ids=id1,id2,...` — returns the answer banks for the seven questions for the recap screen.

**Important:** the current frontend is still using the static prepared file as a safe fallback. The Worker is scaffolded but not deployed or connected to gameplay yet. Do not remove `prepared_challenges.js` until the API is deployed and the frontend integration has been tested.
