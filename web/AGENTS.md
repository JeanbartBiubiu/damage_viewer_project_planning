# Web AGENTS.md

## 1. 适用范围

本文件适用于当前 worktree 下的 `web/**`。

若与仓库根 `AGENTS.md` 冲突，以本文件为准。

## 2. 默认写入与参考边界

默认主写入范围：

1. `web/**`
2. 与前端构建、发布、资源处理直接相关的 `tools/**`
3. `文档记录/**` 中与前端页面、发布链、缓存策略、Wasm 宿主集成直接相关的文档

默认只读参考：

1. `server/**`
2. `db/**`
3. `wasm/**`
4. `接口/**`

## 3. 关键入口地图

进入 `web/**` 工作时先读同目录 `README.md`，再按任务目标读取下列入口：

1. `src/App.tsx`：应用壳层、页面切换、游戏选择、API 基址和本地状态。
2. `src/config/navigation.ts`：页面导航、公开接口与 Admin 资源入口定义。
3. `src/services/apiClient.ts`：API 基址解析、请求封装、错误模型、games/current/images/publish。
4. `src/services/combatDataClient.ts`：Public/Admin combat-data 客户端。
5. `src/services/combatDataLoader.ts`：revision-safe 读取与 IndexedDB 缓存。
6. `src/engine/combatDataAssembler.ts`：combat-data → `CompileRequest` 组装。
7. `src/engine/tinygoV2Bridge.ts`：TinyGo V2 Wasm ABI 桥接层。
8. `src/engine/genericEngineClient.ts`：通用 ABI compile / run / release。
9. `src/pages/admin/combat-data/**`：按资源表拆分的 combat-data 编辑页（`#/combat-data/<resource-id>`）。

## 4. 常用命令

在 `web/` 目录执行：

1. `npm install`：安装依赖。
2. `npm run dev`：启动 Vite。
3. `npm run lint`：禁止旧数据面 REST/模块引用的静态扫描。
4. `npm run typecheck`：TypeScript 检查。
5. `npm run test`：Vitest 单元测试。
6. `npm run build`：执行 `tsc -b + vite build`。
7. `npm run preview`：预览生产构建结果。

## 5. 运行时与配置约定

1. 默认 API 基址回退到 `http://localhost:8080`。
2. 可通过 `VITE_API_BASE_URL` 提供默认 API 基址。
3. 页面内切换后的 API 基址与 Admin Token 会持久化到浏览器本地存储。
4. 不要把机器本地绝对路径硬编码进前端业务源码。
5. 事实数据面仅为 `combat-data/**`；不要恢复 Bundle / wasm-catalog / hero/item/skill 双读。

## 6. 实现边界

1. 优先保证 `web/**` 可单独安装、单独启动、单独构建。
2. Wasm 默认视为前端消费的运行时产物；只有 ABI、宿主桥接或本地构建链确有需要时，才最小化改动 `wasm/**`。
3. 涉及接口行为时，以前端服务层与后端 combat-data 契约为准。
4. Admin PUT 必须剥离 revision/version 元数据；effect-step 必须恰好一个 detail。

## 7. 完成定义

1. 只改文档：无需构建，但要核对提到的入口文件、脚本和命令仍然存在。
2. 改 `web/**` 代码：默认至少运行 `npm run lint`、`npm run typecheck`、`npm run test`、`npm run build`。
3. 改 Wasm 桥接或 `tinygoV2Bridge.ts`：至少核对 `src/engine/wasm/tinygo_engine_v2.wasm` 与 ABI 导出函数仍匹配。
4. 改页面、交互或服务层时，至少按影响范围做浏览器 smoke：`总览`、`版本发布`、`combat-data 分表页`、`Wasm 验证`、`图片缓存`。

## 8. Obsidian 回写边界

1. Web 专用记忆目录：`C:\project\obsidian-game\ai-remember\web专用\`
2. 会话记录默认写入：`C:\project\obsidian-game\ai-remember\web专用\会话记录\`
3. 非汇总会话不要直接修改 Vault 根目录共享页。
