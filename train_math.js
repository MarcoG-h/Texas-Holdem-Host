// 严格引擎自对弈测试 — 测量全押频率与对局健康度
const eng=require('./math_engine.js');
const RANKS=['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const RANK_VAL={'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14};
const SUITS=['spades','hearts','clubs','diams'];
function deck(){const d=[];for(const s of SUITS)for(const r of RANKS)d.push({suit:s,rank:r,value:RANK_VAL[r]});return d;}
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a;}
function eval5(c){
  const vals=c.map(x=>x.value).sort((a,b)=>b-a),suits=c.map(x=>x.suit),fl=suits.every(s=>s===suits[0]);
  let st=false,sh=0;const uv=[...new Set(vals)].sort((a,b)=>b-a);
  if(uv.length===5){if(uv[0]-uv[4]===4){st=true;sh=uv[0]}if(uv[0]===14&&uv[1]===5&&uv[4]===2){st=true;sh=5}}
  const cm={};for(const v of vals)cm[v]=(cm[v]||0)+1;
  const e=Object.entries(cm).map(([v,cn])=>[+v,cn]).sort((a,b)=>b[1]-a[1]||b[0]-a[0]);const cnt=e.map(x=>x[1]);
  if(fl&&st)return[8,sh];if(cnt[0]===4)return[7,e[0][0],e[1][0]];if(cnt[0]===3&&cnt[1]===2)return[6,e[0][0],e[1][0]];
  if(fl)return[5,...vals];if(st)return[4,sh];if(cnt[0]===3)return[3,e[0][0],...e.slice(1).map(x=>x[0]).sort((a,b)=>b-a)];
  if(cnt[0]===2&&cnt[1]===2)return[2,...[e[0][0],e[1][0]].sort((a,b)=>b-a),e[2][0]];
  if(cnt[0]===2)return[1,e[0][0],...e.slice(1).map(x=>x[0]).sort((a,b)=>b-a)];return[0,...vals];
}
function*co(a,k){if(k===0){yield[];return}if(a.length<k)return;for(let i=0;i<=a.length-k;i++)for(const r of co(a.slice(i+1),k-1))yield[a[i],...r]}
function bh(h,c){const a=[...h,...c];if(a.length<5)return null;let b=null;for(const x of co(a,5)){const r=eval5(x);if(!b||cmp(r,b)>0)b=r}return b;}
function cmp(a,b){const n=Math.min(a.length,b.length);for(let i=0;i<n;i++)if(a[i]!==b[i])return a[i]-b[i];return a.length-b.length;}

function simHand(){
  const d=shuffle(deck());
  const P=[0,1,2,3].map(i=>({id:i,hand:[d.pop(),d.pop()],chips:1000,bet:0,totalBet:0,folded:false,allIn:false,isD:i===0,isSB:i===1,isBB:i===2}));
  const community=[],burn=[];
  let pot=0,currentBet=20,lastRaiseSize=20,history=[],allIns=0;
  P[2].bet=20;P[2].totalBet=20;P[2].chips-=20;pot+=20;
  P[1].bet=10;P[1].totalBet=10;P[1].chips-=10;pot+=10;

  for(const phase of ['preflop','flop','turn','river']){
    if(P.filter(p=>!p.folded).length<=1)break;
    if(phase==='flop'){burn.push(d.pop());community.push(d.pop(),d.pop(),d.pop());}
    if(phase==='turn'){burn.push(d.pop());community.push(d.pop());}
    if(phase==='river'){burn.push(d.pop());community.push(d.pop());}
    if(phase!=='preflop'){for(const p of P)p.bet=0;currentBet=0;lastRaiseSize=20;}

    const order=[];for(let i=2;i<6;i++){const idx=i%4;if(!P[idx].folded&&!P[idx].allIn&&P[idx].chips>0)order.push(idx);}
    if(order.length<=1)continue;
    let acted=new Set();
    for(let r=0;r<8;r++){
      let any=false,loopGuard=0;
      for(const idx of order){
        const me=P[idx];if(me.folded||me.allIn)continue;
        if(me.bet===currentBet&&acted.has(idx)&&r>0)continue;
        const state={me_id:me.id,hand:me.hand,community,burnCards:burn,pot,currentBet,lastRaiseSize,bb:20,phase,
          players:P.map(p=>({id:p.id,chips:p.chips,bet:p.bet,totalBet:p.totalBet,folded:p.folded,allIn:p.allIn})),
          history:history.map(h=>({playerId:h.playerId,action:h.action,amount:h.amount})),startingPot:30};
        const dec=eng.decide(state);
        acted.add(idx);any=true;
        if(dec.action==='fold')me.folded=true;
        else if(dec.action==='check'){}
        else if(dec.action==='call'){const need=Math.min(currentBet-me.bet,me.chips);me.chips-=need;me.bet+=need;me.totalBet+=need;pot+=need;if(me.chips===0){me.allIn=true;allIns++;}history.push({playerId:me.id,action:'call',amount:need});}
        else if(dec.action==='raise'){
          const to=Math.min(dec.amount||currentBet+lastRaiseSize,me.chips+me.bet);
          const need=to-me.bet;me.chips-=need;me.bet+=need;me.totalBet+=need;pot+=need;
          lastRaiseSize=me.bet-currentBet;currentBet=me.bet;
          if(me.chips===0){me.allIn=true;allIns++;}
          history.push({playerId:me.id,action:'raise',amount:need});
          acted=new Set([idx]);
        }
        if(P.filter(p=>!p.folded).length<=1)break;
      }
      if(!any)break; if(++loopGuard>40)break;
      const actv=P.filter(p=>!p.folded&&!p.allIn);
      if(actv.length<=1||actv.every(p=>p.bet===currentBet))break;
    }
  }
  // showdown
  const alive=P.filter(p=>!p.folded);
  if(alive.length>=2){
    const levels=[...new Set(alive.map(p=>p.totalBet))].sort((a,b)=>a-b);let prev=0;
    for(const lv of levels){const el=alive.filter(p=>p.totalBet>=lv);const pa=(lv-prev)*el.length;if(pa>0){const res=el.map(p=>({p,h:bh(p.hand,community)}));res.sort((a,b)=>cmp(b.h,a.h));const w=res.filter(r=>cmp(r.h,res[0].h)===0);const s=Math.floor(pa/w.length);for(const x of w)x.p.chips+=s;if(pa-s*w.length>0)w[0].p.chips+=pa-s*w.length;}prev=lv;}
  }else if(alive.length===1)alive[0].chips+=pot;
  return{actions:history.length,allIns,winner:alive.length===1?alive[0].id:-1,pot};
}

const N=parseInt(process.argv[2]||'30');
let totalActions=0,totalAllIns=0,complete=0;
for(let i=0;i<N;i++){const r=simHand();totalActions+=r.actions;totalAllIns+=r.allIns;if(r.winner>=0)complete++;}
console.log('Hands:',N,'Complete:',complete);
console.log('Avg actions/hand:',(totalActions/N).toFixed(1));
console.log('Avg all-ins/hand:',(totalAllIns/N).toFixed(2));
console.log('All-in freq: '+((totalAllIns/totalActions)*100).toFixed(1)+'% of actions');
