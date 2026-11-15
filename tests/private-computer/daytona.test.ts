import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Daytona } from '../../server/src/daytona.js';

test('existing sandbox only: status/exec/files, no lifecycle, no SaaS and sanitized errors', async () => {
  const seen: string[] = [];
  const server = http.createServer(async (req, res) => {
    seen.push(`${req.method} ${req.url}`);
    assert.equal(req.headers.authorization, 'Bearer fixture-secret');
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c);
    if (req.url?.endsWith('/execute')) {
      const b = JSON.parse(Buffer.concat(chunks).toString());
      assert.equal(b.command, "bash -lc 'printf hello'");
      res.end(JSON.stringify({exitCode: 7, result: 'hello'}));
    } else if (req.url?.includes('upload')) {
      assert.match(req.headers['content-type']!, /multipart/); assert.match(Buffer.concat(chunks).toString(), /fixture-file/); res.end('{}');
    } else if (req.url?.includes('download')) res.end('fixture-file');
    else if (req.url?.endsWith('/missing')) {res.writeHead(403); res.end('{"error":"fixture-secret signed-preview response-sensitive"}');}
    else { res.end(JSON.stringify({id:'existing',state:'started'})); }
  });
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const api = new Daytona({baseUrl:`http://127.0.0.1:${(server.address() as any).port}/api`, key:'fixture-secret', sandboxId:'existing', allowHttpLoopback:true});
  try {
    assert.equal((await api.getComputer('existing')).status,'running');
    assert.deepEqual(await api.execute('printf hello'),{exitCode:7,result:'hello'});
    await api.upload('/tmp/fixture','fixture-file');
    assert.equal((await api.download('/tmp/fixture')).toString(),'fixture-file');
    await assert.rejects(api.request('GET','/missing'), e=> {assert.doesNotMatch(String(e), /fixture-secret|signed-preview|response-sensitive/);return true;});
    await assert.rejects(api.getComputer('other'),/configured sandbox/);
    assert.deepEqual(Object.getOwnPropertyNames(Daytona.prototype).filter(k=>/^(start|stop|resume|suspend|delete|create)$/.test(k)),[]);
    assert.ok(seen.every(p=>!p.includes('orgo')));
  } finally {server.closeAllConnections();server.close();}
});

test('timeout is explicit and mutations are never blindly retried',async()=>{
 let n=0; const server=http.createServer((req,res)=>{if(req.url==='/api/warmup'){res.end('{}');return;}n++;setTimeout(()=>res.end('{}'),1000).unref();});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 try {
  const api=new Daytona({baseUrl:`http://127.0.0.1:${(server.address() as any).port}/api`,key:'secret',sandboxId:'existing',allowHttpLoopback:true,timeoutMs:200});
  await api.request('GET','/warmup',undefined,false,2000); // establish transport before measuring mutation timeout
  await assert.rejects(api.execute('true'),/timeout.*reconcile/i); assert.equal(n,1);
 }finally{server.closeAllConnections();server.close();}
});

test('configuration refuses insecure or credential-bearing endpoints',()=>{
 for(const baseUrl of ['http://remote/api','https://user:secret@example.org/api','https://example.org/api?token=secret']) assert.throws(()=>new Daytona({baseUrl,key:'secret',sandboxId:'x'}),/DAYTONA_API_URL/);
});
