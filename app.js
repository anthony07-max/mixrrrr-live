// Mixrrrr Live – browser AI DJ (Web Audio API, no build step)
'use strict';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const fmt=t=>{t=Math.max(0,t||0);return Math.floor(t/60)+':'+String(Math.floor(t%60)).padStart(2,'0')};
const status=m=>{$('#status').textContent=m};
window.addEventListener('error',e=>{console.error('MIXRRRR_ERROR',e.message);status('Error: '+e.message)});

/* ---------------- audio engine ---------------- */
const ctx=new (window.AudioContext||window.webkitAudioContext)({latencyHint:'interactive'});
const resume=()=>{if(ctx.state!=='running')ctx.resume()};
['pointerdown','keydown','touchstart'].forEach(ev=>addEventListener(ev,resume,{capture:true}));
const masterGain=ctx.createGain();masterGain.gain.value=.9;
const masterAn=ctx.createAnalyser();masterAn.fftSize=2048;masterAn.smoothingTimeConstant=.75;
const recDest=ctx.createMediaStreamDestination();
masterGain.connect(masterAn);masterAn.connect(ctx.destination);masterGain.connect(recDest);
const duck=ctx.createGain();const musicBus=ctx.createGain();
const sfxGain=ctx.createGain();sfxGain.gain.value=.8;sfxGain.connect(masterGain);

function impulse(sec=2.6,decay=3){const n=ctx.sampleRate*sec,b=ctx.createBuffer(2,n,ctx.sampleRate);for(let c=0;c<2;c++){const d=b.getChannelData(c);for(let i=0;i<n;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/n,decay)}return b}
const IR=impulse();
function makeFX(){const inp=ctx.createGain(),out=ctx.createGain();inp.connect(out);
 const echoS=ctx.createGain(),dl=ctx.createDelay(4),fb=ctx.createGain(),echoF=ctx.createBiquadFilter();echoS.gain.value=0;fb.gain.value=.45;echoF.type='bandpass';echoF.frequency.value=1800;echoF.Q.value=.6;
 inp.connect(echoS);echoS.connect(dl);dl.connect(echoF);echoF.connect(fb);fb.connect(dl);echoF.connect(out);
 const revS=ctx.createGain(),conv=ctx.createConvolver();conv.buffer=IR;revS.gain.value=0;inp.connect(revS);revS.connect(conv);conv.connect(out);
 const flS=ctx.createGain(),fd=ctx.createDelay(.05),lfo=ctx.createOscillator(),lg=ctx.createGain(),ffb=ctx.createGain();flS.gain.value=0;fd.delayTime.value=.004;lfo.frequency.value=.25;lg.gain.value=.003;ffb.gain.value=.6;
 lfo.connect(lg);lg.connect(fd.delayTime);lfo.start();inp.connect(flS);flS.connect(fd);fd.connect(ffb);ffb.connect(fd);fd.connect(out);
 return{inp,out,echoS,dl,revS,flS}}
const masterFX=makeFX();musicBus.connect(duck);duck.connect(masterFX.inp);masterFX.out.connect(masterGain);

/* ---------------- state & library ---------------- */
const state={tracks:[],auto:false,order:[],playedIds:new Set(),curve:null,requests:[],midiMap:JSON.parse(localStorage.getItem('mx_midi')||'{}'),learn:false,learnTarget:null,nextOverride:null,transition:null};
const bufCache=new Map();
/* IndexedDB */
let dbP=new Promise((res,rej)=>{const r=indexedDB.open('mixrrrr-live',1);r.onupgradeneeded=()=>{r.result.createObjectStore('tracks',{keyPath:'id'})};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
async function dbPut(rec){const db=await dbP;return new Promise((res,rej)=>{const tx=db.transaction('tracks','readwrite');tx.objectStore('tracks').put(rec);tx.oncomplete=res;tx.onerror=()=>rej(tx.error)})}
async function dbAll(){const db=await dbP;return new Promise((res,rej)=>{const q=db.transaction('tracks').objectStore('tracks').getAll();q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)})}
async function dbDel(id){const db=await dbP;return new Promise(res=>{const tx=db.transaction('tracks','readwrite');tx.objectStore('tracks').delete(id);tx.oncomplete=res})}
const saveTrack=t=>dbPut({id:t.id,name:t.name,blob:t.blob,a:t.a,cues:t.cues,dur:t.dur}).catch(e=>console.warn('IDB save',e));

async function decode(t){if(bufCache.has(t.id))return bufCache.get(t.id);const ab=await t.blob.arrayBuffer();const b=await ctx.decodeAudioData(ab);bufCache.set(t.id,b);
 if(bufCache.size>6){for(const k of bufCache.keys()){if(k!==t.id&&!decks.some(d=>d.track&&d.track.id===k)){bufCache.delete(k);break}}}return b}
const cleanName=n=>n.replace(/\.[a-z0-9]+$/i,'').replace(/[_]+/g,' ').trim();
async function addFiles(files){files=[...files].filter(f=>/^audio\//.test(f.type)||/\.(mp3|wav|m4a|aac|ogg|oga|flac|opus|webm)$/i.test(f.name));
 let i=0;for(const f of files){i++;status(`Analysing ${i}/${files.length}: ${f.name}…`);
  const t={id:Date.now().toString(36)+Math.random().toString(36).slice(2,7),name:cleanName(f.name),blob:f,cues:new Array(8).fill(null)};
  try{const b=await decode(t);t.dur=b.duration;t.a=await Analysis.analyze(b);state.tracks.push(t);saveTrack(t);renderLib()}catch(e){console.warn(e);status('Could not decode '+f.name)}}
 status(`Library: ${state.tracks.length} tracks ready.`);planOrder();renderLib()}
async function loadLibrary(){try{const all=await dbAll();for(const r of all){state.tracks.push({id:r.id,name:r.name,blob:r.blob,a:r.a,cues:r.cues||new Array(8).fill(null),dur:r.dur})}
 if(all.length)status(`Restored ${all.length} tracks from this device (offline library).`);planOrder();renderLib()}catch(e){console.warn(e)}}

/* ---------------- deck ---------------- */
class Deck{constructor(id){this.id=id;this.track=null;this.buf=null;this.src=null;this.playing=false;this.startCtx=0;this.startPos=0;this.tempo=0;this.bend=0;this.cuePoint=0;this.loop=null;
 this.keyLock=localStorage.getItem('mx_keylock_'+id)!=='0';this.st=null;this.stBuf=null;this.stSeq=0;this._wpos=null;// key-lock (phase-vocoder worklet) state
 this.leader=null;this.nudge=0;// sync: deck we follow + small continuous tempo nudge for phase lock
 this.trim=ctx.createGain();this.low=ctx.createBiquadFilter();this.low.type='lowshelf';this.low.frequency.value=250;
 this.mid=ctx.createBiquadFilter();this.mid.type='peaking';this.mid.frequency.value=1100;this.mid.Q.value=.8;
 this.high=ctx.createBiquadFilter();this.high.type='highshelf';this.high.frequency.value=3500;
 this.filt=ctx.createBiquadFilter();this.filt.type='lowpass';this.filt.frequency.value=22000;this.filt.Q.value=1;
 this.fx=makeFX();this.vol=ctx.createGain();this.vol.gain.value=.9;this.xf=ctx.createGain();this.an=ctx.createAnalyser();this.an.fftSize=1024;
 this.trim.connect(this.low);this.low.connect(this.mid);this.mid.connect(this.high);this.high.connect(this.filt);this.filt.connect(this.fx.inp);this.fx.out.connect(this.vol);this.vol.connect(this.xf);this.xf.connect(this.an);this.an.connect(musicBus);
 this.eq={low:0,mid:0,high:0};this.kills={low:false,mid:false,high:false}}
 get baseRate(){return (1+this.tempo)*(1+this.bend)}
 get rate(){return this.baseRate*(1+this.nudge)}
 get stOn(){return this.keyLock&&!!this.st&&this.stBuf===this.buf}
 sendBuf(){if(!this.st||!this.buf||this.stBuf===this.buf)return;const ch=[];for(let c=0;c<Math.min(2,this.buf.numberOfChannels);c++)ch.push(this.buf.getChannelData(c).slice());
  this.st.port.postMessage({type:'load',ch},ch.map(a=>a.buffer));this.stBuf=this.buf}
 stMsg(m){if(this.src&&this.src.st)this.st.port.postMessage({...m,id:this.src.id})}
 stAnchor(){const l=this.loop;this._wpos=null;return{seq:++this.stSeq,pos:this.startPos,at:this.startCtx,rate:this.rate,loop:l&&{s:l.s,e:l.e}}}
 stState(){if(this.src&&this.src.st)this.stMsg({type:'state',...this.stAnchor()})}// tell the worklet our position timeline
 _srcLoop(){if(!this.src)return;const l=this.loop;if(this.src.st)this.stState();else{this.src.loop=!!l;if(l){this.src.loopStart=l.s;this.src.loopEnd=l.e}}}
 setKeyLock(on){this.keyLock=on;try{localStorage.setItem('mx_keylock_'+this.id,on?'1':'0')}catch(e){}if(on)this.sendBuf();const was=this.playing;if(was){this.stop();this.play()}ui[this.id].refresh();
  status(`Deck ${this.id}: key lock ${on?(this.st?'ON – tempo changes keep the original pitch':'unavailable in this browser'):'OFF – tempo changes shift pitch like vinyl'}`)}
 get bpm(){return this.track?this.track.a.bpm*this.baseRate:0}
 get beatLen(){return this.track?60/this.track.a.bpm:.5}
 pos(){if(!this.playing)return this.startPos;let p=this.startPos+(ctx.currentTime-this.startCtx)*this.rate;
  if(this.loop&&this.startPos<=this.loop.e+0.01&&p>this.loop.e){const L=this.loop.e-this.loop.s;p=this.loop.s+((p-this.loop.s)%L)}return Math.min(p,this.buf?this.buf.duration:0)}
 // actual playback position as reported by the worklet (source pos at an AudioContext time), extrapolated to now
 truePos(){const w=this._wpos;if(!this.playing||!this.src||!this.src.st||!w||w.id!==this.src.id||w.seq!==this.stSeq)return this.pos();
  let p=w.pos+(ctx.currentTime-w.t)*this.rate;if(this.loop&&this.startPos<=this.loop.e+0.01&&p>this.loop.e){const L=this.loop.e-this.loop.s;p=this.loop.s+((p-this.loop.s)%L)}return Math.min(p,this.buf?this.buf.duration:0)}
 rebase(){this.startPos=this.pos();this.startCtx=ctx.currentTime}
 async load(t){this.stop();status(`Loading ${t.name} → Deck ${this.id}`);this.buf=await decode(t);this.track=t;this.sendBuf();this.leader=null;this.nudge=0;decks.forEach(d=>{if(d.leader===this){d.leader=null;d.nudge=0}});this.startPos=0;this.cuePoint=t.a.entry||0;this.loop=null;this.tempo=0;this.bend=0;ui[this.id].refresh();renderLib();status(`Deck ${this.id}: ${t.name} · ${t.a.bpm} BPM · ${t.a.key}`)}
 play(){if(!this.buf||this.playing)return;resume();const off=clamp(this.startPos,0,this.buf.duration-0.01);
  if(this.stOn){// key lock: time-stretched playback in the worklet (pitch stays put)
   const v={st:true,id:++voiceSeq};this.startPos=off;this.startCtx=ctx.currentTime;this.st.port.postMessage({type:'play',id:v.id,...this.stAnchor()});this.src=v}
  else{const s=ctx.createBufferSource();s.buffer=this.buf;s.playbackRate.value=this.rate;
   if(this.loop){s.loop=true;s.loopStart=this.loop.s;s.loopEnd=this.loop.e}
   s.connect(this.trim);s.start(0,off);this.src=s;
   s.onended=()=>{if(this.src===s)this.ended()}}
  this.startPos=off;this.startCtx=ctx.currentTime;this.playing=true;ui[this.id].refresh()}
 ended(){this.playing=false;this.startPos=this.buf.duration;this.src=null;ui[this.id].refresh()}
 stop(){if(this.src){this.startPos=this.pos();const s=this.src;if(s.st)this.stMsg({type:'stop'});this.src=null;if(!s.st)try{s.stop()}catch(e){}}this.playing=false;ui[this.id]&&ui[this.id].refresh()}
 toggle(){this.playing?this.stop():this.play()}
 seek(t){if(!this.buf)return;t=clamp(t,0,this.buf.duration-0.05);const was=this.playing;if(was)this.stop();this.startPos=t;if(this.loop&&(t<this.loop.s||t>this.loop.e))this.loop=null;if(was)this.play();ui[this.id].refresh()}
 cue(){// CDJ style: if playing -> jump to cue & stop; if stopped -> set cue at current pos
  if(this.playing){this.stop();this.seek(this.cuePoint)}else{this.cuePoint=this.startPos;}ui[this.id].refresh()}
 setRate(){if(this.src){this.rebase();if(this.src.st)this.stState();else this.src.playbackRate.setValueAtTime(this.rate,ctx.currentTime)}}
 setTempo(v){this.tempo=v;this.setRate();ui[this.id].refresh(true)}
 setLoop(beats){if(!this.buf)return;if(!beats){this.exitLoop();return}const p=this.pos();const bl=this.beatLen,o=this.track.a.offset;
  const s=o+Math.floor((p-o)/bl)*bl;this.loop={s:Math.max(0,s),e:Math.min(this.buf.duration,s+beats*bl),beats};if(this.src){this._srcLoop();if(p>this.loop.e)this.seek(this.loop.s)}ui[this.id].refresh()}
 exitLoop(){if(!this.loop)return;const p=this.pos();this.loop=null;if(this.src){this.startPos=p;this.startCtx=ctx.currentTime;this._srcLoop()}ui[this.id].refresh()}
 hotCue(i,clear){if(!this.track)return;if(clear){this.track.cues[i]=null;saveTrack(this.track)}else if(this.track.cues[i]==null){this.track.cues[i]=this.pos();saveTrack(this.track)}else{this.seek(this.track.cues[i]);if(!this.playing)this.play()}ui[this.id].refresh()}
 setEQ(band,db){this.eq[band]=db;this.applyEQ()}
 applyEQ(){for(const b of['low','mid','high']){const n=this[b];const v=this.kills[b]?-40:this.eq[b];n.gain.setTargetAtTime(v,ctx.currentTime,.02)}}
 setFilter(v){// -1..1 : left = low-pass, right = high-pass
  const f=this.filt,t=ctx.currentTime;if(Math.abs(v)<.03){f.type='lowpass';f.frequency.setTargetAtTime(22000,t,.02);f.Q.value=.7}
  else if(v<0){f.type='lowpass';f.frequency.setTargetAtTime(200*Math.pow(110,1+v),t,.02);f.Q.value=4}else{f.type='highpass';f.frequency.setTargetAtTime(20*Math.pow(300,v),t,.02);f.Q.value=4}}
 phase(){return this.track?(((this.truePos()-this.track.a.offset)/this.beatLen)%1+1)%1:0}
 syncTarget(other){let target=other.bpm/this.track.a.bpm-1;
  if(target>.5)target=other.bpm/2/this.track.a.bpm-1;if(target<-.33)target=other.bpm*2/this.track.a.bpm-1;return clamp(target,-.5,.5)}
 sync(other){if(!this.track||!other||!other.track)return false;this.leader=other;if(other.leader===this){other.leader=null;other.nudge=0;other.setRate()}
  this.nudge=0;this.tempo=this.syncTarget(other);this.setRate();if(other.playing&&this.playing)this.alignPhase(other);ui[this.id].refresh();ui[other.id].refresh();return true}
 phaseErr(other){let d=this.phase()-other.phase();if(d>.5)d-=1;if(d<-.5)d+=1;return d*this.beatLen/this.rate}// seconds, + = we're ahead
 alignPhase(other){let d=other.phase()-this.phase();if(d>.5)d-=1;if(d<-.5)d+=1;this.seek(this.truePos()+d*this.beatLen)}
}
let voiceSeq=0;
const decks=[new Deck('A'),new Deck('B')];const D={A:decks[0],B:decks[1]};const other=d=>d===decks[0]?decks[1]:decks[0];
/* phase lock: a synced deck follows its leader's tempo and gets a small, gradual tempo nudge so the beats stay locked */
const LOCK={tau:.35,maxKeyLock:.01,maxVinyl:.004,realign:.04};
function phaseLock(){for(const d of decks){const L=d.leader;if(!L||!d.track||!L.track||d.bend||d._tape||(d.loop&&d.loop.beats<1))continue;
  const t=d.syncTarget(L);if(Math.abs(t-d.tempo)>1e-6){d.tempo=t;d.setRate();ui[d.id].refresh(true)}
  if(!d.playing||!L.playing){if(d.nudge){d.nudge=0;d.setRate()}continue}
  const es=d.phaseErr(L);if(Math.abs(es)>LOCK.realign){d.nudge=0;d.alignPhase(L);continue}
  const max=d.stOn?LOCK.maxKeyLock:LOCK.maxVinyl,n=clamp(-es/LOCK.tau,-max,max);if(Math.abs(n-d.nudge)>2e-5){d.nudge=n;d.setRate()}}}
setInterval(phaseLock,50);
/* key lock: load the phase-vocoder time-stretch worklet; decks fall back to plain varispeed if it can't load (e.g. file://) */
let stretchReady=false;
function attachStretch(d){const n=new AudioWorkletNode(ctx,'mx-stretch',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2]});n.connect(d.trim);d.st=n;
 n.port.onmessage=e=>{const m=e.data;if(!d.src||!d.src.st||d.src.id!==m.id)return;if(m.type==='ended')d.ended();else if(m.type==='pos'&&m.seq===d.stSeq)d._wpos=m};
 n.onprocessorerror=e=>{console.warn('Key-lock worklet failed',e);d.st=null;d.stBuf=null;if(d.src&&d.src.st){d.src=null;d.playing=false;d.play()}ui[d.id].refresh()};d.sendBuf()}
const stretchP=(ctx.audioWorklet?ctx.audioWorklet.addModule('stretch-worklet.js'):Promise.reject(new Error('AudioWorklet not supported')))
 .then(()=>{decks.forEach(attachStretch);stretchReady=true;decks.forEach(d=>ui[d.id]&&ui[d.id].refresh())})
 .catch(e=>{console.warn('Key lock unavailable:',e&&e.message);decks.forEach(d=>ui[d.id]&&ui[d.id].refresh())});

/* ---------------- deck UI ---------------- */
const ui={};
function deckHTML(id){return`<div class="dhead"><span class="dot"></span><span class="dname">DECK ${id}</span><span class="ttl" data-r="title">No track loaded</span></div>
<div class="body"><div class="platter" data-r="platter"><span class="mark"></span></div>
<div class="stats"><div class="stat"><label>BPM</label><b data-r="bpm">---</b><small data-r="rate">×1.00</small></div><div class="stat"><label>KEY</label><b data-r="key">--</b><small data-r="keyname"></small></div>
<div class="stat"><label>ENERGY</label><b data-r="energy">--</b></div><div class="stat"><label>ENTRY</label><b data-r="entry" style="font-size:16px">--</b></div></div></div>
<canvas class="wave" data-r="wave"></canvas><canvas class="over" data-r="over"></canvas><div class="time"><span data-r="pos">0:00</span><span data-r="remain">-0:00</span></div>
<div class="ctrls"><div><div class="trans"><button data-a="play" data-midi="${id}.play">▶︎ / ❚❚</button><button data-a="cue" data-midi="${id}.cue">CUE</button><button data-a="sync" data-midi="${id}.sync">SYNC</button><button data-a="entry" title="Jump to AI-picked entry point">⇥ ENTRY</button></div>
<div class="ptitle sm" style="margin:8px 0 0">Hot cues <small>click to set/jump · right-click/long-press clears</small></div>
<div class="cues">${[1,2,3,4,5,6,7,8].map(i=>`<button data-cue="${i-1}" data-midi="${id}.cue${i}">${i}</button>`).join('')}</div>
<div class="loops">${[1,2,4,8,16].map(b=>`<button data-loop="${b}">${b}</button>`).join('')}<button data-loop="0">EXIT LOOP</button></div>
<div class="knobs">${['high','mid','low'].map(b=>`<div class="knobwrap"><input type="range" class="knob" data-eq="${b}" data-midi="${id}.${b}" min="-26" max="8" step="0.5" value="0"><label>${b.toUpperCase()}</label><button class="kill" data-kill="${b}">KILL</button></div>`).join('')}
<div class="knobwrap"><input type="range" class="knob" data-r="filter" data-midi="${id}.filter" min="-1" max="1" step="0.01" value="0"><label>FILTER</label><button class="kill" data-a="vockill" title="Vocal kill: cuts the mid band">VOX ✕</button></div></div></div>
<div class="tempo"><span>TEMPO</span><span data-r="tempoTxt">0.0%</span><input type="range" class="v" data-r="tempo" data-midi="${id}.tempo" min="-0.16" max="0.16" step="0.0005" value="0"><span>±16%</span><div><button data-bend="-1" class="kill">−</button><button data-bend="1" class="kill">+</button></div><button data-a="keylock" class="kill klock" data-midi="${id}.keylock" title="Key lock (master tempo): change tempo without changing pitch">KEY<br>LOCK</button></div></div>`}
function buildDeckUI(d){const el=$('#deck'+d.id);el.innerHTML=deckHTML(d.id);const r=n=>el.querySelector(`[data-r="${n}"]`);
 const u={el,r,refresh(soft){const t=d.track;r('title').textContent=t?t.name:'No track loaded';r('bpm').textContent=t?d.bpm.toFixed(1):'---';r('rate').textContent='×'+d.baseRate.toFixed(3);
   r('key').textContent=t?t.a.key:'--';r('keyname').textContent=t?t.a.keyName:'';r('energy').textContent=t?Math.round(t.a.energy*10)+'/10':'--';r('entry').textContent=t?fmt(t.a.entry):'--';
   r('tempoTxt').textContent=(d.tempo*100).toFixed(1)+'%';const ts=r('tempo');if(Math.abs(ts.value-d.tempo)>1e-4){ts.min=Math.min(-0.16,d.tempo);ts.max=Math.max(0.16,d.tempo);ts.value=d.tempo}
   if(soft)return;el.querySelector('[data-a="play"]').classList.toggle('on',d.playing);el.querySelector('[data-a="sync"]').classList.toggle('on',!!d.leader);
   el.querySelectorAll('[data-cue]').forEach(b=>b.classList.toggle('set',!!(t&&t.cues[b.dataset.cue]!=null)));
   el.querySelectorAll('[data-loop]').forEach(b=>b.classList.toggle('on',!!(d.loop&&+b.dataset.loop===d.loop.beats)));
   el.querySelectorAll('[data-kill]').forEach(b=>b.classList.toggle('on',d.kills[b.dataset.kill]));el.querySelector('[data-a="vockill"]').classList.toggle('on',d.kills.mid);
   const kl=el.querySelector('[data-a="keylock"]');kl.classList.toggle('on',d.keyLock&&!!d.st);kl.disabled=!d.st;kl.title=d.st?'Key lock (master tempo): change tempo without changing pitch':'Key lock needs AudioWorklet (Chrome/Edge/Safari/Firefox over http/https)'}};
 ui[d.id]=u;
 el.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;const a=b.dataset.a;
  if(a==='play')d.toggle();else if(a==='cue')d.cue();else if(a==='sync'){if(!d.sync(other(d)))status('Load tracks on both decks to sync');}
  else if(a==='entry'&&d.track)d.seek(d.track.a.entry);else if(a==='keylock')d.setKeyLock(!d.keyLock);else if(a==='vockill'){d.kills.mid=!d.kills.mid;d.applyEQ();u.refresh()}
  else if(b.dataset.cue!=null)d.hotCue(+b.dataset.cue,e.shiftKey);else if(b.dataset.loop!=null)d.setLoop(+b.dataset.loop);
  else if(b.dataset.kill){d.kills[b.dataset.kill]=!d.kills[b.dataset.kill];d.applyEQ();u.refresh()}});
 el.addEventListener('contextmenu',e=>{const b=e.target.closest('[data-cue]');if(b){e.preventDefault();d.hotCue(+b.dataset.cue,true)}});
 let lp;el.addEventListener('pointerdown',e=>{const b=e.target.closest('[data-cue]');if(b)lp=setTimeout(()=>{d.hotCue(+b.dataset.cue,true);lp='done'},700);
  const bd=e.target.closest('[data-bend]');if(bd){d.bend=.04*bd.dataset.bend;d.setRate()}});
 el.addEventListener('pointerup',e=>{if(lp&&lp!=='done')clearTimeout(lp);if(lp==='done'){e.preventDefault()}lp=null;if(d.bend){d.bend=0;d.setRate()}});
 el.addEventListener('input',e=>{const t=e.target;if(t.dataset.eq)d.setEQ(t.dataset.eq,+t.value);else if(t.dataset.r==='filter')d.setFilter(+t.value);else if(t.dataset.r==='tempo'){if(d.leader){d.leader=null;d.nudge=0;u.refresh()}d.setTempo(+t.value)}});
 const seekCanvas=(cv,zoom)=>cv.addEventListener('click',e=>{if(!d.buf)return;const rc=cv.getBoundingClientRect();const x=(e.clientX-rc.left)/rc.width;
  if(zoom){d.seek(d.pos()+(x-.5)*8)}else d.seek(x*d.buf.duration)});seekCanvas(r('wave'),true);seekCanvas(r('over'),false);
 el.addEventListener('dragover',e=>e.preventDefault());el.addEventListener('drop',e=>{e.preventDefault();const id=e.dataTransfer.getData('text/track');const t=state.tracks.find(x=>x.id===id);if(t)d.load(t)});
 u.refresh()}
decks.forEach(buildDeckUI);

function drawWave(d){const u=ui[d.id],cv=u.r('wave'),ov=u.r('over');for(const c of[cv,ov]){const w=c.clientWidth*devicePixelRatio,h=c.clientHeight*devicePixelRatio;if(c.width!==w||c.height!==h){c.width=w;c.height=h}}
 const g=cv.getContext('2d'),W=cv.width,H=cv.height;g.clearRect(0,0,W,H);const o=ov.getContext('2d'),OW=ov.width,OH=ov.height;o.clearRect(0,0,OW,OH);
 if(!d.track){return}const p=d.track.a.peaks,dur=d.buf?d.buf.duration:d.track.dur,pos=d.pos();
 // zoomed: 8 s window centered
 const win=8,start=pos-win/2;g.fillStyle='#a14dff';g.shadowColor='#a14dff';g.shadowBlur=6;
 for(let x=0;x<W;x+=2){const t=start+x/W*win;if(t<0||t>dur)continue;const v=p[Math.floor(t/dur*p.length)]||0;const hh=v*H*.95;g.fillRect(x,H/2-hh/2,1.6,hh)}
 g.shadowBlur=0;// beat grid
 const bl=d.beatLen*1,o0=d.track.a.offset;g.fillStyle='rgba(255,255,255,.18)';for(let b=Math.ceil((start-o0)/bl);;b++){const t=o0+b*bl;if(t>start+win)break;const x=(t-start)/win*W;g.fillRect(x,0,b%4===0?2:1,b%4===0?H:H*.2)}
 if(d.loop){g.fillStyle='rgba(161,77,255,.22)';g.fillRect((d.loop.s-start)/win*W,0,(d.loop.e-d.loop.s)/win*W,H)}
 g.fillStyle='#ffd166';d.track.cues.forEach((c,i)=>{if(c==null)return;const x=(c-start)/win*W;if(x>=0&&x<=W){g.fillRect(x,0,2,H);g.font=`${10*devicePixelRatio}px sans-serif`;g.fillText(i+1,x+3,11*devicePixelRatio)}});
 g.fillStyle='#fff';g.fillRect(W/2-1,0,2,H);
 // overview
 for(let x=0;x<OW;x++){const v=p[Math.floor(x/OW*p.length)]||0;o.fillStyle=x/OW<pos/dur?'#6d28d9':'#c9c6d6';const hh=v*OH;o.fillRect(x,OH/2-hh/2,1,hh)}
 o.fillStyle='#ff5ce1';o.fillRect(d.track.a.entry/dur*OW,0,2,OH);o.fillStyle='#fff';o.fillRect(pos/dur*OW-1,0,2,OH);
 u.r('pos').textContent=fmt(pos);u.r('remain').textContent='-'+fmt((dur-pos)/d.rate)}

/* ---------------- mixer ---------------- */
function applyXfade(){const x=+$('#xfader').value;// constant power
 decks[0].xf.gain.setTargetAtTime(Math.cos((x+1)/4*Math.PI),ctx.currentTime,.01);decks[1].xf.gain.setTargetAtTime(Math.sin((x+1)/4*Math.PI),ctx.currentTime,.01)}
$('#xfader').addEventListener('input',applyXfade);applyXfade();
$('#volA').addEventListener('input',e=>decks[0].vol.gain.setTargetAtTime(+e.target.value,ctx.currentTime,.01));
$('#volB').addEventListener('input',e=>decks[1].vol.gain.setTargetAtTime(+e.target.value,ctx.currentTime,.01));
$('#master').addEventListener('input',e=>masterGain.gain.setTargetAtTime(+e.target.value,ctx.currentTime,.01));
['volA','volB','xfader','master'].forEach(id=>$('#'+id).dataset.midi=id);
const tmp=new Float32Array(2048);
function level(an){an.getFloatTimeDomainData(tmp.subarray(0,an.fftSize));let s=0;for(let i=0;i<an.fftSize;i++)s+=tmp[i]*tmp[i];return Math.sqrt(s/an.fftSize)}
const setMeter=(id,v,wide)=>{const p=clamp(Math.pow(v*2.2,.7)*100,0,100)+'%';const i=$(id+' i');if(wide)i.style.width=p;else i.style.height=p};

/* ---------------- FX ---------------- */
const fxState={};
function fxUnit(){const t=$('#fxTarget').value;return t==='master'?{fx:masterFX,deck:null}:{fx:D[t].fx,deck:D[t]}}
function fxToggle(name,on){const {fx,deck}=fxUnit();const mix=+$('#fxMix').value,t=ctx.currentTime;const anyDeck=deck||decks.find(d=>d.playing)||decks[0];
 if(name==='echo'){fx.dl.delayTime.value=clamp(anyDeck.track?60/anyDeck.bpm*.75:.35,.05,3.9);fx.echoS.gain.setTargetAtTime(on?mix:0,t,.02)}
 else if(name==='reverb')fx.revS.gain.setTargetAtTime(on?mix*1.4:0,t,.05);else if(name==='flanger')fx.flS.gain.setTargetAtTime(on?mix:0,t,.02);
 else if(name==='stutter'){const ds=deck?[deck]:decks.filter(d=>d.playing);ds.forEach(d=>{if(on){d._preLoop=d.loop;d.setLoop(.25)}else{d.exitLoop();if(d._preLoop)d.setLoop(d._preLoop.beats)}})}
 else if(name==='tapestop'&&on){const ds=deck?[deck]:decks.filter(d=>d.playing);ds.forEach(d=>{if(!d.src)return;const s=d.src,p0=d.pos(),r=d.rate;d._tape=true;setTimeout(()=>{d._tape=false},1200);if(s.st)d.stMsg({type:'tape',dur:1.1});else{s.playbackRate.cancelScheduledValues(t);s.playbackRate.setValueAtTime(r,t);s.playbackRate.linearRampToValueAtTime(.01,t+1.1)}
   setTimeout(()=>{if(d.src===s){d.stop();d.startPos=p0+r*.55;ui[d.id].refresh()}},1100)});setTimeout(()=>{fxState.tapestop=false;$('[data-fx=tapestop]').classList.remove('on')},1150)}}
$$('.fxb').forEach(b=>{const n=b.dataset.fx;b.dataset.midi='fx.'+n;
 if(n==='stutter'){b.addEventListener('pointerdown',()=>{b.classList.add('on');fxToggle(n,true)});const off=()=>{if(b.classList.contains('on')){b.classList.remove('on');fxToggle(n,false)}};b.addEventListener('pointerup',off);b.addEventListener('pointerleave',off);b.addEventListener('click',e=>{if(e.detail===0){fxToggle(n,true);setTimeout(()=>fxToggle(n,false),500)}})}
 else b.addEventListener('click',()=>{fxState[n]=!fxState[n];b.classList.toggle('on',fxState[n]);fxToggle(n,fxState[n])})});
$('#fxMix').addEventListener('input',()=>['echo','reverb','flanger'].forEach(n=>fxState[n]&&fxToggle(n,true)));
$('#fxTarget').addEventListener('change',()=>{['echo','reverb','flanger'].forEach(n=>{if(fxState[n]){fxState[n]=false;$(`[data-fx=${n}]`).classList.remove('on')}});[masterFX,...decks.map(d=>d.fx)].forEach(f=>{f.echoS.gain.value=0;f.revS.gain.value=0;f.flS.gain.value=0})});

/* ---------------- soundboard ---------------- */
function noiseBuf(sec){const b=ctx.createBuffer(1,ctx.sampleRate*sec,ctx.sampleRate),d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;return b}
const SFX={
 airhorn(){const t=ctx.currentTime,out=ctx.createGain();out.connect(sfxGain);const f=ctx.createBiquadFilter();f.type='lowpass';f.frequency.value=3000;f.connect(out);
  [0,.22,.44,.66].forEach((st,k)=>{const len=k===3?.9:.18;const g=ctx.createGain();g.gain.setValueAtTime(0,t+st);g.gain.linearRampToValueAtTime(.35,t+st+.02);g.gain.setValueAtTime(.35,t+st+len-.03);g.gain.linearRampToValueAtTime(0,t+st+len);g.connect(f);
   [466,470,698,932].forEach(fr=>{const o=ctx.createOscillator();o.type='sawtooth';o.frequency.setValueAtTime(fr*.94,t+st);o.frequency.linearRampToValueAtTime(fr,t+st+.05);o.connect(g);o.start(t+st);o.stop(t+st+len+.05)})})},
 siren(){const t=ctx.currentTime,o=ctx.createOscillator(),l=ctx.createOscillator(),lg=ctx.createGain(),g=ctx.createGain();o.type='square';o.frequency.value=900;l.frequency.value=2.2;lg.gain.value=350;l.connect(lg);lg.connect(o.frequency);
  const f=ctx.createBiquadFilter();f.type='lowpass';f.frequency.value=2500;o.connect(f);f.connect(g);g.connect(sfxGain);g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(.18,t+.1);g.gain.setValueAtTime(.18,t+2.3);g.gain.linearRampToValueAtTime(0,t+2.6);o.start(t);l.start(t);o.stop(t+2.7);l.stop(t+2.7)},
 rewind(){const t=ctx.currentTime;// pull back playing decks + scratchy sweep
  const n=ctx.createBufferSource();n.buffer=noiseBuf(1.2);const bp=ctx.createBiquadFilter();bp.type='bandpass';bp.Q.value=6;bp.frequency.setValueAtTime(3000,t);bp.frequency.exponentialRampToValueAtTime(200,t+1.1);
  const g=ctx.createGain();g.gain.setValueAtTime(.6,t);g.gain.linearRampToValueAtTime(0,t+1.2);n.connect(bp);bp.connect(g);g.connect(sfxGain);n.start(t);
  const o=ctx.createOscillator();o.type='sawtooth';o.frequency.setValueAtTime(1200,t);o.frequency.exponentialRampToValueAtTime(60,t+1.1);const og=ctx.createGain();og.gain.setValueAtTime(.12,t);og.gain.linearRampToValueAtTime(0,t+1.1);o.connect(og);og.connect(sfxGain);o.start(t);o.stop(t+1.2);
  decks.filter(d=>d.playing).forEach(d=>{duckMusic(.05,.05);setTimeout(()=>{d.seek(Math.max(0,d.pos()-d.beatLen*16));duckMusic(1,.05)},1100)})},
 drop(){const t=ctx.currentTime,o=ctx.createOscillator(),g=ctx.createGain();o.frequency.setValueAtTime(160,t);o.frequency.exponentialRampToValueAtTime(35,t+1.4);g.gain.setValueAtTime(.9,t);g.gain.exponentialRampToValueAtTime(.001,t+1.8);o.connect(g);g.connect(sfxGain);o.start(t);o.stop(t+1.9);
  const n=ctx.createBufferSource();n.buffer=noiseBuf(.4);const hp=ctx.createBiquadFilter();hp.type='highpass';hp.frequency.value=4000;const ng=ctx.createGain();ng.gain.setValueAtTime(.4,t);ng.gain.exponentialRampToValueAtTime(.001,t+.4);n.connect(hp);hp.connect(ng);ng.connect(sfxGain);n.start(t)}};
const pads=[{k:'airhorn',n:'AIR HORN',ic:'📯'},{k:'siren',n:'SIREN',ic:'🚨'},{k:'rewind',n:'REWIND',ic:'⏪'},{k:'drop',n:'DROP',ic:'⤓'},...[1,2,3,4].map(i=>({k:'c'+i,n:'CUSTOM '+i,ic:'＋',custom:true}))];
const customBufs={};
$('#pads').innerHTML=pads.map((p,i)=>`<button class="pad${p.custom?' custom':''}" data-pad="${i}" data-midi="pad${i+1}"><span class="ic">${p.ic}</span>${p.n}${p.custom?'<small>tap to load clip</small><span class="load" title="replace clip">⟳</span>':''}</button>`).join('');
function hitPad(i){const p=pads[i],b=$(`[data-pad="${i}"]`);resume();b.classList.add('hit');setTimeout(()=>b.classList.remove('hit'),250);
 if(!p.custom)return SFX[p.k]();if(customBufs[p.k]){const s=ctx.createBufferSource();s.buffer=customBufs[p.k];s.connect(sfxGain);s.start()}else pickClip(i)}
function pickClip(i){const inp=document.createElement('input');inp.type='file';inp.accept='audio/*';inp.onchange=async()=>{const f=inp.files[0];if(!f)return;customBufs[pads[i].k]=await ctx.decodeAudioData(await f.arrayBuffer());$(`[data-pad="${i}"] small`).textContent=cleanName(f.name);
 try{localStorage.setItem('mx_padname'+i,cleanName(f.name))}catch(e){}};inp.click()}
$('#pads').addEventListener('click',e=>{const l=e.target.closest('.load');const b=e.target.closest('[data-pad]');if(!b)return;if(l){e.stopPropagation();pickClip(+b.dataset.pad)}else hitPad(+b.dataset.pad)});

/* ---------------- mic + ducking ---------------- */
let mic=null;const micGain=ctx.createGain();const micAn=ctx.createAnalyser();micAn.fftSize=1024;micGain.connect(micAn);micGain.connect(masterGain);
function duckMusic(v,tc=.08){duck.gain.setTargetAtTime(v,ctx.currentTime,tc)}
$('#micBtn').dataset.midi='mic';
$('#micBtn').addEventListener('click',async()=>{if(mic){mic.getTracks().forEach(t=>t.stop());mic=null;$('#micBtn').classList.remove('on');$('#micState').textContent='OFF';duckMusic(1);return}
 try{mic=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:false}});const s=ctx.createMediaStreamSource(mic);const hp=ctx.createBiquadFilter();hp.type='highpass';hp.frequency.value=90;s.connect(hp);hp.connect(micGain);
  $('#micBtn').classList.add('on');$('#micState').textContent='LIVE'}catch(e){status('Mic unavailable: '+e.message)}});
$('#micVol').addEventListener('input',e=>micGain.gain.value=+e.target.value);
let micHold=0;

/* ---------------- energy curve ---------------- */
const CURVES={classic:[.3,.35,.45,.55,.7,.85,.95,1,.9,.7,.5,.35],build:[.25,.3,.4,.5,.55,.65,.7,.8,.85,.9,.95,1],flat:new Array(12).fill(.65)};
state.curve=JSON.parse(localStorage.getItem('mx_curve')||'null')||CURVES.classic.slice();
const ec=$('#energyCanvas');
function curveAt(x){const c=state.curve,f=clamp(x,0,1)*(c.length-1),i=Math.floor(f),r=f-i;return c[i]*(1-r)+(c[Math.min(i+1,c.length-1)])*r}
function setProgress(){const n=state.order.length||1;const idx=state.playedIds.size;return clamp(idx/Math.max(1,n-1),0,1)}
function drawCurve(){const W=ec.width=ec.clientWidth*devicePixelRatio,H=ec.height=70*devicePixelRatio,g=ec.getContext('2d');g.clearRect(0,0,W,H);
 const grad=g.createLinearGradient(0,0,0,H);grad.addColorStop(0,'rgba(161,77,255,.55)');grad.addColorStop(1,'rgba(161,77,255,0)');
 g.beginPath();g.moveTo(0,H);for(let x=0;x<=W;x+=3){const v=curveAt(x/W);const j=Math.sin(x*.9)*.03*H*Math.random();g.lineTo(x,H-v*H*.9+j)}g.lineTo(W,H);g.fillStyle=grad;g.fill();
 g.beginPath();for(let x=0;x<=W;x+=3){const v=curveAt(x/W);g.lineTo(x,H-v*H*.9)}g.strokeStyle='#c27bff';g.lineWidth=2*devicePixelRatio;g.shadowColor='#a14dff';g.shadowBlur=8;g.stroke();g.shadowBlur=0;
 const p=setProgress();g.fillStyle='#fff';g.fillRect(p*W-1,0,2,H);g.fillStyle='#9b90b3';g.font=`${10*devicePixelRatio}px sans-serif`;g.fillText('WARM UP',4,H-4);g.fillText('PEAK',W/2-14,12*devicePixelRatio);g.fillText('COOL DOWN',W-62*devicePixelRatio,H-4);
 $('#energyNow').textContent=Math.round(curveAt(p)*100)+'%'}
let drawingCurve=false;const curveEdit=e=>{const r=ec.getBoundingClientRect();const x=(e.clientX-r.left)/r.width,y=1-(e.clientY-r.top)/r.height;const i=Math.round(clamp(x,0,1)*(state.curve.length-1));state.curve[i]=clamp(y/.9,.05,1);drawCurve()};
ec.addEventListener('pointerdown',e=>{drawingCurve=true;ec.setPointerCapture(e.pointerId);curveEdit(e)});ec.addEventListener('pointermove',e=>drawingCurve&&curveEdit(e));
ec.addEventListener('pointerup',()=>{drawingCurve=false;localStorage.setItem('mx_curve',JSON.stringify(state.curve));planOrder();renderLib()});
$$('[data-curve]').forEach(b=>b.addEventListener('click',()=>{state.curve=CURVES[b.dataset.curve].slice();localStorage.setItem('mx_curve',JSON.stringify(state.curve));drawCurve();planOrder();renderLib()}));

/* ---------------- auto-mix ---------------- */
function score(a,b,target){const bd=Math.abs(a.a.bpm-b.a.bpm)/a.a.bpm;const bpmS=Math.max(0,1-bd*8);// within ~12%
 return Analysis.camelotCompat(a.a.key,b.a.key)*1.2+bpmS*1.4-Math.abs(b.a.energy-target)*2}
function planOrder(){const pool=state.tracks.filter(t=>!state.playedIds.has(t.id)&&!decks.some(d=>d.track&&d.track.id===t.id&&d.playing));const played=state.tracks.filter(t=>state.playedIds.has(t.id));
 const total=state.tracks.length;const order=[];let prev=decks.find(d=>d.playing&&d.track)?.track||null;const rest=pool.slice();
 if(state.nextOverride){const i=rest.findIndex(t=>t.id===state.nextOverride);if(i>=0){order.push(rest[i]);prev=rest[i];rest.splice(i,1)}}
 while(rest.length){const target=curveAt((played.length+order.length)/Math.max(1,total-1));let best=null,bs=-1e9;
  for(const t of rest){const s=prev?score(prev,t,target):-Math.abs(t.a.energy-target)*2;if(s>bs){bs=s;best=t}}order.push(best);prev=best;rest.splice(rest.indexOf(best),1)}
 state.order=order;drawCurve()}
const MIX_BEATS=32;
async function autoTick(){if(!state.auto||!state.tracks.length)return;const playing=decks.filter(d=>d.playing);
 if(state.transition)return;
 if(!playing.length){planOrder();const t=state.order[0];if(!t)return;const d=decks[0];await d.load(t);d.cuePoint=0;d.seek(0);$('#xfader').value=-1;applyXfade();d.play();state.playedIds.add(t.id);state.nextOverride=null;planOrder();renderLib();preload(d);return}
 const cur=playing.length===1?playing[0]:(+$('#xfader').value<0?decks[0]:decks[1]);const nx=other(cur);
 if(!nx.track||state.playedIds.has(nx.track.id)&&nx.track.id!==state._preloaded)await preload(cur);
 const mixSec=MIX_BEATS*cur.beatLen/cur.rate;const remain=(cur.buf.duration-cur.pos())/cur.rate;
 if(remain<mixSec+1.5&&nx.track&&!nx.playing)startTransition(cur,nx,Math.min(mixSec,Math.max(4,remain-.5)))}
async function preload(cur){planOrder();const t=state.order.find(x=>x.id!==(cur.track&&cur.track.id));const nx=other(cur);if(!t){return}if(nx.track&&nx.track.id===t.id&&!nx.playing)return;if(nx.playing)return;
 await nx.load(t);state._preloaded=t.id;nx.seek(t.cues[0]!=null?t.cues[0]:t.a.entry);status(`Auto-mix: next up “${t.name}” (${t.a.bpm} BPM, ${t.a.key}) entering at ${fmt(nx.startPos)}`)}
function startTransition(cur,nx,sec){state.transition=true;nx.sync(cur);// match tempo
 // phase-align at the entry point before starting
 let d=cur.phase()-nx.phase();if(d>.5)d-=1;if(d<-.5)d+=1;nx.startPos=Math.max(0,nx.startPos+d*nx.beatLen);
 nx.kills.low=true;nx.applyEQ();nx.play();state.playedIds.add(nx.track.id);state.nextOverride=null;renderLib();
 const from=nx===decks[1]?-1:1,to=-from,t0=performance.now();status(`Auto-mix: blending into “${nx.track.name}” over ${sec.toFixed(0)}s`);
 const step=()=>{const k=clamp((performance.now()-t0)/(sec*1000),0,1);$('#xfader').value=from+(to-from)*(k<.5?2*k*k:1-Math.pow(-2*k+2,2)/2);applyXfade();
  if(k>.5&&nx.kills.low){nx.kills.low=false;nx.applyEQ();cur.kills.low=true;cur.applyEQ()}// bass swap at midpoint
  if(k<1&&state.auto)requestAnimationFrame(step);else{cur.stop();cur.kills.low=false;cur.applyEQ();nx.kills.low=false;nx.applyEQ();ui.A.refresh();ui.B.refresh();state.transition=null;if(state.auto)preload(nx)}};requestAnimationFrame(step)}
$('#autoMix').dataset.midi='automix';
$('#autoMix').addEventListener('change',e=>{state.auto=e.target.checked;resume();if(state.auto){if(!state.tracks.length){status('Add some tracks first, then Auto-Mix will take over.');}else{status('Auto-Mix ON — sit back, I\'ve got the decks.');state.playedIds=new Set(decks.filter(d=>d.playing&&d.track).map(d=>d.track.id));planOrder();renderLib();autoTick()}}else status('Auto-Mix OFF — manual control.')});
setInterval(()=>autoTick().catch(e=>console.warn(e)),250);

/* ---------------- library UI ---------------- */
function renderLib(){const q=$('#search').value.toLowerCase();const pos=new Map(state.order.map((t,i)=>[t.id,i+1]));
 $('#libCount').textContent=state.tracks.length;
 $('#libBody').innerHTML=state.tracks.filter(t=>t.name.toLowerCase().includes(q)).map((t,i)=>{const on=decks.find(d=>d.track&&d.track.id===t.id);
  return`<tr draggable="true" data-id="${t.id}" class="${on&&on.playing?'playing':''}"><td>${state.auto&&pos.get(t.id)?'▸'+pos.get(t.id):String(state.tracks.indexOf(t)+1).padStart(2,'0')}</td><td class="t" title="${esc(t.name)}">${esc(t.name)}${on?` <span class="pill">${on.id}</span>`:''}${state.playedIds.has(t.id)?' ✓':''}</td><td>${t.a.bpm.toFixed(1)}</td><td>${t.a.key}</td>
  <td class="hide"><span class="ebar" style="width:${Math.round(t.a.energy*60)+6}px"></span></td><td class="hide">${fmt(t.dur)}</td><td><button data-load="A">A</button><button data-load="B">B</button><button data-next title="Auto-mix: play next">Next</button><button data-del title="Remove">✕</button></td></tr>`}).join('')}
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
$('#libBody').addEventListener('click',async e=>{const b=e.target.closest('button'),tr=e.target.closest('tr');if(!b||!tr)return;const t=state.tracks.find(x=>x.id===tr.dataset.id);
 if(b.dataset.load)D[b.dataset.load].load(t);else if(b.dataset.next!==undefined){state.nextOverride=t.id;planOrder();renderLib();const cur=decks.find(d=>d.playing);if(state.auto&&cur&&!state.transition)await preload(cur);status(`“${t.name}” will play next.`)}
 else if(b.dataset.del!==undefined){state.tracks=state.tracks.filter(x=>x!==t);dbDel(t.id);bufCache.delete(t.id);planOrder();renderLib()}});
$('#libBody').addEventListener('dragstart',e=>{const tr=e.target.closest('tr');if(tr)e.dataTransfer.setData('text/track',tr.dataset.id)});
$('#search').addEventListener('input',renderLib);
$('#fileIn').addEventListener('change',e=>{addFiles(e.target.files);e.target.value=''});
const drop=$('#drop');['dragenter','dragover'].forEach(ev=>document.addEventListener(ev,e=>{if(e.dataTransfer&&[...e.dataTransfer.types].includes('Files')){e.preventDefault();drop.classList.add('over')}}));
document.addEventListener('dragleave',e=>{if(!e.relatedTarget)drop.classList.remove('over')});
document.addEventListener('drop',e=>{if(e.dataTransfer&&e.dataTransfer.files.length){e.preventDefault();drop.classList.remove('over');addFiles(e.dataTransfer.files)}});
drop.addEventListener('click',()=>$('#fileIn').click());

/* ---------------- requests + QR ---------------- */
// Backends: 'server' (server.js on the same WiFi), 'firebase' (hook, wired later), else local-only. No network polling unless a server is detected/configured.
const CFG=window.MIXRRRR_CONFIG||{};
const servedByServer=!!document.querySelector('meta[name="mixrrrr-server"]');// injected by server.js
const reqMode=(()=>{const m=CFG.requests||'auto';if(m==='server')return'server';if(m==='firebase')return CFG.firebase?'firebase':'local';if(m==='local')return'local';return servedByServer?'server':'local'})();
const apiUrl=p=>new URL('api/'+p,CFG.serverUrl?new URL(CFG.serverUrl,location.href):(servedByServer?location.origin+'/':location.href)).href;
const RequestBackends={// Firebase hook: implement list/add/vote/remove with the Realtime Database SDK, using CFG.firebase
 firebase:{ready:false,async list(){return[]},async add(title){},async remove(id){}}};
let serverMode=false,serverDown=false;
if(reqMode==='firebase'&&!RequestBackends.firebase.ready)console.info('Mixrrrr Live: Firebase config found; online requests are not wired yet, using the local queue.');
state.requests=JSON.parse(localStorage.getItem('mx_req')||'[]');
function renderReq(){const list=state.requests.slice().sort((a,b)=>b.votes-a.votes);$('#reqCount').textContent=list.length;
 $('#reqList').innerHTML=list.map(r=>{const m=matchTrack(r.title);return`<li data-id="${r.id}"><span>${esc(r.title)}${m?` <small class="match">✓ in library</small>`:' <small class="miss">not in library</small>'}</span><b>${r.votes}</b><button data-up>▲</button>${m?'<button data-q>Queue</button>':''}<button data-x>✕</button></li>`}).join('')||'<li><span style="color:var(--mute)">No requests yet</span></li>'}
function saveReq(){if(!serverMode)localStorage.setItem('mx_req',JSON.stringify(state.requests));renderReq()}
const postReq=title=>fetch(apiUrl('requests'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title})});
$('#reqForm').addEventListener('submit',async e=>{e.preventDefault();const v=$('#reqInput').value.trim();if(!v)return;$('#reqInput').value='';
 if(serverMode){await postReq(v).catch(()=>{});pollReq()}else{const ex=state.requests.find(r=>r.title.toLowerCase()===v.toLowerCase());if(ex)ex.votes++;else state.requests.push({id:Date.now(),title:v,votes:1});saveReq()}});
$('#reqList').addEventListener('click',async e=>{const li=e.target.closest('li[data-id]');if(!li)return;const r=state.requests.find(x=>String(x.id)===li.dataset.id);if(!r)return;
 if(e.target.matches('[data-up]')){if(serverMode)await postReq(r.title).catch(()=>{});else r.votes++}
 else if(e.target.matches('[data-x]')){if(serverMode)await fetch(apiUrl('requests?id='+r.id),{method:'DELETE'}).catch(()=>{});state.requests=state.requests.filter(x=>x!==r)}
 else if(e.target.matches('[data-q]')){const t=matchTrack(r.title);state.nextOverride=t.id;planOrder();renderLib();status(`Request “${r.title}” queued next.`)}
 serverMode?pollReq():saveReq()});
async function pollReq(){try{const res=await fetch(apiUrl('requests'),{cache:'no-store'});if(!res.ok)throw 0;state.requests=await res.json();if(serverDown){serverDown=false;setupQR()}renderReq()}catch(e){if(!serverDown){serverDown=true;setupQR()}}}
async function setupQR(){const cv=$('#qr'),row=$('.qrrow');let url=null;
 if(serverMode&&!serverDown){url=CFG.requestPageUrl||new URL('request.html',location.href).href;
  if(!CFG.requestPageUrl)try{const info=await (await fetch(apiUrl('info'))).json();if(info.ips&&info.ips[0]&&/localhost|127\.0\.0\.1/.test(location.hostname))url=`http://${info.ips[0]}:${info.port}/request.html`}catch(e){}}
 row.classList.toggle('noqr',!url);cv.hidden=!url;
 if(url){const g=cv.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,96,96);try{const q=qrcode(0,'M');q.addData(url);q.make();const n=q.getModuleCount(),s=Math.floor(88/n),o=(96-n*s)/2;g.fillStyle='#000';for(let r=0;r<n;r++)for(let c=0;c<n;c++)if(q.isDark(r,c))g.fillRect(o+c*s,o+r*s,s,s)}catch(e){console.warn(e)}
  $('#qrTitle').textContent='Request via QR';$('#qrText').innerHTML=`Guests scan to request (same WiFi):<br><code>${esc(url)}</code>`}
 else if(serverMode){$('#qrTitle').textContent='Request server offline';$('#qrText').innerHTML='Can’t reach the request server. Requests added here stay on this device until it’s back.'}
 else{$('#qrTitle').textContent='Online requests coming soon';$('#qrText').innerHTML='For now the queue lives on this device: add requests above. Running locally? Start <code>node server.js</code> on a laptop and guests on the same WiFi can scan a QR code to request.'}}
if(reqMode==='server'){serverMode=true;state.requests=[];pollReq();setInterval(pollReq,4000)}
renderReq();setupQR();

/* ---------------- fuzzy matching + Spotify import ---------------- */
const norm=s=>s.toLowerCase().replace(/\(.*?\)|\[.*?\]/g,' ').replace(/feat\.?|ft\.?|remaster(ed)?|official|audio|video|lyrics|\d{4}/g,' ').replace(/[^a-z0-9]+/g,' ').trim();
function sim(a,b){const A=new Set(norm(a).split(' ').filter(w=>w.length>1)),B=new Set(norm(b).split(' ').filter(w=>w.length>1));if(!A.size||!B.size)return 0;let n=0;A.forEach(w=>B.has(w)&&n++);return n/Math.min(A.size,B.size)*(0.6+0.4*n/Math.max(A.size,B.size))}
function matchTrack(q){let best=null,bs=.55;for(const t of state.tracks){const s=sim(q,t.name);if(s>bs){bs=s;best=t}}return best}
function dialog(html){$('#dlgBody').innerHTML=html;$('#dlg').showModal()}
$('#btnSpotify').addEventListener('click',()=>{dialog(`<h3>Import a Spotify (or any) playlist</h3><p style="color:var(--mute);font-size:12px">Streaming services don't allow their audio to be mixed in third-party apps, so this only matches track names to <b>your own files</b>. Paste one track per line (e.g. “Artist – Title”). Tip: in Spotify desktop, select all tracks (Ctrl/Cmd+A), copy, and paste — links are listed too.</p>
 <textarea id="plText" placeholder="Fred again.. – Delilah&#10;Peggy Gou – (It Goes Like) Nanana"></textarea><p><button type="button" id="plGo" class="on">Match against my library</button></p><div id="plRes"></div>`);
 $('#plGo').onclick=()=>{const lines=$('#plText').value.split(/\n+/).map(s=>s.trim()).filter(Boolean);let found=[],html='<ul>';
  for(const l of lines){if(/open\.spotify\.com\/track/.test(l)){html+=`<li class="miss">${esc(l)} — link only (no track name); paste names instead</li>`;continue}const m=matchTrack(l);if(m)found.push(m);html+=`<li class="${m?'match':'miss'}">${esc(l)} ${m?'→ '+esc(m.name):'— not in your files'}</li>`}
  html+=`</ul><p>${found.length}/${lines.length} matched.</p>`+(found.length?'<button type="button" id="plSave" class="on">Save matches as a set</button>':'');$('#plRes').innerHTML=html;
  if(found.length)$('#plSave').onclick=()=>{const name=prompt('Set name','Imported playlist');if(name){saveSet(name,found.map(t=>t.id));status(`Saved set “${name}” with ${found.length} tracks.`)}}}});

/* ---------------- sets & presets ---------------- */
const getSets=()=>JSON.parse(localStorage.getItem('mx_sets')||'[]');
function saveSet(name,ids){const sets=getSets().filter(s=>s.name!==name);sets.push({name,ids,curve:state.curve,t:Date.now()});localStorage.setItem('mx_sets',JSON.stringify(sets))}
function currentPreset(){return{xfader:$('#xfader').value,volA:$('#volA').value,volB:$('#volB').value,master:$('#master').value,fxMix:$('#fxMix').value,micVol:$('#micVol').value,duck:$('#duckOn').checked,curve:state.curve,
 eq:decks.map(d=>({...d.eq}))}}
function applyPreset(p){['xfader','volA','volB','master','fxMix','micVol'].forEach(k=>{if(p[k]!=null){$('#'+k).value=p[k];$('#'+k).dispatchEvent(new Event('input'))}});$('#duckOn').checked=p.duck!==false;if(p.curve){state.curve=p.curve;drawCurve()}
 if(p.eq)p.eq.forEach((e,i)=>{for(const b in e){decks[i].setEQ(b,e[b]);const el=ui[decks[i].id].el.querySelector(`[data-eq="${b}"]`);if(el)el.value=e[b]}})}
$('#btnSets').addEventListener('click',()=>{const sets=getSets(),presets=JSON.parse(localStorage.getItem('mx_presets')||'{}');
 dialog(`<h3>Saved sets</h3><p style="color:var(--mute);font-size:12px">Your tracks and hot cues are stored on this device (IndexedDB), so they're there next time — even offline.</p>
 <ul>${sets.map((s,i)=>`<li>${esc(s.name)} · ${s.ids.length} tracks <button type="button" data-ls="${i}">Load</button> <button type="button" data-ds="${i}">Delete</button></li>`).join('')||'<li>No sets yet</li>'}</ul>
 <p><button type="button" id="saveSet">Save current library order as set</button></p>
 <h3>Mixer presets</h3><ul>${Object.keys(presets).map(k=>`<li>${esc(k)} <button type="button" data-lp="${esc(k)}">Apply</button> <button type="button" data-dp="${esc(k)}">Delete</button></li>`).join('')||'<li>No presets yet</li>'}</ul>
 <p><button type="button" id="savePreset">Save current mixer as preset</button></p>`);
 $('#dlgBody').onclick=e=>{const b=e.target;const sets=getSets(),presets=JSON.parse(localStorage.getItem('mx_presets')||'{}');
  if(b.id==='saveSet'){const n=prompt('Set name','My set '+new Date().toLocaleDateString());if(n){saveSet(n,(state.order.length?state.order:state.tracks).map(t=>t.id));$('#btnSets').click()}}
  else if(b.id==='savePreset'){const n=prompt('Preset name','Club');if(n){presets[n]=currentPreset();localStorage.setItem('mx_presets',JSON.stringify(presets));$('#btnSets').click()}}
  else if(b.dataset.ls){const s=sets[b.dataset.ls];const byId=new Map(state.tracks.map(t=>[t.id,t]));const inSet=s.ids.map(id=>byId.get(id)).filter(Boolean);state.tracks=[...inSet,...state.tracks.filter(t=>!s.ids.includes(t.id))];
   state.playedIds=new Set(state.tracks.filter(t=>!s.ids.includes(t.id)).map(t=>t.id));if(s.curve)state.curve=s.curve;planOrder();renderLib();status(`Loaded set “${s.name}” — Auto-Mix will play its ${inSet.length} tracks.`);$('#dlg').close()}
  else if(b.dataset.ds){sets.splice(b.dataset.ds,1);localStorage.setItem('mx_sets',JSON.stringify(sets));$('#btnSets').click()}
  else if(b.dataset.lp){applyPreset(presets[b.dataset.lp]);status('Preset applied');$('#dlg').close()}
  else if(b.dataset.dp){delete presets[b.dataset.dp];localStorage.setItem('mx_presets',JSON.stringify(presets));$('#btnSets').click()}}});
addEventListener('beforeunload',()=>localStorage.setItem('mx_last',JSON.stringify(currentPreset())));
try{const last=JSON.parse(localStorage.getItem('mx_last')||'null');if(last)applyPreset(last)}catch(e){}
pads.forEach((p,i)=>{const n=localStorage.getItem('mx_padname'+i);if(p.custom&&n)$(`[data-pad="${i}"] small`).textContent=n+' (reload clip)'});

/* ---------------- recording ---------------- */
let rec=null,chunks=[];
$('#btnRec').addEventListener('click',()=>{resume();if(rec){rec.stop();return}
 if(!window.MediaRecorder)return status('Recording not supported in this browser');const mt=['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg'].find(m=>MediaRecorder.isTypeSupported(m))||'';
 rec=new MediaRecorder(recDest.stream,mt?{mimeType:mt,audioBitsPerSecond:256000}:{});chunks=[];rec.ondataavailable=e=>e.data.size&&chunks.push(e.data);const t0=Date.now();
 rec.onstop=()=>{const blob=new Blob(chunks,{type:rec.mimeType});const a=document.createElement('a');a.href=URL.createObjectURL(blob);const ext=rec.mimeType.includes('mp4')?'m4a':rec.mimeType.includes('ogg')?'ogg':'webm';
  a.download=`mixrrrr-live-set-${new Date().toISOString().slice(0,16).replace(/[:T]/g,'-')}.${ext}`;document.body.appendChild(a);a.click();a.remove();status(`Recording saved (${fmt((Date.now()-t0)/1000)}).`);rec=null;$('#btnRec').classList.remove('on');$('#btnRec').textContent='● REC'};
 rec.start(1000);$('#btnRec').classList.add('on');const tick=()=>{if(rec){$('#btnRec').textContent='■ '+fmt((Date.now()-t0)/1000);setTimeout(tick,500)}};tick();status('Recording the master output…')});

/* ---------------- visuals ---------------- */
const vis=$('#visuals'),vc=$('#visCanvas');let visOn=false,beatFlash=0,bassAvg=0;const fbin=new Uint8Array(1024);
$('#btnVisuals').addEventListener('click',()=>{vis.hidden=false;visOn=true;vis.requestFullscreen&&vis.requestFullscreen().catch(()=>{})});
const closeVis=()=>{vis.hidden=true;visOn=false;if(document.fullscreenElement)document.exitFullscreen()};$('#visClose').addEventListener('click',closeVis);
document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement&&visOn){vis.hidden=true;visOn=false}});
function drawVis(){const W=vc.width=vc.clientWidth,H=vc.height=vc.clientHeight,g=vc.getContext('2d');masterAn.getByteFrequencyData(fbin);
 g.fillStyle=`rgba(13,7,22,${.35})`;g.fillRect(0,0,W,H);const cx=W/2,cy=H/2,R=Math.min(W,H)*.22*(1+beatFlash*.15);
 if(beatFlash>.05){g.fillStyle=`rgba(161,77,255,${beatFlash*.35})`;g.fillRect(0,0,W,H)}
 const N=180;for(let i=0;i<N;i++){const v=fbin[Math.floor(i/N*400)]/255;const a=i/N*Math.PI*2-Math.PI/2;const L=R+v*Math.min(W,H)*.3;
  g.strokeStyle=`hsl(${270+v*60},100%,${50+v*25}%)`;g.lineWidth=3;g.beginPath();g.moveTo(cx+Math.cos(a)*R,cy+Math.sin(a)*R);g.lineTo(cx+Math.cos(a)*L,cy+Math.sin(a)*L);g.stroke()}
 g.strokeStyle='#c9c6d6';g.lineWidth=2;g.beginPath();g.arc(cx,cy,R*.95,0,7);g.stroke();
 for(let k=0;k<6;k++){g.fillStyle=`rgba(161,77,255,${beatFlash*.6})`;const x=(k+.5)/6*W;g.beginPath();g.moveTo(x,0);g.lineTo(x-80-beatFlash*120,H);g.lineTo(x+80+beatFlash*120,H);g.fill()}}

/* ---------------- MIDI ---------------- */
const DEFAULT_MIDI={'b0:7':'volA','b1:7':'volB','b0:8':'xfader','90:11':'A.play','91:11':'B.play','90:12':'A.cue','91:12':'B.cue','90:13':'A.sync','91:13':'B.sync'};
function midiEl(id){return document.querySelector(`[data-midi="${id}"]`)}
function onMidi(e){const [st,d1,d2]=e.data;const type=st&0xf0,ch=st&0x0f;if(type!==0x90&&type!==0x80&&type!==0xb0)return;const key=(type===0x80?'90':type.toString(16))+(ch?String(ch):'')+':'+d1;
 const k2=(type===0x80?0x90+ch:st).toString(16)+':'+d1;
 if(state.learn&&state.learnTarget&&(type===0xb0||(type===0x90&&d2>0))){state.midiMap[k2]=state.learnTarget.dataset.midi;localStorage.setItem('mx_midi',JSON.stringify(state.midiMap));status(`Mapped ${k2} → ${state.learnTarget.dataset.midi}`);state.learnTarget.style.outline='';state.learnTarget=null;return}
 const id=state.midiMap[k2]||DEFAULT_MIDI[k2];if(!id)return;const el=midiEl(id);if(!el)return;
 if(el.type==='range'){el.value=+el.min+(d2/127)*(el.max-el.min);el.dispatchEvent(new Event('input',{bubbles:true}))}
 else if(el.type==='checkbox'){if(d2>0&&type!==0x80){el.checked=!el.checked;el.dispatchEvent(new Event('change'))}}
 else if(type!==0x80&&d2>0){if(el.dataset.fx==='stutter'){el.dispatchEvent(new PointerEvent('pointerdown'))}else el.click()}else if(el.dataset.fx==='stutter')el.dispatchEvent(new PointerEvent('pointerup'))}
let midiAccess=null;
$('#btnMidi').addEventListener('click',async()=>{if(!navigator.requestMIDIAccess)return dialog('<h3>MIDI</h3><p>Web MIDI isn\'t supported in this browser. Use Chrome or Edge on desktop/Android.</p>');
 try{if(!midiAccess){midiAccess=await navigator.requestMIDIAccess();const hook=()=>midiAccess.inputs.forEach(i=>i.onmidimessage=onMidi);hook();midiAccess.onstatechange=hook}
  const names=[...midiAccess.inputs.values()].map(i=>i.name);
  dialog(`<h3>DJ controller (Web MIDI)</h3><p>Connected: ${names.length?names.map(esc).join(', '):'no devices found — plug in a controller'}</p>
  <p style="font-size:12px;color:var(--mute)">Default map: CC7 ch1/ch2 = deck volumes, CC8 = crossfader, notes 11/12/13 = play/cue/sync (ch1 = A, ch2 = B). Use <b>MIDI Learn</b> to map anything else: click Learn, click a control on screen, then move/press the controller knob or button.</p>
  <p><button type="button" id="learnBtn" class="${state.learn?'on':''}">${state.learn?'Stop learning':'MIDI Learn'}</button> <button type="button" id="clearMidi">Clear mappings</button></p><p>${Object.keys(state.midiMap).length} custom mappings saved.</p>`);
  $('#learnBtn').onclick=()=>{state.learn=!state.learn;document.body.classList.toggle('learning',state.learn);$('#btnMidi').classList.toggle('on',state.learn);$('#dlg').close();status(state.learn?'MIDI Learn: click an on-screen control, then move a controller knob.':'MIDI Learn off')};
  $('#clearMidi').onclick=()=>{state.midiMap={};localStorage.removeItem('mx_midi');$('#dlg').close()}}catch(e){status('MIDI access denied: '+e.message)}});
document.addEventListener('pointerdown',e=>{if(!state.learn)return;const el=e.target.closest('[data-midi]');if(el){e.preventDefault();e.stopPropagation();if(state.learnTarget)state.learnTarget.style.outline='';state.learnTarget=el;el.style.outline='2px solid #ff5ce1';status(`Now move a controller knob/button for “${el.dataset.midi}”`)}},true);
document.addEventListener('click',e=>{if(state.learn&&e.target.closest('[data-midi]'))e.preventDefault(),e.stopPropagation()},true);

/* ---------------- keyboard shortcuts ---------------- */
addEventListener('keydown',e=>{if(e.target.matches('input[type=text],input:not([type]),textarea'))return;const k=e.key.toLowerCase();
 if(k==='q')decks[0].toggle();else if(k==='p')decks[1].toggle();else if(k==='w')decks[0].cue();else if(k==='o')decks[1].cue();else if(k==='1')hitPad(0);else if(k==='2')hitPad(1);else if(k==='3')hitPad(2);else if(k==='4')hitPad(3)});

/* ---------------- main loop ---------------- */
function frame(){decks.forEach(drawWave);
 const lA=level(decks[0].an),lB=level(decks[1].an),lM=level(masterAn);setMeter('#meterA',lA);setMeter('#meterB',lB);setMeter('#meterM',lM,true);
 decks.forEach(d=>{const p=ui[d.id].r('platter');if(d.playing){d._rot=((d._rot||0)+d.rate*3.3)%360}p.style.transform=`rotate(${d._rot||0}deg)`});
 const live=decks.filter(d=>d.playing);const md=live.length?live.reduce((a,b)=>(a.xf.gain.value>=b.xf.gain.value?a:b)):null;$('#masterBpm').textContent=md?md.bpm.toFixed(1)+' BPM':'--- BPM';
 // mic ducking
 if(mic){const lm=level(micAn);setMeter('#meterMic',lm,true);if($('#duckOn').checked){if(lm>.03){micHold=performance.now()}duckMusic(performance.now()-micHold<600?.3:1,.12)}}
 // beat detection for visuals
 masterAn.getByteFrequencyData(fbin);let bass=0;for(let i=1;i<8;i++)bass+=fbin[i];bass/=7;if(bass>bassAvg*1.25&&bass>120)beatFlash=1;bassAvg=bassAvg*.95+bass*.05;beatFlash*=.88;
 if(visOn)drawVis();requestAnimationFrame(frame)}
requestAnimationFrame(frame);addEventListener('resize',drawCurve);drawCurve();

/* ---------------- boot ---------------- */
loadLibrary().then(async()=>{const qp=new URLSearchParams(location.search);if(qp.has('demo')&&!state.tracks.length){// demo mode: load bundled demo tracks
  try{const list=await (await fetch('demo/list.json')).json();const files=[];for(const n of list){const b=await (await fetch('demo/'+n)).blob();files.push(new File([b],n,{type:'audio/wav'}))}await addFiles(files);
   if(qp.has('autoload')){await decks[0].load(state.tracks[0]);await decks[1].load(state.tracks[1]||state.tracks[0]);decks[0].seek(5);decks[1].seek(state.tracks[1]?.a.entry||0);decks[0].hotCue(0);decks[1].hotCue(0)}
   window.__MIXRRRR_READY=true;document.body.dataset.ready='1';status(`Demo loaded: ${state.tracks.length} tracks. `+state.tracks.map(t=>`${t.name}=${t.a.bpm}/${t.a.key}`).join(' · '))}catch(e){console.error('demo',e);status('Demo failed: '+e.message)}}});
if('serviceWorker' in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('sw.js').catch(e=>console.warn('SW',e));
addEventListener('online',()=>status('Back online.'));addEventListener('offline',()=>status('Offline — Mixrrrr Live keeps playing from your local library.'));
