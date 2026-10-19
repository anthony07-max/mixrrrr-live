// Mixrrrr Live – key-lock (master tempo) engine. Original MIT-licensed code, no dependencies.
// AudioWorklet that plays a deck's decoded track through a phase vocoder with identity phase
// locking and transient phase resets, so tempo changes don't change pitch. Timing is
// deterministic: the worklet follows the main thread's position timeline (pos at AudioContext
// time `at`, advancing at `rate`) and posts back the source position it is actually rendering.
// Also handles loops and a varispeed tape-stop.
'use strict';
class FFT{constructor(n){this.n=n;const bits=Math.round(Math.log2(n));this.rev=new Uint32Array(n);
  for(let i=0;i<n;i++){let r=0,x=i;for(let b=0;b<bits;b++){r=(r<<1)|(x&1);x>>=1}this.rev[i]=r}
  this.c=new Float64Array(n/2);this.s=new Float64Array(n/2);for(let i=0;i<n/2;i++){this.c[i]=Math.cos(2*Math.PI*i/n);this.s[i]=-Math.sin(2*Math.PI*i/n)}}
 run(re,im,inv){const n=this.n,rev=this.rev,C=this.c,S=this.s;
  for(let i=0;i<n;i++){const j=rev[i];if(j>i){let t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t}}
  for(let size=2;size<=n;size<<=1){const half=size>>1,step=n/size;
   for(let i=0;i<n;i+=size)for(let j=0,k=0;j<half;j++,k+=step){const wr=C[k],wi=inv?-S[k]:S[k],a=i+j,b=a+half;
    const tr=re[b]*wr-im[b]*wi,ti=re[b]*wi+im[b]*wr;re[b]=re[a]-tr;im[b]=im[a]-ti;re[a]+=tr;im[a]+=ti}}}}
class MxStretch extends AudioWorkletProcessor{
 constructor(){super();const sr=sampleRate;
  const N=this.N=sr>60000?4096:2048,H=this.H=N/4,half=this.half=N/2,B=half+1;this.fft=new FFT(N);
  this.win=new Float64Array(N);for(let i=0;i<N;i++)this.win[i]=0.5-0.5*Math.cos(2*Math.PI*i/N);
  this.scale=1/(1.5*N);// Hann^2 at 75% overlap sums to 1.5; 1/N for the inverse FFT
  this.r1=new Float64Array(N);this.i1=new Float64Array(N);this.r2=new Float64Array(N);this.i2=new Float64Array(N);
  this.mag=new Float64Array(B);this.prevMag=new Float64Array(B);this.Sr=new Float64Array(B);this.Si=new Float64Array(B);this.peakOf=new Int32Array(B);
  this.acc=[new Float32Array(N),new Float32Array(N)];this.ready=[new Float32Array(H),new Float32Array(H)];
  this.ch=null;this.mono=null;this.len=0;this.playing=false;this.id=0;this.seq=0;this.rate=1;this.loop=null;this.tape=null;this.fade=0;this.q=0;this.resets=0;
  this.port.onmessage=e=>this.msg(e.data)}
 msg(m){
  if(m.type==='load'){const ch=m.ch;this.ch=[ch[0],ch[1]||ch[0]];this.len=ch[0].length;const mo=new Float32Array(this.len),L=this.ch[0],R=this.ch[1];for(let i=0;i<this.len;i++)mo[i]=(L[i]+R[i])*.5;this.mono=mo;this.playing=false;return}
  if(m.type==='play'){if(!this.ch)return;this.id=m.id;this.tape=null;this.fade=0;this.ended=false;this.state(m);this.started=false;this.playing=true;return}
  if(m.id!==this.id)return;
  if(m.type==='state')this.state(m);
  else if(m.type==='stop'){if(this.playing)this.fade=1}
  else if(m.type==='tape'){if(this.playing&&!this.tape){const r=this.rate,n=m.dur*sampleRate;this.tape={p:this.P(currentFrame),r,dr:(r-.01)/n}}}}
 // timeline anchor from the main thread: source position `pos` (s) at AudioContext time `at` (s), moving at `rate`
 state(m){const sr=sampleRate;this.aPos=m.pos*sr;this.aT=m.at*sr;this.rate=m.rate;this.seq=m.seq;this.loop=m.loop?{s:m.loop.s*sr,e:m.loop.e*sr}:null;this.wrapOn=!!(this.loop&&this.aPos<=this.loop.e+0.01*sr)}
 wrap(i){const l=this.loop;if(this.wrapOn&&i>=l.e){const L=l.e-l.s;if(L>1)i=l.s+((i-l.s)%L)}return i}
 P(t){return this.wrap(this.aPos+(t-this.aT)*this.rate)}// source position (samples) for context frame t
 at(a,i){i=this.wrap(i)|0;return i>=0&&i<this.len?a[i]:0}
 // one vocoder frame: window centred on the source position for the window centre's output time; adds into acc
 frame(base,reset){const N=this.N,H=this.H,half=this.half,w=this.win,r1=this.r1,i1=this.i1,r2=this.r2,i2=this.i2,L=this.ch[0],R=this.ch[1],M=this.mono;
  const c=Math.floor(this.P(base+half)),st=c-half;this.lastC=c;
  const fast=!this.wrapOn&&st-H>=0&&st+N<this.len;
  for(let i=0;i<N;i++){const k=st+i,wi=w[i];if(fast){r1[i]=L[k]*wi;i1[i]=R[k]*wi;r2[i]=M[k]*wi;i2[i]=M[k-H]*wi}else{r1[i]=this.at(L,k)*wi;i1[i]=this.at(R,k)*wi;r2[i]=this.at(M,k)*wi;i2[i]=(k-H>=0?this.at(M,k-H):0)*wi}}
  this.fft.run(r1,i1,false);this.fft.run(r2,i2,false);
  const mag=this.mag,pm=this.prevMag,Sr=this.Sr,Si=this.Si;let flux=0,tot=1e-9;
  // mid spectra: Mc (at c) and Mp (at c-H) unpacked from one complex FFT
  for(let k=0;k<=half;k++){const nk=(N-k)%N;const mr=(r2[k]+r2[nk])*.5,mi=(i2[k]-i2[nk])*.5;const m2=Math.hypot(mr,mi);mag[k]=m2;const d=m2-pm[k];if(d>0)flux+=d;tot+=m2}
  if(!reset&&flux/tot>0.45&&tot>1e-3*N)reset=true;// transient: re-sync phases so drums stay sharp
  if(reset)this.resets++;
  // peaks (local maxima over ±2 bins) and nearest-peak regions for identity phase locking
  const po=this.peakOf;let last=-1,peaks=0;
  for(let k=0;k<=half;k++){const v=mag[k];const isP=v>1e-9&&(k<1||v>mag[k-1])&&(k<2||v>=mag[k-2])&&(k>half-1||v>=mag[k+1])&&(k>half-2||v>=mag[k+2]);
   if(isP){if(last<0){for(let j=0;j<k;j++)po[j]=k}else{const mid=(last+k)>>1;for(let j=last+1;j<=k;j++)po[j]=j<=mid?last:k}po[k]=k;last=k;peaks++}}
  if(last<0)for(let k=0;k<=half;k++)po[k]=0;else for(let j=last+1;j<=half;j++)po[j]=last;
  // rotation per peak: new synth phase = previous synth phase + measured advance over exactly H samples
  for(let k=0;k<=half;k++){if(po[k]!==k)continue;const nk=(N-k)%N;
   const cr=(r2[k]+r2[nk])*.5,ci=(i2[k]-i2[nk])*.5,pr=(i2[k]+i2[nk])*.5,pi=-(r2[k]-r2[nk])*.5;// Mc, Mp
   const cm=Math.hypot(cr,ci)||1;let xr,xi;
   if(reset||k===0||k===half){xr=1;xi=0}else{const dr=cr*pr+ci*pi,di=ci*pr-cr*pi,dm=Math.hypot(dr,di);let ur=1,ui=0;if(dm>1e-12){ur=dr/dm;ui=di/dm}
    const sr=Sr[k]*ur-Si[k]*ui,si=Sr[k]*ui+Si[k]*ur;xr=sr*cr/cm+si*ci/cm;xi=si*cr/cm-sr*ci/cm;const xm=Math.hypot(xr,xi)||1;xr/=xm;xi/=xm}
   this._tr=this._tr||new Float64Array(half+1);this._ti=this._ti||new Float64Array(half+1);this._tr[k]=xr;this._ti[k]=xi}
  const tr=this._tr,ti=this._ti;
  // apply rotations to L/R (unpacked from r1/i1), track synth phases, repack as YL + i*YR for one inverse FFT
  for(let k=0;k<=half;k++){const nk=(N-k)%N;const p=po[k];const xr=tr[p],xi=ti[p];
   const ar=(r1[k]+r1[nk])*.5,ai=(i1[k]-i1[nk])*.5,br=(i1[k]+i1[nk])*.5,bi=-(r1[k]-r1[nk])*.5;// XL, XR
   const cr=(r2[k]+r2[nk])*.5,ci=(i2[k]-i2[nk])*.5,cm=mag[k];
   if(cm>1e-12){const ur=cr/cm,ui=ci/cm;Sr[k]=ur*xr-ui*xi;Si[k]=ur*xi+ui*xr}else{Sr[k]=xr;Si[k]=xi}
   let yLr=ar*xr-ai*xi,yLi=ar*xi+ai*xr,yRr=br*xr-bi*xi,yRi=br*xi+bi*xr;if(k===0||k===half){yLi=0;yRi=0}
   pm[k]=cm;this._yl=this._yl||[new Float64Array(half+1),new Float64Array(half+1),new Float64Array(half+1),new Float64Array(half+1)];const Y=this._yl;Y[0][k]=yLr;Y[1][k]=yLi;Y[2][k]=yRr;Y[3][k]=yRi}
  const Y=this._yl;
  for(let k=0;k<=half;k++){const a=Y[0][k],b=Y[1][k],cc=Y[2][k],d=Y[3][k];r1[k]=a-d;i1[k]=b+cc;if(k>0&&k<half){r1[N-k]=a+d;i1[N-k]=cc-b}}
  this.fft.run(r1,i1,true);
  const A0=this.acc[0],A1=this.acc[1],sc=this.scale;for(let i=0;i<N;i++){const g=w[i]*sc;A0[i]+=r1[i]*g;A1[i]+=i1[i]*g}}
 emit(base){const H=this.H,A0=this.acc[0],A1=this.acc[1];this.ready[0].set(A0.subarray(0,H));this.ready[1].set(A1.subarray(0,H));A0.copyWithin(0,H);A1.copyWithin(0,H);A0.fill(0,this.N-H);A1.fill(0,this.N-H);
  this.blockBase=base;this.blockPos=this.lastC-this.half*this.rate;this.blockRate=this.rate;this.ri=0}
 start(t0){// pre-roll three frames so the first emitted block is fully overlapped
  this.acc[0].fill(0);this.acc[1].fill(0);const H=this.H;for(let j=3;j>=1;j--){this.frame(t0-j*H,j===3);this.emit(t0-j*H)}this.next=t0;this.ri=H;this.started=true}
 process(_,outputs){const out=outputs[0],o0=out[0],o1=out[1]||out[0],n=o0.length;
  if(!this.playing||!this.ch)return true;
  if(this.tape){const t=this.tape,L=this.ch[0],R=this.ch[1];for(let i=0;i<n;i++){if(t.r<=.011){o0[i]=o1[i]=0;continue}const p=this.wrap(t.p),k=Math.floor(p),f=p-k;
    o0[i]=this.at(L,k)*(1-f)+this.at(L,k+1)*f;o1[i]=this.at(R,k)*(1-f)+this.at(R,k+1)*f;t.p+=t.r;t.r=Math.max(.01,t.r-t.dr)}this.cur=t.p}
  else{if(!this.started)this.start(currentFrame);
   for(let i=0;i<n;i++){if(this.ri>=this.H){if(this.ended){this.finish();break}const base=this.next;
     if(!this.wrapOn&&this.P(base)>=this.len)this.ended=true;else this.frame(base,false);this.emit(base);this.next+=this.H}
    o0[i]=this.ready[0][this.ri];o1[i]=this.ready[1][this.ri];this.ri++}
   this.cur=this.wrap(this.blockPos+this.ri*this.blockRate)}
  if(this.fade){for(let i=0;i<n;i++){const g=1-i/n;o0[i]*=g;o1[i]*=g}this.playing=false;this.fade=0}
  if(++this.q%4===0&&this.playing)this.port.postMessage({type:'pos',id:this.id,seq:this.seq,pos:this.cur/sampleRate,t:(currentFrame+n)/sampleRate});
  return true}
 finish(){this.playing=false;this.port.postMessage({type:'ended',id:this.id})}}
registerProcessor('mx-stretch',MxStretch);
