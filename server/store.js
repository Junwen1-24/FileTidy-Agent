import fs from 'node:fs/promises';
import path from 'node:path';

const INITIAL_STATE = {
  schemaVersion: 1,
  settings: {
    rootPath: '',
    updatedAt: null
  },
  files: [],
  operations: [],
  scanRuns: []
};

function clone(value) {
  return structuredClone(value);
}

export class JsonStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.filePath = path.join(dataDir, 'state.json');
    this.state = clone(INITIAL_STATE);
    this.writeQueue = Promise.resolve();
  }

  async init() {
    await fs.mkdir(this.dataDir, { recursive: true });
    try {
      const content = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(content);
      this.state = {
        ...clone(INITIAL_STATE),
        ...parsed,
        settings: { ...INITIAL_STATE.settings, ...parsed.settings },
        files: Array.isArray(parsed.files) ? parsed.files : [],
        operations: Array.isArray(parsed.operations) ? parsed.operations : [],
        scanRuns: Array.isArray(parsed.scanRuns) ? parsed.scanRuns : []
      };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await this.persist();
    }
  }

  read() {
    return clone(this.state);
  }

  async mutate(mutator) {
    let result;
    const task = this.writeQueue.catch(() => undefined).then(async () => {
      result = await mutator(this.state);
      await this.persist();
    });
    this.writeQueue = task.catch(() => undefined);
    await task;
    return clone(result);
  }

  async replace(nextState) {
    return this.mutate((state) => {
      for (const key of Object.keys(state)) delete state[key];
      Object.assign(state, clone(nextState));
      return state;
    });
  }

  async persist() {
    const tempPath = `${this.filePath}.tmp`;
    const content = `${JSON.stringify(this.state, null, 2)}\n`;
    await fs.writeFile(tempPath, content, 'utf8');
    await fs.rename(tempPath, this.filePath);
  }
}
