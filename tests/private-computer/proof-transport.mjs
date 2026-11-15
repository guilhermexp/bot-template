/** Bounded transports for explicit proofs. Errors must reject into the caller's finally. */
export function expectRejectedUpgrade(create,expected=401,timeoutMs=10000){
 return new Promise((resolve,reject)=>{
  let settled=false;const ws=create();const timer=setTimeout(()=>finish(Error('Relay rejection timeout')),timeoutMs);
  function finish(error){if(settled)return;settled=true;clearTimeout(timer);try{ws.terminate();}catch{};if(error)reject(error);else resolve();}
  ws.on('open',()=>finish(Error('Unauthorized relay opened')));
  ws.on('unexpected-response',(_req,response)=>{let error;try{if(response.statusCode!==expected)throw Error('Unexpected relay HTTP '+response.statusCode);}catch(e){error=e;}finally{response.resume();}finish(error);});
  ws.on('error',()=>finish(Error('Relay transport failed before rejection')));
  ws.on('close',()=>finish(Error('Relay closed before HTTP rejection')));
 });
}
export function waitForOpen(ws,timeoutMs=8000){return new Promise((resolve,reject)=>{if(ws.readyState===1)return resolve();const timer=setTimeout(()=>done(Error('Socket open timeout')),timeoutMs);const done=error=>{if(error)ws.once('error',()=>{});clearTimeout(timer);ws.off('open',open);ws.off('error',fail);ws.off('close',fail);if(error)reject(error);else resolve();};const open=()=>done();const fail=()=>done(Error('Socket closed before open'));ws.once('open',open);ws.once('error',fail);ws.once('close',fail);});}
export function cdpClient(ws,{timeoutMs=8000,onEvent=()=>{}}={}){
 let id=0,closed=null;const pending=new Map();
 function fail(){closed=Error('CDP transport disconnected');for(const p of pending.values()){clearTimeout(p.timer);p.reject(closed);}pending.clear();}
 ws.on('close',fail);ws.on('error',fail);
 ws.on('message',raw=>{let data;try{data=JSON.parse(String(raw));}catch{fail();return;}if(data.id){const p=pending.get(data.id);if(!p)return;pending.delete(data.id);clearTimeout(p.timer);if(data.error)p.reject(Error('CDP method failed: '+p.method));else p.resolve(data.result);}else{try{onEvent(data);}catch{fail();}}});
 return {pendingCount:()=>pending.size,call(method,params={}){return new Promise((resolve,reject)=>{if(closed||ws.readyState!==1){reject(closed??Error('CDP transport unavailable'));return;}const n=++id;const timer=setTimeout(()=>{pending.delete(n);reject(Error('CDP command timeout: '+method));},timeoutMs);pending.set(n,{resolve,reject,timer,method});try{ws.send(JSON.stringify({id:n,method,params}));}catch{pending.delete(n);clearTimeout(timer);reject(Error('CDP send failed'));}});}};
}

export function expectRfbGreeting(ws,timeoutMs=5000){
 return new Promise((resolve,reject)=>{
  let settled=false;const timer=setTimeout(()=>finish(Error('RFB greeting timeout')),timeoutMs);
  function finish(error){if(settled)return;settled=true;clearTimeout(timer);try{ws.terminate();}catch{};if(error)reject(error);else resolve();}
  let greeting=Buffer.alloc(0);
  ws.on('message',data=>{if(settled)return;try{greeting=Buffer.concat([greeting,Buffer.from(data).subarray(0,12-greeting.length)]);if(greeting.length<12)return;if(!/^RFB 003\.(003|007|008)\n$/.test(greeting.toString()))throw Error('Invalid RFB greeting');finish();}catch(error){finish(error);}});
  ws.once('error',()=>finish(Error('RFB greeting transport failed')));ws.once('close',()=>finish(Error('RFB greeting closed')));
 });
}
