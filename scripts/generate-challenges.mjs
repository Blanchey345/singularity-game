import fs from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const read = name => fs.readFileSync(new URL(name, root), "utf8");
const indexHtml = read("index.html");
const brandsSource = read("brands_data.js");

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
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "[") depth++;
    if (c === "]" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error("Unclosed categories array");
}

const categoryLiteral = extractArrayAfter(indexHtml, "const categories =");
const categories = vm.runInNewContext("(" + categoryLiteral + ")");
const dbStart = brandsSource.indexOf("=") + 1;
const dbEnd = brandsSource.indexOf(";\nwindow.SINGULARITY_QUESTIONS");
if (dbStart < 1 || dbEnd < 0) throw new Error("Could not parse brands_data.js.");
const db = JSON.parse(brandsSource.slice(dbStart, dbEnd).trim());
const normalize = value => String(value || "").toLowerCase().normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "").replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
const tier = points => points >= 95 ? 100 : points >= 65 ? 75 : points >= 40 ? 50 : points >= 20 ? 25 : 10;

const canonicalRecords = new Map();
for (const brand of Object.values(db.brands || {})) {
  const key = normalize(brand.name);
  if (key) canonicalRecords.set(key, brand);
}

const answerBanks = {};
const usableCategories = [];
for (const category of categories) {
  const key = category.baseKey;
  if (!key || !category.brands || Object.keys(category.brands).length < 8) continue;
  const answers = [];
  const seen = new Set();
  for (const [name, rawPoints] of Object.entries(category.brands)) {
    const canonical = normalize(name);
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    const aliases = new Set([name]);
    const record = canonicalRecords.get(canonical);
    if (record && Array.isArray(record.keys)) {
      for (const alias of record.keys) {
        const aliasNorm = normalize(alias);
        if (aliasNorm.length >= 3 && aliasNorm.length <= 40 &&
            !/https|www|\.com|\.net|\.org/i.test(alias)) aliases.add(alias);
      }
    }
    answers.push({name, aliases:[...aliases], points:tier(Number(rawPoints))});
  }
  if (answers.length < 8) continue;
  answers.sort((a,b) => a.points-b.points || a.name.localeCompare(b.name));
  answerBanks[key] = {answers};
  usableCategories.push({
    key, prompt:String(category.q || "Name a brand.").replace(/[.!?]+$/, ""),
    icon:category.icon || "🚀", answers
  });
}
if (usableCategories.length < 10) {
  throw new Error("Only " + usableCategories.length + " curated categories passed validation.");
}

const startDate = process.env.BLASTOFF_START_DATE || new Date().toISOString().slice(0,10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
    Number.isNaN(Date.parse(startDate + "T00:00:00Z"))) throw new Error("Invalid BLASTOFF_START_DATE.");
let seed = [...startDate].reduce((a,c)=>Math.imul(a ^ c.charCodeAt(0),16777619)>>>0,2166136261);
function random(){ seed=(Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296; }
function shuffled(items){ const out=[...items]; for(let i=out.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[out[i],out[j]]=[out[j],out[i]];} return out; }

const start = new Date(startDate + "T00:00:00Z");
const days = {}, questions = {}, usedPrompts = new Set();
for (let d=0; d<90; d++) {
  const date = new Date(start.getTime() + d*86400000).toISOString().slice(0,10);
  const daily = shuffled(usableCategories).slice(0,7);
  days[date] = [];
  for (let round=0; round<7; round++) {
    const category = daily[round];
    const common = category.answers.filter(a=>a.points<=25).map(a=>a.name);
    const examplePool = common.length >= 3 ? common : category.answers.map(a=>a.name);
    // Keep prompts natural and broad. Do not inject random examples that make
    // a category sound narrower or more obscure than it really is.
    const prompt = category.prompt.endsWith(".") ? category.prompt : category.prompt + ".";
    usedPrompts.add(category.key);
    const id = "daily_" + date + "_r" + (round+1);
    questions[id] = {id, prompt, icon:category.icon, category:category.key, sourceCategories:[category.key]};
    days[date].push(id);
  }
}
for (const [date, ids] of Object.entries(days)) {
  if (ids.length !== 7 || new Set(ids).size !== 7) throw new Error("Invalid seven-question set: " + date);
  for (const id of ids) {
    const q = questions[id];
    const bank = answerBanks[q.sourceCategories[0]]?.answers || [];
    if (bank.length < 8 || !q.prompt || !bank.some(a=>q.prompt.includes(a.name))) {
      throw new Error("Question failed answer-bank validation: " + id);
    }
  }
}
if (Object.keys(days).length !== 90 || Object.keys(questions).length !== 630 || usedPrompts.size !== 630) {
  throw new Error("Expected 90 days and 630 unique prompts.");
}

const output = {
  version:3, generatedAt:new Date().toISOString(), startDate, days, questions, answerBanks,
  metadata:{
    dayCount:90, questionCount:630, roundsPerDay:7, categoryCount:usableCategories.length, uniqueQuestionTemplates:usableCategories.length,
    source:"Curated brand lists embedded in index.html; Wikidata is used only to add aliases to exact canonical matches.",
    scoring:"Fixed 10/25/50/75/100 point tiers copied from the curated source lists.",
    validation:"Seven distinct categories per day; 630 scheduled question instances; prompt templates repeat across days; each question has a precomputed answer bank."
  }
};
const js = "// Generated by scripts/generate-challenges.mjs. Do not edit by hand.\nwindow.BLASTOFF_PREPARED = " + JSON.stringify(output) + ";\n";
fs.writeFileSync(new URL("../prepared_challenges.js", import.meta.url), js);
fs.writeFileSync(new URL("../prepared_challenges.json", import.meta.url), JSON.stringify(output, null, 2) + "\n");
console.log("Generated " + Object.keys(days).length + " days, " + Object.keys(questions).length +
  " unique prompts, and " + Object.keys(answerBanks).length + " curated answer banks.");
