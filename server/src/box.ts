import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from './env.js';
import { daytona, execute, ComputerError } from './computer-provider.js';
export { displayFor } from './computer-provider.js';

/**
 * The box: the one private computer every bot works on. When this server runs on that computer
 * (HQ_LOCAL=1) commands and files go straight to the local shell and disk; otherwise they go
 * through the existing sandbox's toolbox API.
 */

export interface BashResult { output: string; exit_code: number }

/** A path safe to put inside single quotes in a shell command. */
const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export const box = {
  local: env.localBox,

  /** Run a bash command on the box. `screenId` picks which screen's DISPLAY it sees. */
  async bash(command: string, timeoutSec = 60, screenId?: string | null): Promise<BashResult> {
    return execute(command, timeoutSec, screenId);
  },

  async writeFile(file: string, content: string | Buffer, mode = '0644'): Promise<void> {
    const buf = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
    if (env.localBox) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, buf);
      await fs.chmod(file, parseInt(mode, 8));
      return;
    }
    const parent=await box.bash(`mkdir -p -- ${q(path.dirname(file))}`);
    if(parent.exit_code)throw new Error('Remote parent directory could not be created');
    await daytona.upload(file, buf);
    const r=await box.bash(`chmod ${mode} ${q(file)}`);
    if(r.exit_code) throw new Error('File mode could not be applied');
  },

  /** Read a file from the box, or null if it isn't there. Meant for small files (under ~4 MB). */
  async readFile(file: string): Promise<Buffer | null> {
    if (env.localBox) {
      try { return await fs.readFile(file); } catch (e: any) { if(e?.code==='ENOENT')return null;throw e; }
    }
    try { return await daytona.download(file); } catch (e) { if(e instanceof ComputerError && e.status===404)return null;throw e; }
  },

  quote: q,
};
