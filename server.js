// Optional Mixrrrr Live server: serves the app + a shared song-request queue so guests' phones
// on the same WiFi can send requests. Run: node server.js [port]   (no dependencies)
const http=require('http'),fs=require('fs'),path=require('path'),os=require('os');
const PORT=+process.argv[2]||8080,ROOT=__dirname;let requests=[],nextId=1;
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json','.webmanifest':'application/manifest+json','.wav':'audio/wav','.mp3':'audio/mpeg','.png':'image/png'};
http.createServer((req,res)=>{const u=new URL(req.url,'http://x');
 if(u.pathname.startsWith('/api/')){res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Methods','GET,POST,DELETE,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');if(req.method==='OPTIONS')return res.writeHead(204).end()}
 if(u.pathname==='/api/requests'){res.setHeader('Content-Type','application/json');
  if(req.method==='GET')return res.end(JSON.stringify(requests));
  if(req.method==='POST'){let b='';req.on('data',d=>{b+=d;if(b.length>1e4)req.destroy()});req.on('end',()=>{try{const j=JSON.parse(b);const t=String(j.title||'').slice(0,120).trim();if(!t)throw 0;
    const ex=requests.find(r=>r.title.toLowerCase()===t.toLowerCase());if(ex)ex.votes++;else requests.push({id:nextId++,title:t,by:String(j.by||'').slice(0,40),votes:1,t:Date.now()});res.end('{"ok":true}')}catch(e){res.statusCode=400;res.end('{"ok":false}')}});return}
  if(req.method==='DELETE'){const id=+u.searchParams.get('id');requests=id?requests.filter(r=>r.id!==id):[];return res.end('{"ok":true}')}}
 if(u.pathname==='/api/info'){res.setHeader('Content-Type','application/json');const ips=Object.values(os.networkInterfaces()).flat().filter(i=>i&&i.family==='IPv4'&&!i.internal).map(i=>i.address);return res.end(JSON.stringify({ips,port:PORT}))}
 let p=path.normalize(decodeURIComponent(u.pathname)).replace(/^([/\\])+/,'');if(!p)p='index.html';const f=path.join(ROOT,p);
 if(!f.startsWith(ROOT))return res.writeHead(403).end();fs.readFile(f,(e,d)=>{if(e)return res.writeHead(404).end('not found');if(path.extname(f)==='.html')d=Buffer.from(d.toString().replace('<head>','<head><meta name="mixrrrr-server" content="1">'));// lets the app know the request server is here
  res.writeHead(200,{'Content-Type':types[path.extname(f)]||'application/octet-stream'});res.end(d)})
}).listen(PORT,()=>{console.log('Mixrrrr Live on http://localhost:'+PORT);for(const i of Object.values(os.networkInterfaces()).flat())if(i&&i.family==='IPv4'&&!i.internal)console.log('  Guests: http://'+i.address+':'+PORT+'/request.html')});
