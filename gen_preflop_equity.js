// ============================================================
//  预计算所有起手牌对随机对手的翻前胜率
//  输出: preflop_equity.json
//    { "handKey": { "1": 0.604, "2": 0.500, ... }, ... }
//  handKey: "AA", "AKs", "AKo", "72o" ...
// ============================================================
const fs = require('fs');

const RANKS = ['A','K','Q','J','T','9','8','7','6','5','4','3','2'];
const RANK_VAL = {A:14,K:13,Q:12,J:11,T:10,9:9,8:8,7:7,6:6,5:5,4:4,3:3,2:2};
const SUITS = ['s','h','d','c'];

function eval5(cards){
  const vals = cards.map(c=>c.v).sort((a,b)=>b-a);
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
  if(flush&&straight) return [8, sh];
  if(cnt[0]===4) return [7, e[0][0], e[1][0]];
  if(cnt[0]===3&&cnt[1]===2) return [6, e[0][0], e[1][0]];
  if(flush) return [5, ...vals];
  if(straight) return [4, sh];
  if(cnt[0]===3) return [3, e[0][0], ...[...e.slice(1).map(x=>x[0])].sort((a,b)=>b-a)];
  if(cnt[0]===2&&cnt[1]===2) return [2, ...[e[0][0],e[1][0]].sort((a,b)=>b-a), e[2][0]];
  if(cnt[0]===2) return [1, e[0][0], ...[...e.slice(1).map(x=>x[0])].sort((a,b)=>b-a)];
  return [0, ...vals];
}
function cmp(a,b){
  const n=Math.min(a.length,b.length);
  for(let i=0;i<n;i++){ if(a[i]!==b[i]) return a[i]-b[i]; }
  return a.length-b.length;
}
function best5(cards){
  // cards: [{s, v}] length 7 → best of 21 combos
  let best=null;
  for(let a=0;a<cards.length;a++)for(let b=a+1;b<cards.length;b++)for(let c=b+1;c<cards.length;c++)for(let d=c+1;d<cards.length;d++)for(let e=d+1;e<cards.length;e++){
    const hand=[cards[a],cards[b],cards[c],cards[d],cards[e]];
    const r=eval5(hand);
    if(!best||cmp(r,best)>0) best=r;
  }
  return best;
}

function buildDeck(){const d=[];for(const s of SUITS)for(const r of RANKS)d.push({s,suit:s,v:RANK_VAL[r],rank:r});return d;}
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}

// All 169 starting hands, canonical keys
const handKeys=[];
for(const r1 of RANKS){
  // pairs
  handKeys.push(r1+r1);
}
for(let i=0;i<RANKS.length;i++)for(let j=i+1;j<RANKS.length;j++){
  handKeys.push(RANKS[i]+RANKS[j]+'s');
  handKeys.push(RANKS[i]+RANKS[j]+'o');
}
// 13 + 78 + 78 = 169
console.log('Hand types:', handKeys.length);

// Generate 2-card hand from key
function handFromKey(key){
  if(key.length===2){ // pair
    const r=key[0];
    return [{suit:SUITS[0],v:RANK_VAL[r],rank:r},{suit:SUITS[1],v:RANK_VAL[r],rank:r}];
  }
  const r1=key[0], r2=key[1], suited=key[2]==='s';
  return [{suit:SUITS[0],v:RANK_VAL[r1],rank:r1},{suit:suited?SUITS[0]:SUITS[1],v:RANK_VAL[r2],rank:r2}];
}

function mcEquity(key, nOpp, iters){
  const myHand=handFromKey(key);
  const myCards=new Set(myHand.map(c=>c.rank+c.suit));
  const deckAll=buildDeck();
  let wins=0, ties=0, total=0;
  for(let iter=0;iter<iters;iter++){
    // Build deck excluding my cards
    const deck=deckAll.filter(c=>!myCards.has(c.rank+c.suit));
    shuffle(deck);
    // Deal nOpp random opponents
    const opps=[];
    let idx=0;
    for(let o=0;o<nOpp;o++){ opps.push([deck[idx++],deck[idx++]]); }
    // Board
    const board=deck.slice(idx, idx+5);
    if(board.length<5) break;
    const all7=[...myHand,...board];
    const myBest=best5(all7);
    let beatAll=true;
    for(const oh of opps){ const ob=best5([...oh,...board]); if(cmp(ob,myBest)>=0){beatAll=false;break;} }
    if(beatAll){ // strictly better than all
      // check ties against all
      let isTie=false;
      for(const oh of opps){ const ob=best5([...oh,...board]); if(cmp(ob,myBest)===0){isTie=true;break;} }
      if(!isTie) wins++; else ties++;
    }
    total++;
  }
  // Equity = win + tie*(win equity). For tie with 1 opponent split pot, etc. Approx: win + ties*(0.5/nOpp?)
  // Standard: equity = wins/total + ties/total * (1/(nOpp+1)) (pot split equally)
  const eq = wins/total + (ties/total)*(1/(nOpp+1));
  return eq;
}

const OPP_COUNTS=[1,2,3,4,5,6,7,8];
const ITERS=1500;
const result={};

const t0=Date.now();
for(const key of handKeys){
  result[key]={};
  for(const n of OPP_COUNTS){
    result[key][n]=Math.round(mcEquity(key,n,ITERS)*10000)/10000;
  }
  fs.appendFileSync('gen_progress.log', (handKeys.indexOf(key))+'/169 done, '+(Date.now()-t0)/1000+'s\n');
  console.log('  '+(handKeys.indexOf(key))+'/169 done');
}

fs.writeFileSync('preflop_equity.json', JSON.stringify(result));
console.log('Done in '+(Date.now()-t0)/1000+'s. Size:', fs.statSync('preflop_equity.json').size, 'bytes');
console.log('Sample AA:', result['AA'], 'AKs:', result['AKs'], '72o:', result['72o']);
