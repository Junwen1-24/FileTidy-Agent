import { loadConfig } from '../server/config.js';
import { FileTidyService } from '../server/service.js';

const service = new FileTidyService(loadConfig());
await service.store.init();
const state = await service.resetDemo();
console.log(`演示目录已重置：${state.settings.rootPath}`);
console.log(`已扫描 ${state.summary.total} 个演示文件。`);
