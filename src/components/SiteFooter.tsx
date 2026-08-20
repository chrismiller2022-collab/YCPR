import { Twitter } from "lucide-react";

export default function SiteFooter() {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        gap: "0.4rem",
        padding: "2rem 1rem 1.5rem",
        fontSize: "0.8rem",
        color: "var(--chalk-dim)",
      }}
    >
      <a
        href="https://x.com/YCtheflea"
        target="_blank"
        rel="noreferrer"
        style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", color: "var(--chalk-dim)", textDecoration: "none" }}
      >
        <Twitter size={14} />
        @YCtheflea
      </a>
    </div>
  );
}
