import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { projectRoot } from '../server/config.js';
import { FileTidyService } from '../server/service.js';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'filetidy-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const service = new FileTidyService({
    dataDir: path.join(root, 'data'), seedDir: path.join(projectRoot, 'demo-seed'),
    maxFiles: 100, maxDepth: 8
  });
  await service.init();
  return service;
}

test('演示数据可扫描，标签可真实持久化', async (t) => {
  const service = await fixture(t);
  const state = service.getState();
  assert.equal(state.summary.total, 8);
  const target = state.files[0];
  await service.updateTags(target.id, ['工作', '重点']);

  const secondService = new FileTidyService(service.config);
  await secondService.store.init();
  const restored = secondService.getState().files.find((file) => file.id === target.id);
  assert.deepEqual(restored.confirmedTags, ['工作', '重点']);
});

test('整理会移动真实文件，并且可以撤销', async (t) => {
  const service = await fixture(t);
  const original = service.getState().files.find((file) => file.name === '客户合同.txt');
  const result = await service.organize([original.id]);
  const moved = result.operation.items[0];
  await assert.rejects(fs.access(moved.originalPath));
  await fs.access(moved.targetPath);

  const undoneState = await service.undo(result.operation.id);
  await fs.access(moved.originalPath);
  await assert.rejects(fs.access(moved.targetPath));
  assert.equal(undoneState.operations[0].status, 'undone');
  assert.equal(undoneState.files.find((file) => file.id === original.id).organized, false);
});

test('无效路径不会替换当前目录', async (t) => {
  const service = await fixture(t);
  const originalRoot = service.getState().settings.rootPath;
  await assert.rejects(service.updateSettings(path.join(originalRoot, '不存在')), /目录不存在/);
  assert.equal(service.getState().settings.rootPath, originalRoot);
});

test('一次无效写入不会阻塞后续标签保存', async (t) => {
  const service = await fixture(t);
  await assert.rejects(service.updateTags('missing-file', ['测试']), /文件记录不存在/);
  const target = service.getState().files[0];
  const updated = await service.updateTags(target.id, ['恢复正常']);
  assert.deepEqual(updated.confirmedTags, ['恢复正常']);
});
