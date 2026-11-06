// 2025-26 NFL playoffs as ESPN reported them (seasontype=3, weeks 1/2/3/5),
// trimmed to what mergeEspnGames reads. Test fixture for auto-scoring.
// Seeds: AFC DEN 1, NE 2, JAX 3, PIT 4, HOU 5, BUF 6, LAC 7 · NFC SEA 1, CHI 2, PHI 3, CAR 4, LAR 5, SF 6, GB 7.
export const NFL_2025_PLAYOFFS = [
  { id: "401772979", start: "2026-01-10T21:30Z", state: "post", round: 0, home: { abbrev: "CAR", score: 31 }, away: { abbrev: "LAR", score: 34 } },
  { id: "401772981", start: "2026-01-11T01:00Z", state: "post", round: 0, home: { abbrev: "CHI", score: 31 }, away: { abbrev: "GB", score: 27 } },
  { id: "401772977", start: "2026-01-11T18:00Z", state: "post", round: 0, home: { abbrev: "JAX", score: 24 }, away: { abbrev: "BUF", score: 27 } },
  { id: "401772980", start: "2026-01-11T21:30Z", state: "post", round: 0, home: { abbrev: "PHI", score: 19 }, away: { abbrev: "SF", score: 23 } },
  { id: "401772978", start: "2026-01-12T01:15Z", state: "post", round: 0, home: { abbrev: "NE", score: 16 }, away: { abbrev: "LAC", score: 3 } },
  { id: "401772976", start: "2026-01-13T01:15Z", state: "post", round: 0, home: { abbrev: "PIT", score: 6 }, away: { abbrev: "HOU", score: 30 } },
  { id: "401772982", start: "2026-01-17T21:30Z", state: "post", round: 1, home: { abbrev: "DEN", score: 33 }, away: { abbrev: "BUF", score: 30 } },
  { id: "401772984", start: "2026-01-18T01:00Z", state: "post", round: 1, home: { abbrev: "SEA", score: 41 }, away: { abbrev: "SF", score: 6 } },
  { id: "401772983", start: "2026-01-18T20:00Z", state: "post", round: 1, home: { abbrev: "NE", score: 28 }, away: { abbrev: "HOU", score: 16 } },
  { id: "401772985", start: "2026-01-18T23:30Z", state: "post", round: 1, home: { abbrev: "CHI", score: 17 }, away: { abbrev: "LAR", score: 20 } },
  { id: "401772986", start: "2026-01-25T20:00Z", state: "post", round: 2, home: { abbrev: "DEN", score: 7 }, away: { abbrev: "NE", score: 10 } },
  { id: "401772987", start: "2026-01-25T23:30Z", state: "post", round: 2, home: { abbrev: "SEA", score: 31 }, away: { abbrev: "LAR", score: 27 } },
  { id: "401772988", start: "2026-02-08T23:30Z", state: "post", round: 3, home: { abbrev: "NE", score: 13 }, away: { abbrev: "SEA", score: 29 } },
] as const;
export const NFL_2025_SEEDS = { AFC: ["DEN", "NE", "JAX", "PIT", "HOU", "BUF", "LAC"], NFC: ["SEA", "CHI", "PHI", "CAR", "LAR", "SF", "GB"] };
