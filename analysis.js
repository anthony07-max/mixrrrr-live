// Mixrrrr Live – track analysis: BPM, beat offset, Camelot key, energy, waveform peaks, smart entry point
const Analysis=(()=>{
function mono(buf,targetRate=11025){const step=Math.max(1,Math.floor(buf.sampleRate/targetRate));const n=Math.floor(buf.length/step);const out=new Float32Array(n);
 const chs=[];for(let c=0;c<buf.numberOfChannels;c++)chs.push(buf.getChannelData(c));
 for(let i=0;i<n;i++){let s=0;const j=i*step;for(const ch of chs)s+=ch[j];out[i]=s/chs.length}return{data:out,rate:buf.sampleRate/step}}
function peaks(buf,n=1600){const d=buf.getChannelData(0),d2=buf.numberOfChannels>1?buf.getChannelData(1):d;const bs=Math.max(1,Math.floor(d.length/n));const p=new Float32Array(n);
 for(let i=0;i<n;i++){let m=0;const s=i*bs,e=Math.min(d.length,s+bs);for(let j=s;j<e;j+=4){const v=Math.abs(d[j])+Math.abs(d2[j]);if(v>m)m=v}p[i]=m/2}return p}
function bpm(m){const{data,rate}=m;const hop=Math.round(rate/100);// 100 frames/sec
 const nF=Math.floor(data.length/hop);const env=new Float32Array(nF);let lp=0;
 for(let i=0;i<nF;i++){let s=0;for(let j=0;j<hop;j++){lp+=0.15*(data[i*hop+j]-lp);s+=lp*lp}env[i]=Math.sqrt(s/hop)}
 const on=new Float32Array(nF);for(let i=1;i<nF;i++)on[i]=Math.max(0,env[i]-env[i-1]);
 const fps=100;const maxF=Math.min(nF,fps*90);let best=0,bestLag=50;
 const scores=[];for(let lag=Math.floor(fps*60/190);lag<=Math.ceil(fps*60/70);lag++){let s=0;for(let i=0;i+lag<maxF;i++)s+=on[i]*on[i+lag];
  const b=60*fps/lag;const w=Math.exp(-Math.pow(Math.log2(b/122),2)/0.5);scores.push([lag,s*w]);if(s*w>best){best=s*w;bestLag=lag}}
 // refine with parabolic interpolation
 const idx=scores.findIndex(x=>x[0]===bestLag);let lag=bestLag;if(idx>0&&idx<scores.length-1){const a=scores[idx-1][1],b=scores[idx][1],c=scores[idx+1][1];const d=(a-2*b+c);if(d)lag+=0.5*(a-c)/d}
 let tempo=60*fps/lag;while(tempo<75)tempo*=2;while(tempo>175)tempo/=2;tempo=Math.round(tempo*10)/10;
 // beat phase
 const per=fps*60/tempo;let bp=0,bv=-1;for(let ph=0;ph<per;ph++){let s=0;for(let k=ph;k<maxF;k+=per)s+=on[Math.round(k)]||0;if(s>bv){bv=s;bp=ph}}
 return{bpm:tempo,offset:bp/fps,env,fps}}
const MAJ=[6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88],MIN=[6.33,2.68,3.52,5.38,2.6,3.53,2.54,4.75,3.98,2.69,3.34,3.17];
const NAMES=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const CAM_MAJ=[8,3,10,5,12,7,2,9,4,11,6,1],CAM_MIN=[5,12,7,2,9,4,11,6,1,8,3,10];
function key(m){const{data,rate}=m;const chroma=new Float64Array(12);const N=2048;const frames=60;const span=data.length-N;if(span<=0)return{camelot:'?',name:'?'};
 const freqs=[];for(let oct=3;oct<=5;oct++)for(let pc=0;pc<12;pc++)freqs.push([pc,440*Math.pow(2,(oct-4)+(pc-9)/12)]);
 for(let f=0;f<frames;f++){const st=Math.floor(span*(0.1+0.8*f/frames));
  for(const[pc,fr]of freqs){if(fr>rate/2.2)continue;const w=2*Math.PI*fr/rate,co=2*Math.cos(w);let s1=0,s2=0;
   for(let i=0;i<N;i++){const s0=data[st+i]*(0.5-0.5*Math.cos(2*Math.PI*i/N))+co*s1-s2;s2=s1;s1=s0}chroma[pc]+=Math.sqrt(Math.max(0,s1*s1+s2*s2-co*s1*s2))}}
 const corr=(a,b)=>{const ma=a.reduce((x,y)=>x+y)/12,mb=b.reduce((x,y)=>x+y)/12;let n=0,da=0,db=0;for(let i=0;i<12;i++){n+=(a[i]-ma)*(b[i]-mb);da+=(a[i]-ma)**2;db+=(b[i]-mb)**2}return n/Math.sqrt(da*db||1)};
 let best=-2,res=null;for(let r=0;r<12;r++){const rot=Array.from({length:12},(_,i)=>chroma[(i+r)%12]);
  const cM=corr(rot,MAJ),cm=corr(rot,MIN);if(cM>best){best=cM;res={camelot:CAM_MAJ[r]+'B',name:NAMES[r]+' Major'}}if(cm>best){best=cm;res={camelot:CAM_MIN[r]+'A',name:NAMES[r]+' Minor'}}}
 return res}
function camelotCompat(a,b){if(!a||!b||a==='?'||b==='?')return 0.5;const na=parseInt(a),nb=parseInt(b),la=a.slice(-1),lb=b.slice(-1);
 if(a===b)return 1;const d=Math.min((na-nb+12)%12,(nb-na+12)%12);if(la===lb&&d===1)return 0.9;if(na===nb)return 0.8;if(la===lb&&d===2)return 0.5;return 0.15}
function entryPoint(env,fps,bpm,offset,dur){// first phrase (8 bars) boundary after the intro where energy reaches 75% of track mean
 const mean=env.reduce((a,b)=>a+b,0)/env.length;const bar=4*60/bpm,phrase=bar*8;
 for(let t=offset+phrase;t<dur*0.5;t+=phrase){const i=Math.floor(t*fps);let s=0,n=0;for(let k=i;k<i+fps*4&&k<env.length;k++){s+=env[k];n++}if(n&&s/n>mean*0.75)return t}
 return offset}
async function analyze(buf){const m=mono(buf);const b=bpm(m);await new Promise(r=>setTimeout(r));const k=key(m);
 const mean=b.env.reduce((a,c)=>a+c,0)/b.env.length;// energy 0..1 combining loudness & tempo
 const energy=Math.max(0,Math.min(1,(mean*6)*0.6+((b.bpm-80)/90)*0.4));
 return{bpm:b.bpm,offset:b.offset,key:k.camelot,keyName:k.name,energy,entry:entryPoint(b.env,b.fps,b.bpm,b.offset,buf.duration),peaks:peaks(buf)}}
return{analyze,camelotCompat,peaks}})();
