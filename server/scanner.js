import fs from 'node:fs/promises';
import path from 'node:path';

import { AppError } from './errors.js';
import { createId, formatBytes, unique } from './utils.js';

const CATEGORY_BY_EXTENSION = new Map([
  ['pdf', '文档'], ['doc', '文档'], ['docx', '文档'], ['txt', '文档'], ['md', '文档'],
  ['csv', '文档'], ['xls', '文档'], ['xlsx', '文档'], ['ppt', '文档'], ['pptx', '文档'],
  ['png', '图片'], ['jpg', '图片'], ['jpeg', '图片'], ['gif', '图片'], ['svg', '图片'],
  ['webp', '图片'], ['heic', '图片'],
  ['zip', '压缩包'], ['rar', '压缩包'], ['7z', '压缩包'], ['tar', '压缩包'], ['gz', '压缩包'],
  ['dmg', '安装包'], ['pkg', '安装包'], ['exe', '安装包'], ['msi', '安装包'],
  ['js', '代码'], ['mjs', '代码'], ['cjs', '代码'], ['ts', '代码'], ['tsx', '代码'],
  ['jsx', '代码'], ['py', '代码'], ['java', '代码'], ['go', '代码'], ['rs', '代码'],
  ['swift', '代码'], ['html', '代码'], ['css', '代码'], ['json', '代码'], ['yaml', '代码'], ['yml', '代码']
]);

function daysSince(timestamp, now) {
  return Math.max(0, (now - timestamp) / 86_400_000);
}

export function classifyFile({ name, extension, relativePath, mtimeMs }, now = Date.now()) {
  const suggestions = [];
  const category = CATEGORY_BY_EXTENSION.get(extension) || '其他';
  suggestions.push({
    tag: category,
    reason: extension ? `根据 .${extension} 文件类型识别` : '未识别扩展名，归入其他类型'
  });

  const age = daysSince(mtimeMs, now);
  let usageTag = '正在使用';
  let usageReason = '最近 7 天内修改过';
  if (age > 180) {
    usageTag = '长期闲置';
    usageReason = '超过 180 天未修改';
  } else if (age > 90) {
    usageTag = '可归档';
    usageReason = '超过 90 天未修改';
  } else if (age > 30) {
    usageTag = '低频';
    usageReason = '超过 30 天未修改';
  } else if (age > 7) {
    usageTag = '常用';
    usageReason = '最近 30 天内修改过';
  }
  suggestions.push({ tag: usageTag, reason: usageReason });

  const lowerName = name.toLowerCase();
  if (/(截图|截屏|screenshot|screen shot)/i.test(name)) {
    suggestions.push({ tag: '截图', reason: '文件名包含截图特征' });
  }
  if (/(临时|副本|copy|temp|draft)/i.test(lowerName)) {
    suggestions.push({ tag: '疑似临时', reason: '文件名包含临时或副本特征' });
  }

  const segments = relativePath.split(path.sep).filter(Boolean);
  const firstSegment = segments[0];
  if (segments.length > 1 && firstSegment !== '整理结果') {
    suggestions.push({ tag: `项目:${firstSegment}`, reason: `位于“${firstSegment}”目录` });
  }

  const isScreenshot = suggestions.some((item) => item.tag === '截图');
  const folder = isScreenshot ? path.join('图片', '截图') : category;
  return {
    category,
    suggestions: suggestions.filter(
      (item, index, list) => list.findIndex((other) => other.tag === item.tag) === index
    ),
    recommendation: {
      folder,
      reason: isScreenshot ? '截图文件集中归档' : `按${category}类型整理`
    }
  };
}

async function walkDirectory(rootPath, options) {
  const results = [];
  const warnings = [];

  async function walk(currentPath, depth) {
    if (results.length >= options.maxFiles) return;
    if (depth > options.maxDepth) {
      warnings.push(`已跳过深层目录：${path.relative(rootPath, currentPath)}`);
      return;
    }

    let entries;
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch (error) {
      warnings.push(`无法读取目录：${path.relative(rootPath, currentPath) || '.'}`);
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    for (const entry of entries) {
      if (results.length >= options.maxFiles) break;
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const absolutePath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath, depth + 1);
      } else if (entry.isFile()) {
        try {
          const stat = await fs.stat(absolutePath);
          results.push({ absolutePath, stat });
        } catch {
          warnings.push(`无法读取文件：${path.relative(rootPath, absolutePath)}`);
        }
      }
    }
  }

  await walk(rootPath, 0);
  if (results.length >= options.maxFiles) {
    warnings.push(`扫描达到 ${options.maxFiles} 个文件上限，结果已截断。`);
  }
  return { results, warnings: unique(warnings) };
}

export async function scanDirectory(rootPath, existingFiles, options) {
  let realRoot;
  try {
    realRoot = await fs.realpath(rootPath);
    const stat = await fs.stat(realRoot);
    if (!stat.isDirectory()) throw new Error('not a directory');
  } catch {
    throw new AppError('目录不存在或无法读取。', 400, 'INVALID_DIRECTORY');
  }

  const { results, warnings } = await walkDirectory(realRoot, options);
  const existingByPath = new Map(existingFiles.map((file) => [file.absolutePath, file]));
  const now = Date.now();
  const files = results.map(({ absolutePath, stat }) => {
    const relativePath = path.relative(realRoot, absolutePath);
    const name = path.basename(absolutePath);
    const extension = path.extname(name).slice(1).toLowerCase();
    const existing = existingByPath.get(absolutePath);
    const classification = classifyFile({ name, extension, relativePath, mtimeMs: stat.mtimeMs }, now);
    return {
      id: existing?.id || createId('file'),
      name,
      extension,
      absolutePath,
      relativePath,
      size: stat.size,
      sizeLabel: formatBytes(stat.size),
      createdAt: stat.birthtime.toISOString(),
      modifiedAt: stat.mtime.toISOString(),
      category: classification.category,
      suggestions: classification.suggestions,
      confirmedTags: existing?.confirmedTags || [],
      recommendation: classification.recommendation,
      organized: relativePath.split(path.sep)[0] === '整理结果',
      scannedAt: new Date(now).toISOString()
    };
  });

  return { rootPath: realRoot, files, warnings };
}
