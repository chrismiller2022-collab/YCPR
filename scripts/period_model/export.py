import numpy as np, pandas as pd, json
from sim import O, fit, FEATS
sc,m,res=fit(O,alpha=10)
V=["f1","f2","f3","f4","d1","d2","d3","d4"]
pool=[[float(r.abs_spread),float(r.total)]+[int(r[v]) for v in V] for _,r in O.iterrows()]
version=f"ridge-a10-n{len(O)}-2021-2026"
ts=f"""// Frozen period (quarter/half) model — trained OFFLINE on {len(O)} completed FBS-vs-FBS
// games, seasons 2021-2026 (closing spread/total from betting_lines, per-quarter
// regulation scores from CFBD line scores). Same "train once, freeze the numbers"
// pattern as totalModelRidge.ts. To retrain: re-run the fit and paste new values.
//
// RIDGE: predicts one team's points in each of Q1..Q4 from its own/opponent expected
// points (implied by a game's total + spread), the total, |spread|, neutral flag,
// favorite flag and whether the favorite is the home team. Orientation is favorite/underdog.
//
// POOL: every training game as [absSpread, total, fav Q1..Q4, dog Q1..Q4]. The simulator
// re-weights the nearest games so their quarter-by-quarter AVERAGES match the ridge
// prediction — that keeps real football scoring (lumpy 0/3/7, ties, 2H-vs-1H
// correlation) instead of smooth normal noise.
export const PERIOD_MODEL_VERSION = "{version}";
export const PERIOD_FEATURES = {json.dumps(FEATS)} as const;
export const PERIOD_MEAN = {json.dumps([round(x,6) for x in sc.mean_])};
export const PERIOD_SCALE = {json.dumps([round(x,6) for x in sc.scale_])};
export const PERIOD_COEF: number[][] = {json.dumps([[round(x,6) for x in row] for row in m.coef_])}; // rows = Q1..Q4
export const PERIOD_INTERCEPT = {json.dumps([round(x,6) for x in m.intercept_])};
export const PERIOD_POOL: number[][] = {json.dumps(pool,separators=(",",":"))};
"""
open("periodModelData.ts","w").write(ts)
print(len(ts)//1024,"KB", version)
