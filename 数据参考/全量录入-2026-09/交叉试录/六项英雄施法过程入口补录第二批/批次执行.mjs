import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProtectedTriggerBatch } from '../共享受保护触发批次/受保护触发批次-v1.mjs';
import { batchConfig } from './批次配置.mjs';

const batchDirectory = path.dirname(fileURLToPath(import.meta.url));
await runProtectedTriggerBatch({ batchDirectory, config: batchConfig, mode: process.argv[2] });
