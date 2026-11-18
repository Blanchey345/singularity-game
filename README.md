# BLASTOFF

A space-themed brand trivia game.

## Prepared Daily Challenges

BLASTOFF now uses a checked-in, precomputed 90-day schedule. Each day contains seven distinct rounds. Question families are broad brand categories and multi-category prompts; accepted answers, aliases, and rarity points are generated ahead of time and saved in `prepared_challenges.js`.

To regenerate the schedule from the Wikidata-derived brand registry:

```bash
node scripts/generate-challenges.mjs
node scripts/validate-challenges.mjs
```

Set `BLASTOFF_START_DATE=YYYY-MM-DD` to choose the first day of a new 90-day schedule. The generator keeps adjacent daily sets varied and gives each answer a fixed rarity tier before play.

**Current implementation note:** the prepared file is loaded by the browser, so future answer banks are visible in the client bundle. A Cloudflare Worker/KV layer is the next step if you want to keep future answer banks server-side and validate submissions remotely.
