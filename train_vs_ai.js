// MATH vs 3 AI — 训练对局，统计 MATH 打法和弃牌率
const eng = require('./math_engine.js');
const fs = require('fs');

// DeepSeek 配置
const API_KEY = (fs.existsSync('API KEY.txt')? fs.readFileSync('API KEY.txt','utf8').split('\n').find(l=>l.startsWith('sk-')):'') || '';
const API_URL = 'https://api.deepseek.com/v1';
const MODEL = 'deepseek-chat';
const SLEEP_MS = 50;

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

// ---- AI decision via API ----
let aiCalls=0;
async function aiDecide(me, state, oppNames){
  const fmt=c=>c.rank+(c.suit[0]);
  const toCall=Math.max(0,state.currentBet-me.bet);
  const ctx=`You are ${me.name}. Texas Holdem ${state.phase}.
Hand: ${me.hand.map(fmt).join(' ')}. Board: ${state.community.map(fmt).join(' ')||'none'}.
Pot: $${state.pot}. Your chips: $${me.chips}. To call: $${toCall}. Min raise: $${state.currentBet+state.lastRaiseSize}.
Reply ONE line: ACTION: fold | ACTION: check | ACTION: call | ACTION: raise NUMBER | ACTION: allin`;
  try{
    aiCalls++;
    const r=await fetch(API_URL+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+API_KEY},body:JSON.stringify({model:MODEL,messages:[{role:'system',content:'Poker bot. ONE line only.'},{role:'user',content:ctx}],max_tokens:20,temperature:0.3})});
    if(!r.ok) return {action:'call'};
    const d=await r.json();const resp=d.choices[0].message.content||'';
    const m=resp.match(/ACTION\s*:\s*(\w+)(?:\s+(\d+))?/i);
    if(!m) return {action:'call'};
    const a=m[1].toLowerCase(),amt=m[2]?parseInt(m[2]):0;
    if(a==='fold')return{action:'fold'};if(a==='check')return{action:'check'};if(a==='call')return{action:'call'};
    if(a==='raise')return{action:'raise',amount:amt};if(a==='allin')return{action:'allin'};return{action:'call'};
  }catch(e){return{action:'call'};}
}

const sleep=ms=>new Promise(r=>setTimeout(r,ms));

// ---- 统计 ----
const stats={actions:0,fold:0,check:0,call:0,raise:0,allin:0,byPhase:{preflop:{a:0,f:0},flop:{a:0,f:0},turn:{a:0,f:0},river:{a:0,f:0}},won:0,lost:0,profit:0,foldLog:[]};

async function simHand(handNum){
  const d=shuffle(deck());
  const P=[0,1,2,3].map(i=>({id:i,name:'玩家'+(i+1)+(i===0?'(MATH)':'(AI)'),hand:[d.pop(),d.pop()],chips:1000,bet:0,totalBet:0,folded:false,allIn:false,isD:i===0,isSB:i===1,isBB:i===2}));
  const community=[],burn=[];let pot=0,currentBet=20,lastRaiseSize=20,history=[];
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
      let any=false;
      for(const idx of order){
        const me=P[idx];if(me.folded||me.allIn)continue;
        if(me.bet===currentBet&&acted.has(idx)&&r>0)continue;
        const state={me_id:me.id,hand:me.hand,community,burnCards:burn,pot,currentBet,lastRaiseSize,bb:20,phase,startingPot:30,
          players:P.map(p=>({id:p.id,chips:p.chips,bet:p.bet,totalBet:p.totalBet,folded:p.folded,allIn:p.allIn})),
          history:history.map(h=>({playerId:h.playerId,action:h.action,amount:h.amount}))};
        let dec;
        if(idx===0){
          dec=eng.decide(state); stats.actions++; stats[dec.action]++; stats.byPhase[phase].a++;
          if(dec.action==='fold'){
            stats.byPhase[phase].f++;
            stats.foldLog.push({hand:handNum,phase,cards:me.hand.map(c=>c.rank+c.suit[0]).join(''),eq:dec.equity?dec.equity.toFixed(2):'?',toCall:state.currentBet-me.bet,pot:state.pot,reason:dec.reason});
          }
        }
        else{ dec=await aiDecide(me,state); await sleep(SLEEP_MS); }
        acted.add(idx);any=true;
        if(dec.action==='fold')me.folded=true;
        else if(dec.action==='check'){}
        else if(dec.action==='call'){const need=Math.min(currentBet-me.bet,me.chips);me.chips-=need;me.bet+=need;me.totalBet+=need;pot+=need;if(me.chips===0){me.allIn=true;if(idx===0)stats.allin++;}history.push({playerId:me.id,action:'call',amount:need});}
        else if(dec.action==='raise'||dec.action==='bet'){
          const to=Math.min((dec.amount||currentBet+lastRaiseSize),me.chips+me.bet);
          const need=to-me.bet;me.chips-=need;me.bet+=need;me.totalBet+=need;pot+=need;
          lastRaiseSize=me.bet-currentBet;currentBet=me.bet;
          if(me.chips===0){me.allIn=true;if(idx===0)stats.allin++;}
          history.push({playerId:me.id,action:'raise',amount:need});
          acted=new Set([idx]);
        }
        else if(dec.action==='allin'){
          const amt=me.chips;me.bet+=amt;me.totalBet+=amt;pot+=amt;me.chips=0;me.allIn=true;if(idx===0)stats.allin++;
          const raised=me.bet>currentBet;if(raised){lastRaiseSize=me.bet-currentBet;currentBet=me.bet;acted=new Set([idx]);}
          history.push({playerId:me.id,action:'allin',amount:amt});
          if(!raised){ /* next */ }
        }
        if(P.filter(p=>!p.folded).length<=1)break;
      }
      if(!any)break;
      const actv=P.filter(p=>!p.folded&&!p.allIn);
      if(actv.length<=1||actv.every(p=>p.bet===currentBet))break;
    }
  }
  // showdown (side pots)
  const alive=P.filter(p=>!p.folded);
  const mathStart=1000, mathEnd=P[0].chips;
  stats.profit += (mathEnd-mathStart);
  if(alive.length>=2){
    const levels=[...new Set(alive.map(p=>p.totalBet))].sort((a,b)=>a-b);let prev=0;
    for(const lv of levels){const el=alive.filter(p=>p.totalBet>=lv);const pa=(lv-prev)*el.length;if(pa>0){const res=el.map(p=>({p,h:bh(p.hand,community)}));res.sort((a,b)=>cmp(b.h,a.h));const w=res.filter(r=>cmp(r.h,res[0].h)===0);const s=Math.floor(pa/w.length);for(const x of w)x.p.chips+=s;if(pa-s*w.length>0)w[0].p.chips+=pa-s*w.length;}prev=lv;}
  }else if(alive.length===1)alive[0].chips+=pot;
  if(P[0].chips>mathStart)stats.won++;else if(P[0].chips<mathStart)stats.lost++;
}

async function main(){
  if(!API_KEY){console.log('⚠️ 无API Key');return;}
  const N=parseInt(process.argv[2]||'20');
  console.log('=== MATH vs 3 AI ===');
  console.log('Hands:',N,'Model:',MODEL,'\n');
  const t0=Date.now();
  for(let i=0;i<N;i++){
    await simHand(i+1);
    console.log(`  Hand ${i+1}/${N} done (${((Date.now()-t0)/1000).toFixed(0)}s)`);
  }
  const s=stats;
  console.log('\n=== MATH 打法统计 ===');
  console.log('总行动:',s.actions);
  console.log('弃牌率:',(s.fold/s.actions*100).toFixed(1)+'%','('+s.fold+')');
  console.log('过牌率:',(s.check/s.actions*100).toFixed(1)+'%','('+s.check+')');
  console.log('跟注率:',(s.call/s.actions*100).toFixed(1)+'%','('+s.call+')');
  console.log('加注率:',(s.raise/s.actions*100).toFixed(1)+'%','('+s.raise+')');
  console.log('全押率:',(s.allin/s.actions*100).toFixed(1)+'%','('+s.allin+')');
  console.log('\n分阶段弃牌率:');
  for(const ph of ['preflop','flop','turn','river']){
    const b=s.byPhase[ph];
    console.log(`  ${ph.padEnd(7)} 行动${String(b.a).padStart(4)}  弃牌${String(b.f).padStart(3)}  (${b.a?((b.f/b.a*100).toFixed(0)):0}%)`);
  }
  console.log('\n=== MATH 战绩 ===');
  console.log('胜:'+s.won+' 负:'+s.lost+' 总盈亏:'+(s.profit>=0?'+':'')+s.profit);
  console.log('AI API 调用:',aiCalls);
  console.log('\n=== MATH 弃牌明细 ('+s.foldLog.length+') ===');
  for(const f of s.foldLog){
    console.log(`  H${f.hand} ${f.phase.padEnd(7)} ${f.cards.padEnd(6)} eq=${f.eq} toCall=$${f.toCall} pot=$${f.pot}`);
    console.log(`      ${f.reason.slice(0,110)}`);
  }
}

main();
