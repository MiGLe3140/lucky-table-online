const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e6 });
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, app: 'Lucky Table' }));

const rooms = new Map();
const games = new Set(['blackjack', 'poker', 'roulette']);
const rnd = (n) => crypto.randomInt(0, n);
const code = () => crypto.randomBytes(3).toString('hex').toUpperCase();
function safeName(s) { return String(s || 'Jogador').trim().replace(/[<>]/g, '').slice(0, 20) || 'Jogador'; }
function roomPublic(r, viewer) { const state={...r.state}; if(state.poker){const h=state.poker; state.poker={started:h.started,street:h.street,pot:h.pot,currentBet:h.currentBet,community:h.community.map(c=>c.label),turnId:h.order[h.turn],button:h.button,hands:Object.fromEntries(h.order.filter(id=>h.folded.includes(id)).map(id=>[id,[]])),ownHand:h.hands[viewer]?.map(c=>c.label)||[],folded:h.folded,contrib:h.contrib,order:h.order,allIn:h.allIn};} return { code:r.code, name:r.name, private:r.private, game:r.game, players:[...r.players.values()].map(p=>({id:p.id,name:p.name,avatar:p.avatar,chips:p.chips})), feed:r.feed.slice(-30), state }; }
function emitRoom(r) { for(const id of r.players.keys()) io.to(id).emit('room:update', roomPublic(r,id)); }
function say(r, text) { r.feed.push({text:String(text).slice(0,180), at:Date.now()}); if(r.feed.length>80) r.feed.shift(); }
function newRoom({name, privateRoom, game, host}) {
  const c = code();
  const r = { code:c, name:String(name||'Mesa').slice(0,32), private:!!privateRoom, game:games.has(game)?game:'blackjack', host, players:new Map(), feed:[], state:{round:0, status:'À espera de jogadores', bets:{}, hands:{}, dealer:[], rouletteResult:null} };
  rooms.set(c,r); return r;
}
function publicRooms() { return [...rooms.values()].filter(r=>!r.private).map(r=>({code:r.code,name:r.name,game:r.game,count:r.players.size})); }
function leaveRoom(socket) {
  const c=socket.data.room; if(!c) return;
  const r=rooms.get(c); socket.leave(c); socket.data.room=null;
  if(r){ const p=r.players.get(socket.id); if(p) say(r, `${p.name} saiu da mesa.`); r.players.delete(socket.id); if(!r.players.size) rooms.delete(c); else { if(r.host===socket.id) r.host=r.players.keys().next().value; emitRoom(r); } }
  io.emit('rooms:list', publicRooms());
}

const SUITS=['♠','♥','♦','♣'], RANKS=['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
function deck(){const d=[];for(let v=2;v<=14;v++)for(const suit of SUITS)d.push({v,suit,label:(RANKS[v-2]+suit)});for(let i=d.length-1;i>0;i--){const j=rnd(i+1);[d[i],d[j]]=[d[j],d[i]];}return d;}
function eval5(cards){const vals=cards.map(c=>c.v).sort((a,b)=>b-a), counts={};vals.forEach(v=>counts[v]=(counts[v]||0)+1);const groups=Object.entries(counts).map(([v,n])=>({v:+v,n})).sort((a,b)=>b.n-a.n||b.v-a.v);const flush=cards.every(c=>c.suit===cards[0].suit);const unique=[...new Set(vals)];let straightHigh=0;for(let i=0;i<=unique.length-5;i++){if(unique[i]-unique[i+4]===4){straightHigh=unique[i];break;}}if(!straightHigh&&[14,5,4,3,2].every(v=>unique.includes(v)))straightHigh=5;
 if(flush&&straightHigh)return [8,straightHigh];if(groups[0].n===4)return [7,groups[0].v,groups.find(g=>g.n===1).v];if(groups[0].n===3&&groups[1].n===2)return [6,groups[0].v,groups[1].v];if(flush)return [5,...vals];if(straightHigh)return [4,straightHigh];if(groups[0].n===3)return [3,groups[0].v,...groups.filter(g=>g.n===1).map(g=>g.v).sort((a,b)=>b-a)];if(groups[0].n===2&&groups[1].n===2)return [2,Math.max(groups[0].v,groups[1].v),Math.min(groups[0].v,groups[1].v),groups.find(g=>g.n===1).v];if(groups[0].n===2)return [1,groups[0].v,...groups.filter(g=>g.n===1).map(g=>g.v).sort((a,b)=>b-a)];return [0,...vals];}
function compareRank(a,b){for(let i=0;i<Math.max(a.length,b.length);i++){const x=a[i]||0,y=b[i]||0;if(x!==y)return x-y;}return 0;}
function bestHand(cards){let best=null;for(let a=0;a<cards.length-4;a++)for(let b=a+1;b<cards.length-3;b++)for(let c=b+1;c<cards.length-2;c++)for(let d=c+1;d<cards.length-1;d++)for(let e=d+1;e<cards.length;e++){const r=eval5([cards[a],cards[b],cards[c],cards[d],cards[e]]);if(!best||compareRank(r,best)>0)best=r;}return best;}
const HAND_NAMES=['Carta alta','Par','Dois pares','Trio','Sequência','Flush','Full house','Poker','Straight flush'];
function pokerStart(r){const ps=[...r.players.values()].filter(p=>p.chips>0);if(ps.length<2){say(r,'São precisos pelo menos 2 jogadores com fichas para iniciar o Texas Hold’em.');return false;}const d=deck();const h={deck:d,hands:{},folded:[],allIn:[],contrib:{},pot:0,community:[],street:'Pré-flop',currentBet:10,raiseSize:10,acted:[],turn:0,order:ps.map(p=>p.id),button:(r.state.poker?.button ?? -1)+1,started:true};h.button%=h.order.length;h.order.forEach(id=>{h.hands[id]=[d.pop(),d.pop()];h.contrib[id]=0;});const sb=h.order[(h.button+1)%h.order.length],bb=h.order[(h.button+2)%h.order.length];function blind(id,amt){const p=r.players.get(id),n=Math.min(amt,p.chips);p.chips-=n;h.contrib[id]+=n;h.pot+=n;}blind(sb,5);blind(bb,10);h.currentBet=Math.max(...Object.values(h.contrib));h.turn=(h.order.indexOf(bb)+1)%h.order.length;h.acted=[];r.state.poker=h;r.state.status=`Texas Hold’em · ${h.street} · pote ${h.pot}`;say(r,`Nova mão de Texas Hold’em! Blinds: 5/10. Pote inicial: ${h.pot} fichas.`);pokerAdvanceIfDone(r);return true;}
function pokerActive(h){return h.order.filter(id=>!h.folded.includes(id)&&!h.allIn.includes(id));}
function pokerNextTurn(h,from){const n=h.order.length;for(let i=1;i<=n;i++){const idx=(from+i+n)%n,id=h.order[idx];if(!h.folded.includes(id)&&!h.allIn.includes(id))return idx;}return from;}
function pokerAdvanceIfDone(r){const h=r.state.poker;if(!h||!h.started)return;if(h.order.filter(id=>!h.folded.includes(id)).length===1){const winner=h.order.find(id=>!h.folded.includes(id));r.players.get(winner).chips+=h.pot;say(r,`${r.players.get(winner).name} ganha o pote de ${h.pot} fichas porque todos os outros desistiram.`);h.pot=0;h.started=false;r.state.status='Mão terminada — podes iniciar outra.';return;}const alive=pokerActive(h);if(alive.length===0&&h.street!=='River'){while(h.street!=='River'){h.street=h.street==='Pré-flop'?'Flop':h.street==='Flop'?'Turn':'River';if(h.street==='Flop')h.community.push(h.deck.pop(),h.deck.pop(),h.deck.pop());else h.community.push(h.deck.pop());}h.acted=[];}const complete=alive.length===0||alive.every(id=>h.acted.includes(id)&&(h.contrib[id]===h.currentBet||h.allIn.includes(id)));if(!complete)return;
 if(h.street==='River'){const contenders=h.order.filter(id=>!h.folded.includes(id));let best=-Infinity,winners=[];for(const id of contenders){const rank=bestHand([...h.hands[id],...h.community]);const cmp=best===-Infinity?1:compareRank(rank,best);if(cmp>0){best=rank;winners=[id];}else if(cmp===0)winners.push(id);}const each=Math.floor(h.pot/winners.length),extra=h.pot%winners.length;winners.forEach((id,i)=>r.players.get(id).chips+=each+(i<extra?1:0));say(r,`Showdown: ${winners.map(id=>r.players.get(id).name).join(' e ')} ganha${winners.length>1?'m':''} o pote de ${h.pot} fichas com ${HAND_NAMES[best[0]]}.`);h.pot=0;h.started=false;r.state.status='Mão terminada — inicia outra mão quando quiseres.';return;}
 h.street=h.street==='Pré-flop'?'Flop':h.street==='Flop'?'Turn':'River';if(h.street==='Flop')h.community.push(h.deck.pop(),h.deck.pop(),h.deck.pop());else h.community.push(h.deck.pop());h.currentBet=0;h.order.forEach(id=>h.contrib[id]=0);h.acted=[];h.turn=pokerNextTurn(h,h.order.indexOf(h.order[h.button]));say(r,`${h.street}: ${h.community.map(c=>c.label).join(' ')}`);r.state.status=`Texas Hold’em · ${h.street} · pote ${h.pot}`;}
function pokerAction(r,id,action,amount){const h=r.state.poker;if(!h||!h.started)return {error:'Não há uma mão ativa. Inicia uma nova mão.'};if(h.order[h.turn]!==id)return {error:'Ainda não é a tua vez.'};const p=r.players.get(id),toCall=Math.max(0,h.currentBet-h.contrib[id]);if(action==='fold'){h.folded.push(id);h.acted.push(id);say(r,`${p.name} desistiu.`);}else if(action==='check'){if(toCall>0)return {error:`Tens de igualar ${toCall} fichas ou desistir.`};h.acted.push(id);say(r,`${p.name} fez check.`);}else if(action==='call'){if(toCall<=0)return {error:'Não há aposta para igualar; usa check.'};const n=Math.min(toCall,p.chips);p.chips-=n;h.contrib[id]+=n;h.pot+=n;if(n<toCall&&!h.allIn.includes(id))h.allIn.push(id);h.acted.push(id);say(r,`${p.name} igualou ${n} fichas${p.chips===0?' (all-in)':''}.`);}else if(action==='raise'){const raise=Math.max(10,Math.floor(Number(amount)||10));const total=toCall+raise;if(p.chips<total)return {error:`Precisas de ${total} fichas para igualar e aumentar.`};p.chips-=total;h.contrib[id]+=total;h.pot+=total;h.currentBet=h.contrib[id];h.raiseSize=raise;h.acted=[id];say(r,`${p.name} aumentou para ${h.currentBet} fichas nesta ronda.`);}else return {error:'Jogada inválida.'};h.turn=pokerNextTurn(h,h.turn);pokerAdvanceIfDone(r);r.state.status=h.started?`Texas Hold’em · ${h.street} · pote ${h.pot} · vez de ${r.players.get(h.order[h.turn])?.name||'—'}`:r.state.status;return {};}

io.on('connection', socket => {
  socket.emit('rooms:list', publicRooms());
  socket.on('rooms:list:request', () => socket.emit('rooms:list', publicRooms()));
  socket.on('room:create', (data={}, cb=()=>{}) => {
    leaveRoom(socket);
    const r=newRoom({name:data.name,privateRoom:data.privateRoom,game:data.game,host:socket.id});
    const p={id:socket.id,name:safeName(data.namePlayer),avatar:String(data.avatar||'').slice(0,150000),chips:1000}; r.players.set(socket.id,p); socket.data.room=r.code; socket.join(r.code); say(r,`${p.name} criou a mesa.`); cb({ok:true,code:r.code}); emitRoom(r); io.emit('rooms:list',publicRooms());
  });
  socket.on('room:join', ({code:c,name,avatar}={}, cb=()=>{}) => {
    const r=rooms.get(String(c||'').toUpperCase()); if(!r) return cb({ok:false,error:'Essa sala já não existe.'});
    if(r.players.size>=12) return cb({ok:false,error:'A sala está cheia (máximo 12 jogadores).'});
    leaveRoom(socket); const p={id:socket.id,name:safeName(name),avatar:String(avatar||'').slice(0,150000),chips:1000}; r.players.set(socket.id,p); socket.data.room=r.code; socket.join(r.code); say(r,`${p.name} entrou na mesa.`); cb({ok:true,code:r.code}); emitRoom(r); io.emit('rooms:list',publicRooms());
  });
  socket.on('room:leave',()=>leaveRoom(socket));
  socket.on('chat:send', text => { const r=rooms.get(socket.data.room); if(!r)return; const p=r.players.get(socket.id); if(!p)return; say(r,`${p.name}: ${String(text||'').replace(/[<>]/g,'').slice(0,180)}`); emitRoom(r); });
  socket.on('game:action', ({action,amount}={}) => {
    const r=rooms.get(socket.data.room); if(!r)return; const p=r.players.get(socket.id); if(!p)return;
    if(!games.has(r.game) || action!==r.game)return;
    const bet=Math.max(1,Math.min(100,Math.floor(Number(amount)||10)));
    if(action==='roulette') {
      if(p.chips<bet)return socket.emit('notice','Não tens fichas suficientes.');
      p.chips-=bet; const n=rnd(37); r.state.rouletteResult=n; const won=n===0?bet*12:(n%2===0?bet*2:0); p.chips+=won; say(r,`${p.name} apostou ${bet} fichas na roleta: saiu ${n}. ${won?`Ganhou ${won}!`:'Não ganhou desta vez.'}`);
    } else if(action==='blackjack') {
      if(p.chips<bet)return socket.emit('notice','Não tens fichas suficientes.');
      p.chips-=bet; const card=()=>rnd(10)+1; const total=card()+card(); const dealer=card()+card(); let win=0;
      if(total>21)win=0; else if(dealer>21||total>dealer)win=bet*2; else if(total===dealer)win=bet;
      p.chips+=win; say(r,`${p.name} jogou Blackjack (${total} contra ${dealer}) — ${win>bet?'ganhou '+(win-bet)+' fichas':win===bet?'empate':'perdeu '+bet+' fichas'}.`);
    }
    r.state.round++; r.state.status=`Ronda ${r.state.round}`; emitRoom(r);
  });
  socket.on('poker:start',()=>{const r=rooms.get(socket.data.room);if(!r||r.game!=='poker')return;const result=pokerStart(r);emitRoom(r);io.emit('rooms:list',publicRooms());});
  socket.on('poker:action',({action,amount}={})=>{const r=rooms.get(socket.data.room);if(!r||r.game!=='poker')return;const result=pokerAction(r,socket.id,action,amount);if(result.error)socket.emit('notice',result.error);else emitRoom(r);});
  socket.on('disconnect',()=>leaveRoom(socket));
});
const port=process.env.PORT||3000;
server.listen(port,'0.0.0.0',()=>console.log(`Lucky Table a correr na porta ${port}`));
