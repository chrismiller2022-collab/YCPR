// Calcutta auction — one self-contained document per auction.
//
// The whole auction (settings, attendees, field, lots, every bid, every
// ownership split, results) lives in one JSON doc. It is saved to
// localStorage on every action (crash-safe, instant cross-tab sync between
// the Stage tab and the admin/Desk tab) and mirrored to Supabase
// (calcutta_auctions.doc) shortly after, so it survives a new browser and
// builds the bidding history per attendee over time.
//
// Bids are append-only: undo marks a bid `voided` instead of deleting it,
// so the full bid log (including retracted bids) is kept for history.

export type FormatKey = "nfl_playoffs" | "nfl_season" | "cfb_season" | "cfb_playoff12" | "cfb_playoff24" | "march_madness";

export interface IncrementTier {
  /** This step applies while the current high bid is below `upTo` (null = no ceiling). */
  upTo: number | null;
  step: number;
}

export interface CalcuttaSettings {
  openingMin: number;
  increments: IncrementTier[];
  /** Seconds on the clock when a lot opens. */
  timerStart: number;
  /** Each new bid puts at least this many seconds back on the clock. */
  timerReset: number;
  goingOnceAt: number;
  goingTwiceAt: number;
  /** false (default): clock at 0 shows a SOLD? prompt you confirm. true: sells automatically. */
  autoSell: boolean;
  /** What happens to a lot that gets no bids: back of the queue, or left unsold. */
  noBidAction: "requeue" | "unsold";
  rakePct: number;
  sound: boolean;
}

export interface Participant {
  id: string;
  name: string;
  color: string;
  /** Single lowercase letter pressed on the Stage to bid for this person. */
  hotkey: string;
  /** Dollars actually collected from this person so far. */
  paid: number;
  /** Practice mode: set when this attendee is a bot. */
  bot?: BotProfile | null;
}

export type BotStyle = "balanced" | "aggressive" | "bargain" | "fan" | "longshot" | "budget";

export interface BotProfile {
  style: BotStyle;
  /** This bot's own fair share (% of net pot) per team, from its own noisy ratings. */
  values: Record<string, number>;
  /** Its guess at the final pot before anything sells. */
  potGuess: number;
  /** Fan: the teams it overpays for. */
  favorites: string[];
  /** Budget: stops bidding past this total. */
  budget: number | null;
  /** Per-bot randomness seed (reaction speed, per-lot mood). */
  seed: number;
}

export interface PracticeSettings {
  enabled: boolean;
  /** Stage opens/starts/sells lots by itself. */
  autoAdvance: boolean;
  /** The pot the bots are guessing around. */
  expectedPot: number;
}

/** One team in the auction field (format-specific bits like seed/bye live here). */
export interface FieldTeam {
  id: string;
  name: string;
  abbr: string;
  group: string; // AFC / NFC, region; "" when seeds are one list (CFP)
  /** Extra display info (a CFB team's conference). */
  note?: string | null;
  seed: number | null;
  bye: boolean;
  logo: string | null;
}

export type LotStatus = "pending" | "live" | "sold" | "unsold";

export interface Lot {
  id: string;
  teamIds: string[];
  /** Optional display name for bundles ("AFC 6–7 seeds"). */
  label: string | null;
  order: number;
  status: LotStatus;
  winnerId: string | null;
  price: number | null;
  soldAt: number | null;
  passCount: number;
}

export interface Bid {
  id: string;
  lotId: string;
  participantId: string;
  amount: number;
  ts: number;
  voided: boolean;
}

/**
 * A share of a sold lot moving from one person to another (partner split or
 * buyback). `pct` is a percentage of the WHOLE lot. `price` is paid
 * person-to-person; it never changes the pot.
 */
export interface OwnershipTransfer {
  id: string;
  lotId: string;
  fromId: string;
  toId: string;
  pct: number;
  price: number;
  ts: number;
  note: string | null;
}

/** Per-team result. roundsCleared counts rounds advanced past (a bye clears round 1). */
export interface TeamResult {
  roundsCleared: number;
  eliminated: boolean;
  /** March Madness First Four: won/lost the play-in (doesn't count as a round). */
  playIn?: "won" | "lost" | null;
}

/** A one-off prize ("biggest upset") paid to whoever owns the winning team(s). Ties split evenly. */
export interface PropEvent {
  id: string;
  label: string;
  pct: number;
  /** Winner(s); more than one = a tie, the prize splits evenly. */
  teamIds: string[];
  /** One-line rule shown to the room (tiebreaks etc.). */
  rule?: string | null;
  /** Which built-in prize this is, so the Desk's sim can price it. "custom" = priced as an even split. */
  kind?: PropKind;
  /** Legacy single winner (docs saved before ties were supported). */
  teamId?: string | null;
}

export type PropKind = "biggest_upset" | "worst_loss" | "cinderella" | "best_ats" | "custom";

export interface PayoutRules {
  /** % of net pot paid PER TEAM that clears each round, keyed by the format's round keys. */
  roundPct: Record<string, number>;
  /** NFL: does a #1 seed's bye count as clearing the first round for payouts? */
  byeCountsAsWin: boolean;
  props: PropEvent[];
}

/** One playoff game, from ESPN or typed in. Only final games count toward results. */
export interface PlayoffGame {
  id: string;
  /** 0 = first round (Wild Card / Round of 64 …); −1 = First Four play-in. */
  round: number;
  homeId: string;
  awayId: string;
  homeScore: number | null;
  awayScore: number | null;
  final: boolean;
  /** Closing line for the HOME team (−3.5 = home favored by 3.5). Needed for the ATS prize. */
  homeSpread: number | null;
  neutral: boolean;
  start: string | null;
  espnId: string | null;
  /** true once the line was typed in by hand — ESPN sync won't overwrite it. */
  lineManual: boolean;
}

export type LivePhase = "idle" | "ready" | "running" | "paused" | "expired" | "sold";

export interface LiveState {
  lotId: string | null;
  phase: LivePhase;
  /** epoch ms when the clock hits 0 (running only). */
  endsAt: number | null;
  /** ms left on the clock while ready/paused. */
  remainingMs: number | null;
}

export interface CalcuttaAuction {
  id: string;
  name: string;
  format: FormatKey;
  status: "setup" | "live" | "complete";
  createdAt: number;
  updatedAt: number;
  settings: CalcuttaSettings;
  payouts: PayoutRules;
  participants: Participant[];
  field: FieldTeam[];
  lots: Lot[];
  bids: Bid[];
  transfers: OwnershipTransfer[];
  results: Record<string, TeamResult>;
  /** Game log (optional). With autoScore on, results and side prizes are worked out from it. */
  games?: PlayoffGame[];
  autoScore?: boolean;
  /** March Madness region order: Final Four is [0] vs [1], [2] vs [3]. */
  regions?: string[];
  /** Practice auction against bots (kept out of bidding history and the cloud). */
  practice?: PracticeSettings | null;
  live: LiveState;
}
