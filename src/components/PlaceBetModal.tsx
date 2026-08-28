import { useState } from "react";
import { savePlacedBet, BOOK_LABELS, type BetBook, type BetType, type NewPlacedBet } from "../lib/api/placedBets";

export interface BetTypeDefaults {
  side: string; // team name, or "over"/"under"
  lineValue: number | null;
  price: number | null;
}

export interface PlaceBetContext {
  gameId: string;
  season: number;
  week: number;
  awayTeam: string;
  homeTeam: string;
  initialBetType: BetType;
  getDefaultsForType: (betType: BetType) => BetTypeDefaults;
}

const BOOKS: BetBook[] = ["bovada", "betonlineag", "novig", "kalshi"];
const BET_TYPES: BetType[] = ["spread", "moneyline", "total"];
const STANDARD_VIG_PRICE = -110;

export default function PlaceBetModal({ context, onClose, onSaved }: { context: PlaceBetContext; onClose: () => void; onSaved: () => void }) {
  const [book, setBook] = useState<BetBook>("bovada");
  const [betType, setBetType] = useState<BetType>(context.initialBetType);
  const initialDefaults = context.getDefaultsForType(context.initialBetType);
  const [side, setSide] = useState(initialDefaults.side);
  const [lineValue, setLineValue] = useState<string>(initialDefaults.lineValue != null ? String(initialDefaults.lineValue) : "");
  const [price, setPrice] = useState<string>(String(initialDefaults.price ?? STANDARD_VIG_PRICE));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleBetTypeChange(t: BetType) {
    setBetType(t);
    const d = context.getDefaultsForType(t);
    setSide(d.side);
    setLineValue(d.lineValue != null ? String(d.lineValue) : "");
    setPrice(String(d.price ?? STANDARD_VIG_PRICE));
  }

  const sideOptions = betType === "total" ? ["over", "under"] : [context.awayTeam, context.homeTeam];

  async function handleSave() {
    const parsedPrice = parseFloat(price);
    if (Number.isNaN(parsedPrice)) {
      setError("Price must be a number");
      return;
    }
    const parsedLine = lineValue.trim() === "" ? null : parseFloat(lineValue);
    if (betType !== "moneyline" && lineValue.trim() !== "" && Number.isNaN(parsedLine as number)) {
      setError("Line must be a number");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const bet: NewPlacedBet = {
        gameId: context.gameId,
        season: context.season,
        week: context.week,
        awayTeam: context.awayTeam,
        homeTeam: context.homeTeam,
        book,
        betType,
        side,
        lineValue: betType === "moneyline" ? null : parsedLine,
        price: parsedPrice,
      };
      await savePlacedBet(bet);
      onSaved();
    } catch (err: any) {
      setError(err.message ?? "Failed to save bet");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--turf-panel)",
          border: "1px solid var(--hash)",
          borderRadius: 10,
          padding: "1.25rem",
          width: 380,
          maxWidth: "90vw",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontWeight: 700, marginBottom: "0.25rem" }}>Log a bet</div>
        <div style={{ fontSize: "0.8rem", color: "var(--chalk-dim)", marginBottom: "1rem" }}>
          {context.awayTeam} @ {context.homeTeam} · Wk {context.week}
        </div>

        <div style={{ marginBottom: "0.85rem" }}>
          <div style={{ fontSize: "0.78rem", color: "var(--chalk-dim)", marginBottom: "0.3rem" }}>Bet type</div>
          <div style={{ display: "flex", gap: "0.4rem" }}>
            {BET_TYPES.map((t) => (
              <button key={t} className={`mode-btn ${betType === t ? "mode-btn-active" : ""}`} onClick={() => handleBetTypeChange(t)} type="button">
                {t === "spread" ? "Spread" : t === "moneyline" ? "Moneyline" : "Total"}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: "0.85rem" }}>
          <div style={{ fontSize: "0.78rem", color: "var(--chalk-dim)", marginBottom: "0.3rem" }}>Book</div>
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
            {BOOKS.map((b) => (
              <button key={b} className={`mode-btn ${book === b ? "mode-btn-active" : ""}`} onClick={() => setBook(b)} type="button">
                {BOOK_LABELS[b]}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: "0.85rem" }}>
          <div style={{ fontSize: "0.78rem", color: "var(--chalk-dim)", marginBottom: "0.3rem" }}>
            {betType === "total" ? "Over/Under" : "Team"}
          </div>
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
            {sideOptions.map((s) => (
              <button key={s} className={`mode-btn ${side === s ? "mode-btn-active" : ""}`} onClick={() => setSide(s)} type="button">
                {s === "over" ? "Over" : s === "under" ? "Under" : s}
              </button>
            ))}
          </div>
        </div>

        {betType !== "moneyline" && (
          <label style={{ display: "block", marginBottom: "0.85rem" }}>
            <div style={{ fontSize: "0.78rem", color: "var(--chalk-dim)", marginBottom: "0.3rem" }}>
              {betType === "spread" ? "Spread" : "Total"}
            </div>
            <input type="number" step="0.5" value={lineValue} onChange={(e) => setLineValue(e.target.value)} style={{ width: "100%" }} />
          </label>
        )}

        <label style={{ display: "block", marginBottom: "1rem" }}>
          <div style={{ fontSize: "0.78rem", color: "var(--chalk-dim)", marginBottom: "0.3rem" }}>
            Price (American odds){betType !== "moneyline" ? " — defaults to standard -110 vig" : " — defaults to the market moneyline shown"}
          </div>
          <input type="number" step="1" value={price} onChange={(e) => setPrice(e.target.value)} style={{ width: "100%" }} />
        </label>

        {error && <p style={{ color: "crimson", fontSize: "0.82rem" }}>{error}</p>}

        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
          <button className="menu-btn" onClick={onClose} type="button" disabled={saving}>
            Cancel
          </button>
          <button className="menu-btn" onClick={handleSave} type="button" disabled={saving}>
            {saving ? "Saving…" : "Save bet"}
          </button>
        </div>
      </div>
    </div>
  );
}
