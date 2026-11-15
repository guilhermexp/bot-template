import { db, now } from './db.js';
import { env } from './env.js';
import { hub } from './lib/hub.js';
import { computerProvider as orgo, ComputerError as OrgoError, type ComputerScreen as OrgoScreen } from './computer-provider.js';
import { cdpPortFor, dressScreen, resetScreen, undressScreen, type DeskBot } from './desk.js';
import { box } from './box.js';
import type { ComputerState } from './types.js';

/** One existing private computer, with four app-owned lazy screens including the primary. */
export const MAX_SCREENS = 4;

export interface BotScreen { computerId: string; screenId: string; width?: number; height?: number; revision?: number }

function computerId(): string {
  if (!env.orgoComputerId) throw new Error('DAYTONA_SANDBOX_ID is not set, so there is no computer for the bots to use.');
  return env.orgoComputerId;
}

function rowFor(userId: string) {
  let r = db.prepare('SELECT * FROM computers WHERE user_id=?').get(userId) as any;
  if (!r) {
    db.prepare("INSERT INTO computers(user_id,orgo_id,status,updated_at) VALUES (?, ?, 'starting', ?)").run(userId, env.orgoComputerId || null, now());
    r = db.prepare('SELECT * FROM computers WHERE user_id=?').get(userId);
  }
  return r;
}

function setStatus(userId: string, status: ComputerState['status'], error: string | null = null) {
  rowFor(userId);
  db.prepare('UPDATE computers SET status=?, orgo_id=?, error=?, updated_at=? WHERE user_id=?').run(status, env.orgoComputerId || null, error, now(), userId);
  hub.emit(userId, { type: 'computer', state: computerState(userId) });
}

export function computerState(userId: string): ComputerState {
  const r = rowFor(userId);
  const screens = (db.prepare('SELECT bot_id, screen_id, width, height FROM screens WHERE user_id=?').all(userId) as any[]).map((s) => ({
    botId: s.bot_id as string,
    screenId: s.screen_id as string,
    ...(s.width && s.height ? { width: s.width as number, height: s.height as number } : {}),
  }));
  return { status: r.status, orgoId: env.orgoComputerId || r.orgo_id, error: r.error, screens, maxScreens: Math.min(env.maxBots, MAX_SCREENS) };
}

function mapStatus(s: string): ComputerState['status'] {
  if (s === 'running') return 'running';
  if (s === 'creating') return 'creating';
  if (s === 'suspended') return 'suspended';
  if (s === 'suspending') return 'suspending';
  if (s === 'resuming') return 'resuming';
  if (s === 'frozen' || s === 'stopped') return 'stopped';
  if (s === 'error') return 'error';
  return 'starting';
}

/** Check availability only. No automatic lifecycle mutations, including on error. */
const availability = new Map<string,{until:number;promise:Promise<string>}>();
export function ensureComputer(userId: string): Promise<string> {
  const cached=availability.get(userId);
  if(cached && cached.until>Date.now())return cached.promise;
  const entry={until:Date.now()+5000,promise:checkComputer(userId)};
  availability.set(userId,entry);
  void entry.promise.catch(()=>{if(availability.get(userId)===entry)availability.delete(userId);});
  return entry.promise;
}
async function checkComputer(userId: string): Promise<string> {
  const id = computerId();
  try {
    const c = await orgo.getComputer(id);
    if (c.status !== 'running') throw new Error('Private computer unavailable (' + c.status + '); ask its owner to restore availability.');
    setStatus(userId, 'running');
    return id;
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Private computer unavailable';
    setStatus(userId, 'error', message);
    throw new Error(message);
  }
}

function deskBot(botId: string): DeskBot | null {
  const b = db.prepare('SELECT id, name, label, avatar_shape, avatar_color FROM bots WHERE id=?').get(botId) as any;
  return b ? { id: b.id, name: b.name, label: b.label ?? '', avatarShape: b.avatar_shape, avatarColor: b.avatar_color } : null;
}

const isPrimaryEngine = (botId: string) => (db.prepare('SELECT engine FROM bots WHERE id=?').get(botId) as any)?.engine === 'primary';

/** The primary bot's own Chrome (when PRIMARY_CDP_URL names one) is never started or stopped by us. */
const managesChrome = (botId: string) => !(isPrimaryEngine(botId) && env.primaryCdpUrl);

const verified = new Map<string,{userId:string;until:number;screen:BotScreen}>();
const releasing = new Map<string,Promise<void>>();
const leasing = new Map<string, Promise<BotScreen>>();
const dressing = new Map<string, Promise<void>>();
const dressedRevision = new Map<string,number|undefined>();

function saveSize(botId: string, s: OrgoScreen | undefined) {
  if (s?.width && s?.height) db.prepare('UPDATE screens SET width=?, height=? WHERE bot_id=?').run(s.width, s.height, botId);
}

/** This bot's screen on the shared computer; leases one the first time. */
export function screenFor(userId: string, botId: string): Promise<BotScreen> {
  const stopping=releasing.get(botId);
  if(stopping)return stopping.then(()=>screenFor(userId,botId));
  const running = leasing.get(botId);
  if (running) return running;
  const p = lease(userId, botId).finally(() => leasing.delete(botId));
  leasing.set(botId, p);
  return p;
}

async function lease(userId: string, botId: string): Promise<BotScreen> {
  const id = await ensureComputer(userId);
  const row=db.prepare('SELECT screen_id FROM screens WHERE bot_id=? AND user_id=?').get(botId,userId) as any;
  const cached=verified.get(botId);
  if(row && cached?.userId===userId && cached.until>Date.now() && cached.screen.screenId===row.screen_id && cached.screen.computerId===id)return cached.screen;
  verified.delete(botId);
  if(row && /^screen-10[0-3]$/.test(row.screen_id)){
    let found:OrgoScreen|undefined;
    try{found=await orgo.getScreen(id,row.screen_id);}catch(error){
      // A missing registry lease can be migrated; transport/auth failures cannot.
      const screens=await orgo.listScreens(id);
      if(screens.some(s=>s.id===row.screen_id))throw error;
    }
    if(found){
    if(found.owner!==botId)throw new Error('Screen ownership changed; refusing reuse');
    const current=await orgo.ensureScreen(id,row.screen_id,botId);
    const screen={computerId:id,screenId:current.id,width:current.width,height:current.height,revision:current.revision};
    verified.set(botId,{userId,until:Date.now()+5000,screen});return screen;
    }
  }
  const existed = (await orgo.listScreens(id)).some(s=>s.owner===botId);
  const screen = await orgo.leaseScreen(id, botId, isPrimaryEngine(botId));
  let current:OrgoScreen;
  try { current=await orgo.ensureScreen(id, screen.id,botId); } catch (e) {
    if (!existed) {
      try { await orgo.releaseScreen(id,botId); } catch {
        // Keep the owner mapping so release can be retried without orphaning the lease.
        db.prepare('INSERT OR REPLACE INTO screens(bot_id,user_id,screen_id,last_used_at,width,height) VALUES (?,?,?,?,?,?)').run(botId,userId,screen.id,now(),screen.width||null,screen.height||null);
      }
    }
    throw e;
  }
  db.prepare('INSERT OR REPLACE INTO screens(bot_id,user_id,screen_id,last_used_at,width,height) VALUES (?,?,?,?,?,?)').run(botId, userId, screen.id, now(), screen.width || null, screen.height || null);
  hub.emit(userId, { type: 'computer', state: computerState(userId) });
  const result={ computerId: id, screenId: screen.id, width: screen.width || undefined, height: screen.height || undefined, revision:current.revision };
  verified.set(botId,{userId,until:Date.now()+5000,screen:result});return result;
}

/**
 * The bot's screen, dressed as its own computer (wallpaper, dock, its Chrome on its home screen).
 * Dressing happens once per server run per bot, and again when `redress` is set (rename, new colour).
 */
export async function readyScreen(userId: string, botId: string, opts: { redress?: boolean } = {}): Promise<BotScreen> {
  const s = await screenFor(userId, botId);
  if (opts.redress || dressedRevision.get(botId)!==s.revision) dressing.delete(botId);
  let d = dressing.get(botId);
  if (!d) {
    const bot = deskBot(botId);
    d = bot
      ? dressScreen(bot, s.screenId, { manageChrome: managesChrome(botId) }).catch((e) => {
          console.warn(`[computer] could not dress ${s.screenId} for ${botId}: ${e?.message ?? e}`);
          dressing.delete(botId);
        })
      : Promise.resolve();
    dressing.set(botId, d);
    dressedRevision.set(botId,s.revision);
  }
  await d;
  return s;
}

/** DevTools address of the Chrome on this bot's screen (for Hermes' browser tools). */
export function cdpUrlFor(botId: string, screenId: string): string {
  if (isPrimaryEngine(botId) && env.primaryCdpUrl) return env.primaryCdpUrl;
  return `http://127.0.0.1:${cdpPortFor(screenId)}`;
}

/**
 * Called before a bot starts working: its screen is leased and dressed, and the browser we run for it
 * answers. Without this a bot's first turn finds no browser and goes off to start one of its own.
 */
export async function screenForWork(userId: string, botId: string): Promise<void> {
  if (!env.orgoComputerId) return;
  if (!managesChrome(botId)) {
    // It brings its own browser, so nothing it needs depends on the dressing: don't make it wait.
    void readyScreen(userId, botId).catch((e) => console.warn(`[computer] screen not ready for ${botId}: ${e?.message ?? e}`));
    return;
  }
  const s = await readyScreen(userId, botId);
  if (!env.localBox) return;
  const alive = await fetch(`${cdpUrlFor(botId, s.screenId)}/json/version`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok, () => false);
  if (!alive) await readyScreen(userId, botId, { redress: true });
}

/** Close everything on the bot's screen and bring its browser back to the home screen. Logins stay. */
export async function resetBotScreen(userId: string, botId: string): Promise<void> {
  const s = await screenFor(userId, botId);
  const bot = deskBot(botId);
  if (bot) await resetScreen(bot, s.screenId, { manageChrome: managesChrome(botId) });
}

/** The bot is gone: stop what we ran on its screen and free the screen for the next bot. */
export function releaseScreen(botId:string):Promise<void>{
  const pending=releasing.get(botId);if(pending)return pending;
  const work=(async()=>{await leasing.get(botId)?.catch(()=>{});await releaseOwnedScreen(botId);})().finally(()=>releasing.delete(botId));
  releasing.set(botId,work);return work;
}
async function releaseOwnedScreen(botId: string): Promise<void> {
  verified.delete(botId);
  const mine = db.prepare('SELECT screen_id, user_id FROM screens WHERE bot_id=?').get(botId) as any;
  if (!mine) return;
  dressing.delete(botId);
  dressedRevision.delete(botId);
  if (mine.screen_id) {
    try { await undressScreen(botId, mine.screen_id); } catch (e: any) { console.warn(`[computer] undress failed: ${e?.message ?? e}`); }
  }
  await orgo.releaseScreen(env.orgoComputerId, botId);
  db.prepare('DELETE FROM screens WHERE bot_id=?').run(botId);
  hub.emit(mine.user_id, { type: 'computer', state: computerState(mine.user_id) });
}

/** A deleted bot leaves nothing behind on the computer: its browser profile and its Library folder go. */
export async function forgetBotFiles(botId: string): Promise<void> {
  if (!/^bot_[\w-]+$/.test(botId)) return;
  await box.bash(`rm -rf -- ${box.quote(env.hqRoot+'/profiles/'+botId)} ${box.quote(env.hqRoot+'/files/'+botId)}`, 60);
}

/** The shared computer is never suspended from the app (other things live on it). */
export async function suspendComputer(_userId: string, _reason = 'manual'): Promise<void> {}

/** Refresh status and app screen sizes from Daytona (cheap; used when the UI opens). */
export async function refreshComputer(userId: string): Promise<ComputerState> {
  availability.delete(userId);
  if (!env.orgoComputerId) {
    setStatus(userId, 'error', 'DAYTONA_SANDBOX_ID is not set.');
    return computerState(userId);
  }
  try {
    const c = await orgo.getComputer(env.orgoComputerId);
    const s = mapStatus(c.status);
    const r = rowFor(userId);
    if (s !== r.status || r.error) setStatus(userId, s);
    if (s === 'running') {
      const screens = await orgo.listScreens(env.orgoComputerId);
      const byId = new Map(screens.map((x) => [x.default ? 'default' : x.id, x]));
      for (const row of db.prepare('SELECT bot_id, screen_id FROM screens WHERE user_id=?').all(userId) as any[]) saveSize(row.bot_id, byId.get(row.screen_id));
    }
  } catch (e: any) {
    setStatus(userId, 'error', e instanceof OrgoError && e.status === 404 ? 'The computer was not found with this Daytona configuration.' : String(e?.message ?? e));
  }
  return computerState(userId);
}
