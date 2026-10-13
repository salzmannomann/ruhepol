// Auswertung von tools/vergleich.mjs: node tools/auswertung.mjs .vergleich/vergleich.json
import { readFileSync } from 'node:fs';
const d=JSON.parse(readFileSync(process.argv[2],'utf8'));
const med=a=>a.length?a.slice().sort((x,y)=>x-y)[a.length>>1]:null;
const f=x=>x==null?"-":(x/1000).toFixed(2);
const sites=[...new Set(d.map(x=>x.url))], vers=[...new Set(d.map(x=>x.v))];
for (const s of sites){ const row=[s.replace(/https:\/\/(www\.)?/,"")];
 for (const v of vers){ const r=d.filter(x=>x.url===s&&x.v===v);
  row.push(`${v.padEnd(7)} Bilder ${f(med(r.flatMap(x=>x.imgs)))} | KI ${f(med(r.flatMap(x=>x.ki)))} | TBT ${r.map(x=>Math.round(x.tbt)).join("/")}`);}
 console.log(row.join("\n  "));}
for (const v of vers){const r=d.filter(x=>x.v===v); console.log(v.padEnd(7),"Bilder med",f(med(r.flatMap(x=>x.imgs))),"s; KI med",f(med(r.flatMap(x=>x.ki))),"s; TBT Mittel",Math.round(r.reduce((s,x)=>s+x.tbt,0)/r.length),"ms");}
