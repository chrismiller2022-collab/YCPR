function PoolTile({
  label,
  description,
  comingSoon,
  onClick,
}: {
  label: string;
  description: string;
  comingSoon?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: "left",
        padding: "1rem 1.1rem",
        background: "var(--turf-panel)",
        border: "1px solid var(--hash)",
        borderRadius: 8,
        cursor: "pointer",
        color: "inherit",
        display: "flex",
        flexDirection: "column",
        gap: "0.3rem",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontWeight: 700 }}>{label}</span>
        {comingSoon && (
          <span
            style={{
              fontSize: "0.68rem",
              padding: "0.15rem 0.5rem",
              borderRadius: 999,
              background: "rgba(255,255,255,0.06)",
              color: "var(--chalk-dim)",
            }}
          >
            Coming soon
          </span>
        )}
      </div>
      <span style={{ fontSize: "0.82rem", color: "var(--chalk-dim)" }}>{description}</span>
    </button>
  );
}

export default function PoolsMenuPanel({
  onBack,
  onSelectPool,
}: {
  onBack: () => void;
  onSelectPool: (pool: string) => void;
}) {
  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Admin
      </button>

      <h2 style={{ marginTop: 0 }}>Pools</h2>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem", marginTop: 0 }}>
        Each pool you're entered in, as its own tool.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.75rem" }}>
        <PoolTile label="ESPN Confidence" description="Confidence pick'em pool." onClick={() => onSelectPool("espnconfidence")} />
        <PoolTile label="Survivor" description="Personal survivor pool planner — spread/moneyline projections, save a path." onClick={() => onSelectPool("survivor")} />
        <PoolTile label="ESPN Moneyline" description="Straight-up moneyline pool." onClick={() => onSelectPool("espnml")} />
        <PoolTile label="ESPN Spreads" description="Against-the-spread pool." onClick={() => onSelectPool("espnspread")} />
        <PoolTile
          label="The Brit"
          description="Weekly $10 pick'em with a local pub."
          onClick={() => onSelectPool("brit")}
        />
        <PoolTile label="Peay Pool" description="ATS pool vs a custom line, all FBS vs FBS games." onClick={() => onSelectPool("peay")} />
        <PoolTile label="Westgate Supercontest" description="ATS pool vs a custom line, all FBS vs FBS games." onClick={() => onSelectPool("westgate")} />
        <PoolTile
          label="CBS Splash"
          description="ATS pool vs a custom line, all FBS vs FBS games."
          onClick={() => onSelectPool("cbssplash")}
        />
        <PoolTile
          label="CFBD Pick'em"
          description="Fill in predicted margins for CFBD's own prediction contest CSV."
          onClick={() => onSelectPool("cfbdpickem")}
        />
        <PoolTile
          label="CBS Pickem"
          description="Pick against CBS's spread for each game."
          onClick={() => onSelectPool("cbspickem")}
        />
      </div>
    </div>
  );
}
