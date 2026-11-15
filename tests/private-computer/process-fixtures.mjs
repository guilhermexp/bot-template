import fs from 'node:fs';import {spawn} from 'node:child_process';import crypto from 'node:crypto';
/** A detached test session, protected from the instant spawn returns. */
export async function withSession(command,args,work,options={}){
 const marker=crypto.randomBytes(16).toString('hex');const child=spawn(command,args,{detached:true,stdio:['ignore','pipe','ignore'],...options,env:{...process.env,...options.env,HQ_TEST_SESSION:marker}});
 try{return await work(child);}finally{
  for(let attempt=0;attempt<40;attempt++){
   let found=false;
   for(const entry of fs.readdirSync('/proc')){
    if(!/^\d+$/.test(entry))continue;
    try{const text=fs.readFileSync(`/proc/${entry}/stat`,'utf8');const fields=text.slice(text.lastIndexOf(')')+1).trim().split(/\s+/);if(fields[0]==='Z'||Number(fields[3])!==child.pid)continue;const vars=fs.readFileSync(`/proc/${entry}/environ`,'utf8').split('\0');if(!vars.includes('HQ_TEST_SESSION='+marker))continue;found=true;process.kill(Number(entry),'SIGKILL');}catch{}
   }
   if(!found)break;await new Promise(r=>setTimeout(r,25));
  }
  child.stdout?.destroy();child.stderr?.destroy();
 }
}
export function ready(child){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Fixture ready timeout')),3000);child.once('error',fail);child.stdout.once('data',b=>{clearTimeout(timer);resolve(b.toString().trim());});function fail(e){clearTimeout(timer);reject(e);}});}
