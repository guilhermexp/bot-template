import crypto from 'node:crypto';import fs from 'node:fs';import path from 'node:path';
import {processIdentity,sameLifetime,ownedSessionMembers,type ProcessIdentity} from './process-owner.js';
/** Reconcile only a dedicated home's receipt/PID, never scan unrelated process environments. */
export function gatewayIdentity(home:string,binary:string):ProcessIdentity|null {
 if(!fs.existsSync(home))return null;
 home=fs.realpathSync(home);const receipt=path.join(home,'hq-process.json');
 if(fs.existsSync(receipt)){
  const old=JSON.parse(fs.readFileSync(receipt,'utf8')) as ProcessIdentity&{home:string};
  if(fs.realpathSync(old.home)!==home)throw new Error('Gateway identity belongs to another home; migration required');
  const current=processIdentity(old.pid);
  if(current){
   if(!sameLifetime(old))throw new Error('Gateway identity changed; migration required before cleanup');
   if(!old.bootId||old.sessionId===undefined||old.uid===undefined)persist(current);
   return current;
  }
  if(ownedSessionMembers(old).length)return old;
  // A legacy receipt cannot authorize signals after leader death; never discard a surviving session.
  if(old.sessionId===undefined&&fs.readdirSync('/proc').some(pid=>processIdentity(Number(pid))?.sessionId===old.pid))throw new Error('Gateway session receipt requires migration; retaining home');
 }
 const file=path.join(home,'gateway.pid');if(!fs.existsSync(file))return null;
 let raw:any;try{raw=JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw new Error('Gateway PID receipt invalid; migration required');}
 const pid=Number(typeof raw==='object'?raw?.pid:raw);if(!Number.isInteger(pid)||pid<=1)throw new Error('Gateway PID receipt invalid; migration required');const current=processIdentity(pid);if(!current)return null;
 if((raw?.hermes_home&&fs.realpathSync(raw.hermes_home)!==home)||current.uid!==process.getuid?.())throw new Error('Gateway identity not verified; retain home and reconcile migration');
 const executable=binary.includes(path.sep)?binary:(process.env.PATH??'/usr/bin:/bin').split(path.delimiter).map(dir=>path.join(dir,binary)).find(candidate=>fs.existsSync(candidate));
 if(!executable)throw new Error('Configured gateway CLI unavailable; migration required');
 const expected=fs.realpathSync(executable);
 const cli=current.command.some(arg=>{try{return fs.realpathSync(arg)===expected;}catch{return false;}});
 const stat=fs.readFileSync(`/proc/${pid}/stat`,'utf8');const fields=stat.slice(stat.lastIndexOf(')')+1).trim().split(/\s+/);
 if(!cli||!current.command.includes('gateway')||!current.command.includes('run')||!current.command.includes('--no-supervise')||Number(fields[2])!==pid||Number(fields[3])!==pid||fs.realpathSync(`/proc/${pid}/cwd`)!==home)throw new Error('Gateway identity not verified; retain home and reconcile migration');
 // Only after CLI, uid, cwd and detached session match this owned home do we read its environment.
 const vars=fs.readFileSync(`/proc/${pid}/environ`,'utf8').split('\0');
 const statedHome=vars.find(value=>value.startsWith('HERMES_HOME='))?.slice('HERMES_HOME='.length);
 if(!statedHome||fs.realpathSync(statedHome)!==home)throw new Error('Gateway home identity not verified; migration required');
 persist(current);return current;
 function persist(rec:ProcessIdentity){const tmp=receipt+'.'+crypto.randomUUID();try{fs.writeFileSync(tmp,JSON.stringify({...rec,home}),{mode:0o600,flag:'wx'});fs.renameSync(tmp,receipt);}finally{fs.rmSync(tmp,{force:true});}}
}
