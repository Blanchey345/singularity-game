import fs from "node:fs";
const source = fs.readFileSync(new URL("../prepared_challenges.js", import.meta.url), "utf8");
const marker = "window.BLASTOFF_PREPARED = ";
const start = source.indexOf(marker);
if (start < 0) throw new Error("Prepared challenge export was not found.");
const payload = JSON.parse(source.slice(start + marker.length, source.lastIndexOf(";")));
const dates = Object.keys(payload.days || {});
const questionIds = Object.keys(payload.questions || {});
if (dates.length !== 90) throw new Error("Expected 90 days, found " + dates.length + ".");
if (questionIds.length !== 630) throw new Error("Expected 630 unique prompts, found " + questionIds.length + ".");
const used = new Set();
for (const date of dates) {
  const ids = payload.days[date];
  if (!Array.isArray(ids) || ids.length !== 7 || new Set(ids).size !== 7) throw new Error(date + " must contain seven distinct rounds.");
  for (const id of ids) {
    if (!payload.questions[id]) throw new Error(date + " references missing question " + id + ".");
    if (used.has(id)) throw new Error("Prompt repeated during the 90-day schedule: " + id);
    used.add(id);
    const question = payload.questions[id];
    const merged = new Map();
    for (const category of question.sourceCategories || []) {
      const bank = payload.answerBanks[category];
      if (!bank) throw new Error(id + " references missing answer bank " + category + ".");
      for (const answer of bank.answers) merged.set(answer.name.toLowerCase(), answer);
    }
    if (merged.size < 10) throw new Error(id + " has fewer than ten accepted answers.");
  }
}
if (used.size !== 630) throw new Error("Not all 630 prompts are scheduled.");
for (const [category,bank] of Object.entries(payload.answerBanks || {})) {
  if (bank.answers.length < 10) throw new Error(category + " answer bank is too small.");
  for (const answer of bank.answers) if (!answer.name || !answer.aliases?.length || ![10,25,50,75,100].includes(answer.points)) throw new Error("Invalid answer in " + category + ".");
}
console.log("Validated 90 days, 630 unique prompts, 630 rounds, and " + Object.keys(payload.answerBanks).length + " fixed answer banks.");
