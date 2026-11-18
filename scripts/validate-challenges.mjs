import fs from "node:fs";

const source = fs.readFileSync(new URL("../prepared_challenges.js", import.meta.url), "utf8");
const marker = "window.BLASTOFF_PREPARED = ";
const start = source.indexOf(marker);
if (start < 0) throw new Error("Prepared challenge export was not found.");
const payload = JSON.parse(source.slice(start + marker.length, source.lastIndexOf(";")));
const dates = Object.keys(payload.days || {});
if (dates.length !== 90) throw new Error(`Expected 90 days, found ${dates.length}.`);
const questionIds = Object.keys(payload.questions || {});
if (questionIds.length < 7) throw new Error("Not enough question families to create a daily challenge.");
const signatures = new Set();
let previous = [];
for (const date of dates) {
  const ids = payload.days[date];
  if (!Array.isArray(ids) || ids.length !== 7) throw new Error(`${date} does not contain exactly seven rounds.`);
  if (new Set(ids).size !== 7) throw new Error(`${date} contains duplicate rounds.`);
  for (const id of ids) {
    const question = payload.questions[id];
    if (!question) throw new Error(`${date} references missing question ${id}.`);
    if (!Array.isArray(question.answers) || question.answers.length < 10) throw new Error(`${id} has an insufficient answer pool.`);
    for (const answer of question.answers) {
      if (!answer.name || !Array.isArray(answer.aliases) || ![10,25,50,75,100].includes(answer.points)) {
        throw new Error(`${id} contains an invalid prepared answer.`);
      }
    }
  }
  const signature = [...ids].sort().join("|");
  if (signatures.has(signature)) throw new Error(`Duplicate daily set on ${date}.`);
  signatures.add(signature);
  const overlap = ids.filter(id => previous.includes(id)).length;
  if (overlap > 2) throw new Error(`${date} repeats more than two prompts from the previous day.`);
  previous = ids;
}
console.log(`Validated ${dates.length} days, ${dates.length*7} rounds, ${questionIds.length} prompt families, ${questionIds.reduce((n,id)=>n+payload.questions[id].answers.length,0)} prepared answers.`);
