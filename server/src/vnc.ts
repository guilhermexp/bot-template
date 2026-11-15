import fs from 'node:fs';
import path from 'node:path';
import {WatchFilter} from './lib/rfb.js';
import type { IncomingMessage, Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { db } from './db.js';
import { userFromCookieHeader } from './lib/auth.js';
import { vncAuthResponse } from './lib/des.js';
import { computerProvider } from './computer-provider.js';
import { env } from './env.js';
import { readyScreen, screenFor } from './computer.js';
import { viewerClosed, viewerOpened } from './idle.js';

/**
 * VNC relay: browser <-> our server <-> owned loopback websockify.
 * The server performs the RFB handshake upstream with the computer's VNC password
 * (which is root-equivalent and never reaches the browser), then offers the browser
 * an unauthenticated RFB session. In "watch" mode, client input messages
 * (KeyEvent, PointerEvent, ClientCutText) are dropped server-side.
 */

class ByteQueue {
  private buf = Buffer.alloc(0);
  private waiters: { n: number; resolve: (b: Buffer) => void; reject: (e: Error) => void }[] = [];
  private closed: Error | null = null;
  push(b: Buffer) { this.buf = Buffer.concat([this.buf, b]); this.drain(); }
  close(e: Error) { this.closed = e; for (const w of this.waiters) w.reject(e); this.waiters = []; }
  read(n: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      if (this.closed) return reject(this.closed);
      this.waiters.push({ n, resolve, reject });
      this.drain();
    });
  }
  takeAll(): Buffer { const b = this.buf; this.buf = Buffer.alloc(0); return b; }
  private drain() {
    while (this.waiters.length && this.buf.length >= this.waiters[0].n) {
      const w = this.waiters.shift()!;
      const out = this.buf.subarray(0, w.n);
      this.buf = this.buf.subarray(w.n);
      w.resolve(Buffer.from(out));
    }
  }
}

const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };

async function upstreamHandshake(q: ByteQueue, send: (b: Buffer) => void, password: string): Promise<Buffer> {
  await q.read(12); // server ProtocolVersion
  send(Buffer.from('RFB 003.008\n'));
  const n = (await q.read(1))[0];
  if (n === 0) {
    const len = (await q.read(4)).readUInt32BE();
    throw new Error(`VNC refused: ${(await q.read(len)).toString()}`);
  }
  const types = [...(await q.read(n))];
  const choice = types.includes(2) ? 2 : types.includes(1) ? 1 : -1;
  if (choice < 0) throw new Error(`Unsupported VNC security types: ${types.join(',')}`);
  send(Buffer.from([choice]));
  if (choice === 2) {
    const challenge = await q.read(16);
    send(vncAuthResponse(password, challenge));
  }
  const result = (await q.read(4)).readUInt32BE();
  if (result !== 0) {
    let reason = '';
    try { const len = (await q.read(4)).readUInt32BE(); reason = (await q.read(len)).toString(); } catch { /* none */ }
    throw new Error(`VNC auth failed ${reason}`);
  }
  send(Buffer.from([1])); // ClientInit: shared
  const head = await q.read(24); // w,h,pixfmt(16),nameLen
  const nameLen = head.readUInt32BE(20);
  const name = await q.read(nameLen);
  return Buffer.concat([head, name]);
}

async function browserHandshake(q: ByteQueue, send: (b: Buffer) => void, serverInit: Buffer) {
  send(Buffer.from('RFB 003.008\n'));
  await q.read(12);
  send(Buffer.from([1, 1])); // one security type: None
  await q.read(1);
  send(u32(0)); // SecurityResult OK
  await q.read(1); // ClientInit
  send(serverInit);
}

export function attachVncRelay(server: Server) {
  const wss = new WebSocketServer({ noServer: true, handleProtocols: (protocols) => (protocols.has('binary') ? 'binary' : false) });

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const m = url.pathname.match(/^\/api\/bots\/([^/]+)\/screen$/);
    if (!m) return; // not ours
    const user = userFromCookieHeader(req.headers.cookie);
    const bot = user ? (db.prepare('SELECT * FROM bots WHERE id=? AND user_id=?').get(m[1], user.id) as any) : null;
    if (!user || !bot) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    const mode = url.searchParams.get('mode') === 'control' ? 'control' : 'watch';
    wss.handleUpgrade(req, socket, head, (client) => relay(client, user.id, bot.id, mode));
  });
}

async function relay(client: WebSocket, userId: string, botId: string, mode: 'watch' | 'control') {
  const fromClient = new ByteQueue();
  const fromUp = new ByteQueue();
  let upstream: WebSocket | null = null;
  let piping = false;
  const filter = new WatchFilter();
  const closeAll = (code = 1000, reason = '') => {
    try { client.close(code, reason.slice(0, 120)); } catch { /* */ }
    try { upstream?.close(); } catch { /* */ }
  };

  client.on('message', (data: Buffer) => {
    if (!piping) return fromClient.push(Buffer.from(data));
    try {
      const fwd = mode === 'watch' ? filter.feed(Buffer.from(data)) : Buffer.from(data);
      if (fwd.length && upstream?.readyState === WebSocket.OPEN) upstream.send(fwd);
    } catch { closeAll(1008, 'Invalid viewer message'); }
  });
  client.on('close', () => { viewerClosed(userId); fromClient.close(new Error('client closed')); try { upstream?.close(); } catch { /* */ } });
  viewerOpened(userId); // keeps the computer awake while someone is watching (see idle.ts)

  let phase = 'lease';
  try {
    const leased = await screenFor(userId, botId);
    const {computerId,screenId}=leased;
    // A screen nobody has used yet is bare; set it up while the person is already watching.
    if (!env.localBox) throw new Error('Viewer requires HQ_LOCAL=1 inside the private guest');
    const screen = await computerProvider.ensureScreen(computerId, screenId,botId);
    readyScreen(userId,botId,{redress:screen.revision!==leased.revision}).catch(()=>{});
    const password = fs.readFileSync(path.join(env.hqRoot,'screens',screenId.slice(7),'vnc-password'),'utf8');
    const upUrl = `ws://127.0.0.1:${screen.wsPort}`;
    phase = 'upstream-open';
      upstream = new WebSocket(upUrl, ['binary']);
    upstream.on('message', (data: Buffer) => {
      if (!piping) return fromUp.push(Buffer.from(data));
      if (client.readyState === WebSocket.OPEN) client.send(data);
    });
    upstream.on('close', (code, reason) => { fromUp.close(new Error(`upstream closed ${code}`)); closeAll(1000, 'Private viewer closed'); });
    upstream.on('error', (e) => { fromUp.close(e as Error); closeAll(1011, 'Private viewer unavailable'); });
    await new Promise<void>((res, rej) => { upstream!.once('open', () => res()); upstream!.once('error', rej); });

    phase = 'upstream-handshake';
      const serverInit = await upstreamHandshake(fromUp, (b) => upstream!.send(b), password);
    phase = 'browser-handshake';
      await browserHandshake(fromClient, (b) => client.send(b), serverInit);
    // Flush anything that arrived during the handshake, then switch to piping.
    piping = true;
    const leftoverUp = fromUp.takeAll();
    if (leftoverUp.length) client.send(leftoverUp);
    const leftoverClient = fromClient.takeAll();
    if (leftoverClient.length) {
      const fwd = mode === 'watch' ? filter.feed(leftoverClient) : leftoverClient;
      if (fwd.length) upstream.send(fwd);
    }
  } catch (e: any) {
    console.warn('[vnc] private viewer unavailable', {phase, kind: e?.name, status: typeof e?.status === 'number' ? e.status : undefined});
    closeAll(1011, 'Private viewer unavailable');
  }
}
