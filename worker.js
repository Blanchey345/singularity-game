const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
function json(data,status=200,origin="*"){return new Response(JSON.stringify(data),{status,headers:{...JSON_HEADERS,"access-control-allow-origin":origin,"access-control-allow-methods":"GET,POST,OPTIONS","access-control-allow-headers":"content-type"}});}
function normalize(value){return String(value||"").toLowerCase().normalize("NFKD").replace(/[\\u0300-\\u036f]/g,"").replace(/&/g,"and").replace(/[^a-z0-9]/g,"");}
function distance(a,b){const row=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){let prev=row[0];row[0]=i;for(let j=1;j<=b.length;j++){const old=row[j];row[j]=a[i-1]===b[j-1]?prev:1+Math.min(prev,row[j],row[j-1]);prev=old;}}return row[b.length];}
function tier(points){return ({10:"Space Dust",25:"Satellite",50:"Nebula",75:"Supernova",100:"Singularity"})[points]||"Space Dust";}
function validDate(value){return !value||/^\\d{4}-\\d{2}-\\d{2}$/.test(value);}
async function loadData(env){const raw=await env.CHALLENGE_DATA.get("prepared_challenges");return raw?JSON.parse(raw):null;}
export default {
 async fetch(request,env){
  const url=new URL(request.url),origin=env.ALLOWED_ORIGIN||"*";
  if(request.method==="OPTIONS")return new Response(null,{status:204,headers:{"access-control-allow-origin":origin,"access-control-allow-methods":"GET,POST,OPTIONS","access-control-allow-headers":"content-type","access-control-max-age":"86400"}});
  if(!url.pathname.startsWith("/api/"))return json({error:"Not found"},404,origin);
  try{
   const data=await loadData(env);if(!data)return json({error:"Challenge data is not loaded yet."},503,origin);
   const date=url.searchParams.get("date")||new Date().toISOString().slice(0,10);
   if(!validDate(date)||!data.days?.[date])return json({error:"No prepared challenge exists for that date."},404,origin);
   const ids=data.days[date];
   if(request.method==="GET"&&url.pathname==="/api/daily"){
    return json({date,rounds:ids.map(id=>{const q=data.questions[id];return{id:q.id,prompt:q.prompt,icon:q.icon,category:q.category};})},200,origin);
   }
   if(request.method==="POST"&&url.pathname==="/api/answer"){
    const body=await request.json(),q=data.questions?.[body.questionId];
    if(!q||!ids.includes(body.questionId))return json({error:"Question is not part of today's challenge."},400,origin);
    const shortcuts={mccdonalds:"mcdonalds",mcdonald:"mcdonalds"};const input=shortcuts[normalize(body.answer)]||normalize(body.answer);if(input.length<2)return json({accepted:false},200,origin);
    let suggestion=null,best=Infinity,tied=false;
    for(const answer of q.answers){
     const names=[answer.name,...(answer.aliases||[])].map(normalize).map(n=>shortcuts[n]||n).filter(Boolean);
     if(names.includes(input))return json({accepted:true,name:answer.name,points:answer.points,tier:tier(answer.points)},200,origin);
     let dist=Infinity;for(const name of names)dist=Math.min(dist,distance(input,name));
     const max=Math.max(input.length,normalize(answer.name).length)>=11?3:Math.max(input.length,normalize(answer.name).length)>=7?2:1;
     if(dist>0&&dist<=max){if(dist<best){best=dist;suggestion=answer;tied=false;}else if(dist===best)tied=true;}
    }
    if(suggestion&&!tied)return json({accepted:false,suggestion:{name:suggestion.name,points:suggestion.points,tier:tier(suggestion.points)}},200,origin);
    return json({accepted:false},200,origin);
   }
   if(request.method==="GET"&&url.pathname==="/api/review"){
    const requested=(url.searchParams.get("ids")||"").split(",").filter(Boolean);
    if(!requested.length||requested.length>7||requested.some(id=>!ids.includes(id)))return json({error:"Invalid review request."},400,origin);
    return json({date,questions:requested.map(id=>data.questions[id])},200,origin);
   }
   return json({error:"Not found"},404,origin);
  }catch(error){return json({error:"Server error",detail:env.ENVIRONMENT==="development"?String(error):undefined},500,origin);}
 }
};
