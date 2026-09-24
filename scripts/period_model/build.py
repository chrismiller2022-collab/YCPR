import json, numpy as np, pandas as pd
games=json.load(open("games.json")); lines=json.load(open("lines.json"))
pref=["consensus","DraftKings","Bovada"]
by={}
for l in lines: by.setdefault(l["game_id"],[]).append(l)
def pick(ls,f):
    ls=[l for l in ls if l.get(f) is not None]
    if not ls: return None
    for p in pref:
        for l in ls:
            if l["provider"]==p: return l[f]
    return ls[0][f]
rows=[]
for g in games:
    hs,as_=g["home_line_scores"],g["away_line_scores"]
    if not hs or not as_ or len(hs)<4 or len(as_)<4: continue
    ls=by.get(g["id"],[])
    sp=pick(ls,"spread"); tot=pick(ls,"over_under")
    if sp is None or tot is None: continue
    r=dict(id=g["id"],season=g["season"],week=g["week"],neutral=int(bool(g["neutral_site"])),spread=float(sp),total=float(tot),
           ot=int(len(hs)>4 or len(as_)>4))
    for i in range(4):
        r[f"h{i+1}"]=float(hs[i]); r[f"a{i+1}"]=float(as_[i])
    rows.append(r)
df=pd.DataFrame(rows)
df["reg_h"]=df[["h1","h2","h3","h4"]].sum(axis=1); df["reg_a"]=df[["a1","a2","a3","a4"]].sum(axis=1)
df.to_csv("data.csv",index=False)
print(len(df), df.season.value_counts().sort_index().to_dict())
print("OT share",df.ot.mean().round(3))
tot_reg=df.reg_h+df.reg_a
print("Q share of reg points:",[round((df[f"h{i}"]+df[f"a{i}"]).sum()/tot_reg.sum(),3) for i in range(1,5)])
print("1H share",round(((df.h1+df.h2+df.a1+df.a2).sum())/tot_reg.sum(),3))
print("1H tie rate",round(((df.h1+df.h2)==(df.a1+df.a2)).mean(),3), "Q1 tie",round((df.h1==df.a1).mean(),3),"Q1 0-0",round(((df.h1==0)&(df.a1==0)).mean(),3))
print("mean total actual",round(tot_reg.mean(),2),"mean market",round(df.total.mean(),2))
print("total corr w/ market",round(np.corrcoef(tot_reg,df.total)[0,1],3))
