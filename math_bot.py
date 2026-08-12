#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MATH Poker Bot v3 — 无经验常数，严格实时计算
与 math_engine.js 逻辑一致。

用法:
    echo '<game_state_json>' | python math_bot.py

输入: {me_id, hand:[{rank,suit}], community, burnCards, pot, currentBet,
       lastRaiseSize, bb, phase, startingPot, players, history}
输出: {action, amount, equity, ranges, reason}
"""
import sys, json, random
from itertools import combinations

RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A']
RANK_VAL = {r: i+2 for i, r in enumerate(RANKS)}
SUITS = ['spades','hearts','clubs','diams']
SHORT = {'spades':'s','hearts':'h','clubs':'c','diams':'d'}

def fmt(c): return c['rank'] + SHORT[c['suit']]

# ---- 预计算胜率表 ----
try:
    PREFLOP = json.load(open('preflop_equity.json', encoding='utf-8'))
except Exception:
    PREFLOP = {}

def hand_key(c1, c2):
    if c1['rank'] == c2['rank']: return c1['rank']*2
    hi, lo = (c1['rank'], c2['rank']) if RANK_VAL[c1['rank']] >= RANK_VAL[c2['rank']] else (c2['rank'], c1['rank'])
    return hi + lo + ('s' if c1['suit']==c2['suit'] else 'o')

def hand_combos(k): return 6 if len(k)==2 else (4 if k[2]=='s' else 12)

EQ_LIST = sorted([{'key':k,'eq':PREFLOP[k]['1'],'weight':hand_combos(k)} for k in PREFLOP], key=lambda x:-x['eq'])
TOTAL_COMBOS = 1326
BEST_WIDTH = EQ_LIST[0]['weight']/TOTAL_COMBOS

def eq_to_width(t):
    if t <= 0: return 1.0
    c = 0
    for h in EQ_LIST:
        if h['eq'] >= t-1e-9: c += h['weight']
        else: break
    return max(c/TOTAL_COMBOS, BEST_WIDTH)

def width_to_eq(w):
    c = 0
    for h in EQ_LIST:
        nc = c + h['weight']
        if nc/TOTAL_COMBOS >= w: return h['eq']
        c = nc
    return EQ_LIST[-1]['eq']

def hand_eq(c1, c2):
    k = hand_key(c1, c2)
    return PREFLOP[k]['1'] if k in PREFLOP else 0.5

def table_eq(key, n):
    return PREFLOP[key][str(max(1,min(8,n)))] if key in PREFLOP else 0.5

# ---- 手牌评估 (精确) ----
def eval5(cards):
    vals = sorted([RANK_VAL[c['rank']] for c in cards], reverse=True)
    suits = [c['suit'] for c in cards]
    flush = len(set(suits))==1
    uv = sorted(set(vals), reverse=True)
    straight = False; sh = 0
    if len(uv)==5:
        if uv[0]-uv[-1]==4: straight=True; sh=uv[0]
        if uv==[14,5,4,3,2]: straight=True; sh=5
    counts = {}
    for v in vals: counts[v]=counts.get(v,0)+1
    groups = sorted(counts.items(), key=lambda kv:(-kv[1],-kv[0]))
    pat = [c for _,c in groups]
    if flush and straight: return (8,[sh])
    if pat==[4,1]: return (7,[groups[0][0],groups[1][0]])
    if pat==[3,2]: return (6,[groups[0][0],groups[1][0]])
    if flush: return (5,vals)
    if straight: return (4,[sh])
    if pat==[3,1,1]: return (3,[groups[0][0]]+sorted([v for v,c in groups[1:]],reverse=True))
    if pat==[2,2,1]:
        pairs=sorted([v for v,c in groups if c==2],reverse=True)
        return (2,pairs+[groups[2][0]])
    if pat==[2,1,1,1]: return (1,[groups[0][0]]+sorted([v for v,c in groups[1:]],reverse=True))
    return (0,vals)

def cmp_hand(a,b):
    if a[0]!=b[0]: return a[0]-b[0]
    for x,y in zip(a[1],b[1]):
        if x!=y: return x-y
    return 0

def best_hand(hole, comm):
    allc = hole + comm
    if len(allc) < 5: return None
    best = None
    for combo in combinations(allc,5):
        r = eval5(list(combo))
        if best is None or cmp_hand(r,best) > 0: best = r
    return best

# ---- MC 胜率 ----
def shuffle(a):
    random.shuffle(a); return a

def build_deck():
    return [{'suit':s,'rank':r,'value':RANK_VAL[r]} for s in SUITS for r in RANKS]

def in_range(c1,c2,rng):
    if rng is None or rng['width']>=1.0: return True
    if rng['width']<=0: return False
    return hand_eq(c1,c2) >= rng['minEq']

def deal_type(t, d):
    if len(t)==2:
        r=t[0]; idxs=[i for i,c in enumerate(d) if c["rank"]==r]
        if len(idxs)<2: return None
        c1=d.pop(idxs[0]); c2=d.pop(idxs[1]-1); return [c1,c2]
    hi,lo,suited=t[0],t[1],t[2]=="s"
    if suited:
        for s in SUITS:
            i1=next((i for i,c in enumerate(d) if c["rank"]==hi and c["suit"]==s),None)
            if i1 is None: continue
            i2=next((i for i,c in enumerate(d) if c["rank"]==lo and c["suit"]==s),None)
            if i2 is None: continue
            c1=d.pop(i1); c2=d.pop(i2-1 if i1<i2 else i2); return [c1,c2]
        return None
    i1=next((i for i,c in enumerate(d) if c["rank"]==hi),None)
    if i1 is None: return None
    c1=d.pop(i1)
    i2=next((i for i,c in enumerate(d) if c["rank"]==lo and c["suit"]!=c1["suit"]),None)
    if i2 is None: d.append(c1); return None
    return [c1, d.pop(i2)]
def mc_equity(my_hand, opp_ranges, community, dead, iters=200):
    used = set(fmt(c) for c in my_hand+community+dead)
    deck = [c for c in build_deck() if fmt(c) not in used]
    cands=[]
    for r in opp_ranges:
        if r is None or r["width"]>=1.0: cands.append(None)
        elif r["width"]<=0: cands.append([])
        else: cands.append([h["key"] for h in EQ_LIST if h["eq"]>=r["minEq"]])
    wins=0; ties=0; total=0
    for _ in range(iters):
        d=list(deck); oh=[]; ok=True
        for cand in cands:
            if cand is None:
                if len(d)<2: ok=False; break
                oh.append([d.pop(),d.pop()])
            elif not cand: ok=False; break
            else:
                hh=deal_type(cand[random.randrange(len(cand))],d)
                if hh is None: ok=False; break
                oh.append(hh)
        if not ok: continue
        board=list(community)
        while len(board)<5 and d: board.append(d.pop())
        if len(board)<5: continue
        mb=best_hand(my_hand,board)
        if mb is None: continue
        ob=[best_hand(h,board) for h in oh]
        if all(b is not None and cmp_hand(mb,b)>0 for b in ob): wins+=1
        elif all(b is not None and cmp_hand(mb,b)>=0 for b in ob): ties+=1
        total+=1
    return (wins+ties*0.5)/total if total>0 else 0.5

# ---- 范围推断 (从底池赔率) ----
def infer_range(opp, history, starting_pot):
    running = starting_pot or 0
    width = 1.0
    for a in history:
        if a.get('playerId') != opp['id']: continue
        if a.get('action')=='fold': width=0; break
        bet = a.get('amount') or 0
        if a.get('action') in ('raise','allin','call'):
            req = bet/(running+bet) if running+bet>0 else 0
            width = min(width, eq_to_width(min(0.99,max(req,0.001))))
        running += bet
    return {'width':width, 'minEq':0 if width>=1 else width_to_eq(width)}

# ---- EV 决策 ----
def raise_ev(R, state, opps, my_equity, me):
    pot = state['pot']
    p_all_fold = 1.0; ev = 0.0; p_calls=[]
    my_add = max(R - (me.get('bet') or 0), 0)
    for opp in opps:
        bet_faced = max(R - (opp.get('bet') or 0), 0)
        req = bet_faced/(pot+bet_faced) if pot+bet_faced>0 else 0.5
        call_frac = eq_to_width(min(0.99,max(req,0.001)))
        w = infer_range(opp, state['history'], state.get('startingPot')).get('width')
        p_call = min(1, call_frac/w) if w>0 else 1
        mdf = pot/(pot+bet_faced) if pot+bet_faced>0 else 1
        p_call = max(p_call, mdf)
        p_calls.append((p_call, call_frac, bet_faced))
        p_all_fold *= (1-p_call)
    avg_frac = sum(c for _,c,_ in p_calls)/max(len(p_calls),1) if p_calls else 0.5
    eq_vs = my_equity if avg_frac>=1 else mc_equity(state['hand'],[{'width':avg_frac,'minEq':width_to_eq(avg_frac)}],state['community'],state.get('burnCards') or [],120)
    for p_call,_,bf in p_calls:
        ev += p_call*(eq_vs*(pot+my_add+bf)-my_add)
    return ev + p_all_fold*pot

def decide(state):
    me = next(p for p in state['players'] if p['id']==state['me_id'])
    to_call = max(0, state['currentBet'] - me['bet'])
    cc = len(state['community'])
    opps = [p for p in state['players'] if p['id']!=me['id'] and not p['folded'] and not p['allIn']]
    history = state.get('history') or []
    ranges = [infer_range(o, history, state.get('startingPot')) for o in opps]
    n_opp = max(len(opps),1)

    # equity
    if cc>=3:
        equity = mc_equity(state['hand'], ranges, state['community'], state.get('burnCards') or [], 200)
    else:
        all_wide = all(r['width']>=0.9 for r in ranges)
        if all_wide and len(state['hand'])>=2:
            equity = table_eq(hand_key(state['hand'][0],state['hand'][1]), n_opp)
        else:
            equity = mc_equity(state['hand'], ranges, [], state.get('burnCards') or [], 200)

    # EV decisions
    decisions = [{'action':'fold','amount':0,'ev':0}]
    if to_call==0: decisions.append({'action':'check','amount':0,'ev':0})
    if to_call>0: decisions.append({'action':'call','amount':to_call,'ev':equity*(state['pot']+to_call)-(1-equity)*to_call})

    min_raise = state['currentBet']+state['lastRaiseSize']
    max_raise = me['chips']+me['bet']
    if max_raise>min_raise:
        cand = {min_raise}
        pot = state['pot'] or 1
        for f in (0.5,1.0,2.0):
            R = int(pot*f/10)*10
            if min_raise < R <= max_raise: cand.add(R)
        cand.add(max_raise)
        for R in sorted(c for c in cand if state['currentBet']<c<=max_raise)[:5]:
            decisions.append({'action':'raise','amount':R,'ev':raise_ev(R,state,opps,equity,me)})

    prio={'check':3,'call':2,'raise':1,'fold':0}
    best = max(decisions, key=lambda d:(d['ev'],prio[d['action']]))
    return {'action':best['action'],'amount':best['amount'],'equity':equity,
            'ranges':[{'width':round(r['width'],2)} for r in ranges],
            'reason':'EV max: '+' | '.join(d['action']+('+' if d['ev']>=0 else '')+('%.1f'%d['ev']) for d in decisions)}

def main():
    state = json.load(sys.stdin)
    print(json.dumps(decide(state), ensure_ascii=False))

if __name__ == '__main__':
    main()
