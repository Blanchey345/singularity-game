#!/usr/bin/env python3
"""Build immutable, server-side BLASTOFF daily challenge packages.

The script intentionally refuses to publish a 90-day run unless the question
bank contains at least 630 distinct prompts. It never invents answers:
every accepted answer must already exist in brands_db.json and be referenced
by that question's validIds.
"""
import argparse
import datetime as dt
import json
import os
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DAYS = 90
ROUNDS = 7


def points_from_sitelinks(popularity):
    # Match the scoring thresholds already used by BLASTOFF's live frontend.
    if popularity >= 75:
        return 10
    if popularity >= 45:
        return 25
    if popularity >= 20:
        return 50
    return 75


def tier_for(points):
    return {
        10: "Space Dust",
        25: "Satellite",
        50: "Nebula",
        75: "Supernova",
        100: "Singularity",
    }[points]


def load_inputs():
    with (ROOT / "daily_questions.json").open(encoding="utf-8") as f:
        questions = json.load(f)
    with (ROOT / "brands_db.json").open(encoding="utf-8") as f:
        db = json.load(f)
    return questions, db["brands"]


def prepare_question(question, brands):
    answers = []
    seen_ids = set()
    for qid in question.get("validIds", []):
        if qid in seen_ids:
            continue
        seen_ids.add(qid)
        brand = brands.get(qid)
        if not brand or not brand.get("name"):
            continue
        points = points_from_sitelinks(int(brand.get("popularity") or 25))
        aliases = set([brand["name"]])
        aliases.update(x for x in brand.get("keys", []) if isinstance(x, str) and x.strip())
        answers.append({
            "id": qid,
            "name": brand["name"],
            "aliases": sorted(aliases),
            "points": points,
            "tier": tier_for(points),
            "popularity": int(brand.get("popularity") or 0),
        })
    answers.sort(key=lambda x: (x["points"], x["name"].casefold()))
    return {
        "id": question["id"],
        "prompt": question["prompt"],
        "category": question.get("category", ""),
        "answers": answers,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--start-date", default=os.environ.get("START_DATE"))
    parser.add_argument("--output", default="prepared")
    parser.add_argument("--allow-prompt-repeats", action="store_true")
    args = parser.parse_args()

    today = dt.datetime.now(dt.timezone.utc).date()
    start = dt.date.fromisoformat(args.start_date) if args.start_date else today
    questions, brands = load_inputs()
    prepared = [prepare_question(q, brands) for q in questions]
    prepared = [q for q in prepared if len(q["answers"]) >= 8]

    unique_prompts = {q["prompt"].strip().casefold() for q in prepared}
    required = DAYS * ROUNDS
    if len(unique_prompts) < required and not args.allow_prompt_repeats:
        raise SystemExit(
            f"Not publishing: only {len(unique_prompts)} distinct, usable prompts "
            f"are available; {required} are required for {DAYS} days x {ROUNDS} "
            "rounds. Expand and validate the question bank first."
        )

    if not prepared:
        raise SystemExit("No usable questions were found.")

    output = ROOT / args.output
    output.mkdir(parents=True, exist_ok=True)
    rng = random.Random(start.isoformat() + ":BLASTOFF:90-day-deck")
    deck = prepared[:]
    rng.shuffle(deck)

    if len(deck) < required:
        # Explicitly opt-in only for development previews; never use this in release CI.
        deck = [deck[i % len(deck)] for i in range(required)]

    for day_offset in range(DAYS):
        date = start + dt.timedelta(days=day_offset)
        day_questions = deck[day_offset * ROUNDS:(day_offset + 1) * ROUNDS]
        payload = {
            "schemaVersion": 1,
            "date": date.isoformat(),
            "preparedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
            "questions": day_questions,
        }
        with (output / f"{date.isoformat()}.json").open("w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))

    print(
        f"Prepared {DAYS} days ({required} rounds) beginning {start.isoformat()} "
        f"from {len(unique_prompts)} distinct usable prompts."
    )


if __name__ == "__main__":
    main()
