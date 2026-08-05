import fs from 'node:fs/promises';

const requiredFiles = [
  'public/index.html', 'public/styles.css', 'public/app.js',
  'server/index.js', 'server/app.js', 'server/service.js', 'server/store.js', 'server/scanner.js',
  'docs/PRD.md', 'README.md', '.env.example'
];
for (const file of requiredFiles) await fs.access(file);

const html = await fs.readFile('public/index.html', 'utf8');
const client = await fs.readFile('public/app.js', 'utf8');
const ids = [...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
if (duplicates.length) throw new Error(`HTML 存在重复 id：${duplicates.join(', ')}`);

const referencedIds = [...client.matchAll(/querySelector\('#([^']+)'\)/g)].map((match) => match[1]);
const missingIds = referencedIds.filter((id) => !ids.includes(id));
if (missingIds.length) throw new Error(`前端引用了不存在的 id：${missingIds.join(', ')}`);
console.log(`静态检查通过：${requiredFiles.length} 个必需文件，${ids.length} 个界面元素。`);
