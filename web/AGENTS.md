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

1. `src/App.tsx`：应用壳层、页面切换、游戏选择、API 基址和本地状态。
2. `src/config/navigation.ts`：页面导航、公开接口与 Admin 资源入口定义。
3. `src/services/apiClient.ts`：API 基址解析、请求封装、错误模型。
4. `src/engine/worker.ts`：Web Worker 宿主。
5. `src/engine/wasmBridge.ts`：前端到 Wasm 的桥接层。
6. `src/engine/wasm/`：Wasm 构建产物目录。
7. `src/pages/admin/**`：后台资源维护页面。

## 4. 常用命令

在 `web/` 目录执行：

1. `npm install`：安装依赖。
2. `npm run build:wasm`：调用 `..\wasm\katarina_mvp_engine\build-web-wasm.ps1` 生成并复制 Wasm 产物。
3. `npm run dev`：启动 Vite；执行前会先跑 `predev -> build:wasm`。
4. `npm run build`：执行 `build:wasm + tsc -b + vite build`。
5. `npm run preview`：预览生产构建结果。

## 5. 运行时与配置约定

1. 默认 API 基址回退到 `http://localhost:8080`。
2. 可通过 `VITE_API_BASE_URL` 提供默认 API 基址。
3. 页面内切换后的 API 基址与 Admin Token 会持久化到浏览器本地存储；修改服务层时注意兼容这一行为。
4. 不要把机器本地绝对路径硬编码进前端业务源码；跨目录桥接优先通过脚本、环境变量或配置项处理。

## 6. 实现边界

1. 优先保证 `web/**` 可单独安装、单独启动、单独构建。
2. Wasm 默认视为前端消费的运行时产物；只有 ABI、宿主桥接或本地构建链确有需要时，才最小化改动 `wasm/**`。
3. 涉及接口行为时，以前端服务层、接口契约和联调结果为准，不直接假设后端实现细节。
4. 跨模块改动只做支撑当前前端任务所必需的最小变更。

## 7. 完成定义

1. 只改文档：无需构建，但要核对提到的入口文件、脚本和命令仍然存在。
2. 改 `web/**` 代码：默认至少运行一次 `npm run build`。
3. 改 Wasm 桥接、`worker.ts` 或 `wasmBridge.ts`：至少确认 `npm run build:wasm` 路径仍成立，并核对产物目录 `src/engine/wasm/`。
4. 改页面或服务层时，至少按影响范围做 smoke check：`总览`、`版本发布`、`Katarina MVP`、`场景模拟`、`图片缓存`、相关 Admin 页面。

## 8. Obsidian 回写边界

1. Web 专用记忆目录：`C:\project\obsidian-game\ai-remember\web专用\`
2. 会话记录默认写入：`C:\project\obsidian-game\ai-remember\web专用\会话记录\`
3. 非汇总会话不要直接修改 Vault 根目录共享页。