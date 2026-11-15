import fs from 'node:fs';
export interface ProcessIdentity {pid:number;starttime:string;command:string[];bootId?:string;uid?:number;sessionId?:number}
/** comm may contain spaces and closing parentheses; only the final ')' ends it. */
function processStat(pid:number):string[] {
 const text=fs.readFileSync(`/proc/${pid}/stat`,'utf8');
 const end=text.lastIndexOf(')');
 if(end<0)throw new Error('Invalid process stat');
 return text.slice(end+1).trim().split(/\s+/);
}
export function processIdentity(pid:number):ProcessIdentity|null {
 if(!Number.isInteger(pid)||pid<=1)return null;
 try{const stat=processStat(pid);if(stat[0]==='Z')return null;return {pid,starttime:stat[19],bootId:fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim(),uid:fs.statSync(`/proc/${pid}`).uid,sessionId:Number(stat[3]),command:fs.readFileSync(`/proc/${pid}/cmdline`,'utf8').split('\0').filter(Boolean)};}catch{return null;}
}
export function sameProcess(rec:ProcessIdentity):boolean {const current=processIdentity(rec.pid);return !!current&&current.starttime===rec.starttime&&JSON.stringify(current.command)===JSON.stringify(rec.command);}

/** Stable authority for a receipt created during this kernel/process lifetime; argv is provenance. */
export function sameLifetime(rec:ProcessIdentity):boolean {
 const current=processIdentity(rec.pid);
 if(!current||current.starttime!==rec.starttime)return false;
 if(!rec.bootId||rec.uid===undefined)return sameProcess(rec); // legacy receipts require explicit reconciliation
 return current.bootId===rec.bootId&&current.uid===rec.uid;
}

/** Recover only a previously attested detached session on this boot and UID. */
export function ownedSessionMembers(rec:ProcessIdentity):ProcessIdentity[] {
 if(rec.sessionId!==rec.pid||rec.uid!==process.getuid?.()||rec.bootId!==fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim())return [];
 if(processIdentity(rec.pid)&&!sameLifetime(rec))throw new Error('Gateway leader PID reused; refusing session recovery');
 const members:ProcessIdentity[]=[];
 for(const entry of fs.readdirSync('/proc')){const pid=Number(entry);if(!Number.isInteger(pid)||pid<=1)continue;const current=processIdentity(pid);if(current&&current.sessionId===rec.pid&&current.uid===rec.uid&&BigInt(current.starttime)>=BigInt(rec.starttime))members.push(current);}
 return members;
}

/** Stop an owned detached session, retaining identities of workers after its leader exits. */
export async function stopOwnedGroup(rec:ProcessIdentity,graceMs=10_000):Promise<void> {
 const leader=processIdentity(rec.pid);
 if(leader?!sameLifetime(rec):!(rec.bootId===fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim()&&rec.uid===process.getuid?.()&&rec.sessionId===rec.pid))throw new Error('Gateway identity changed; refusing shutdown');
 const group=(pid:number)=>{try{const s=processStat(pid);return Number(s[3])===rec.pid;}catch{return false;}};
 if(leader&&!group(rec.pid))throw new Error('Gateway is not its own detached session');
 const members=new Map<number,ProcessIdentity>();
 const scan=()=>{if(processIdentity(rec.pid)&&!sameLifetime(rec))throw new Error('Gateway leader PID reused; refusing group cleanup');for(const entry of fs.readdirSync('/proc')){const pid=Number(entry);if(Number.isInteger(pid)&&pid>1&&group(pid)){const current=processIdentity(pid);if(current&&current.uid===rec.uid&&BigInt(current.starttime)>=BigInt(rec.starttime))members.set(pid,current);}}};
 scan();
 if(leader&&!sameLifetime(rec))throw new Error('Gateway identity changed; refusing shutdown');
 try{if(leader)process.kill(-rec.pid,'SIGTERM');for(const member of members.values())if(sameLifetime(member)&&group(member.pid))process.kill(member.pid,'SIGTERM');}catch(e:any){if(e.code!=='ESRCH')throw e;}
 const end=Date.now()+graceMs;
 const live=()=>[...members.values()].filter(p=>sameLifetime(p)&&group(p.pid));
 while(Date.now()<end){scan();if(!live().length)break;await new Promise(r=>setTimeout(r,25));}
 scan();
 for(const member of live())if(sameLifetime(member)&&group(member.pid)){try{process.kill(member.pid,'SIGKILL');}catch(e:any){if(e.code!=='ESRCH')throw e;}}
 for(let i=0;i<40;i++){scan();if(!live().length)break;for(const member of live())if(sameLifetime(member)&&group(member.pid)){try{process.kill(member.pid,'SIGKILL');}catch(e:any){if(e.code!=='ESRCH')throw e;}}await new Promise(r=>setTimeout(r,25));}
 scan();
 if(live().length)throw new Error('Owned gateway workers remain; retaining home');
}
