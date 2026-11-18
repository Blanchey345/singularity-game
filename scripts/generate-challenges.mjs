import fs from "node:fs";

const dbSource = fs.readFileSync(new URL("../brands_data.js", import.meta.url), "utf8");
const dbStart = dbSource.indexOf("= ") + 2;
const dbEnd = dbSource.indexOf(";\nwindow.SINGULARITY_QUESTIONS");
if (dbStart < 2 || dbEnd < 0) throw new Error("Could not parse brands_data.js database.");
const db = JSON.parse(dbSource.slice(dbStart, dbEnd));
const questionStart = dbSource.indexOf("= ", dbEnd) + 2;
const questionEnd = dbSource.lastIndexOf(";");
const sourceQuestions = JSON.parse(dbSource.slice(questionStart, questionEnd));
const normalize = value => String(value || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
const labels = {"cosmetics":"cosmetics, makeup, or skincare","fast_food":"fast-food, coffee, or restaurant","automotive":"automobile or motorcycle","tech_software":"technology or software","video_games":"video game studio or publisher","fashion_apparel":"fashion or apparel","retail_supermarkets":"retail or supermarket","airlines":"commercial airline","beverages":"soda, coffee, or beverage","candy_snacks":"candy, chocolate, or snack","hotels_resorts":"hotel or resort","music_gear":"musical instrument or audio","toy_brands":"toy or board game","banks_fintech":"bank or financial services","sports_teams":"professional sports team or club","tire_auto_parts":"tire or automotive parts","book_publishers":"book or comic publisher"};
const icons = {"cosmetics":"🧴","fast_food":"🍔","automotive":"🚘","tech_software":"💻","video_games":"🎮","fashion_apparel":"👜","retail_supermarkets":"🛒","airlines":"✈️","beverages":"🥤","candy_snacks":"🍫","hotels_resorts":"🏨","music_gear":"🎸","toy_brands":"🧸","banks_fintech":"💳","sports_teams":"🏆","tire_auto_parts":"🛞","book_publishers":"📚"};
const brands = Object.values(db.brands);
const curatedFastFood = [["McDonald's",10],["Burger King",10],["Wendy's",10],["Taco Bell",10],["Subway",10],["KFC",10],["Starbucks",10],["Domino's",10],["Chick-fil-A",10],["Popeyes",25],["Chipotle",25],["Pizza Hut",25],["Five Guys",25],["Dairy Queen",25],["Little Caesars",25],["Wingstop",25],["Dunkin'",25],["Panda Express",25],["Panera Bread",25],["Papa John's",25],["Jimmy John's",25],["Jersey Mike's",25],["Raising Cane's",25],["In-N-Out",25],["Sonic",25],["Arby's",25],["Jack in the Box",25],["Krispy Kreme",25],["Shake Shack",50],["Whataburger",50],["Culver's",50],["Carl's Jr.",50],["Hardee's",50],["White Castle",50],["Zaxby's",50],["Bojangles",50],["Church's Chicken",50],["Tim Hortons",50],["Firehouse Subs",50],["Auntie Anne's",50],["Cinnabon",50],["Baskin-Robbins",50],["Cold Stone Creamery",50],["Jamba Juice",50],["Smoothie King",50],["Qdoba",50],["Moe's Southwest Grill",50],["Del Taco",50],["El Pollo Loco",50]];
for (const [name, popularity] of curatedFastFood) {
  if (!brands.some(b => normalize(b.name) === normalize(name))) brands.push({ id: "CURATED_" + normalize(name), name, categories: ["fast_food"], keys: [normalize(name)], popularity, curated: true });
}
const templates = [];
for (const category of Object.keys(labels)) {
  const source = sourceQuestions.find(q => q.id === "cat_" + category);
  if (!source) continue;
  const validIds = new Set(source.validIds || []);
  const matches = brands.filter(b => validIds.has(b.id) || (b.curated && b.categories?.includes(category)));
  if (matches.length >= 12) templates.push({ id: "single_" + category, prompt: source.prompt.replace(/[.!?]+$/, "") + ".", icon: icons[category], category, sourceCategories: [category], brands: matches });
}
const groups = [{"id":"mix_food_drink","prompt":"Name a brand in fast food, drinks, or snacks.","icon":"🍟","category":"food & drink","sourceCategories":["fast_food","beverages","candy_snacks"]},{"id":"mix_tech_gaming","prompt":"Name a technology, gaming, or audio brand.","icon":"🕹️","category":"technology & gaming","sourceCategories":["tech_software","video_games","music_gear","streaming_media"]},{"id":"mix_transport","prompt":"Name a car, airline, or automotive parts brand.","icon":"🚗","category":"transportation","sourceCategories":["automotive","airlines","tire_auto_parts"]},{"id":"mix_style","prompt":"Name a fashion, beauty, or luxury brand.","icon":"🧥","category":"style & beauty","sourceCategories":["cosmetics","fashion_apparel","watchmakers"]},{"id":"mix_shopping_travel","prompt":"Name a retail, grocery, or hotel brand.","icon":"🏬","category":"shopping & travel","sourceCategories":["retail_supermarkets","hotels_resorts"]},{"id":"mix_sports","prompt":"Name a professional sports team or club.","icon":"🏆","category":"sports","sourceCategories":["sports_teams"]},{"id":"mix_books_toys_games","prompt":"Name a toy, book, or video game publisher.","icon":"🎲","category":"games & publishing","sourceCategories":["toy_brands","book_publishers","video_games"]}];
for (const group of groups) {
  const matches = brands.filter(b => group.sourceCategories.some(c => b.categories?.includes(c)));
  if (matches.length >= 15) templates.push({ ...group, brands: matches });
}
const questions = {};
for (const template of templates) {
  const seen = new Set(); const answers = [];
  for (const brand of template.brands) {
    const name = brand.name?.trim(); const key = normalize(name);
    if (!name || !key || seen.has(key)) continue;
    seen.add(key);
    const popularity = Number(brand.popularity || 0);
    const points = brand.curated ? popularity : popularity >= 75 ? 10 : popularity >= 45 ? 25 : popularity >= 20 ? 50 : popularity >= 10 ? 75 : 100;
    answers.push({ name, aliases: [...new Set([...(brand.keys || []), name].map(x => String(x).trim()).filter(Boolean))], points, tier: ({10:"Space Dust",25:"Satellite",50:"Nebula",75:"Supernova",100:"Singularity"})[points] });
  }
  answers.sort((a,b) => a.points - b.points || a.name.localeCompare(b.name));
  questions[template.id] = { id: template.id, prompt: template.prompt, icon: template.icon, category: template.category, sourceCategories: template.sourceCategories, answers };
}
const pool = Object.keys(questions);
const startDate = process.env.BLASTOFF_START_DATE || new Date().toISOString().slice(0,10);
const start = new Date(startDate + "T00:00:00Z");
const days = {};
let seed = 2166136261;
for (const char of "blastoff-90-day-schedule") { seed ^= char.charCodeAt(0); seed = Math.imul(seed, 16777619) >>> 0; }
const random = () => {
  seed = (seed + 0x6D2B79F5) >>> 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const usedSets = new Set();
let previous = [];
for (let d=0; d<90; d++) {
  const date = new Date(start.getTime() + d*86400000).toISOString().slice(0,10);
  let selected = null;
  for (let attempt=0; attempt<500; attempt++) {
    const shuffled = [...pool];
    for (let i=shuffled.length-1; i>0; i--) {
      const j = Math.floor(random()*(i+1));
      [shuffled[i],shuffled[j]] = [shuffled[j],shuffled[i]];
    }
    const candidate = shuffled.slice(0,7);
    const signature = [...candidate].sort().join("|");
    const overlap = candidate.filter(id => previous.includes(id)).length;
    if (overlap <= 2 && !usedSets.has(signature)) {
      selected = candidate;
      usedSets.add(signature);
      break;
    }
  }
  if (!selected) throw new Error("Could not create a sufficiently varied daily set for " + date);
  days[date] = selected;
  previous = selected;
}
const output = { version: 1, startDate, days, questions };
fs.writeFileSync(new URL("../prepared_challenges.js", import.meta.url), "// Generated by scripts/generate-challenges.mjs. Do not edit by hand.\\nwindow.BLASTOFF_PREPARED = " + JSON.stringify(output) + ";\\n");
console.log("Generated", Object.keys(days).length, "days,", Object.values(days).reduce((n,x)=>n+x.length,0), "rounds,", pool.length, "prompt families.");
