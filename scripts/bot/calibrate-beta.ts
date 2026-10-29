// Shrinkage calibration for the trading bot: regress (final margin - closing line) on (YC line - closing line).
// Convention here: home-team relation, negative = home favored; X = away - home. 2025 wk10+ rows are sign-flipped in the file and un-flipped below.
// Run: bun scripts/bot/calibrate-beta.ts
import { BET_HISTORY } from "../../src/data/betHistory.data.ts";
type R={s:number;w:number;L:number;P:number;X:number;e:number;y:number};
const rows:R[]=BET_HISTORY.map((r:any)=>{const f=(r.season===2025&&r.week>=10)?-1:1;const L=f*r.spread,P=f*r.prediction,X=r.awayScore-r.homeScore;return{s:r.season,w:r.week,L,P,X,e:P-L,y:X-L}});
const mean=(a:number[])=>a.reduce((x,y)=>x+y,0)/a.length, sd=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1))};
function ols(g:R[],icpt=true){const n=g.length;const xs=g.map(r=>r.e),ys=g.map(r=>r.y);const mx=icpt?mean(xs):0,my=icpt?mean(ys):0;let sxy=0,sxx=0;for(let i=0;i<n;i++){sxy+=(xs[i]-mx)*(ys[i]-my);sxx+=(xs[i]-mx)**2}const b=sxy/sxx,a=my-b*mx;let sse=0;for(let i=0;i<n;i++)sse+=(ys[i]-a-b*xs[i])**2;const s=Math.sqrt(sse/(n-(icpt?2:1)));return{n,b,se:s/Math.sqrt(sxx),a,resid:s}}
const f=(o:any)=>`n=${o.n} beta=${o.b.toFixed(2)} ±${o.se.toFixed(2)} icpt=${o.a.toFixed(2)} residSD=${o.resid.toFixed(1)}`;
console.log("ALL (no icpt)",f(ols(rows,false)));
console.log("ALL",f(ols(rows)));
for(const S of [2024,2025]) console.log(S,f(ols(rows.filter(r=>r.s===S))));
console.log("SD(X-L) closing-line residual",sd(rows.map(r=>r.y)).toFixed(2),"MAE",mean(rows.map(r=>Math.abs(r.y))).toFixed(2),"MAE model",mean(rows.map(r=>Math.abs(r.X-r.P))).toFixed(2));
console.log("SD(e)",sd(rows.map(r=>r.e)).toFixed(2),"mean|e|",mean(rows.map(r=>Math.abs(r.e))).toFixed(2));
console.log("--- by |edge| bucket (beta within bucket is noisy; show realized capture = mean(y*sign(e)) / mean|e|)");
const bk=[[0,1],[1,2],[2,3],[3,4],[4,6],[6,8],[8,99]];
for(const [lo,hi] of bk){const g=rows.filter(r=>Math.abs(r.e)>=lo&&Math.abs(r.e)<hi);if(!g.length)continue;const cap=mean(g.map(r=>r.y*Math.sign(r.e)));const me=mean(g.map(r=>Math.abs(r.e)));const ats=g.filter(r=>r.y*Math.sign(r.e)>0).length,l=g.filter(r=>r.y*Math.sign(r.e)<0).length;const se=sd(g.map(r=>r.y*Math.sign(r.e)))/Math.sqrt(g.length);
console.log(`|e| ${lo}-${hi}: n=${g.length} mean|e|=${me.toFixed(2)} captured=${cap.toFixed(2)}±${se.toFixed(2)} pts => beta≈${(cap/me).toFixed(2)}  ATS ${ats}-${l} (${(100*ats/(ats+l)).toFixed(1)}%)`)}
console.log("--- cumulative >= threshold");
for(const t of [2,3,4,5,6,8]){const g=rows.filter(r=>Math.abs(r.e)>=t);const cap=mean(g.map(r=>r.y*Math.sign(r.e)));const ats=g.filter(r=>r.y*Math.sign(r.e)>0).length,l=g.filter(r=>r.y*Math.sign(r.e)<0).length;console.log(`>=${t}: n=${g.length} captured=${cap.toFixed(2)} ATS ${(100*ats/(ats+l)).toFixed(1)}% mean|e|=${mean(g.map(r=>Math.abs(r.e))).toFixed(2)} beta≈${(cap/mean(g.map(r=>Math.abs(r.e)))).toFixed(2)}`)}
console.log("--- by side: model likes favorite more (P further from 0 in fav direction) vs dog");
const favMore=rows.filter(r=>Math.abs(r.P)>Math.abs(r.L)&&Math.sign(r.P)===Math.sign(r.L)),dogMore=rows.filter(r=>Math.abs(r.P)<Math.abs(r.L)&&Math.sign(r.P)===Math.sign(r.L));
for(const [n,g] of [["model more bullish on FAV",favMore],["model more bullish on DOG",dogMore]] as any){const cap=mean(g.map((r:R)=>r.y*Math.sign(r.e)));console.log(n,"n="+g.length,"beta≈",(cap/mean(g.map((r:R)=>Math.abs(r.e)))).toFixed(2),"cap",cap.toFixed(2))}
console.log("--- by closing-line size (|L|) beta");
for(const [lo,hi] of [[0,7],[7,14],[14,21],[21,99]]){const g=rows.filter(r=>Math.abs(r.L)>=lo&&Math.abs(r.L)<hi);console.log(`|L| ${lo}-${hi}: `,f(ols(g,false)),"SD(y)",sd(g.map(r=>r.y)).toFixed(1))}
// bootstrap beta CI for edges >=3
let bs:number[]=[];const g3=rows;for(let k=0;k<2000;k++){const s=Array.from({length:g3.length},()=>g3[Math.floor(Math.random()*g3.length)]);bs.push(ols(s,false).b)}bs.sort((a,b)=>a-b);console.log("bootstrap 95% CI beta (all, no icpt)",bs[50].toFixed(2),bs[1950].toFixed(2));
