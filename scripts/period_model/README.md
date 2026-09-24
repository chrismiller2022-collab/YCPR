# Period (quarter/half) model — offline training

Run from this folder (needs numpy, pandas, scikit-learn):

1. `python3 pull.py`   — pulls completed FBS-vs-FBS games (with CFBD line scores) + betting lines from Supabase (public read).
2. `python3 build.py`  — builds data.csv and prints sanity stats (quarter shares, tie rates).
3. `python3 sim2.py`   — leave-one-season-out calibration of the simulator (PIT histograms should be ~0.10 per decile; tie rates should match).
4. `python3 export.py` — writes periodModelData.ts; copy it to src/lib/periodModelData.ts.

Bump nothing by hand: the model version string is generated from the training set, and locked
period projections remember the version they were priced under.
