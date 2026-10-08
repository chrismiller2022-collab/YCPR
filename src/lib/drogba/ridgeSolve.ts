// Small dense ridge solver (Cholesky). DROGBA's rating problems are a few hundred unknowns at most
// (≈140 teams × offense/defense), so a plain dense solve is instant and needs no dependencies —
// the same code runs in the browser and in the bun backtest scripts.

export interface SparseRow {
  idx: number[]; // parameter indices this observation touches
  val: number[]; // their design-matrix values
  y: number;
  w?: number; // observation weight (default 1)
}

// Solves min Σ w (y − x·θ)² + Σ λ_j (θ_j − θ0_j)²  for θ. `lambda[j] = 0` leaves θ_j unpenalized.
export function solveRidge(rows: SparseRow[], lambda: number[], prior: number[]): number[] {
  return solveRidgeFull(rows, lambda, prior, false).theta;
}

// Same solve, optionally also returning diag((XᵀWX + Λ)⁻¹) — each parameter's posterior variance in units of the
// observation noise variance (multiply by the noise variance to get a standard error). Costs one extra O(n³).
export function solveRidgeFull(rows: SparseRow[], lambda: number[], prior: number[], wantVar: boolean): { theta: number[]; diagInv: number[] | null } {
  const n = lambda.length;
  const A = new Float64Array(n * n);
  const b = new Float64Array(n);
  for (const r of rows) {
    const w = r.w ?? 1;
    // residual against the prior, so the penalty is on (θ − θ0)
    let pred0 = 0;
    for (let k = 0; k < r.idx.length; k++) pred0 += r.val[k] * prior[r.idx[k]];
    const resid = r.y - pred0;
    for (let a = 0; a < r.idx.length; a++) {
      const ia = r.idx[a];
      b[ia] += w * r.val[a] * resid;
      for (let c = 0; c < r.idx.length; c++) A[ia * n + r.idx[c]] += w * r.val[a] * r.val[c];
    }
  }
  for (let j = 0; j < n; j++) A[j * n + j] += lambda[j] + 1e-9;
  choleskyFactor(A, n);
  const delta = choleskyBackSolve(A, b, n);
  let diagInv: number[] | null = null;
  if (wantVar) {
    diagInv = new Array<number>(n).fill(0);
    const e = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      e.fill(0);
      e[j] = 1;
      diagInv[j] = choleskyBackSolve(A, e, n)[j];
    }
  }
  return { theta: delta.map((d, j) => d + prior[j]), diagInv };
}

// In-place lower-triangular factor L (A = L Lᵀ).
function choleskyFactor(A: Float64Array, n: number) {
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = A[i * n + j];
      for (let k = 0; k < j; k++) sum -= A[i * n + k] * A[j * n + k];
      if (i === j) A[i * n + i] = Math.sqrt(Math.max(sum, 1e-12));
      else A[i * n + j] = sum / A[j * n + j];
    }
  }
}

function choleskyBackSolve(A: Float64Array, b: Float64Array, n: number): number[] {
  const z = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = b[i];
    for (let k = 0; k < i; k++) sum -= A[i * n + k] * z[k];
    z[i] = sum / A[i * n + i];
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = z[i];
    for (let k = i + 1; k < n; k++) sum -= A[k * n + i] * x[k];
    x[i] = sum / A[i * n + i];
  }
  return x;
}

// Dense multi-feature ridge with an unpenalized intercept — used for the stacked layers
// (a handful of columns). Returns [intercept, ...coefficients].
export function fitDenseRidge(X: number[][], y: number[], alpha: number, w?: number[]): { intercept: number; coef: number[] } {
  const p = X[0]?.length ?? 0;
  const rows: SparseRow[] = X.map((x, i) => ({ idx: Array.from({ length: p + 1 }, (_, j) => j), val: [1, ...x], y: y[i], w: w?.[i] }));
  const lambda = [0, ...new Array(p).fill(alpha)];
  const theta = solveRidge(rows, lambda, new Array(p + 1).fill(0));
  return { intercept: theta[0], coef: theta.slice(1) };
}
