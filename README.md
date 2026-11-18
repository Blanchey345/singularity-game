# BLASTOFF

A space-themed brand trivia game.

## Prepared Daily Challenges

BLASTOFF now uses a checked-in, precomputed 90-day schedule of 630 unique prompts. Each day contains seven distinct rounds, and no prompt repeats during the 90-day schedule. Question families are broad brand categories and multi-category prompts; accepted answers, aliases, and rarity points are generated ahead of time and saved in `prepared_challenges.js`.

To regenerate the schedule from the Wikidata-derived brand registry:

```bash
node scripts/generate-challenges.mjs
node scripts/validate-challenges.mjs
```

Set `BLASTOFF_START_DATE=YYYY-MM-DD` to choose the first day of a new 90-day schedule. The generator keeps adjacent daily sets varied and gives each answer a fixed rarity tier before play.

**Current implementation note:** the frontend now supports the Worker API when `config.js` contains its workers.dev URL. Leave that setting blank to use the checked-in static fallback. Until the Worker is deployed and configured, the browser still loads the prepared answer banks.
