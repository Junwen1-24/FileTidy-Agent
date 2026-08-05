import fs from 'node:fs/promises';

const output = 'dist';
await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(output, { recursive: true });
for (const source of ['server', 'public', 'demo-seed', 'docs']) {
  await fs.cp(source, `${output}/${source}`, { recursive: true });
}
for (const source of ['package.json', 'README.md', '.env.example']) {
  await fs.copyFile(source, `${output}/${source}`);
}
console.log('构建完成：dist/ 可直接执行 npm start。');
