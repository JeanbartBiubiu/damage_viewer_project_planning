# Web AGENTS.md

## 1. 适用范围

本文件适用于当前 worktree 下的 `web/**`。

若与仓库根 `AGENTS.md` 冲突，以本文件为准。

## 2. 默认写入与参考边界

默认主写入范围：

1. `web/**`
2. 与前端构建、发布、资源处理直接相关的 `tools/**`
3. `文档记录/**` 中与前端页面、缓存策略、Wasm 宿主集成直接相关的文档

默认只读参考：

1. `server/**`
2. `db/**`
3. `wasm/**`
4. `接口/**`

## 3. 关键入口地图

进入 `web/**` 工作时先读同目录 `README.md`，再按任务目标读取下列入口：

1. `src/App.tsx`：应用壳层、页面切换、游戏选择、API 基址和本地状态。默认与未知 Hash 落到 `#/attributes`。
2. `src/config/navigation.ts`：当前管理页导航。
3. `src/services/apiClient.ts`：API 基址解析、请求封装、错误模型和游戏列表。
4. `src/pages/admin/attributes/**`、`characters/**`、`equipment/**`、`skill-categories/**`、`damage-types/**`、`skills/**`、`statuses/**`、`game-settings/**`：当前业务管理页。
5. `src/pages/admin/images/**`：图片管理、浏览器上传前处理和本地缓存同步；图片列表直接读取当前游戏缓存。
6. `src/engine/tinygoV2Bridge.ts`：TinyGo V2 Wasm ABI 桥接层。
7. `src/engine/genericEngineClient.ts`：通用 ABI compile / run / release。

## 4. 常用命令

在 `web/` 目录执行：

1. `npm install`：安装依赖。
2. `npm run dev`：启动 Vite。
3. `npm run lint`：禁止已删除旧数据面 REST/模块/页面引用的静态扫描。
4. `npm run typecheck`：TypeScript 检查。
5. `npm run test`：Vitest 单元测试。
6. `npm run build`：执行 `tsc -b + vite build`。
7. `npm run preview`：预览生产构建结果。
8. `npm run test:e2e:non-wasm`：非 Wasm 桌面 Playwright 验收；无需 `E2E_*`。

## 5. 运行时与配置约定

1. 默认 API 基址回退到 `http://localhost:8080`。
2. 可通过 `VITE_API_BASE_URL` 提供默认 API 基址。
3. 页面内切换后的 API 基址与 Admin Token 会持久化到浏览器本地存储。
4. 不要把机器本地绝对路径硬编码进前端业务源码。
5. 当前管理页只访问当前业务接口与图片接口；不要恢复 `/combat-data/**`、旧 versions/current 或旧发布请求。

## 6. 实现边界

1. 优先保证 `web/**` 可单独安装、单独启动、单独构建。
2. Wasm 默认视为前端消费的运行时产物；只有 ABI、宿主桥接或本地构建链确有需要时，才最小化改动 `wasm/**`。
3. 涉及接口行为时，以前端服务层与当前管理接口契约为准。
4. 不要恢复旧实体、Provider、Ability、Effect Sequence、Effect Step、旧发布或旧 Wasm 验证页。

## 7. 完成定义

1. 只改文档：无需构建，但要核对提到的入口文件、脚本和命令仍然存在。
2. 开发中先运行受影响的类型和测试检查；一个功能收尾时运行 `npm run lint`、`npm run typecheck`、`npm run test`、`npm run build`。阶段提交前再运行 `npm run test:e2e:non-wasm`。已有有效结果不因角色交接重复执行，后续相关改动需重跑。
3. 改 Wasm 桥接或 `tinygoV2Bridge.ts`：至少核对 `src/engine/wasm/tinygo_engine_v2.wasm` 与 ABI 导出函数仍匹配（当前通用路径：`engine_compile` / `engine_run` / `engine_release_session`）。
4. 改页面、交互或服务层时，验证受影响的浏览器路径。只有共享路由、API 基址、认证或缓存等公共行为变化时才扩大到相关页面；普通字段修改不要求人工遍历全部管理页。

## 8. Obsidian 回写边界

1. Web 专用记忆目录：`C:\project\obsidian-game\ai-remember\web专用\`
2. 会话记录默认写入：`C:\project\obsidian-game\ai-remember\web专用\会话记录\`
3. 非汇总会话不要直接修改 Vault 根目录共享页。
