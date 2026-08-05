import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const roots = ['server', 'public', 'scripts', 'test'];
const files = [];

async function collect(directory) {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await collect(target);
      else if (/\.(?:js|mjs)$/.test(entry.name)) files.push(target);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

for (const root of roots) await collect(root);
for (const file of files) execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
console.log(`语法检查通过：${files.length} 个 JavaScript 文件。`);
