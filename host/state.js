import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export class StateStore {
  constructor(dir) {
    this.dir = dir;
    this.file = join(dir, 'state.json');
    this.data = { threads: Object.create(null) };
    this.loadError = null;
    try {
      mkdirSync(dir, { recursive: true });
      const raw = readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.threads || typeof parsed.threads !== 'object' || Array.isArray(parsed.threads)) throw new Error('Invalid state file');
      this.data = { threads: Object.assign(Object.create(null), parsed.threads) };
    } catch (error) {
      if (error.code !== 'ENOENT') this.loadError = error;
    }
  }

  get(threadId) {
    return this.loadError ? { resumeSafe: false } : (this.data.threads[threadId] ?? {});
  }

  set(threadId, patch) {
    if (this.loadError) throw new Error(`Safety state unavailable: ${this.loadError.message}`);
    this.data.threads[threadId] = { ...(this.data.threads[threadId] ?? {}), ...patch, updatedAt: Date.now() };
    this.save();
    return this.data.threads[threadId];
  }

  save() {
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), { encoding: 'utf8', mode: 0o600 });
    renameSync(tmp, this.file);
  }
}
