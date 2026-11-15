import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

/** A secret from NAME, or from the file named by NAME_FILE (so keys need not sit in .env). */
function secret(name: string): string {
  const direct = process.env[name];
  if (direct) return direct;
  const file = process.env[`${name}_FILE`];
  if (file) return fs.readFileSync(file, 'utf8').trim();
  throw new Error(`Missing env ${name} (or ${name}_FILE)`);
}

function canonical(p:string):string {
 let ancestor=path.resolve(p);const missing:string[]=[];
 while(!fs.existsSync(ancestor)){const parent=path.dirname(ancestor);if(parent===ancestor)break;missing.unshift(path.basename(ancestor));ancestor=parent;}
 return path.resolve(fs.realpathSync(ancestor),...missing);
}
const hqRoot = canonical(process.env.HQ_ROOT ?? path.join(os.homedir(), 'bot-template-private'));
function dedicated(name: string, fallback: string): string {
 const p=canonical(process.env[name] ?? path.join(hqRoot,fallback));
 if(!p.startsWith(hqRoot+path.sep))throw new Error(`${name} must belong to HQ_ROOT; migrate your dedicated homes before upgrading (README: Existing deployments).`);
 return p;
}
const hermesHome = dedicated('HERMES_HOME_PRIMARY', 'hermes-primary');
// Never silently replace a deployment's existing database with an empty private one.
const legacyDbPath=fileURLToPath(new URL('../../data/grokbot.db',import.meta.url));
if (!process.env.DB_PATH && fs.existsSync(legacyDbPath)) {
  throw new Error('Legacy database detected: set DB_PATH explicitly to keep it, or migrate it first (README: Existing deployments).');
}

export const env = {
  hqRoot,
  deskPython: process.env.HQ_DESK_PYTHON ?? '/usr/bin/python3',
  daytonaUrl: req('DAYTONA_API_URL'),
  daytonaKey: secret('DAYTONA_API_KEY'),
  port: Number(process.env.PORT ?? 8787),
  appUrl: process.env.APP_URL ?? 'http://localhost:5173',
  /** Public URL of this server, used for OAuth callbacks. */
  serverUrl: process.env.SERVER_URL ?? `http://localhost:${process.env.PORT ?? 8787}`,
  xaiKey: process.env.XAI_API_KEY ?? '',
  xaiModel: process.env.XAI_MODEL ?? 'grok-4.7',
  composioKey: process.env.COMPOSIO_API_KEY ?? '',
  sessionSecret: req('SESSION_SECRET'),
  devLogin: process.env.DEV_LOGIN === '1',
  dbPath: process.env.DB_PATH ?? path.join(hqRoot, 'data/hq.db'),

  // ---- Hermes engine ----
  /** The `hermes` CLI used to start a gateway for each extra bot. */
  hermesBin: process.env.HERMES_BIN ?? path.join(hqRoot, 'runtime/hermes/bin/hermes'),
  /** The primary bot's Hermes home and API server (an agent that already runs; never restarted by us). */
  hermesHome,
  hermesUrl: (process.env.HERMES_URL ?? 'http://127.0.0.1:8642').replace(/\/+$/, ''),
  hermesKey: process.env.HERMES_KEY ?? '',
  /** Where each extra bot's own Hermes home lives. Must be outside ~/.hermes so it is a separate tenant. */
  enginesDir: dedicated('ENGINES_DIR', 'engines'),
  enginePortBase: Number(process.env.ENGINE_PORT_BASE ?? 8650),
  /** URL the Hermes gateways use to reach this server's MCP endpoint. */
  mcpBaseUrl: (process.env.MCP_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? 8787}`).replace(/\/+$/, ''),
  /** Extra MCP servers every managed bot gets, as a JSON object of Hermes `mcp_servers` entries (e.g. X's XMCP). */
  extraMcpServers: process.env.EXTRA_MCP_SERVERS ?? '',
  primaryBotName: process.env.PRIMARY_BOT_NAME ?? 'Doug',
  primaryBotLabel: process.env.PRIMARY_BOT_LABEL ?? 'Chief of Staff',

  // ---- the one shared computer ----
  /** Existing configured sandbox; historical field names preserve SQLite compatibility. */
  orgoComputerId: req('DAYTONA_SANDBOX_ID'),
  /** This server runs on that computer, so shell commands run locally instead of through the toolbox API. */
  localBox: process.env.HQ_LOCAL === '1',
  /**
   * DevTools URL of a Chrome that already runs on the default screen and belongs to the primary bot
   * (e.g. http://127.0.0.1:9333). When set, we never start or stop that screen's Chrome ourselves.
   */
  primaryCdpUrl: process.env.PRIMARY_CDP_URL ?? '',
  /** Bots that can each have a screen (the private registry allows four app-owned screens). */
  maxBots: Number(process.env.MAX_BOTS ?? 4),
  /** Comma-separated emails allowed to sign in; empty = anyone who can reach the app. */
  allowedEmails: (process.env.ALLOWED_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
};
