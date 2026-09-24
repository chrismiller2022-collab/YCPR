import numpy as np, pandas as pd
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler
rng=np.random.default_rng(7)
df=pd.read_csv("data.csv")
# orient fav/dog: fav = home if spread<0 (home favored) else away; spread==0 -> home
def orient(d):
    fav_home=(d.spread<=0).values
    def col(prefix_h,prefix_a,q): 
        h=d[f"{prefix_h}{q}"].values;a=d[f"{prefix_a}{q}"].values
        return np.where(fav_home,h,a),np.where(fav_home,a,h)
    out={}
    for q in range(1,5):
        f,dg=col("h","a",q); out[f"f{q}"]=f; out[f"d{q}"]=dg
    o=pd.DataFrame(out)
    o["fav_home"]=fav_home.astype(int)
    o["abs_spread"]=d.spread.abs().values;o["total"]=d.total.values;o["neutral"]=d.neutral.values;o["season"]=d.season.values
    o["fav_ep"]=(d.total.values+d.spread.abs().values)/2; o["dog_ep"]=(d.total.values-d.spread.abs().values)/2
    return o
O=orient(df)
FEATS=["ep_own","ep_opp","total","abs_spread","neutral","is_fav","fav_home"]
def stack(o):
    rows=[]
    for side in ["f","d"]:
        x=pd.DataFrame({"ep_own":o.fav_ep if side=="f" else o.dog_ep,"ep_opp":o.dog_ep if side=="f" else o.fav_ep,"total":o.total,"abs_spread":o.abs_spread,
            "neutral":o.neutral,"is_fav":1 if side=="f" else 0,"fav_home":o.fav_home})
        for q in range(1,5): x[f"q{q}"]=o[f"{side}{q}"].values
        rows.append(x)
    return rows  # [fav rows, dog rows]
def fit(o,alpha=10):
    fr,dr=stack(o); S=pd.concat([fr,dr],ignore_index=True)
    sc=StandardScaler().fit(S[FEATS]);m=Ridge(alpha=alpha).fit(sc.transform(S[FEATS]),S[["q1","q2","q3","q4"]])
    pf=m.predict(sc.transform(fr[FEATS]));pd_=m.predict(sc.transform(dr[FEATS]))
    res=np.hstack([fr[["q1","q2","q3","q4"]].values-pf, dr[["q1","q2","q3","q4"]].values-pd_])
    return sc,m,res
def predict(sc,m,abs_spread,total,neutral,fav_home):
    fav_ep=(total+abs_spread)/2;dog_ep=(total-abs_spread)/2
    def f(ep_o,ep_p,isf):
        X=pd.DataFrame({"ep_own":ep_o,"ep_opp":ep_p,"total":total,"abs_spread":abs_spread,"neutral":neutral,"is_fav":isf,"fav_home":fav_home})
        return m.predict(sc.transform(X[FEATS]))
    return np.hstack([f(fav_ep,dog_ep,1),f(dog_ep,fav_ep,0)])
def simulate(train_o,res,mu,abs_spread,total,n,k=250,snap=False):
    # kNN in (abs_spread,total) standardized space
    ta=train_o.abs_spread.values;tt=train_o.total.values
    sa,st=ta.std(),tt.std()
    d=((ta-abs_spread)/sa)**2+((tt-total)/st)**2
    idx=np.argsort(d)[:k]
    pick=res[rng.choice(idx,size=n)]
    sim=np.rint(mu[None,:]+pick).clip(min=0)
    return sim
def stats(sim):  # sim: n x 8 (f1..f4,d1..d4)
    f=sim[:,:4];d=sim[:,4:]
    return dict(q_tot=(f+d),h1_tot=(f[:,:2]+d[:,:2]).sum(1),h1_margin=(f[:,:2]-d[:,:2]).sum(1),q1_tie=(f[:,0]==d[:,0]),q1_00=((f[:,0]==0)&(d[:,0]==0)),h1_tie=((f[:,:2].sum(1))==(d[:,:2].sum(1))),
                final_tot=(f.sum(1)+d.sum(1)),final_margin=(f.sum(1)-d.sum(1)))
if __name__=="__main__":
    test_season=2025
    tr=O[O.season<test_season].reset_index(drop=True);te=O[O.season==test_season].reset_index(drop=True)
    sc,m,res=fit(tr)
    pit={"q1_tot":[],"h1_tot":[],"h1_margin":[],"q4_tot":[],"final_tot":[],"final_margin":[]}
    agg=dict(q1_tie=[],q1_00=[],h1_tie=[])
    act=dict(q1_tie=[],q1_00=[],h1_tie=[])
    for i,r in te.iterrows():
        mu=predict(sc,m,np.array([r.abs_spread]),np.array([r.total]),np.array([r.neutral]),np.array([r.fav_home]))[0]
        sim=simulate(tr,res,mu,r.abs_spread,r.total,600)
        s=stats(sim)
        a_f=np.array([r.f1,r.f2,r.f3,r.f4]);a_d=np.array([r.d1,r.d2,r.d3,r.d4])
        av=dict(q1_tot=a_f[0]+a_d[0],h1_tot=a_f[:2].sum()+a_d[:2].sum(),h1_margin=a_f[:2].sum()-a_d[:2].sum(),q4_tot=a_f[3]+a_d[3],final_tot=a_f.sum()+a_d.sum(),final_margin=a_f.sum()-a_d.sum())
        sv=dict(q1_tot=s["q_tot"][:,0],h1_tot=s["h1_tot"],h1_margin=s["h1_margin"],q4_tot=s["q_tot"][:,3],final_tot=s["final_tot"],final_margin=s["final_margin"])
        for k_ in pit:
            x=sv[k_];a=av[k_]
            pit[k_].append(((x<a).mean()+(x<=a).mean())/2)  # randomized-mid PIT for discrete
        for k_ in agg: agg[k_].append(s[k_].mean())
        act["q1_tie"].append(a_f[0]==a_d[0]);act["q1_00"].append(a_f[0]==0 and a_d[0]==0);act["h1_tie"].append(a_f[:2].sum()==a_d[:2].sum())
    print("PIT decile histograms (ideal = 0.10 each) for",test_season)
    for k_,v in pit.items():
        h=np.histogram(v,bins=10,range=(0,1))[0]/len(v);print(k_,np.round(h,3))
    for k_ in agg: print(k_,"sim",round(np.mean(agg[k_]),3),"actual",round(np.mean(act[k_]),3))
