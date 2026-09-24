import json, urllib.request
URL="https://uyxnmtsntiaxqqmwsteq.supabase.co/rest/v1"
KEY="sb_publishable_6yizAfXG0dIvxcvik8ajFg_z1tf9f3j"
def get(path):
    out=[];off=0
    while True:
        req=urllib.request.Request(f"{URL}/{path}",headers={"apikey":KEY,"Authorization":f"Bearer {KEY}","Range-Unit":"items","Range":f"{off}-{off+999}"})
        with urllib.request.urlopen(req) as r: rows=json.load(r)
        out+=rows
        if len(rows)<1000: break
        off+=1000
    return out
games=get("games?select=id,season,week,neutral_site,completed,home_team,away_team,home_points,away_points,home_line_scores,away_line_scores,home_classification,away_classification&season=gte.2021&completed=eq.true&home_classification=eq.fbs&away_classification=eq.fbs&order=id")
lines=get("betting_lines?select=game_id,provider,spread,over_under,opening_spread,opening_over_under&season=gte.2021&order=id")
json.dump(games,open("games.json","w")); json.dump(lines,open("lines.json","w"))
print(len(games),len(lines))
