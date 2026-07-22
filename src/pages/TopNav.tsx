import { useEffect, useRef, useState } from "react";
import { Menu, X, ChevronDown } from "lucide-react";
import { conferencesForDivision, teamsForConference } from "../data/teams";
import { NAV } from "../lib/nav";

export default function TopNav({ onNavigate, onNavigateTeam, onNavigateSingle, onHome }: any) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [openCategory, setOpenCategory] = useState(null);
  const [teamDivision, setTeamDivision] = useState(null);
  const [teamConference, setTeamConference] = useState(null);
  const [futuresItem, setFuturesItem] = useState(null);
  const topbarRef = useRef(null);

  useEffect(() => {
    const el = topbarRef.current;
    if (!el) return;

    const setHeightVar = () => {
      document.documentElement.style.setProperty(
        "--topbar-h",
        `${el.offsetHeight}px`
      );
    };

    setHeightVar();
    const ro = new ResizeObserver(setHeightVar);
    ro.observe(el);
    window.addEventListener("resize", setHeightVar);

    // Fonts loading async can change the topbar's height after first paint.
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(setHeightVar);
    }

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", setHeightVar);
    };
  }, []);

  const resetDrill = () => {
    setTeamDivision(null);
    setTeamConference(null);
    setFuturesItem(null);
  };

  const toggleMenu = () => {
    setMenuOpen((v) => !v);
    setOpenCategory(null);
    resetDrill();
  };

  const openCat = (key) => {
    if (openCategory !== key) resetDrill();
    setOpenCategory(openCategory === key ? null : key);
  };

  return (
    <>
      <div className="topbar" ref={topbarRef}>
        <button className="brand" onClick={onHome}>
          YC<span>•</span>POWER RATINGS
        </button>
        <button className="menu-btn" onClick={toggleMenu}>
          {menuOpen ? <X size={16} /> : <Menu size={16} />}
          Menu
        </button>
      </div>

      {menuOpen && (
        <div className="menu-overlay" onClick={toggleMenu}>
          <div className="menu-panel" onClick={(e) => e.stopPropagation()}>
            <button
              className="menu-home-item"
              onClick={() => {
                onHome();
                toggleMenu();
              }}
            >
              Home
            </button>
            <div className="menu-divider" />
            {NAV.map((cat) => (
              <div key={cat.key} className="menu-cat">
                <button
                  className="menu-cat-btn"
                  onClick={() => {
                    if (cat.single) {
                      onNavigateSingle(cat.pageType);
                      toggleMenu();
                    } else {
                      openCat(cat.key);
                    }
                  }}
                >
                  {cat.label}
                  {!cat.single && (
                    <ChevronDown
                      size={14}
                      className={`chev ${
                        openCategory === cat.key ? "chev-open" : ""
                      }`}
                    />
                  )}
                </button>

                {!cat.single && openCategory === cat.key && cat.drill && (
                  <div className="sub-panel">
                    {!teamDivision && (
                      <div className="sub-grid two-col">
                        {["FBS", "FCS"].map((d) => (
                          <button
                            key={d}
                            className="sub-chip"
                            onClick={() => setTeamDivision(d)}
                          >
                            {d}
                          </button>
                        ))}
                      </div>
                    )}

                    {teamDivision && !teamConference && (
                      <>
                        <button
                          className="drill-back"
                          onClick={() => setTeamDivision(null)}
                        >
                          ‹ {teamDivision}
                        </button>
                        <div className="sub-grid">
                          {conferencesForDivision(teamDivision).map((c) => (
                            <button
                              key={c}
                              className="sub-chip"
                              onClick={() => setTeamConference(c)}
                            >
                              {c}
                            </button>
                          ))}
                        </div>
                      </>
                    )}

                    {teamDivision && teamConference && (
                      <>
                        <button
                          className="drill-back"
                          onClick={() => setTeamConference(null)}
                        >
                          ‹ {teamConference}
                        </button>
                        <div className="sub-grid">
                          {teamsForConference(teamDivision, teamConference).map(
                            (t) => (
                              <button
                                key={t.team}
                                className="sub-chip"
                                onClick={() => {
                                  onNavigateTeam(t);
                                  toggleMenu();
                                }}
                              >
                                {t.team}
                              </button>
                            )
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {!cat.single && openCategory === cat.key && cat.futures && (
                  <div className="sub-panel">
                    {!futuresItem && (
                      <div className="futures-list">
                        {cat.items.map((item) => (
                          <button
                            key={item.key}
                            className="futures-item-btn"
                            onClick={() => {
                              if (item.expandable) {
                                setFuturesItem(item.key);
                              } else {
                                onNavigate("futures", "Futures", item.key, item.label);
                                toggleMenu();
                              }
                            }}
                          >
                            {item.label}
                            {item.expandable && (
                              <ChevronDown size={14} className="chev" />
                            )}
                          </button>
                        ))}
                      </div>
                    )}

                    {futuresItem &&
                      (() => {
                        const active = cat.items.find(
                          (i) => i.key === futuresItem
                        );
                        return (
                          <>
                            <button
                              className="drill-back"
                              onClick={() => setFuturesItem(null)}
                            >
                              ‹ {active.label}
                            </button>
                            <div className="sub-grid">
                              {active.subs.map((s) => (
                                <button
                                  key={s.key}
                                  className="sub-chip"
                                  onClick={() => {
                                    onNavigate(
                                      active.key,
                                      active.label,
                                      s.key,
                                      s.label
                                    );
                                    toggleMenu();
                                  }}
                                >
                                  {s.label}
                                </button>
                              ))}
                            </div>
                          </>
                        );
                      })()}
                  </div>
                )}

                {!cat.single && !cat.futures && openCategory === cat.key && !cat.drill && (
                  <div className="sub-grid">
                    {cat.subs.map((s) => (
                      <button
                        key={s.key}
                        className="sub-chip"
                        onClick={() => {
                          if (s.pageType) {
                            onNavigateSingle(s.pageType);
                          } else {
                            onNavigate(cat.key, cat.label, s.key, s.label);
                          }
                          toggleMenu();
                        }}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
