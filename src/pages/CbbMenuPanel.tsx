// College Basketball's own admin landing page — deliberately not reusing
// AdminSidebar/NAV_GROUPS (CFB's admin nav): this is meant to be a clean
// slate with no college football anything, per Chris's explicit spec.
// Just two ways out: into a CBB tool, or back to the CFB admin.
export default function CbbMenuPanel({
  onBack,
  onSelectPowerRatings,
}: {
  onBack: () => void;
  onSelectPowerRatings: () => void;
}) {
  return (
    <div>
      <h2 style={{ marginTop: 0 }}>College Basketball</h2>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem", marginTop: 0 }}>Its own space, separate from the CFB admin.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.75rem", maxWidth: 700 }}>
        <button
          className="menu-btn"
          onClick={onSelectPowerRatings}
          style={{ textAlign: "left", padding: "1rem", display: "flex", flexDirection: "column", gap: "0.3rem" }}
        >
          <span style={{ fontWeight: 700 }}>Power Ratings</span>
          <span style={{ fontSize: "0.78rem", color: "var(--chalk-dim)", fontWeight: 400 }}>
            Team roster, conferences, SRS/Elo, Massey — one system per column.
          </span>
        </button>
        <button
          className="menu-btn"
          onClick={onBack}
          style={{ textAlign: "left", padding: "1rem", display: "flex", flexDirection: "column", gap: "0.3rem" }}
        >
          <span style={{ fontWeight: 700 }}>‹ College Football</span>
          <span style={{ fontSize: "0.78rem", color: "var(--chalk-dim)", fontWeight: 400 }}>Back to the main admin.</span>
        </button>
      </div>
    </div>
  );
}
