/** Ownership for explicit runtime proofs; cleanup also runs after assertions/handshake errors. */
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
export class ProofScope {
 cleanups=[];sockets=new Set();nonce=crypto.randomBytes(12).toString('hex');
 defer(work){this.cleanups.push(work);}
 socket(ws){this.sockets.add(ws);return ws;}
 ownPath(p){this.defer(()=>{try{fs.unlinkSync(p);}catch(e){if(e.code!=='ENOENT')throw e;}});return p;}
 file(dir,name){fs.mkdirSync(dir,{recursive:true});const p=path.join(dir,this.nonce+'-'+name);const fd=fs.openSync(p,'wx',0o600);fs.closeSync(fd);return this.ownPath(p);}
 symlink(target,dir){const p=path.join(dir,this.nonce+'-proof-escape');fs.symlinkSync(target,p);return this.ownPath(p);}
 async cleanup(){
  for(const ws of this.sockets){try{ws.terminate();}catch{}}
  const errors=[];for(const work of this.cleanups.reverse()){try{await work();}catch(e){errors.push(e);}}
  if(errors.length)throw new AggregateError(errors,'Owned proof cleanup failed');
 }
}
