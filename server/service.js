import fs from 'node:fs/promises';
import path from 'node:path';

import { AppError } from './errors.js';
import { scanDirectory } from './scanner.js';
import { JsonStore } from './store.js';
import { createId, isPathInside, normalizeTagList } from './utils.js';

function summarize(state) {
  const files = state.files;
  return {
    total: files.length,
    pending: files.filter((file) => file.confirmedTags.length === 0).length,
    confirmed: files.filter((file) => file.confirmedTags.length > 0).length,
    organized: files.filter((file) => file.organized).length,
    reclaimableBytes: files
      .filter((file) => file.suggestions.some((item) => ['长期闲置', '疑似临时'].includes(item.tag)))
      .reduce((total, file) => total + file.size, 0)
  };
}

async function validateDirectory(directoryPath) {
  if (!directoryPath || typeof directoryPath !== 'string') {
    throw new AppError('请输入要整理的目录路径。', 400, 'DIRECTORY_REQUIRED');
  }
  try {
    const realPath = await fs.realpath(directoryPath.trim());
    const stat = await fs.stat(realPath);
    if (!stat.isDirectory()) throw new Error('not directory');
    return realPath;
  } catch {
    throw new AppError('目录不存在或无法读取。', 400, 'INVALID_DIRECTORY');
  }
}

async function availableTarget(targetPath) {
  const parsed = path.parse(targetPath);
  let candidate = targetPath;
  let number = 2;
  while (true) {
    try {
      await fs.access(candidate);
      candidate = path.join(parsed.dir, `${parsed.name} (${number})${parsed.ext}`);
      number += 1;
    } catch {
      return candidate;
    }
  }
}

async function moveFile(source, target) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  try {
    await fs.rename(source, target);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    await fs.copyFile(source, target);
    await fs.unlink(source);
  }
}

export class FileTidyService {
  constructor(config) {
    this.config = config;
    this.store = new JsonStore(config.dataDir);
    this.scanPromise = null;
  }

  async init() {
    await this.store.init();
    if (!this.store.read().settings.rootPath) await this.resetDemo();
  }

  getState() {
    const state = this.store.read();
    return {
      settings: state.settings,
      summary: summarize(state),
      files: state.files,
      operations: state.operations.slice(0, 20),
      lastScan: state.scanRuns[0] || null
    };
  }

  async updateSettings(rootPath) {
    const realRoot = await validateDirectory(rootPath);
    await this.store.mutate((state) => {
      const rootChanged = state.settings.rootPath !== realRoot;
      state.settings = { rootPath: realRoot, updatedAt: new Date().toISOString() };
      state.files = [];
      if (rootChanged) {
        state.operations = [];
        state.scanRuns = [];
      }
      return state.settings;
    });
    return this.getState();
  }

  async resetDemo() {
    const demoPath = path.join(this.config.dataDir, 'demo-workspace');
    await fs.rm(demoPath, { recursive: true, force: true });
    await fs.mkdir(demoPath, { recursive: true });
    await fs.cp(this.config.seedDir, demoPath, { recursive: true });

    const oldDate = new Date(Date.now() - 240 * 86_400_000);
    const archivalPath = path.join(demoPath, '归档候选', '2024-预算草案.md');
    await fs.utimes(archivalPath, oldDate, oldDate);

    await this.store.replace({
      schemaVersion: 1,
      settings: { rootPath: demoPath, updatedAt: new Date().toISOString() },
      files: [],
      operations: [],
      scanRuns: []
    });
    await this.scan();
    return this.getState();
  }

  async scan() {
    if (this.scanPromise) return this.scanPromise;
    this.scanPromise = this.runScan();
    try {
      return await this.scanPromise;
    } finally {
      this.scanPromise = null;
    }
  }

  async runScan() {
    const state = this.store.read();
    const rootPath = await validateDirectory(state.settings.rootPath);
    const result = await scanDirectory(rootPath, state.files, {
      maxFiles: this.config.maxFiles,
      maxDepth: this.config.maxDepth
    });
    const run = {
      id: createId('scan'),
      completedAt: new Date().toISOString(),
      fileCount: result.files.length,
      warnings: result.warnings
    };
    await this.store.mutate((draft) => {
      draft.settings.rootPath = result.rootPath;
      draft.files = result.files;
      draft.scanRuns.unshift(run);
      draft.scanRuns = draft.scanRuns.slice(0, 20);
      return run;
    });
    return this.getState();
  }

  async updateTags(fileId, tags) {
    const normalized = normalizeTagList(tags);
    return this.store.mutate((state) => {
      const file = state.files.find((item) => item.id === fileId);
      if (!file) throw new AppError('文件记录不存在，请重新扫描。', 404, 'FILE_NOT_FOUND');
      file.confirmedTags = normalized;
      file.updatedAt = new Date().toISOString();
      return file;
    });
  }

  async confirmSuggestions(fileIds) {
    if (!Array.isArray(fileIds) || fileIds.length === 0) {
      throw new AppError('请至少选择一个文件。', 400, 'FILES_REQUIRED');
    }
    return this.store.mutate((state) => {
      const selected = new Set(fileIds);
      let updated = 0;
      for (const file of state.files) {
        if (!selected.has(file.id)) continue;
        file.confirmedTags = normalizeTagList([
          ...file.confirmedTags,
          ...file.suggestions.map((item) => item.tag)
        ]);
        file.updatedAt = new Date().toISOString();
        updated += 1;
      }
      if (updated === 0) throw new AppError('选择的文件已不存在。', 404, 'FILES_NOT_FOUND');
      return { updated };
    });
  }

  previewOrganize(fileIds) {
    const state = this.store.read();
    const selected = new Set(fileIds || []);
    const items = state.files
      .filter((file) => selected.has(file.id) && !file.organized)
      .map((file) => ({
        id: file.id,
        name: file.name,
        from: file.relativePath,
        to: path.join('整理结果', file.recommendation.folder, file.name),
        reason: file.recommendation.reason
      }));
    if (items.length === 0) {
      throw new AppError('没有可整理的文件，请选择尚未整理的文件。', 400, 'NO_ORGANIZABLE_FILES');
    }
    return { count: items.length, items };
  }

  async organize(fileIds) {
    const preview = this.previewOrganize(fileIds);
    const state = this.store.read();
    const rootPath = await validateDirectory(state.settings.rootPath);
    const moved = [];

    try {
      for (const item of preview.items) {
        const file = state.files.find((candidate) => candidate.id === item.id);
        const source = file.absolutePath;
        if (!isPathInside(rootPath, source)) {
          throw new AppError(`拒绝移动目录外文件：${file.name}`, 400, 'UNSAFE_SOURCE_PATH');
        }
        const desiredTarget = path.join(rootPath, '整理结果', file.recommendation.folder, file.name);
        if (!isPathInside(rootPath, desiredTarget)) {
          throw new AppError(`目标路径不安全：${file.name}`, 400, 'UNSAFE_TARGET_PATH');
        }
        try {
          await fs.access(source);
        } catch {
          throw new AppError(`源文件不存在：${file.relativePath}`, 409, 'SOURCE_MISSING');
        }
        const target = await availableTarget(desiredTarget);
        await moveFile(source, target);
        moved.push({ fileId: file.id, originalPath: source, targetPath: target });
      }
    } catch (error) {
      for (const item of [...moved].reverse()) {
        try {
          await moveFile(item.targetPath, item.originalPath);
        } catch (rollbackError) {
          console.error('整理失败后的回滚也失败：', rollbackError);
        }
      }
      throw error;
    }

    const operation = {
      id: createId('operation'),
      type: 'organize',
      status: 'completed',
      createdAt: new Date().toISOString(),
      undoneAt: null,
      items: moved
    };
    await this.store.mutate((draft) => {
      for (const movedItem of moved) {
        const file = draft.files.find((candidate) => candidate.id === movedItem.fileId);
        file.absolutePath = movedItem.targetPath;
        file.relativePath = path.relative(rootPath, movedItem.targetPath);
        file.name = path.basename(movedItem.targetPath);
        file.organized = true;
      }
      draft.operations.unshift(operation);
      draft.operations = draft.operations.slice(0, 100);
      return operation;
    });
    return { operation, state: this.getState() };
  }

  async undo(operationId) {
    const state = this.store.read();
    const operation = state.operations.find((item) => item.id === operationId);
    if (!operation) throw new AppError('操作记录不存在。', 404, 'OPERATION_NOT_FOUND');
    if (operation.status === 'undone') throw new AppError('该操作已经撤销。', 409, 'ALREADY_UNDONE');
    const rootPath = await validateDirectory(state.settings.rootPath);

    for (const item of operation.items) {
      if (!isPathInside(rootPath, item.targetPath) || !isPathInside(rootPath, item.originalPath)) {
        throw new AppError('撤销路径超出当前整理目录。', 400, 'UNSAFE_UNDO_PATH');
      }
      try {
        await fs.access(item.targetPath);
      } catch {
        throw new AppError(`无法撤销，整理后的文件不存在：${path.basename(item.targetPath)}`, 409, 'TARGET_MISSING');
      }
      try {
        await fs.access(item.originalPath);
        throw new AppError(`无法撤销，原位置已有同名文件：${path.basename(item.originalPath)}`, 409, 'ORIGINAL_OCCUPIED');
      } catch (error) {
        if (error instanceof AppError) throw error;
      }
    }

    for (const item of [...operation.items].reverse()) {
      await moveFile(item.targetPath, item.originalPath);
    }
    await this.store.mutate((draft) => {
      const savedOperation = draft.operations.find((item) => item.id === operationId);
      savedOperation.status = 'undone';
      savedOperation.undoneAt = new Date().toISOString();
      for (const item of savedOperation.items) {
        const file = draft.files.find((candidate) => candidate.id === item.fileId);
        if (!file) continue;
        file.absolutePath = item.originalPath;
        file.relativePath = path.relative(rootPath, item.originalPath);
        file.name = path.basename(item.originalPath);
        file.organized = false;
      }
      return savedOperation;
    });
    return this.getState();
  }
}
