// ============================================================
//  MATH ENGINE v3 — 无经验常数，严格实时计算
//
//  核心思想：所有决策参数从「底池赔率 + 预计算手牌胜率分布」推导，
//  不用任何拍脑袋的常量。
//
//  手牌胜率表: preflop_equity.js (169手 × 对手数1-8，蒙特卡洛预计算)
//  范围宽度、弃牌概率、胜率衰减 —— 全部由该分布 + 当前底池赔率实时算出。
// ============================================================

const PREFLOP = require('./preflop_equity.js');

const SUITS = ['spades','hearts','clubs','diams'];
const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const RANK_VAL = {'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14};
const SHORT = {'spades':'s','hearts':'h','clubs':'c','diams':'d'};

function fmt(c){return c.rank + SHORT[c.suit];}

// ============================================================
//  HAND EVALUATION (精确，无近似)
// ============================================================
function eval5(cards){
  const vals = cards.map(c=>RANK_VAL[c.rank]||c.value).sort((a,b)=>b-a);
  const suits = cards.map(c=>c.suit);
  const flush = suits.every(s=>s===suits[0]);
  let straight=false, sh=0;
  const uv = [...new Set(vals)].sort((a,b)=>b-a);
  if(uv.length===5){
    if(uv[0]-uv[4]===4){straight=true; sh=uv[0];}
    if(uv[0]===14&&uv[1]===5&&uv[4]===2){straight=true; sh=5;}
  }
  const cm={}; for(const v of vals) cm[v]=(cm[v]||0)+1;
  const e=Object.entries(cm).map(([v,c])=>[+v,c]).sort((a,b)=>b[1]-a[1]||b[0]-a[0]);
  const cnt=e.map(x=>x[1]);
  if(flush&&straight) return {rank:8,vals:[sh]};
  if(cnt[0]===4) return {rank:7,vals:[e[0][0],e[1][0]]};
  if(cnt[0]===3&&cnt[1]===2) return {rank:6,vals:[e[0][0],e[1][0]]};
  if(flush) return {rank:5,vals};
  if(straight) return {rank:4,vals:[sh]};
  if(cnt[0]===3) return {rank:3,vals:[e[0][0],...e.slice(1).map(x=>x[0]).sort((a,b)=>b-a)]};
  if(cnt[0]===2&&cnt[1]===2) return {rank:2,vals:[...[e[0][0],e[1][0]].sort((a,b)=>b-a),e[2][0]]};
  if(cnt[0]===2) return {rank:1,vals:[e[0][0],...e.slice(1).map(x=>x[0]).sort((a,b)=>b-a)]};
  return {rank:0,vals};
}
function combos(arr,k){if(k===0)return[[]];if(arr.length<k)return[];const out=[];for(let i=0;i<=arr.length-k;i++)for(const rest of combos(arr.slice(i+1),k-1))out.push([arr[i],...rest]);return out;}
function bestHand(hole,comm){
  const all=[...hole,...comm]; if(all.length<5) return null;
  let best=null; for(const c of combos(all,5)){const r=eval5(c); if(!best||cmpHand(r,best)>0) best=r;}
  return best;
}
function cmpHand(a,b){if(a.rank!==b.rank)return a.rank-b.rank;for(let i=0;i<Math.min(a.vals.length,b.vals.length);i++)if(a.vals[i]!==b.vals[i])return a.vals[i]-b.vals[i];return 0;}

// ============================================================
//  PREFLOP EQUITY DISTRIBUTION (预计算 → 实时查表)
// ============================================================
// 手牌 key: "AA" | "AKs" | "AKo"
function handKey(c1,c2){
  if(c1.rank===c2.rank) return c1.rank+c1.rank;
  const v1=RANK_VAL[c1.rank],v2=RANK_VAL[c2.rank];
  const hi=v1>=v2?c1.rank:c2.rank, lo=v1>=v2?c2.rank:c1.rank;
  return hi+lo+(c1.suit===c2.suit?'s':'o');
}
function handCombos(key){return key.length===2?6:(key[2]==='s'?4:12);}

// 按翻前胜率降序排列的加权手牌列表（用于范围→胜率映射）
const EQ_LIST=[];
for(const key of Object.keys(PREFLOP)) EQ_LIST.push({key,eq:PREFLOP[key][0],weight:handCombos(key)});
EQ_LIST.sort((a,b)=>b.eq-a.eq);
const TOTAL_COMBOS=1326;

// eqToWidth(t): 胜率 ≥ t 的手牌占全部组合的比例 (严格由分布计算)
// 下限 = 最强的单种手牌 (AA 6组合)，避免 req 超过 AA 胜率时返回 0 (没人能跟)
const BEST_WIDTH = EQ_LIST[0].weight/TOTAL_COMBOS; // AA = 6/1326
function eqToWidth(t){
  if(t<=0) return 1;
  let c=0;
  for(const h of EQ_LIST){ if(h.eq>=t-1e-9) c+=h.weight; else break; }
  return Math.max(c/TOTAL_COMBOS, BEST_WIDTH);
}
// widthToEq(w): 前 w 比例手牌的最低胜率
function widthToEq(w){
  let c=0;
  for(const h of EQ_LIST){ const nc=c+h.weight; if(nc/TOTAL_COMBOS>=w) return h.eq; c=nc; }
  return EQ_LIST[EQ_LIST.length-1].eq;
}
function handEq(c1,c2){const k=handKey(c1,c2);return PREFLOP[k]?PREFLOP[k][0]:0.5;}
function tableEq(key,nOpp){return PREFLOP[key]?PREFLOP[key][Math.max(0,Math.min(7,nOpp-1))]:0.5;}

// ============================================================
//  OPPONENT RANGE — 从底池赔率严格推导
//  对手跟注/加注/全押时需要的胜率 = 投入/(当前底池+总投入)
//  范围 = 胜率 ≥ 该值的手牌 → 宽度由胜率分布实时算出
// ============================================================

// 从对手的动作推断其范围宽度 (全部从底池赔率推导)
function inferRange(opp, history, startingPot){
  // 重建本局底池时间线，算出每个动作当时面对的底池赔率
  let runningPot=startingPot||0;
  let width=1.0;
  for(const a of history){
    if(a.playerId!==opp.id) continue;
    if(a.action==='fold'){ width=0; break; }
    const aPot=runningPot;
    const bet=a.amount||0;
    if(a.action==='raise'||a.action==='allin'||a.action==='call'){
      // 对手投入 bet，需要胜率 ≥ bet/(pot+bet) 才有利可图
      const req = aPot+bet>0?bet/(aPot+bet):0;
      const w = eqToWidth(Math.min(0.99,Math.max(req,0.001)));
      width=Math.min(width,w);
    }
    runningPot+=bet;
  }
  return {width, minEq:width>=1?0:widthToEq(width)};
}

// ============================================================
//  MONTE CARLO — 我的胜率 vs 对手范围
// ============================================================
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a;}
function buildDeck(){const d=[];for(const s of SUITS)for(const r of RANKS)d.push({suit:s,rank:r,value:RANK_VAL[r]});return d;}

// 手牌是否落在范围内（用预计算胜率表判断，严格）
function inRange(c1,c2,range){
  if(!range||range.width>=1.0) return true;
  if(range.width<=0) return false;
  return handEq(c1,c2)>=range.minEq;
}

// 从牌堆抽出指定手牌类型的一个组合 (如 "AA" 或 "AKs"), 从 deck 移除并返回
function dealType(type, deck){
  if(type.length===2){ // pair
    const r=type[0], idxs=[]; for(let i=0;i<deck.length;i++) if(deck[i].rank===r) idxs.push(i);
    if(idxs.length<2) return null;
    const c1=deck.splice(idxs[0],1)[0]; const c2=deck.splice(idxs[1]-1,1)[0]; return [c1,c2];
  }
  const hi=type[0], lo=type[1], suited=type[2]==='s';
  if(suited){
    for(const s of SUITS){
      const i1=deck.findIndex(c=>c.rank===hi&&c.suit===s);
      if(i1<0) continue;
      const i2=deck.findIndex(c=>c.rank===lo&&c.suit===s);
      if(i2<0) continue;
      const c1=deck.splice(i1,1)[0]; const c2=deck.splice(i1<i2?i2-1:i2,1)[0]; return [c1,c2];
    }
    return null;
  }
  const i1=deck.findIndex(c=>c.rank===hi); if(i1<0) return null;
  const c1=deck.splice(i1,1)[0];
  const i2=deck.findIndex(c=>c.rank===lo&&c.suit!==c1.suit);
  if(i2<0){ deck.push(c1); return null; }
  const c2=deck.splice(i2,1)[0]; return [c1,c2];
}

function mcEquity(myHand, oppRanges, community, deadCards, iters){
  iters=iters||300;
  const used=new Set([...myHand,...community,...deadCards].map(fmt));
  const deck=buildDeck().filter(c=>!used.has(fmt(c)));
  // 每个范围的候选手牌类型 (按胜率表, 严格)
  const cands = oppRanges.map(r=>{
    if(!r||r.width>=1.0) return null;                    // 任意手
    if(r.width<=0) return [];
    return EQ_LIST.filter(h=>h.eq>=r.minEq).map(h=>h.key); // 该范围可打的手牌
  });
  let wins=0,ties=0,total=0;
  for(let i=0;i<iters;i++){
    const d=[...deck]; const oh=[]; let ok=true;
    for(let ci=0;ci<cands.length;ci++){
      const cand=cands[ci];
      if(cand===null){ if(d.length<2){ok=false;break;} const c1=d.pop(),c2=d.pop(); oh.push([c1,c2]); }
      else if(cand.length===0){ ok=false; break; }
      else{
        const type=cand[Math.floor(Math.random()*cand.length)];
        const hand=dealType(type,d);
        if(!hand){ ok=false; break; }
        oh.push(hand);
      }
    }
    if(!ok)continue;
    const board=[...community]; let bi=0;
    while(board.length<5&&d.length) board.push(d.pop());
    if(board.length<5)continue;
    const mb=bestHand(myHand,board); if(!mb)continue;
    const ob=oh.map(h=>bestHand(h,board));
    if(ob.every(b=>b&&cmpHand(mb,b)>0)) wins++;
    else if(ob.every(b=>b&&cmpHand(mb,b)>=0)) ties++; // 未被任何人击败(含平局)
    total++;
  }
  return total>0?(wins+ties*0.5)/total:0.5;
}

// ============================================================
//  DECISION — 纯 EV 最大化
//  fold/check/call/raise 各自算 EV，选最大
// ============================================================
function decide(state){
  const me = state.players.find(p=>p.id===state.me_id);
  if(!me) return {action:'check',amount:0,reason:'no me'};
  const toCall = Math.max(0, state.currentBet - me.bet);
  const cc = state.community.length;
  const opps = state.players.filter(p=>p.id!==me.id && !p.folded && !p.allIn);
  const history = state.history||[];
  const ranges = opps.map(o=>inferRange(o,history,state.startingPot));
  const nOpp = Math.max(opps.length,1);

  // ---- My equity (严格计算) ----
  let equity;
  if(cc>=3){
    equity = mcEquity(state.hand, ranges, state.community, state.burnCards||[], 200);
  }else{
    // 翻前: 对手范围都宽则直接查表，否则 MC vs 范围
    const allWide = ranges.every(r=>r.width>=0.9);
    if(allWide && state.hand.length>=2){
      equity = tableEq(handKey(state.hand[0],state.hand[1]), nOpp);
    }else{
      equity = mcEquity(state.hand, ranges, [], state.burnCards||[], 200);
    }
  }

  // ---- EV of each action (增量, 沉没成本不计) ----
  const decisions=[];
  // Fold: 已投入是沉没成本, 增量损失为 0
  decisions.push({action:'fold',amount:0,ev:0});
  // Check (if free)
  if(toCall===0) decisions.push({action:'check',amount:0,ev:0});
  // Call: 只算额外跟注额
  if(toCall>0) decisions.push({action:'call',amount:toCall,ev:equity*(state.pot+toCall)-(1-equity)*toCall});

  // Raise candidates: 从最小加注到全押, 步长 = max(BB, pot/8)
  const minRaise = state.currentBet + state.lastRaiseSize;
  const maxRaise = me.chips + me.bet;
  if(maxRaise > minRaise && toCall>=0){
    // 候选采样点: 最小加注、底池 0.5/1.0/2.0 倍、全押 (搜索分辨率, 非决策常数)
    const candSet=new Set([minRaise]);
    const pot=state.pot||1;
    for(const f of [0.5,1.0,2.0]){const R=Math.floor(pot*f/10)*10; if(R>minRaise&&R<=maxRaise) candSet.add(R);}
    candSet.add(maxRaise);
    const sorted=[...candSet].filter(R=>R>state.currentBet&&R<=maxRaise).sort((a,b)=>a-b);
    for(const R of sorted.slice(0,5)){
      const ev = raiseEV(R, me, state, opps, history, cc, equity);
      decisions.push({action:'raise',amount:R,ev});
    }
  }

  // Pick max EV (平局时优先 check > call > raise > fold)
  let best=decisions[0];
  const prio={check:3,call:2,raise:1,fold:0};
  for(const d of decisions) if(d.ev>best.ev||(d.ev===best.ev&&prio[d.action]>prio[best.action])) best=d;
  return {
    action:best.action,
    amount:best.action==='raise'?best.amount:best.amount,
    equity,
    ranges:ranges.map(r=>({id:0,width:Math.round(r.width*100)/100,label:'范围'})),
    reason:'EV max: '+decisions.map(d=>d.action+(d.ev>=0?'+':'')+d.ev.toFixed(1)).join(' | ')
  };
}

// EV of raising to R: 对手各自决定跟或弃 (增量形式, 只算额外投入)
function raiseEV(R, me, state, opps, history, cc, myEq){
  const pot=state.pot;
  const myAdd = Math.max(R - (me.bet||0), 0);   // 我额外投入
  let pAllFold=1, ev=0, pCalls=[];
  for(const opp of opps){
    const betFaced = Math.max(R - (opp.bet||0), 0);       // 对手还需跟多少
    const req = pot+betFaced>0 ? betFaced/(pot+betFaced) : 0.5;  // 跟注需要的胜率
    const callFrac = eqToWidth(Math.min(0.99,Math.max(req,0.001)));
    const w = inferRange(opp,history,state.startingPot).width;
    let pCall = w>0 ? Math.min(1,callFrac/w) : 1;
    const MDF = pot+betFaced>0 ? pot/(pot+betFaced) : 1;
    pCall = Math.max(pCall, MDF);
    pCalls.push({pCall, betFaced, callFrac});
    pAllFold *= (1-pCall);
  }
  // 我的胜率 vs 平均跟注范围 (一次 MC, 提速)
  const avgCallFrac = pCalls.length? pCalls.reduce((s,c)=>s+c.callFrac,0)/pCalls.length : 0.5;
  const eqVsCaller = avgCallFrac>=1 ? myEq : mcEquity(state.hand,[{width:avgCallFrac,minEq:widthToEq(avgCallFrac)}],state.community,state.burnCards||[],120);
  // 每个对手跟注时的增量净收益 (最终池=当前池+我的额外投入+他的额外投入)
  for(let i=0;i<pCalls.length;i++){
    const c=pCalls[i];
    const finalPot = pot + myAdd + c.betFaced;
    ev += c.pCall*(eqVsCaller*finalPot - myAdd);
  }
  return ev + pAllFold*pot;
}

module.exports = { decide, mcEquity, bestHand, eval5, handKey, eqToWidth, widthToEq, tableEq };
