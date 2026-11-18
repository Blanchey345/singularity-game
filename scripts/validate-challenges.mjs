import fs from "node:fs";

const read = name => fs.readFileSync(new URL("../" + name, import.meta.url), "utf8");
const source = read("prepared_challenges.js");
const index = read("index.html");
const marker = "window.BLASTOFF_PREPARED = ";
const start = source.indexOf(marker);
if (start < 0) throw new Error("Prepared challenge export was not found.");
const payload = JSON.parse(source.slice(start + marker.length, source.lastIndexOf(";")));
const dates = Object.keys(payload.days || {}).sort();
const questionIds = Object.keys(payload.questions || {});
const allowedPoints = new Set([10,25,50,75,100]);
const normalize = value => String(value || "").toLowerCase().normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "").replace(/&/g, "and").replace(/[^a-z0-9]/g, "");

if (payload.version !== 4) throw new Error("Unexpected prepared data version.");
if (dates.length !== 90) throw new Error("Expected 90 days, found " + dates.length + ".");
if (questionIds.length !== 630) throw new Error("Expected 630 unique question instances, found " + questionIds.length + ".");
if (Object.keys(payload.answerBanks || {}).length < 35) throw new Error("Not enough validated answer banks.");

const usedQuestionIds = new Set();
const templateHistory = [];
for (const date of dates) {
  const ids = payload.days[date];
  if (!Array.isArray(ids) || ids.length !== 7 || new Set(ids).size !== 7) {
    throw new Error(date + " must contain seven distinct rounds.");
  }
  const previousTemplates = new Set(templateHistory);
  const todaysTemplates = new Set();
  for (const id of ids) {
    const question = payload.questions[id];
    if (!question) throw new Error(date + " references missing question " + id + ".");
    if (usedQuestionIds.has(id)) throw new Error("Question instance repeated in schedule: " + id + ".");
    usedQuestionIds.add(id);
    if (!question.templateId || previousTemplates.has(question.templateId) || todaysTemplates.has(question.templateId)) {
      throw new Error(date + " repeats a question template too soon: " + question.templateId + ".");
    }
    todaysTemplates.add(question.templateId);
    if (!question.prompt || /connected to|or cars and motorcycles|brand or organization|professional sports franchise or club/i.test(question.prompt)) {
      throw new Error("Unnatural or excluded prompt: " + question.prompt);
    }
    const merged = new Map();
    for (const category of question.sourceCategories || []) {
      const bank = payload.answerBanks[category];
      if (!bank) throw new Error(id + " references missing answer bank " + category + ".");
      for (const answer of bank.answers) merged.set(normalize(answer.name), answer);
    }
    if (merged.size < 10) throw new Error(id + " has fewer than ten accepted answers.");
  }
  templateHistory.push(...todaysTemplates);
  while (templateHistory.length > 28) templateHistory.shift();
}
if (usedQuestionIds.size !== 630) throw new Error("Not all 630 question instances are scheduled.");

for (const [category, bank] of Object.entries(payload.answerBanks || {})) {
  if (!Array.isArray(bank.answers) || bank.answers.length < 10) throw new Error(category + " answer bank is too small.");
  const aliasOwners = new Map();
  for (const answer of bank.answers) {
    if (!answer.name || !Array.isArray(answer.aliases) || !answer.aliases.length || !allowedPoints.has(answer.points)) {
      throw new Error("Invalid answer in " + category + ".");
    }
    for (const alias of [answer.name, ...answer.aliases]) {
      const key = normalize(alias);
      if (!aliasOwners.has(key)) aliasOwners.set(key, new Set());
      aliasOwners.get(key).add(normalize(answer.name));
    }
  }
  if ([...aliasOwners.values()].some(owners => owners.size > 1)) {
    throw new Error("Ambiguous aliases remain in " + category + ".");
  }
}

if (!index.includes('"mccdonalds":"mcdonalds"')) throw new Error("The McDonald's typo alias is missing.");
if (!index.includes("Damerau-Levenshtein style distance")) throw new Error("Transposition-aware typo matching is missing.");
if (!index.includes('timeZone:"America/New_York"')) throw new Error("The game reset is not aligned to Eastern time.");
for (const points of [10,25,50,75,100]) {
  if (!index.includes("points:" + points + ", name:")) throw new Error("Rarity tier " + points + " is missing its point value.");
}
console.log("Validated 90 days, 630 question instances, " + Object.keys(payload.answerBanks).length +
  " answer banks, typo handling, rarity tiers, and the four-day question rotation.");
