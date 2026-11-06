// Totals v2 — walk-forward training, tuning and export.
//   bun scripts/totals_v2/pull.ts && bun scripts/totals_v2/weather_meteostat.ts   (data)
//   bun scripts/totals_v2/train.ts                 # default config, per-season report
//   bun scripts/totals_v2/train.ts --tune          # grid on TUNE seasons, confirm on HOLDOUT seasons
//   bun scripts/totals_v2/train.ts --export        # fit on every finished season, write src/lib/totals2/frozen.ts + docs report
// Protocol: every season is predicted only by fits on earlier seasons. Settings are chosen on 2023-24 only and then
// reported, untouched, on 2025-26 — the holdout is never used to pick anything.
import { readFileSync, writeFileSync } from "node:fs";
import { buildGames } from "../../src/lib/drogba/dataset";
import {
  DEFAULT_T2_CONFIG,
  buildMarkets,
  buildSideRows,
  buildT2Ratings,
  fitLayer1,
  fitLayer2,
  pairGames,
  predictLayer1,
  walkForward,
  type T2Config,
  type SideRow,
} from "../../src/lib/totals2/model";
import { scoreGames, scoreTeams, fmtNum, fmtPct, atsObs, gameMoveObs, topBuckets, type ScoreSummary, type AtsMarket } from "../../src/lib/totals2/report";
import type { GameWeatherInputs } from "../../src/lib/totals2/weatherFeatures";

const DIR = new URL("./data/", import.meta.url).pathname;
const load = (n: string) => JSON.parse(readFileSync(`${DIR}${n}.json`, "utf8"));
const TUNE = [2023, 2024];
const HOLDOUT = [2025, 2026];

const rawGames = load("games");
const lines = load("lines");
const adv = load("adv");
const plays = load("plays");
const preseason = load("preseason");
const weatherObj: Record<string, GameWeatherInputs> = load("weather");
const weather = new Map(Object.entries(weatherObj));
const games = buildGames(rawGames, lines);
const markets = buildMarkets(lines);

function rowsFor(cfg: T2Config): SideRow[] {
  const ratings = buildT2Ratings({ games, adv, plays, preseason }, cfg);
  return buildSideRows(games, ratings, markets, weather);
}

function evaluate(rows: SideRow[], cfg: T2Config, seasons: number[]) {
  const wf = walkForward(rows, cfg);
  const preds = wf.preds.filter((p) => seasons.includes(p.row.g.season));
  const gps = pairGames(preds);
  return {
    wf,
    game: { close: scoreGames(gps, "close"), open: scoreGames(gps, "open") },
    team: { close: scoreTeams(preds, "close"), open: scoreTeams(preds, "open") },
  };
}

function line(label: string, s: ScoreSummary): string {
  const b = (t: number) => s.buckets.find((x) => x.minEdge === t);
  const cell = (t: number) => {
    const x = b(t);
    return x ? `${fmtPct(x.winPct)} (${x.n})${x.clv != null ? ` clv ${x.clv >= 0 ? "+" : ""}${x.clv.toFixed(2)}` : ""}` : "–";
  };
  return `${label.padEnd(26)} n=${String(s.n).padStart(5)}  R²=${fmtNum(s.r2 == null ? null : 100 * s.r2, 2).padStart(6)}%  corr=${fmtNum(s.corr, 3).padStart(6)}  MAE ${fmtNum(s.mae)} vs line ${fmtNum(s.lineMae)}  bias ${fmtNum(s.bias)} | all ${cell(0)} | 2+ ${cell(2)} | 3+ ${cell(3)} | 5+ ${cell(5)}`;
}

function report(rows: SideRow[], cfg: T2Config, title: string): string {
  const out: string[] = [`## ${title}`];
  for (const seasons of [[2023], [2024], [2025], [2026], TUNE, HOLDOUT]) {
    const r = evaluate(rows, cfg, seasons);
    const tag = seasons.join("+");
    out.push(line(`${tag} game vs close`, r.game.close), line(`${tag} game vs open`, r.game.open), line(`${tag} team vs close`, r.team.close), line(`${tag} team vs open`, r.team.open));
  }
  return out.join("\n");
}

// Objective for tuning: residual R² on team totals and game totals, both lines, tune seasons only.
function objective(rows: SideRow[], cfg: T2Config): number {
  const r = evaluate(rows, cfg, TUNE);
  return (r.team.close.r2 ?? -1) + (r.team.open.r2 ?? -1) + (r.game.close.r2 ?? -1) + (r.game.open.r2 ?? -1);
}

const args = process.argv.slice(2);
let cfg: T2Config = { ...DEFAULT_T2_CONFIG, lambda: { ...DEFAULT_T2_CONFIG.lambda } };
const t0 = Date.now();
let rows = rowsFor(cfg);
console.log(`ratings + rows: ${((Date.now() - t0) / 1000).toFixed(1)}s, ${rows.length} team-sides, weather on ${rows.filter((r) => Object.values(r.wx).some((v) => v !== 0)).length}`);

if (args.includes("--tune")) {
  // Stage 1: the layers (cheap — no rating rebuild).
  let best = objective(rows, cfg);
  console.log("start", best.toFixed(4));
  for (const alpha1 of [10, 50, 200]) for (const alpha2 of [500, 2000, 8000]) for (const edgeCap of [4, 7, 10]) {
    const c = { ...cfg, alpha1, alpha2, edgeCap };
    const o = objective(rows, c);
    if (o > best) {
      best = o;
      cfg = c;
      console.log("layers", { alpha1, alpha2, edgeCap }, o.toFixed(4));
    }
  }
  // Stage 2: how quickly ratings let go of last season, and how much returning production changes that.
  for (const rho of [0.5, 0.7, 0.85]) for (const retLambdaK of [0, 0.35, 0.7]) for (const retRhoK of [0, 0.1, 0.2]) {
    const c = { ...cfg, rho, retLambdaK, retRhoK };
    const rws = rowsFor(c);
    const o = objective(rws, c);
    console.log("ratings", { rho, retLambdaK, retRhoK }, o.toFixed(4));
    if (o > best) {
      best = o;
      cfg = c;
      rows = rws;
    }
  }
  // Stage 3: overall prior strength.
  for (const scale of [0.5, 1.5]) {
    const c = { ...cfg, lambda: Object.fromEntries(Object.entries(cfg.lambda).map(([k, v]) => [k, v * scale])) as T2Config["lambda"] };
    const rws = rowsFor(c);
    const o = objective(rws, c);
    console.log("lambda ×", scale, o.toFixed(4));
    if (o > best) {
      best = o;
      cfg = c;
      rows = rws;
    }
  }
  console.log("BEST", JSON.stringify(cfg), best.toFixed(4));
}

if (args.includes("--extend")) {
  let best = objective(rows, cfg);
  console.log("base", best.toFixed(4));
  for (const [retLambdaK, retRhoK] of [[1.0, 0.2], [1.4, 0.2], [0.7, 0.3], [1.0, 0.3], [1.4, 0.3]]) {
    const c = { ...cfg, retLambdaK, retRhoK };
    const rws = rowsFor(c);
    const o = objective(rws, c);
    console.log("ext", retLambdaK, retRhoK, o.toFixed(4));
    if (o > best) {
      best = o;
      cfg = c;
      rows = rws;
    }
  }
  console.log("BEST", JSON.stringify(cfg));
}

const rep = report(rows, cfg, `Walk-forward results (config ${JSON.stringify(cfg)})`);
console.log(rep);

if (args.includes("--export")) {
  // Live model for the current season: layer 1 on every finished season, layer 2 on layer 1's walk-forward predictions.
  const current = Math.max(...games.map((g) => g.season));
  const wf = walkForward(rows, cfg);
  const l1 = fitLayer1(rows.filter((r) => r.g.season < current), cfg.alpha1)!;
  const l1Pred = new Map(wf.preds.map((p) => [p.row, p.l1] as const));
  const train = rows.filter((r) => r.g.season < current && l1Pred.has(r));
  const l2close = fitLayer2(train, l1Pred, "close", cfg.alpha2, cfg.edgeCap, wf.slates)!;
  const l2open = fitLayer2(train, l1Pred, "open", cfg.alpha2, cfg.edgeCap, wf.slates)!;
  const l2move = fitLayer2(train, l1Pred, "open", cfg.alpha2, cfg.edgeCap, wf.slates, "move")!;
  // Over/under record by strength of lean, per season and pooled, every market.
  const ats: any[] = [];
  const MARKETS: AtsMarket[] = ["game-move", "game-open", "game-close", "team-move", "team-open", "team-close"];
  for (const seasons of [[2023], [2024], [2025], [2026], [2023, 2024], [2025, 2026], [2023, 2024, 2025, 2026]]) {
    const preds = wf.preds.filter((p) => seasons.includes(p.row.g.season));
    const gps = pairGames(preds);
    for (const market of MARKETS) {
      const b = topBuckets(atsObs(market, gps, preds));
      ats.push({
        seasons: seasons.join("+"),
        market,
        buckets: b.map((x) => ({ frac: x.frac, minEdge: Math.round(x.minEdge * 100) / 100, w: x.w, l: x.l, p: x.p, units: Math.round(x.units * 10) / 10, clv: x.clv == null ? null : Math.round(x.clv * 100) / 100 })),
      });
    }
  }
  // The live "bet" flag: the line-move lean that made the top 10% of games in the walk-forward seasons.
  const allMoves = wf.preds.filter((p) => p.row.g.season >= 2023);
  const mvAbs = gameMoveObs(pairGames(allMoves)).map((o) => Math.abs(o.model - o.line)).sort((a, b) => b - a);
  const moveCutTop10 = Math.round(mvAbs[Math.floor(mvAbs.length * 0.1)] * 100) / 100;
  void predictLayer1;
  const version = `t2-${current}-n${train.length}`;
  const backtest: any[] = [];
  for (const S of [2023, 2024, 2025, 2026]) {
    const r = evaluate(rows, cfg, [S]);
    for (const scope of ["game", "team"] as const)
      for (const ln of ["close", "open"] as const) {
        const x = r[scope][ln];
        const all = x.buckets[0];
        const rd = (v: number | null, d: number) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);
        backtest.push({ season: S, scope, line: ln, n: x.n, r2: rd(x.r2 == null ? null : 100 * x.r2, 2), corr: rd(x.corr, 3), win: rd(all?.winPct ?? null, 1), clv: rd(all?.clv ?? null, 2) });
      }
  }
  const ts = `// GENERATED by scripts/totals_v2/train.ts --export — do not edit by hand. Retrain each offseason (or after a data
// backfill) by re-running pull.ts, weather_meteostat.ts and train.ts --export.
// Trained on seasons before ${current}: layer 1 on every finished season, layer 2 on layer 1's walk-forward predictions.
import type { Layer1Fit, Layer2Fit, T2Config } from "./model";
import type { AtsMarket } from "./report";
export const T2_VERSION = ${JSON.stringify(version)};
export const T2_TRAINED_THROUGH = ${current - 1};
export const T2_CONFIG: T2Config = ${JSON.stringify(cfg)};
export const T2_LAYER1: Layer1Fit = ${JSON.stringify(l1)};
export const T2_LAYER2_CLOSE: Layer2Fit = ${JSON.stringify(l2close)};
export const T2_LAYER2_OPEN: Layer2Fit = ${JSON.stringify(l2open)};
export const T2_LAYER2_MOVE: Layer2Fit = ${JSON.stringify(l2move)};
// Smallest predicted open→close move of a game total that ranked in the top 10% of 2023-26 walk-forward games.
export const T2_MOVE_CUT_TOP10 = ${moveCutTop10};
export interface T2AtsBucket { frac: number; minEdge: number; w: number; l: number; p: number; units: number; clv: number | null }
export const T2_ATS: { seasons: string; market: AtsMarket; buckets: T2AtsBucket[] }[] = ${JSON.stringify(ats)};
// Walk-forward backtest (each season predicted by fits on earlier seasons only). r2 = residual R² in %, win = % of
// every game/team side picked in the model's direction, clv = avg points the line moved our way open → close.
export interface T2BacktestRow { season: number; scope: "game" | "team"; line: "close" | "open"; n: number; r2: number | null; corr: number | null; win: number | null; clv: number | null }
export const T2_BACKTEST: T2BacktestRow[] = ${JSON.stringify(backtest)};
`;
  writeFileSync(new URL("../../src/lib/totals2/frozen.ts", import.meta.url).pathname, ts);
  writeFileSync(new URL("./last_report.txt", import.meta.url).pathname, rep + "\n\nlayer1 " + JSON.stringify(l1) + "\nlayer2 close " + JSON.stringify(l2close) + "\nlayer2 open " + JSON.stringify(l2open) + "\n");
  console.log("wrote frozen.ts", version);
}

if (args.includes("--coef")) {
  const wf = walkForward(rows, cfg);
  for (const S of [2024, 2026]) {
    const f = wf.l2Fits.get(S)!;
    console.log(S, "L2 close", f.close!.features.map((k, i) => `${k}=${f.close!.coef[i].toFixed(3)}`).join(" "));
    console.log(S, "L2 open ", f.open!.features.map((k, i) => `${k}=${f.open!.coef[i].toFixed(3)}`).join(" "));
    const l1 = wf.l1Fits.get(S)!;
    console.log(S, "L1", l1.features.map((k, i) => `${k}=${l1.coef[i].toFixed(2)}`).join(" "), "int", l1.intercept.toFixed(2));
  }
  // layer 1 alone vs the market
  const pr = wf.preds.filter((p) => p.row.pts != null && p.row.g.season >= 2023);
  const { sideImplied } = await import("../../src/lib/totals2/model");
  for (const ln of ["open", "close"] as const) {
    const xs: number[] = [], ys: number[] = [];
    for (const p of pr) {
      const imp = sideImplied(p.row, ln);
      if (imp == null) continue;
      xs.push(p.l1 - imp);
      ys.push(p.row.pts! - imp);
    }
    const m = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    const mx = m(xs), my = m(ys);
    const c = xs.reduce((s, v, i) => s + (v - mx) * (ys[i] - my), 0) / Math.sqrt(xs.reduce((s, v) => s + (v - mx) ** 2, 0) * ys.reduce((s, v) => s + (v - my) ** 2, 0));
    console.log("layer1 − implied vs actual − implied", ln, "corr", c.toFixed(3), "sd(edge)", Math.sqrt(xs.reduce((s, v) => s + (v - mx) ** 2, 0) / xs.length).toFixed(2));
  }
}
