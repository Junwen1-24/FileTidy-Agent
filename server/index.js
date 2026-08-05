import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { FileTidyService } from './service.js';

const config = loadConfig();
const service = new FileTidyService(config);
await service.init();

const server = createApp({ service, publicDir: config.publicDir });
server.listen(config.port, config.host, () => {
  console.log(`FileTidy Agent 已启动：http://${config.host}:${config.port}`);
  console.log(`当前数据目录：${config.dataDir}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
