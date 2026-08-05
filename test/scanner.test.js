import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyFile } from '../server/scanner.js';

test('根据扩展名、目录和文件名生成可解释标签', () => {
  const now = new Date('2026-08-05T00:00:00Z').getTime();
  const result = classifyFile({
    name: '截图-临时方案.png',
    extension: 'png',
    relativePath: '项目-A/截图-临时方案.png',
    mtimeMs: now - 10 * 86_400_000
  }, now);
  const tags = result.suggestions.map((item) => item.tag);
  assert.deepEqual(tags, ['图片', '常用', '截图', '疑似临时', '项目:项目-A']);
  assert.equal(result.recommendation.folder, '图片/截图');
  assert.ok(result.suggestions.every((item) => item.reason));
});

test('超过 180 天未修改的文件标记为长期闲置', () => {
  const now = Date.now();
  const result = classifyFile({
    name: '旧资料.pdf', extension: 'pdf', relativePath: '旧资料.pdf',
    mtimeMs: now - 181 * 86_400_000
  }, now);
  assert.ok(result.suggestions.some((item) => item.tag === '长期闲置'));
});
