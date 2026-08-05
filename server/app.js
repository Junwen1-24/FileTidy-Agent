import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

import { toErrorPayload } from './errors.js';

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(value));
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) throw Object.assign(new Error('请求内容过大。'), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('请求 JSON 格式不正确。'), { statusCode: 400 });
  }
}

async function serveStatic(publicDir, pathname, response) {
  const requested = pathname === '/' ? 'index.html' : pathname.slice(1);
  const filePath = path.resolve(publicDir, requested);
  if (!filePath.startsWith(`${path.resolve(publicDir)}${path.sep}`)) return false;
  try {
    const content = await fs.readFile(filePath);
    response.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    response.end(content);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

export function createApp({ service, publicDir }) {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const { pathname } = url;
    try {
      if (request.method === 'GET' && pathname === '/api/health') {
        return sendJson(response, 200, { ok: true });
      }
      if (request.method === 'GET' && pathname === '/api/state') {
        return sendJson(response, 200, { data: service.getState() });
      }
      if (request.method === 'POST' && pathname === '/api/settings') {
        const body = await readBody(request);
        return sendJson(response, 200, { data: await service.updateSettings(body.rootPath) });
      }
      if (request.method === 'POST' && pathname === '/api/demo/reset') {
        return sendJson(response, 200, { data: await service.resetDemo() });
      }
      if (request.method === 'POST' && pathname === '/api/scan') {
        return sendJson(response, 200, { data: await service.scan() });
      }
      const tagMatch = pathname.match(/^\/api\/files\/([^/]+)\/tags$/);
      if (request.method === 'PATCH' && tagMatch) {
        const body = await readBody(request);
        const file = await service.updateTags(decodeURIComponent(tagMatch[1]), body.tags);
        return sendJson(response, 200, { data: file });
      }
      if (request.method === 'POST' && pathname === '/api/files/bulk-confirm') {
        const body = await readBody(request);
        return sendJson(response, 200, { data: await service.confirmSuggestions(body.fileIds) });
      }
      if (request.method === 'POST' && pathname === '/api/organize/preview') {
        const body = await readBody(request);
        return sendJson(response, 200, { data: service.previewOrganize(body.fileIds) });
      }
      if (request.method === 'POST' && pathname === '/api/organize/execute') {
        const body = await readBody(request);
        return sendJson(response, 200, { data: await service.organize(body.fileIds) });
      }
      const undoMatch = pathname.match(/^\/api\/operations\/([^/]+)\/undo$/);
      if (request.method === 'POST' && undoMatch) {
        const state = await service.undo(decodeURIComponent(undoMatch[1]));
        return sendJson(response, 200, { data: state });
      }
      if (pathname.startsWith('/api/')) return sendJson(response, 404, { error: { message: '接口不存在。', code: 'NOT_FOUND' } });
      if (request.method === 'GET' && await serveStatic(publicDir, pathname, response)) return;
      sendJson(response, 404, { error: { message: '页面不存在。', code: 'NOT_FOUND' } });
    } catch (error) {
      if (error.statusCode && !(error.status || error.code)) {
        sendJson(response, error.statusCode, { error: { code: 'BAD_REQUEST', message: error.message } });
        return;
      }
      const payload = toErrorPayload(error);
      sendJson(response, payload.status, payload.body);
    }
  });
}
