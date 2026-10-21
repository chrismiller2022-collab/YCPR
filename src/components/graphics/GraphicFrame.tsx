import type { CSSProperties, ReactNode } from "react";
import { TEAM_LOGOS } from "../../data/logos";

// Shared shell for the Weekly Image Dump playoff graphics — same dark navy
// card, gold eyebrow, big uppercase header and YC POWER RATINGS / site /
// handle footer as CompactPowerRatingsGraphic and MatchupGridGraphic (those
// inline theirs; this is the same markup factored out). Capture with
// includeBranding:false, the footer is baked in.

export const SITE_URL = "ycpr.vercel.app";
export const TWITTER_HANDLE = "@YCtheflea";
export const GOLD = "var(--gold, #d9a441)";
export const NAVY = "#1f2041";

export default function GraphicFrame({
  eyebrow,
  header,
  subtitle,
  width,
  children,
}: {
  eyebrow: string;
  header: string;
  subtitle?: ReactNode;
  /** Fixed card width in px; omitted = fit-content. */
  width?: number;
  children: ReactNode;
}) {
  return (
    <div style={{ background: NAVY, padding: "22px 26px", width: width ?? "fit-content", boxSizing: "border-box", fontFamily: "inherit", color: "#fff" }}>
      <div style={{ textAlign: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.12em", color: GOLD, textTransform: "uppercase", marginBottom: 6 }}>{eyebrow}</div>
        <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "0.03em", color: "#fff", textTransform: "uppercase" }}>{header}</div>
        {subtitle && <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", marginTop: 6, fontWeight: 600 }}>{subtitle}</div>}
      </div>
      {children}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 16,
          paddingTop: 10,
          marginTop: 14,
          borderTop: "1px solid rgba(255,255,255,0.15)",
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: "0.05em",
        }}
      >
        <span style={{ color: "rgba(255,255,255,0.55)" }}>YC POWER RATINGS</span>
        <span style={{ color: "rgba(255,255,255,0.4)" }}>{SITE_URL}</span>
        <span style={{ color: GOLD }}>{TWITTER_HANDLE}</span>
      </div>
    </div>
  );
}

export function Logo({ team, size = 16, style }: { team: string; size?: number; style?: CSSProperties }) {
  const src = TEAM_LOGOS[team];
  if (!src) return <span style={{ display: "inline-block", width: size, height: size, flexShrink: 0, ...style }} />;
  return <img src={src} alt="" width={size} height={size} style={{ display: "block", width: size, height: size, objectFit: "contain", flexShrink: 0, ...style }} />;
}

/** Power rating for display. flip=true shows -rating (higher = better, like the advance-odds reference); false keeps the site's signed convention. */
export function fmtRating(rating: number, flip: boolean): string {
  const v = flip ? -rating : rating;
  return `${!flip && v > 0 ? "+" : ""}${v.toFixed(1)}`;
}

export function AutoTag({ label = "AUTO" }: { label?: string }) {
  return (
    <span
      style={{
        fontSize: 8.5,
        fontWeight: 800,
        letterSpacing: "0.06em",
        color: NAVY,
        background: "#d9a441",
        borderRadius: 3,
        padding: "1px 4px",
        lineHeight: "12px",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}
