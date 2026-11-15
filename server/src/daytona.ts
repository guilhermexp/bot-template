/** Backend-only REST client. Never logs URLs, headers, response bodies or credentials. */
export interface DaytonaConfig { baseUrl: string; key: string; sandboxId: string; timeoutMs?: number; allowHttpLoopback?: boolean }
export class ComputerError extends Error {
  constructor(public status: number, message: string) {super(message);}
}
export const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
export class Daytona {
 private base: string;
 constructor(private config: DaytonaConfig) {
  let u: URL; try {u = new URL(config.baseUrl);} catch {throw new Error('Invalid DAYTONA_API_URL');}
  if ((u.protocol !== 'https:' && !(config.allowHttpLoopback && u.protocol === 'http:' && ['127.0.0.1','localhost'].includes(u.hostname))) || u.username || u.password || u.search || u.hash) throw new Error('Invalid DAYTONA_API_URL: HTTPS required');
  if (!config.key || !config.sandboxId) throw new Error('Missing DAYTONA_API_KEY or DAYTONA_SANDBOX_ID');
  this.base=u.href.replace(/\/+$/,''); if(!this.base.endsWith('/api')) this.base+='/api';
 }
 async request(method:string,path:string,body?:unknown,raw=false,timeoutMs=this.config.timeoutMs ?? 120_000):Promise<any> {
  try {
   const multipart=body instanceof FormData;
   const r=await fetch(this.base+path,{method,headers:{Authorization:`Bearer ${this.config.key}`,...(body!==undefined&&!multipart?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:multipart?body:JSON.stringify(body),signal:AbortSignal.timeout(timeoutMs),redirect:'error'});
   if(!r.ok) throw new ComputerError(r.status,`Computer request failed (HTTP ${r.status}); check private configuration and sandbox availability.`);
   if(raw) return Buffer.from(await r.arrayBuffer());
   const text=await r.text(); return text?JSON.parse(text):{};
  } catch(e) {
   if(e instanceof ComputerError) throw e;
   if((e as Error).name==='TimeoutError'||(e as Error).name==='AbortError') throw new ComputerError(504,`Computer timeout; reconcile ${method==='GET'?'availability':'operation state before retrying the mutation'}.`);
   throw new ComputerError(502,'Computer transport or response unavailable; check private backend configuration.');
  }
 }
 private sandbox(id=this.config.sandboxId) {if(id!==this.config.sandboxId) throw new Error('Only the configured sandbox is allowed');return encodeURIComponent(id);}
 private toolbox() {return `/toolbox/${this.sandbox()}/toolbox`;}
 async getComputer(id:string) {const r=await this.request('GET',`/sandbox/${this.sandbox(id)}`);return {id,status:r.state==='started'?'running':r.state ?? 'error',name:'Private computer'};}
 execute(command:string,timeout=120,cwd?:string):Promise<{exitCode?:number;result:string}> {return this.request('POST',`${this.toolbox()}/process/execute`,{command:`bash -lc ${quote(command)}`,timeout,...(cwd?{cwd}:{})},false,this.config.timeoutMs ?? (timeout+10)*1000);}
 async upload(dest:string,data:string|Buffer) {const form=new FormData(); form.append('file',new Blob([new Uint8Array(typeof data==='string'?Buffer.from(data):data)]),'upload');await this.request('POST',`${this.toolbox()}/files/upload?path=${encodeURIComponent(dest)}`,form);}
 download(src:string):Promise<Buffer> {return this.request('GET',`${this.toolbox()}/files/download?path=${encodeURIComponent(src)}`,undefined,true);}
 signedPreview(port:number,ttl=3600) {if(!Number.isInteger(port)||port<1024||port>65535||ttl<1||ttl>86400) throw new Error('Invalid preview port or TTL');return this.request('GET',`/sandbox/${this.sandbox()}/ports/${port}/signed-preview-url?expiresInSeconds=${ttl}`);}
}
