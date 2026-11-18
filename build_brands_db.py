import json
import re
import time
import unicodedata
import urllib.parse
import urllib.request

SPARQL_ENDPOINT = "https://query.wikidata.org/sparql"
USER_AGENT = "BallisticBrandGameBuilder/2.0 (https://github.com/Blanchey345/singularity-game)"

# Each category maps to a Wikidata SPARQL pattern + minimum Wikipedia sitelinks
# Higher min_sitelinks = stricter filter for globally recognizable consumer brands
CATEGORIES = {
    "cosmetics": {
        "prompt": "Name a cosmetics, makeup, or skincare brand",
        "min_sitelinks": 10,
        "limit": 250,
        "where": """
            { ?item wdt:P452 wd:Q131207 . } UNION
            { ?item wdt:P31 wd:Q29885033 . } UNION
            { ?item wdt:P1056 wd:Q131207 . }
        """,
    },
    "fast_food": {
        "prompt": "Name a fast food, coffee, or restaurant chain",
        "min_sitelinks": 12,
        "limit": 250,
        "where": """
            { ?item wdt:P31 wd:Q18534542 . } UNION
            { ?item wdt:P31 wd:Q177054 . } UNION
            { ?item wdt:P452 wd:Q8195619 . }
        """,
    },
    "automotive": {
        "prompt": "Name an automobile or motorcycle brand",
        "min_sitelinks": 18,
        "limit": 250,
        "where": """
            { ?item wdt:P31 wd:Q786820 . }
        """,
    },
    "tech_software": {
        "prompt": "Name a tech, software, or consumer electronics brand",
        "min_sitelinks": 20,
        "limit": 300,
        "where": """
            { ?item wdt:P31 wd:Q1058914 . } UNION
            { ?item wdt:P452 wd:Q11661 . }
        """,
    },
    "video_games": {
        "prompt": "Name a video game studio, publisher, or console brand",
        "min_sitelinks": 16,
        "limit": 250,
        "where": """
            { ?item wdt:P31 wd:Q210167 . } UNION
            { ?item wdt:P31 wd:Q1137109 . }
        """,
    },
    "fashion_apparel": {
        "prompt": "Name a clothing, fashion, or luxury apparel brand",
        "min_sitelinks": 14,
        "limit": 250,
        "where": """
            { ?item wdt:P31 wd:Q1618899 . } UNION
            { ?item wdt:P452 wd:Q11460 . }
        """,
    },
    "retail_supermarkets": {
        "prompt": "Name a retail store or supermarket chain",
        "min_sitelinks": 15,
        "limit": 250,
        "where": """
            { ?item wdt:P31 wd:Q507619 . } UNION
            { ?item wdt:P31 wd:Q180846 . }
        """,
    },
    "airlines": {
        "prompt": "Name a commercial airline",
        "min_sitelinks": 22,
        "limit": 250,
        "where": """
            { ?item wdt:P31 wd:Q46970 . }
        """,
    },
    "beverages": {
        "prompt": "Name a beverage, soda, coffee, or brewing brand",
        "min_sitelinks": 14,
        "limit": 250,
        "where": """
            { ?item wdt:P31 wd:Q131734 . } UNION
            { ?item wdt:P31 wd:Q147538 . }
        """,
    },
    "candy_snacks": {
        "prompt": "Name a candy, chocolate, or snack brand",
        "min_sitelinks": 12,
        "limit": 250,
        "where": """
            { ?item wdt:P452 wd:Q185583 . } UNION
            { ?item wdt:P1056 wd:Q185583 . } UNION
            { ?item wdt:P1056 wd:Q132311 . }
        """,
    },
    "watchmakers": {
        "prompt": "Name a watchmaker or luxury timepiece brand",
        "min_sitelinks": 12,
        "limit": 200,
        "where": """
            { ?item wdt:P31 wd:Q1762621 . } UNION
            { ?item wdt:P1056 wd:Q178790 . }
        """,
    },
    "hotels_resorts": {
        "prompt": "Name a hotel or resort chain",
        "min_sitelinks": 16,
        "limit": 200,
        "where": """
            { ?item wdt:P31 wd:Q1616075 . }
        """,
    },
    "streaming_media": {
        "prompt": "Name a streaming platform or TV network",
        "min_sitelinks": 22,
        "limit": 250,
        "where": """
            { ?item wdt:P31 wd:Q54820071 . } UNION
            { ?item wdt:P31 wd:Q141683 . }
        """,
    },
    "music_gear": {
        "prompt": "Name a musical instrument or audio gear brand",
        "min_sitelinks": 14,
        "limit": 200,
        "where": """
            { ?item wdt:P31 wd:Q1320047 . } UNION
            { ?item wdt:P1056 wd:Q34379 . }
        """,
    },
    "toy_brands": {
        "prompt": "Name a toy or board game brand",
        "min_sitelinks": 14,
        "limit": 200,
        "where": """
            { ?item wdt:P1056 wd:Q11422 . } UNION
            { ?item wdt:P452 wd:Q188460 . }
        """,
    },
    "banks_fintech": {
        "prompt": "Name a bank or financial services brand",
        "min_sitelinks": 28,
        "limit": 250,
        "where": """
            { ?item wdt:P31 wd:Q22687 . } UNION
            { ?item wdt:P31 wd:Q134161 . }
        """,
    },
    "sports_teams": {
        "prompt": "Name a professional sports franchise or club",
        "min_sitelinks": 48,
        "limit": 300,
        "where": """
            { ?item wdt:P31 wd:Q476028 . } UNION
            { ?item wdt:P31 wd:Q13393265 . } UNION
            { ?item wdt:P31 wd:Q13027888 . }
        """,
    },
    "tire_auto_parts": {
        "prompt": "Name a tire or automotive parts brand",
        "min_sitelinks": 12,
        "limit": 180,
        "where": """
            { ?item wdt:P1056 wd:Q169545 . }
        """,
    },
    "book_publishers": {
        "prompt": "Name a book or comic publisher",
        "min_sitelinks": 28,
        "limit": 220,
        "where": """
            { ?item wdt:P31 wd:Q2085381 . }
        """,
    },
}

CORPORATE_SUFFIXES = re.compile(
    r"\b(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|plc|ag|sa|se|nv|gmbh|group|brands|holdings|international)\b\.?",
    re.IGNORECASE,
)


def normalize_key(text: str) -> str:
    """Normalizes brand names for forgiving player input matching."""
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    text = text.lower().replace("&", "and")
    text = re.sub(r"[^a-z0-9\s]", "", text)
    return re.sub(r"\s+", " ", text).strip()


def generate_aliases(name: str, raw_aliases: list[str]) -> list[str]:
    """Builds canonical + stripped corporate variants + Wikidata aliases."""
    candidates = {name}
    stripped = CORPORATE_SUFFIXES.sub("", name).strip(" ,.-")
    if len(stripped) >= 2:
        candidates.add(stripped)

    for alias in raw_aliases:
        alias = alias.strip()
        if 2 <= len(alias) <= 40:
            candidates.add(alias)

    normalized = {normalize_key(c) for c in candidates if normalize_key(c)}
    return sorted(normalized)


def extract_domain(url: str) -> str:
    if not url:
        return ""
    parsed = urllib.parse.urlparse(url)
    host = parsed.netloc.lower()
    return host[4:] if host.startswith("www.") else host


def query_wikidata(category_key: str, cfg: dict) -> list[dict]:
    sparql = f"""
    SELECT ?item ?label (SAMPLE(?countryName) AS ?country) (SAMPLE(?site) AS ?website)
           ?sitelinks (GROUP_CONCAT(DISTINCT ?alt; separator="|") AS ?aliases)
    WHERE {{
      {cfg["where"]}
      ?item rdfs:label ?label .
      FILTER(LANG(?label) = "en")
      ?item wikibase:sitelinks ?sitelinks .
      FILTER(?sitelinks >= {cfg["min_sitelinks"]})
      OPTIONAL {{
        ?item wdt:P17 ?c .
        ?c rdfs:label ?countryName .
        FILTER(LANG(?countryName) = "en")
      }}
      OPTIONAL {{ ?item wdt:P856 ?site . }}
      OPTIONAL {{
        ?item skos:altLabel ?alt .
        FILTER(LANG(?alt) = "en")
      }}
    }}
    GROUP BY ?item ?label ?sitelinks
    ORDER BY DESC(?sitelinks)
    LIMIT {cfg["limit"]}
    """

    params = urllib.parse.urlencode({"query": sparql, "format": "json"})
    req = urllib.request.Request(
        f"{SPARQL_ENDPOINT}?{params}",
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/sparql-results+json",
        },
    )

    with urllib.request.urlopen(req, timeout=45) as resp:
        data = json.loads(resp.read().decode("utf-8"))

    results = []
    for row in data["results"]["bindings"]:
        name = row["label"]["value"].strip()
        if re.match(r"^Q\d+$", name):
            continue

        qid = row["item"]["value"].split("/")[-1]
        country = row.get("country", {}).get("value", "")
        website = row.get("website", {}).get("value", "")
        sitelinks = int(row["sitelinks"]["value"])
        raw_aliases = row.get("aliases", {}).get("value", "").split("|")

        results.append(
            {
                "id": qid,
                "name": name,
                "category": category_key,
                "country": country,
                "domain": extract_domain(website),
                "popularity": sitelinks,
                "keys": generate_aliases(name, raw_aliases),
            }
        )
    return results


def build_daily_questions(brands_by_id: dict) -> list[dict]:
    """Generates category + country-specific prompts with pre-computed valid IDs."""
    questions = []

    # 1. Core Category Questions
    for cat_key, cfg in CATEGORIES.items():
        valid_ids = [
            b["id"] for b in brands_by_id.values() if cat_key in b["categories"]
        ]
        if len(valid_ids) >= 12:
            questions.append(
                {
                    "id": f"cat_{cat_key}",
                    "prompt": cfg["prompt"],
                    "category": cat_key,
                    "difficulty": "standard",
                    "validIds": valid_ids,
                }
            )

    # 2. Country + Category Combo Questions
    country_filters = [
        ("United States", "American"),
        ("Japan", "Japanese"),
        ("France", "French"),
        ("Germany", "German"),
        ("United Kingdom", "British"),
        ("South Korea", "South Korean"),
        ("Italy", "Italian"),
        ("Switzerland", "Swiss"),
        ("Canada", "Canadian"),
        ("Sweden", "Swedish"),
    ]
    for country_name, demonym in country_filters:
        for cat_key, cfg in CATEGORIES.items():
            valid_ids = [
                b["id"]
                for b in brands_by_id.values()
                if cat_key in b["categories"] and b["country"] == country_name
            ]
            if len(valid_ids) >= 8:
                clean_topic = cfg["prompt"].replace("Name a ", "").replace("Name an ", "")
                article = "an" if demonym[0].lower() in "aeiou" else "a"
                questions.append(
                    {
                        "id": f"combo_{country_name.lower().replace(' ', '_')}_{cat_key}",
                        "prompt": f"Name {article} {demonym} {clean_topic}",
                        "category": cat_key,
                        "difficulty": "hard",
                        "validIds": valid_ids,
                    }
                )

    return questions


def main():
    brands_by_id = {}
    lookup_index = {}

    for cat_key, cfg in CATEGORIES.items():
        print(f"Fetching [{cat_key}] from Wikidata...")
        try:
            entries = query_wikidata(cat_key, cfg)
            print(f"  -> Retrieved {len(entries)} brands")
            for entry in entries:
                qid = entry["id"]
                if qid not in brands_by_id:
                    brands_by_id[qid] = {
                        "id": qid,
                        "name": entry["name"],
                        "categories": [cat_key],
                        "country": entry["country"],
                        "domain": entry["domain"],
                        "popularity": entry["popularity"],
                        "keys": entry["keys"],
                    }
                else:
                    if cat_key not in brands_by_id[qid]["categories"]:
                        brands_by_id[qid]["categories"].append(cat_key)
                    merged_keys = set(brands_by_id[qid]["keys"]) | set(entry["keys"])
                    brands_by_id[qid]["keys"] = sorted(merged_keys)

                for k in brands_by_id[qid]["keys"]:
                    lookup_index.setdefault(k, [])
                    if qid not in lookup_index[k]:
                        lookup_index[k].append(qid)

        except Exception as exc:
            print(f"  [!] Error fetching {cat_key}: {exc}")

        time.sleep(1.2)

    daily_questions = build_daily_questions(brands_by_id)

    db_payload = {
        "meta": {
            "totalBrands": len(brands_by_id),
            "totalKeys": len(lookup_index),
            "categories": list(CATEGORIES.keys()),
        },
        "brands": brands_by_id,
        "lookup": lookup_index,
    }

    with open("brands_db.json", "w", encoding="utf-8") as f:
        json.dump(db_payload, f, ensure_ascii=False, indent=2)

    with open("daily_questions.json", "w", encoding="utf-8") as f:
        json.dump(daily_questions, f, ensure_ascii=False, indent=2)

    with open("brands_data.js", "w", encoding="utf-8") as f:
        f.write("window.SINGULARITY_DB = ")
        json.dump(db_payload, f, ensure_ascii=False)
        f.write(";\nwindow.SINGULARITY_QUESTIONS = ")
        json.dump(daily_questions, f, ensure_ascii=False)
        f.write(";\n")

    print(
        f"\nDone! Saved {len(brands_by_id)} unique brands, "
        f"{len(lookup_index)} searchable keys, and {len(daily_questions)} daily prompts."
    )


if __name__ == "__main__":
    main()
