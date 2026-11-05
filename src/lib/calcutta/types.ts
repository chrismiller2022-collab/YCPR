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

export type FormatKey = "nfl_playoffs" | "nfl_season" | "cfb_season" | "cfb_playoff24" | "march_madness";

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
}

/** One team in the auction field (format-specific bits like seed/bye live here). */
export interface FieldTeam {
  id: string;
  name: string;
  abbr: string;
  group: string; // AFC / NFC, region, conference…
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
  live: LiveState;
}
