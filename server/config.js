import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(serverDir, '..');

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(env = process.env) {
  return {
    host: env.HOST || '127.0.0.1',
    port: positiveInteger(env.PORT, 4310),
    dataDir: path.resolve(env.FILETIDY_DATA_DIR || path.join(projectRoot, '.filetidy-data')),
    publicDir: path.join(projectRoot, 'public'),
    seedDir: path.join(projectRoot, 'demo-seed'),
    maxFiles: positiveInteger(env.FILETIDY_MAX_FILES, 1000),
    maxDepth: positiveInteger(env.FILETIDY_MAX_DEPTH, 8)
  };
}
