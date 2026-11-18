import fs from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const read = name => fs.readFileSync(new URL(name, root), "utf8");
const indexHtml = read("index.html");
const brandsSource = read("brands_data.js");
const legacyQuestions = JSON.parse(read("daily_questions.json"));

function extractArrayAfter(source, marker) {
  const markerAt = source.indexOf(marker);
  if (markerAt < 0) throw new Error("Could not find " + marker);
  const start = source.indexOf("[", markerAt + marker.length);
  let depth = 0, quote = null, escaped = false, lineComment = false, blockComment = false;
  for (let i = start; i < source.length; i++) {
    const c = source[i], next = source[i + 1];
    if (lineComment) { if (c === "\n") lineComment = false; continue; }
    if (blockComment) { if (c === "*" && next === "/") { blockComment = false; i++; } continue; }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (c === "\\") { escaped = true; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "/" && next === "/") { lineComment = true; i++; continue; }
    if (c === "/" && next === "*") { blockComment = true; i++; continue; }
    if (c === '"' || c === "'" || c === "\`") { quote = c; continue; }
    if (c === "[") depth++;
    if (c === "]" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error("Unclosed categories array");
}

const baseCategories = vm.runInNewContext("(" + extractArrayAfter(indexHtml, "const categories =") + ")");
const extraCategories = vm.runInNewContext("(" + extractArrayAfter(indexHtml, "const extraCategories =") + ")");
const categoriesByKey = new Map();
for (const category of [...baseCategories, ...extraCategories]) {
  if (category?.baseKey) categoriesByKey.set(category.baseKey, category);
}
const curatedCategories = [...categoriesByKey.values()];

const dbStart = brandsSource.indexOf("=") + 1;
const dbEnd = brandsSource.indexOf(";\nwindow.SINGULARITY_QUESTIONS");
if (dbStart < 1 || dbEnd < 0) throw new Error("Could not parse brands_data.js.");
const db = JSON.parse(brandsSource.slice(dbStart, dbEnd).trim());
const normalize = value => String(value || "").toLowerCase().normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "").replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
const tier = points => points >= 95 ? 100 : points >= 65 ? 75 : points >= 40 ? 50 : points >= 20 ? 25 : 10;
const popularityTier = popularity => {
  const n = Number(popularity) || 0;
  if (n >= 70) return 10;
  if (n >= 55) return 25;
  if (n >= 40) return 50;
  if (n >= 25) return 75;
  return 100;
};

const recordsByName = new Map();
for (const brand of Object.values(db.brands || {})) {
  const key = normalize(brand.name);
  if (key) recordsByName.set(key, brand);
}
const iconsByCategory = Object.fromEntries(curatedCategories.map(c => [c.baseKey, c.icon || "🚀"]));
const templates = [];
const answerBanks = {};

function cleanAnswers(items, bankKey) {
  const byCanonical = new Map();
  for (const item of items) {
    const name = String(item.name || "").trim();
    const canonical = normalize(name);
    if (!canonical || byCanonical.has(canonical)) continue;
    const aliases = [...new Set([name, ...(item.aliases || [])].map(x => String(x || "").trim()).filter(Boolean))];
    byCanonical.set(canonical, {name, aliases, points:tier(Number(item.points)), source:item.source || "curated"});
  }
  const owners = new Map();
  for (const answer of byCanonical.values()) {
    for (const alias of [answer.name, ...answer.aliases]) {
      const key = normalize(alias);
      if (!key) continue;
      if (!owners.has(key)) owners.set(key, new Set());
      owners.get(key).add(normalize(answer.name));
    }
  }
  const answers = [...byCanonical.values()].map(answer => ({
    ...answer,
    aliases:answer.aliases.filter(alias => {
      const key = normalize(alias);
      return key === normalize(answer.name) || owners.get(key)?.size === 1;
    })
  })).sort((a,b) => a.points-b.points || a.name.localeCompare(b.name));
  if (answers.length < 8) return null;
  answerBanks[bankKey] = {answers};
  return answers;
}

// First use the hand-reviewed answer lists already in the game.
for (const category of curatedCategories) {
  const items = [];
  for (const [name, rawPoints] of Object.entries(category.brands || {})) {
    const record = recordsByName.get(normalize(name));
    items.push({name, points:rawPoints, aliases:record?.keys || [], source:"curated"});
  }
  const bankKey = category.baseKey;
  const answers = cleanAnswers(items, bankKey);
  if (!answers) continue;
  templates.push({
    templateId:"curated_" + bankKey,
    bankKey,
    category:bankKey,
    prompt:String(category.q || "Name a brand.").replace(/[.!?]+$/, ""),
    icon:category.icon || "🚀",
    answers
  });
}

// Then add vetted country/category question sets from the existing Wikidata registry.
// Broad global templates are already represented above; country-only sports-team
// prompts are intentionally excluded to avoid overly niche club questions.
const curatedKeys = new Set(curatedCategories.map(c => c.baseKey));
for (const question of legacyQuestions) {
  if (!question || !Array.isArray(question.validIds) || question.category === "sports_teams") continue;
  if (question.id.startsWith("cat_") && curatedKeys.has(question.category)) continue;
  if (!question.id.startsWith("combo_")) continue;
  const records = question.validIds.map(id => db.brands?.[id]).filter(Boolean);
  const uniqueRecords = [...new Map(records.map(record => [normalize(record.name), record])).values()];
  if (uniqueRecords.length < 12) continue;
  const bankKey = "wikidata_" + question.id;
  const answers = cleanAnswers(uniqueRecords.map(record => ({
    name:record.name,
    aliases:record.keys || [],
    points:popularityTier(record.popularity),
    source:"wikidata_registry"
  })), bankKey);
  if (!answers || answers.length < 12) {
    delete answerBanks[bankKey];
    continue;
  }
  const prompt = String(question.prompt || "").replace(/[.!?]+$/, "");
  if (!prompt || /sports franchise or club|professional sports/i.test(prompt)) {
    delete answerBanks[bankKey];
    continue;
  }
  templates.push({
    templateId:question.id,
    bankKey,
    category:question.category,
    prompt,
    icon:iconsByCategory[question.category] || "🌍",
    answers
  });
}

const uniqueTemplates = [...new Map(templates.map(t => [t.templateId, t])).values()];
if (uniqueTemplates.length < 35) {
  throw new Error("Only " + uniqueTemplates.length + " good question templates passed validation; refusing to publish a repetitive schedule.");
}

const startDate = process.env.BLASTOFF_START_DATE || new Date().toISOString().slice(0,10);
const parsedStartDate = new Date(startDate + "T00:00:00Z");
if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
    Number.isNaN(parsedStartDate.getTime()) ||
    parsedStartDate.toISOString().slice(0,10) !== startDate) {
  throw new Error("Invalid BLASTOFF_START_DATE.");
}
let seed = [...startDate].reduce((a,c)=>Math.imul(a ^ c.charCodeAt(0),16777619)>>>0,2166136261);
function random(){ seed=(Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296; }
function shuffled(items){ const out=[...items]; for(let i=out.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[out[i],out[j]]=[out[j],out[i]];} return out; }

const start = new Date(startDate + "T00:00:00Z");
const days = {}, questions = {};
const recentTemplateIds = [];
for (let d=0; d<90; d++) {
  const date = new Date(start.getTime() + d*86400000).toISOString().slice(0,10);
  const recent = new Set(recentTemplateIds);
  const eligible = uniqueTemplates.filter(t => !recent.has(t.templateId));
  if (eligible.length < 7) throw new Error("Not enough fresh templates for " + date);
  const daily = shuffled(eligible).slice(0,7);
  days[date] = [];
  for (let round=0; round<7; round++) {
    const template = daily[round];
    const id = "daily_" + date + "_r" + (round+1);
    questions[id] = {
      id,
      templateId:template.templateId,
      prompt:template.prompt.endsWith(".") ? template.prompt : template.prompt + ".",
      icon:template.icon,
      category:template.category,
      sourceCategories:[template.bankKey]
    };
    days[date].push(id);
  }
  recentTemplateIds.push(...daily.map(t => t.templateId));
  while (recentTemplateIds.length > 35) recentTemplateIds.shift();
}

for (const [date, ids] of Object.entries(days)) {
  if (ids.length !== 7 || new Set(ids).size !== 7) throw new Error("Invalid seven-question set: " + date);
  for (const id of ids) {
    const q = questions[id];
    const bank = answerBanks[q.sourceCategories[0]]?.answers || [];
    if (bank.length < 8 || !q.prompt || /connected to|or cars and motorcycles|brand or organization|professional sports franchise or club/i.test(q.prompt)) {
      throw new Error("Question failed answer-bank validation: " + id);
    }
  }
}
if (Object.keys(days).length !== 90 || Object.keys(questions).length !== 630) {
  throw new Error("Expected 90 days and 630 scheduled question instances.");
}
const templateIds = new Set(Object.values(questions).map(q => q.templateId));
const output = {
  version:4,
  generatedAt:new Date().toISOString(),
  startDate,
  days,
  questions,
  answerBanks,
  metadata:{
    dayCount:90,
    questionCount:630,
    roundsPerDay:7,
    categoryCount:uniqueTemplates.length,
    uniqueQuestionTemplates:uniqueTemplates.length,
    source:"Hand-reviewed BLASTOFF category lists plus the repository's curated Wikidata brand registry and country/category subsets.",
    scoring:"Fixed five-level estimated rarity tiers. Curated lists retain editorial values; registry-derived subsets use Wikidata popularity as a conservative proxy. Scores are frozen before play.",
    validation:"90 days and 630 question instances; seven distinct templates per day; no template repeats within a rolling five-day window; answer banks precomputed; ambiguous aliases removed; sports-team prompts excluded."
  }
};
const js = "// Generated by scripts/generate-challenges.mjs. Do not edit by hand.\nwindow.BLASTOFF_PREPARED = " + JSON.stringify(output) + ";\n";
fs.writeFileSync(new URL("../prepared_challenges.js", import.meta.url), js);
fs.writeFileSync(new URL("../prepared_challenges.json", import.meta.url), JSON.stringify(output, null, 2) + "\n");
console.log("Generated " + Object.keys(days).length + " days, " + Object.keys(questions).length +
  " scheduled question instances across " + uniqueTemplates.length + " validated templates and " + Object.keys(answerBanks).length + " frozen answer banks.");
