import numpy as np, pandas as pd
from sim import O, fit, predict
rng=np.random.default_rng(11)
V=["f1","f2","f3","f4","d1","d2","d3","d4"]
def tilt_weights(X,mu,reg=1e-3,iters=60):
    # max-entropy reweighting: find w_i ∝ exp(X_i·λ) with sum w_i X_i = mu
    n,p=X.shape; Xc=X-mu; lam=np.zeros(p)
    def obj(l):
        z=Xc@l; m=z.max(); return m+np.log(np.exp(z-m).sum())+0.5*reg*l@l
    for _ in range(iters):
        z=Xc@lam; w=np.exp(z-z.max()); w/=w.sum()
        g=Xc.T@w+reg*lam                     # gradient of logsumexp(Xc lam)
        H=(Xc*w[:,None]).T@Xc-np.outer(Xc.T@w,Xc.T@w)+reg*np.eye(p)
        step=np.linalg.solve(H,g); t=1.0; f0=obj(lam)
        while obj(lam-t*step)>f0 and t>1e-6: t/=2
        lam=lam-t*step
        if np.abs(g).max()<1e-6: break
    z=Xc@lam; w=np.exp(z-z.max()); return w/w.sum()
def simulate(train,mu,abs_spread,total,n,k=500):
    ta=train.abs_spread.values;tt=train.total.values
    d=((ta-abs_spread)/ta.std())**2+((tt-total)/tt.std())**2
    idx=np.argsort(d)[:k]; X=train[V].values[idx].astype(float)
    w=tilt_weights(X,mu)
    return X[rng.choice(len(idx),size=n,p=w)]
def stats(sim):
    f=sim[:,:4];d=sim[:,4:]
    return dict(q_tot=f+d,h1_tot=(f[:,:2]+d[:,:2]).sum(1),h1_margin=(f[:,:2]-d[:,:2]).sum(1),q1_tie=(f[:,0]==d[:,0]),q1_00=((f[:,0]==0)&(d[:,0]==0)),h1_tie=(f[:,:2].sum(1)==d[:,:2].sum(1)),
                final_tot=f.sum(1)+d.sum(1),final_margin=f.sum(1)-d.sum(1))
if __name__=="__main__":
    test_season=2025
    tr=O[O.season<test_season].reset_index(drop=True);te=O[O.season==test_season].reset_index(drop=True)
    sc,m,_=fit(tr)
    pit={k:[] for k in ["q1_tot","h1_tot","h1_margin","q4_tot","final_tot","final_margin"]};agg={k:[] for k in ["q1_tie","q1_00","h1_tie"]};act={k:[] for k in agg}
    zs=[]
    for i,r in te.iterrows():
        mu=predict(sc,m,np.array([r.abs_spread]),np.array([r.total]),np.array([r.neutral]),np.array([r.fav_home]))[0]
        sim=simulate(tr,mu,r.abs_spread,r.total,600); s=stats(sim)
        a_f=np.array([r.f1,r.f2,r.f3,r.f4]);a_d=np.array([r.d1,r.d2,r.d3,r.d4])
        av=dict(q1_tot=a_f[0]+a_d[0],h1_tot=a_f[:2].sum()+a_d[:2].sum(),h1_margin=a_f[:2].sum()-a_d[:2].sum(),q4_tot=a_f[3]+a_d[3],final_tot=a_f.sum()+a_d.sum(),final_margin=a_f.sum()-a_d.sum())
        sv=dict(q1_tot=s["q_tot"][:,0],h1_tot=s["h1_tot"],h1_margin=s["h1_margin"],q4_tot=s["q_tot"][:,3],final_tot=s["final_tot"],final_margin=s["final_margin"])
        for k_ in pit:
            x=sv[k_];a=av[k_];pit[k_].append(((x<a).mean()+(x<=a).mean())/2)
        for k_ in agg: agg[k_].append(s[k_].mean())
        act["q1_tie"].append(a_f[0]==a_d[0]);act["q1_00"].append(a_f[0]==0 and a_d[0]==0);act["h1_tie"].append(a_f[:2].sum()==a_d[:2].sum())
        zs.append((sim.mean(0)-mu).max())
    print("max abs mean-miss of tilt:",np.round(np.abs(zs).max(),3))
    for k_,v in pit.items(): print(k_,np.round(np.histogram(v,bins=10,range=(0,1))[0]/len(v),3))
    for k_ in agg: print(k_,"sim",round(np.mean(agg[k_]),3),"actual",round(np.mean(act[k_]),3))
