import { fileURLToPath } from 'node:url';

// 服务命令始终在前端模块执行，不随配置文件所在目录改变。
export const webRoot = fileURLToPath(new URL('../../', import.meta.url));
