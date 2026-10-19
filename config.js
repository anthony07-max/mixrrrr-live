// Mixrrrr Live configuration. This file is committed to a public repo: put PUBLIC values only.
// (A Firebase web config is public by design; the data is protected by Realtime Database rules.)
window.MIXRRRR_CONFIG=Object.assign({
  // Song-request backend: 'auto' | 'local' | 'server' | 'firebase'
  //  auto     = use server.js only when the page is served by it, otherwise a local-only queue
  //  local    = queue lives in this browser only
  //  server   = always use a server.js at serverUrl (or the same origin)
  //  firebase = shared online queue (hook ready, wiring coming soon; falls back to local for now)
  requests:'auto',
  serverUrl:'',          // e.g. 'http://192.168.1.20:8080/' ('' = same origin)
  firebase:null,         // later: {apiKey:'…',authDomain:'…',databaseURL:'…',projectId:'…',appId:'…'}
  requestPageUrl:''      // optional public URL of request.html for the QR code
},window.MIXRRRR_CONFIG||{});
