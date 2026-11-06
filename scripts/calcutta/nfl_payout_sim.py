import random, math, collections
random.seed(7)
N = 100000
SEED_RATING = [7.0, 5.0, 4.0, 1.5, 3.5, 2.5, 1.0]   # typical rating by seed (pts vs avg)
HFA, PTS_SD, RATING_NOISE = 1.5, 9.5, 1.5
TEAMS = [(c, s) for c in "AN" for s in range(1, 8)]   # A=AFC, N=NFC

def run():
    R = {t: SEED_RATING[t[1]-1] + random.gauss(0, RATING_NOISE) for t in TEAMS}
    st = {t: dict(rc=0, games=[], to=0, ats_w=0, ats_g=0) for t in TEAMS}
    games = []
    def play(h, a, neutral=False):
        d = R[h] - R[a] + (0 if neutral else HFA)
        ph = random.gauss(22 + d/2, PTS_SD); pa = random.gauss(22 - d/2, PTS_SD)
        ph, pa = max(0, round(ph)), max(0, round(pa))
        while ph == pa:
            if random.random() < 0.5 + d/40: ph += 3
            else: pa += 3
        spread = d  # home favored by d
        margin = ph - pa
        for t, m, opp in ((h, margin, a), (a, -margin, h)):
            s = st[t]; won = m > 0
            s['games'].append(dict(m=m, opp=opp, won=won, pts=ph if t == h else pa))
            s['to'] += sum(1 for _ in range(10) if random.random() < 0.13)  # ~1.3/g
            cov = (m - (spread if t == h else -spread))
            if abs(cov) > 0.25:
                s['ats_g'] += 1; s['ats_w'] += cov > 0
        w, l = (h, a) if margin > 0 else (a, h)
        games.append(dict(w=w, l=l, m=abs(margin)))
        return w
    champs = []
    for c in "AN":
        T = lambda s: (c, s)
        for s in range(1, 8): pass
        st[T(1)]['rc'] = 1  # bye
        wc = [play(T(2), T(7)), play(T(3), T(6)), play(T(4), T(5))]
        for w in wc: st[w]['rc'] = 1
        wc.sort(key=lambda t: t[1])
        d1 = play(T(1), wc[2]); d2 = play(wc[0], wc[1])
        for w in (d1, d2): st[w]['rc'] = 2
        h, a = sorted([d1, d2], key=lambda t: t[1])
        cc = play(h, a); st[cc]['rc'] = 3; champs.append(cc)
    sb = play(champs[0], champs[1], neutral=True); st[sb]['rc'] = 4
    return st, games, sb, champs

def split(winners, val, out):
    for w in winners: out[w] += val / len(winners)

STRUCTS = {
  # name: (wc, div, conf, sb, bye_credit)
  "Unabated BTP (3.5/6.5/10/13)": (3.5, 6.5, 10, 13, False),
  "Template 5/5/10/10":           (5, 5, 10, 10, False),
  "Your 3/5/10/17":               (3, 5, 10, 17, False),
  "Current site default 2.5*8/5/10/40": (2.5, 5, 10, 40, True),
}
PROPS = ["upset_seed", "worst_loss", "most_TO", "ats_pct", "closest_loss", "cinderella", "most_pts_in_loss", "most_TO_one_game"]

main = {k: collections.defaultdict(float) for k in STRUCTS}
pts = collections.defaultdict(float)   # loser-points structure
props = {p: collections.defaultdict(float) for p in PROPS}
anypay = {k: collections.defaultdict(int) for k in STRUCTS}
reach = collections.defaultdict(lambda: [0]*5)

for _ in range(N):
    st, games, sb, champs = run()
    for t in TEAMS:
        rc = st[t]['rc']; reach[t][rc] += 1
        for k, (wc, dv, cf, s, bye) in STRUCTS.items():
            v = 0
            if rc >= 1 and (t[1] != 1 or bye): v += wc
            if rc >= 2: v += dv
            if rc >= 3: v += cf
            if rc >= 4: v += s
            main[k][t] += v
            if v > 0: anypay[k][t] += 1
        # loser points 15/7/3/1 of 32
        p = {4: 15, 3: 7}.get(rc, 0)
        if rc == 2: p = 3
        if rc == 1 and t[1] != 1: p = 1
        if rc == 1 and t[1] == 1: p = 1
        pts[t] += p / 32 * 100
    # upset by seed (within playoff games, winner seed number > loser seed number); SB counts too
    ups = [(g['w'][1] - g['l'][1], g['w']) for g in games if g['w'][1] > g['l'][1]]
    if ups:
        mx = max(u[0] for u in ups); split({u[1] for u in ups if u[0] == mx}, 1, props['upset_seed'])
    else: split({sb}, 1, props['upset_seed'])
    worst = max(g['m'] for g in games); split({g['l'] for g in games if g['m'] == worst}, 1, props['worst_loss'])
    close = min(g['m'] for g in games); split({g['l'] for g in games if g['m'] == close}, 1, props['closest_loss'])
    mto = max(st[t]['to'] for t in TEAMS); split({t for t in TEAMS if st[t]['to'] == mto}, 1, props['most_TO'])
    # single-game TO max
    best = -1; who = set()
    for t in TEAMS:
        pass
    # ats pct, tiebreak most ats wins
    def key(t):
        s = st[t]; return ((s['ats_w'] / s['ats_g']) if s['ats_g'] else 0, s['ats_w'])
    k = max(key(t) for t in TEAMS); split({t for t in TEAMS if key(t) == k}, 1, props['ats_pct'])
    # cinderella: highest seed number with most rounds cleared among seeds 4-7 (furthest advance, tie -> higher seed number)
    cand = [t for t in TEAMS if t[1] >= 5]
    ck = max((st[t]['rc'], t[1]) for t in cand); split({t for t in cand if (st[t]['rc'], t[1]) == ck}, 1, props['cinderella'])
    # most points scored in a loss
    lp = [(gg['pts'], t) for t in TEAMS for gg in st[t]['games'] if not gg['won']]
    mx = max(x[0] for x in lp); split({x[1] for x in lp if x[0] == mx}, 1, props['most_pts_in_loss'])

def show(title, d, scale=1):
    row = [d[('A', s)] + d[('N', s)] for s in range(1, 8)]
    print(f"{title:38s}" + "".join(f"{v/2/N*scale:7.2f}" for v in row))

print("Per-team expected % of pot by seed (avg of AFC/NFC)")
print(" " * 38 + "".join(f"{'#'+str(s):>7s}" for s in range(1, 8)))
for k in STRUCTS: show(k, main[k])
show("Loser points 15/7/3/1 (100% scale)", pts)
print("\nP(team cashes anything from main rounds), %")
for k in STRUCTS: show(k, anypay[k], 100)
print("\nProp: chance a team of each seed wins it (%), ties split")
for p in PROPS:
    if props[p]: show(p, props[p], 100)
print("\nReach by seed: P(clear >=1,2,3,4 rounds) %")
for r in range(1, 5):
    show(f"cleared {r}", {t: sum(reach[t][r:]) for t in TEAMS}, 100)
