// Mixrrrr Live – key-lock (master tempo) engine. Original MIT-licensed code, no dependencies.
// AudioWorklet that plays a deck's decoded track with WSOLA time-stretching, so the tempo
// (playback rate) changes without changing pitch. Also handles loops and a varispeed tape-stop.
'use strict';
class MxStretch extends AudioWorkletProcessor{
 constructor(){super();
  const sr=sampleRate;this.N=2*Math.round(0.0232*sr);this.HS=this.N/2;this.SEEK=Math.round(0.010*sr);this.lam=0.15;
  this.win=new Float32Array(this.N);for(let i=0;i<this.N;i++)this.win[i]=0.5-0.5*Math.cos(2*Math.PI*i/this.N);// periodic Hann, sums to 1 at 50% overlap
  this.acc=[new Float32Array(this.N),new Float32Array(this.N)];this.ready=[new Float32Array(this.HS),new Float32Array(this.HS)];
  this.ch=null;this.mono=null;this.len=0;this.playing=false;this.id=0;this.rate=1;this.loop=null;this.tape=null;this.fade=0;this.q=0;
  this.port.onmessage=e=>this.msg(e.data)}
 msg(m){const sr=sampleRate;
  if(m.type==='load'){const ch=m.ch;this.ch=[ch[0],ch[1]||ch[0]];this.len=ch[0].length;const mo=new Float32Array(this.len),L=this.ch[0],R=this.ch[1];for(let i=0;i<this.len;i++)mo[i]=(L[i]+R[i])*.5;this.mono=mo;this.playing=false}
  else if(m.type==='play'){if(!this.ch)return;this.id=m.id;this.rate=m.rate;this.setLoop(m.loop);this.pos=m.pos*sr;this.prev=0;this.first=true;this.tape=null;this.fade=0;
   this.acc[0].fill(0);this.acc[1].fill(0);this.ri=this.HS;this.playing=true;this.ended=false;this.cur=this.pos}
  else if(m.id!==this.id)return;
  else if(m.type==='stop'){if(this.playing)this.fade=1}
  else if(m.type==='rate')this.rate=m.rate;
  else if(m.type==='loop')this.setLoop(m.loop);
  else if(m.type==='tape'){if(this.playing&&!this.tape){const r=this.rate,n=m.dur*sr;this.tape={p:this.cur,r,dr:(r-.01)/n,n}}}}
 setLoop(l){this.loop=l?{s:l.s*sampleRate,e:l.e*sampleRate}:null}
 wrap(i){const l=this.loop;if(l&&i>=l.e){const L=l.e-l.s;if(L>1)i=l.s+((i-l.s)%L)}return i}
 at(a,i){i=Math.floor(this.wrap(i));return i>=0&&i<this.len?a[i]:0}
 // find offset d in [-SEEK,SEEK] so frame at a+d best continues the previous frame (normalised cross-correlation)
 search(a){const t=this.prev+this.HS,H=this.HS,S=this.SEEK,m=this.mono,lam=this.lam;let best=0,bv=-Infinity;
  const tgt=this.tgt||(this.tgt=new Float32Array(H));for(let j=0;j<H;j++)tgt[j]=this.at(m,t+j);
  const fast=!this.loop&&a-S-1>=0&&a+S+H+1<this.len;
  const corr=(d,step)=>{let xy=0,yy=1e-9,xx=1e-9;const b=Math.floor(a+d);for(let j=0;j<H;j+=step){const x=tgt[j],y=fast?m[b+j]:this.at(m,b+j);xy+=x*y;yy+=y*y;xx+=x*x}
   return xy/Math.sqrt(xx*yy)-lam*Math.abs(d)/S};// normalised correlation, small penalty for drifting from the nominal position (keeps beat-grid timing tight)
  for(let d=-S;d<=S;d+=4){const v=corr(d,4);if(v>bv){bv=v;best=d}}
  const c=best;bv=corr(c,2);for(let d=c-3;d<=c+3;d++){if(d<-S||d>S||d===c)continue;const v=corr(d,2);if(v>bv){bv=v;best=d}}
  this.lastC=bv+lam*Math.abs(best)/S;return best}
 frame(){const N=this.N,H=this.HS;if(!this.loop&&this.pos>=this.len){this.ended=true}
  this.pos=this.wrap(this.pos);const a=Math.floor(this.pos);const d=this.first?0:this.search(a);const s=a+d;this.first=false;
  const A0=this.acc[0],A1=this.acc[1],L=this.ch[0],R=this.ch[1],w=this.win;
  if(!this.ended){if(!this.loop&&s>=0&&s+N<this.len){for(let i=0;i<N;i++){A0[i]+=L[s+i]*w[i];A1[i]+=R[s+i]*w[i]}}
   else for(let i=0;i<N;i++){A0[i]+=this.at(L,s+i)*w[i];A1[i]+=this.at(R,s+i)*w[i]}}
  this.ready[0].set(A0.subarray(0,H));this.ready[1].set(A1.subarray(0,H));A0.copyWithin(0,H);A1.copyWithin(0,H);A0.fill(0,H);A1.fill(0,H);
  this.prev=s;this.fstart=s;this.lastOff=d;this.frate=this.rate;this.pos+=H*this.rate;this.ri=0}
 process(_,outputs){const out=outputs[0],o0=out[0],o1=out[1]||out[0],n=o0.length;
  if(!this.playing||!this.ch)return true;
  if(this.tape){const t=this.tape,L=this.ch[0],R=this.ch[1];for(let i=0;i<n;i++){if(t.r<=.011){o0[i]=o1[i]=0;continue}const p=this.wrap(t.p),k=Math.floor(p),f=p-k;
    o0[i]=this.at(L,k)*(1-f)+this.at(L,k+1)*f;o1[i]=this.at(R,k)*(1-f)+this.at(R,k+1)*f;t.p+=t.r;t.r=Math.max(.01,t.r-t.dr)}this.cur=t.p}
  else{for(let i=0;i<n;i++){if(this.ri>=this.HS){if(this.ended){this.finish();break}this.frame()}o0[i]=this.ready[0][this.ri];o1[i]=this.ready[1][this.ri];this.ri++}
   this.cur=this.wrap(this.fstart+this.ri*this.frate)}
  if(this.fade){for(let i=0;i<n;i++){const g=1-i/n;o0[i]*=g;o1[i]*=g}this.playing=false;this.fade=0}
  if(++this.q%16===0&&this.playing)this.port.postMessage({type:'pos',id:this.id,pos:this.cur/sampleRate,t:currentTime+n/sampleRate,off:(this.lastOff||0)/sampleRate,c:this.lastC||1});
  return true}
 finish(){this.playing=false;this.port.postMessage({type:'ended',id:this.id})}}
registerProcessor('mx-stretch',MxStretch);
