import {execFile} from 'node:child_process';
import {env} from './env.js';
import {Daytona,quote,ComputerError} from './daytona.js';
export {ComputerError};
export interface ComputerScreen {id:string;display:string;width:number;height:number;default:boolean;owner:string;wsPort:number;revision?:number}
export const daytona=new Daytona({baseUrl:env.daytonaUrl,key:env.daytonaKey,sandboxId:env.orgoComputerId});
export function displayFor(id?:string|null):string {
 if(!id||id==='default')return ':100';
 if(!/^screen-10[0-3]$/.test(id))throw new Error('Unknown app screen');
 return ':'+id.slice(7);
}
export function commandEnv(screen?:string|null):NodeJS.ProcessEnv {
 return {PATH:env.hqRoot+'/runtime/x11/usr/bin:'+process.env.PATH,LD_LIBRARY_PATH:env.hqRoot+'/runtime/x11/usr/lib/x86_64-linux-gnu',HOME:env.hqRoot+'/home',USER:process.env.USER,LANG:'C.UTF-8',HQ_ROOT:env.hqRoot,DISPLAY:displayFor(screen),XAUTHORITY:env.hqRoot+'/screens/'+displayFor(screen).slice(1)+'/Xauthority',XDG_CONFIG_HOME:env.hqRoot+'/home/.config',XDG_CACHE_HOME:env.hqRoot+'/home/.cache',XDG_DATA_HOME:env.hqRoot+'/home/.local/share'};
}
export async function execute(command:string,timeout=60,screen?:string|null):Promise<{output:string;exit_code:number}> {
 if(env.localBox)return new Promise(resolve=>execFile('bash',['-c',command],{env:commandEnv(screen),timeout:timeout*1000,maxBuffer:32*1024*1024},(e,out,err)=>resolve({output:`${out??''}${err??''}`,exit_code:e?(typeof (e as any).code==='number'?(e as any).code:1):0})));
 const prefix=Object.entries(commandEnv(screen)).filter(([k,v])=>v&&k!=='PATH'&&k!=='USER').map(([k,v])=>`${k}=${quote(v!)}`).join(' ');
 const r=await daytona.execute(`env PATH=${quote(env.hqRoot+'/runtime/x11/usr/bin')}:"$PATH" ${prefix} bash -c ${quote(command)}`,timeout);
 return {output:r.result??'',exit_code:r.exitCode??1};
}
async function helper(action:string,...args:string[]):Promise<any> {
 const r=await execute(`python3 ${quote(env.hqRoot+'/app/server/box/screen-registry.py')} ${[action,...args].map(quote).join(' ')}`,45);
 let data:any;try{data=JSON.parse(r.output);}catch{throw new Error('App screen helper unavailable; install private runtime');}
 if(r.exit_code||data.error)throw new Error(data.error??'App screen operation failed');return data;
}
const owned=(id:string)=>{if(id!==env.orgoComputerId)throw new Error('Only configured sandbox is allowed');};
export const computerProvider={
 getComputer:(id:string)=>daytona.getComputer(id),
 listScreens:async(id:string):Promise<ComputerScreen[]>=>{owned(id);return helper('list');},
 leaseScreen:async(id:string,owner:string,primary=false):Promise<ComputerScreen>=>{owned(id);return helper('lease',owner,primary?'primary':'managed');},
 getScreen:async(id:string,s:string):Promise<ComputerScreen>=>{owned(id);displayFor(s);return helper('get',s);},
 ensureScreen:async(id:string,s:string,owner?:string):Promise<ComputerScreen>=>{owned(id);displayFor(s);return helper('ensure',s,...(owner?[owner]:[]));},
 releaseScreen:async(id:string,owner:string)=>{owned(id);return helper('release',owner);},
 screenshot:async(id:string,s:string)=>{owned(id);displayFor(s);return helper('capture',s);},
};
