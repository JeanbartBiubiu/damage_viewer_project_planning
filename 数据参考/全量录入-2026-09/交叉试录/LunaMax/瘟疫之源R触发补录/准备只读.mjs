import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runForDirectory } from '../麦林炮手Q触发补录/准备只读.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
await runForDirectory(here, 'twitch');
