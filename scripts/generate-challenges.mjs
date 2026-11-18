import fs from "node:fs";

const source = fs.readFileSync(new URL("../brands_data.js", import.meta.url), "utf8");
const dbStart = source.indexOf("= ") + 2;
const dbEnd = source.indexOf(";\nwindow.SINGULARITY_QUESTIONS");
if (dbStart < 2 || dbEnd < 0) throw new Error("Could not parse brands_data.js.");
const db = JSON.parse(source.slice(dbStart, dbEnd));
const labels = {"cosmetics":"beauty and skincare","fast_food":"fast food and restaurants","automotive":"cars and motorcycles","tech_software":"technology","video_games":"video games","fashion_apparel":"fashion","retail_supermarkets":"retail and grocery","airlines":"airlines","beverages":"beverages","hotels_resorts":"hotels and resorts","music_gear":"music and audio","toy_brands":"toys and board games","banks_fintech":"banking and finance","sports_teams":"professional sports","tire_auto_parts":"automotive parts","book_publishers":"book publishing"};
const icons = {"cosmetics":"🧴","fast_food":"🍔","automotive":"🚘","tech_software":"💻","video_games":"🎮","fashion_apparel":"👜","retail_supermarkets":"🛒","airlines":"✈️","beverages":"🥤","hotels_resorts":"🏨","music_gear":"🎸","toy_brands":"🧸","banks_fintech":"💳","sports_teams":"🏆","tire_auto_parts":"🛞","book_publishers":"📚"};
const normalize = value => String(value || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
const brands = Object.values(db.brands);
const curatedFastFood = [["McDonald's",10],["Burger King",10],["Wendy's",10],["Taco Bell",10],["Subway",10],["KFC",10],["Starbucks",10],["Domino's",10],["Chick-fil-A",10],["Popeyes",25],["Chipotle",25],["Pizza Hut",25],["Five Guys",25],["Dairy Queen",25],["Little Caesars",25],["Wingstop",25],["Dunkin'",25],["Panda Express",25],["Panera Bread",25],["Papa John's",25],["Jimmy John's",25],["Jersey Mike's",25],["Raising Cane's",25],["In-N-Out",25],["Sonic",25],["Arby's",25],["Jack in the Box",25],["Krispy Kreme",25],["Shake Shack",50],["Whataburger",50],["Culver's",50],["Carl's Jr.",50],["Hardee's",50],["White Castle",50],["Zaxby's",50],["Bojangles",50],["Church's Chicken",50],["Tim Hortons",50],["Firehouse Subs",50],["Auntie Anne's",50],["Cinnabon",50],["Baskin-Robbins",50],["Cold Stone Creamery",50],["Jamba Juice",50],["Smoothie King",50],["Qdoba",50],["Moe's Southwest Grill",50],["Del Taco",50],["El Pollo Loco",50]];
for (const [name, points] of curatedFastFood) {
  if (!brands.some(brand => normalize(brand.name) === normalize(name))) {
    brands.push({ id: "CURATED_" + normalize(name), name, categories: ["fast_food"], keys: [normalize(name)], popularity: points, curated: true });
  }
}
const answerBanks = {};
for (const category of Object.keys(labels)) {
  const seen = new Set();
  const answers = [];
  for (const brand of brands.filter(item => item.categories?.includes(category))) {
    const name = brand.name?.trim();
    const key = normalize(name);
    if (!name || !key || seen.has(key)) continue;
    seen.add(key);
    const popularity = Number(brand.popularity || 0);
    const points = brand.curated ? popularity : popularity >= 75 ? 10 : popularity >= 45 ? 25 : popularity >= 20 ? 50 : popularity >= 10 ? 75 : 100;
    const tier = ({10:"Space Dust",25:"Satellite",50:"Nebula",75:"Supernova",100:"Singularity"})[points];
    answers.push({ name, aliases:[...new Set([...(brand.keys || []),name].map(value => String(value).trim()).filter(Boolean))], points, tier });
  }
  answers.sort((a,b) => a.points-b.points || a.name.localeCompare(b.name));
  if (answers.length >= 10) answerBanks[category] = { label:labels[category], icon:icons[category], answers };
}
const categoryIds = Object.keys(answerBanks).sort();
const combinations = [];
for (let i=0;i<categoryIds.length;i++) for (let j=i+1;j<categoryIds.length;j++) combinations.push([categoryIds[i],categoryIds[j]]);
for (let i=0;i<categoryIds.length;i++) for (let j=i+1;j<categoryIds.length;j++) for (let k=j+1;k<categoryIds.length;k++) combinations.push([categoryIds[i],categoryIds[j],categoryIds[k]]);
if (combinations.length < 630) throw new Error("Not enough category combinations for 630 unique prompts.");
const questions = {};
for (const combo of combinations.slice(0,630)) {
  const id = "combo_" + combo.join("_");
  const names = combo.map(category => answerBanks[category].label);
  const phrase = names.length === 2 ? names[0] + " or " + names[1] : names[0] + ", " + names[1] + ", or " + names[2];
  questions[id] = { id, prompt:"Name a brand or organization connected to " + phrase + ".", icon:answerBanks[combo[0]].icon, category:phrase, sourceCategories:combo };
}
const startDate = process.env.BLASTOFF_START_DATE || new Date().toISOString().slice(0,10);
const start = new Date(startDate + "T00:00:00Z");
const ids = Object.keys(questions);
const days = {};
for (let d=0;d<90;d++) {
  const date = new Date(start.getTime() + d*86400000).toISOString().slice(0,10);
  days[date] = ids.slice(d*7,(d+1)*7);
}
const output = { version:2, startDate, days, questions, answerBanks };
const js = "// Generated by scripts/generate-challenges.mjs. Do not edit by hand.\nwindow.BLASTOFF_PREPARED = " + JSON.stringify(output) + ";\n";
fs.writeFileSync(new URL("../prepared_challenges.js", import.meta.url), js);
fs.writeFileSync(new URL("../prepared_challenges.json", import.meta.url), JSON.stringify(output));
console.log("Generated " + Object.keys(days).length + " days, " + ids.length + " unique prompts, and " + Object.keys(answerBanks).length + " answer banks.");
