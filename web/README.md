# Damage Viewer Web

`web/` 是 Damage Viewer 的前端工作台，不是普通展示网站。它负责把后端发布链、后台资源维护、图片缓存和 Wasm 模拟入口放到一个可联调、可验证的 Web 壳里。

它在整条链路里的位置是：

1. 读取后端提供的 `current version / published bundle snapshot / images`。
2. 提供 Admin 页面维护游戏资源。
3. 缓存图片与 Bundle 快照，降低联调成本。
4. 通过 TinyGo V2 Wasm M1/M2/M3 验证页核对发布数据到计算输入与输出证据的转换。

## 当前主要页面

- `src/App.tsx`：应用外壳、路由、API 基址和本地状态
- `src/pages/OverviewPage.tsx`：系统总览和当前游戏快照
- `src/pages/VersionPublishPage.tsx`：版本发布和 `current / bundle` 快照校验
- `src/pages/WasmValidationPage.tsx`：TinyGo V2 M1 初始快照验证
- `src/pages/WasmValidationM2Page.tsx`：TinyGo V2 M2 Action 面板值验证
- `src/pages/WasmValidationM3Page.tsx`：TinyGo V2 M3 单技能 1v 假人验证
- `src/pages/WasmValidationM4ClosurePage.tsx`：TinyGo V2 M4 机制扩展闭环验证
- `src/pages/WasmValidationV2DpsPage.tsx`：TinyGo V2 单攻击方站桩普攻 DPS 验证（单英雄 / 多英雄 / 批量英雄叠层被动三模式页内切换）
- `src/pages/ImagesPage.tsx`：图片缓存与同步
- `src/pages/admin/**`：后台资源维护

## 当前迭代优先级（非 Wasm）

当前前端迭代默认先做非 Wasm 工作面，顺序如下：

1. 系统总览、版本发布、图片缓存、Admin 资源页的工作面收口
2. 版本发布页的校验与失败态补齐
3. Admin 资源页通用体验增强
4. 图片资源能力接入资源编辑链路
5. 非 Wasm 回归清单与文档收口

对应任务清单见：`../文档记录/详细设计/web/前端开发任务清单-非Wasm优先.md`

旧 `Katarina MVP` 与旧 Rust Wasm 场景模拟链路已移除，后续 Wasm 验证默认走 TinyGo V2 页面。

## 关键入口地图

- `src/App.tsx`：应用壳层、页面切换、游戏选择和全局本地状态
- `src/config/navigation.ts`：导航项、公开接口说明和 Admin 资源入口
- `src/services/apiClient.ts`：API 基址解析、请求封装、错误处理
- `src/engine/tinygoV2Bridge.ts`：TinyGo V2 Wasm ABI 桥接层
- `src/engine/tinygoV2BundleAdapter.ts`：发布 Bundle 到 TinyGo V2 输入的适配层
- `src/engine/wasm/`：Wasm 构建产物目录

## 开发范围

这个模块默认主写入范围：

- `web/**`
- 与前端构建、发布、缓存直接相关的 `tools/**`
- `文档记录/**` 中与前端直接相关的文档

默认只读参考：

- `server/**`
- `db/**`
- `wasm/**`
- `接口/**`

## 环境与配置

前置要求：

- Node.js `18+`
- npm

API 基址解析顺序：

1. 页面内手动输入并保存的地址
2. 环境变量 `VITE_API_BASE_URL`
3. 默认值 `http://localhost:8080`

说明：

- 页面内切换后的 API 基址会持久化到浏览器本地存储。
- Admin Token 也会持久化到浏览器本地存储，仅用于当前前端工作台联调。

## 本地开发

安装依赖并启动：

```powershell
cd web
npm install
npm run dev
```

当前常用命令：

| 命令 | 作用 | 说明 |
| --- | --- | --- |
| `npm install` | 安装依赖 | 首次进入或依赖变更后执行 |
| `npm run dev` | 启动本地开发服务器 | 启动 Vite |
| `npm run build` | 生产构建校验 | 执行 `tsc -b + vite build` |
| `npm run preview` | 预览生产构建 | 用于检查构建产物 |

开发说明：

- `web/src/engine/wasm/tinygo_engine_v2.wasm` 是当前前端验证页使用的 Wasm 产物。
- 如需刷新 TinyGo 产物，在 `../wasm/tinygo_engine_v2` 按该模块 README 构建后再同步到 `web/src/engine/wasm/`。
- 默认 API 基址是 `http://localhost:8080`，也可以在页面内切换或通过 `VITE_API_BASE_URL` 预设。

## 常用验证

最低自动化验证：

```powershell
cd web
npm run build
```

这个命令会同时验证：

1. TypeScript 编译
2. Vite 生产构建

当前前端没有独立的 `lint` / `test` 脚本，默认以 `npm run build` 作为最小自动化校验。

涉及页面、服务层或联调行为改动时，至少回归这些能力：

1. 总览页读取当前游戏与当前版本
2. 版本发布页读取 `current / bundle`
3. Wasm M1/M2/M3 验证页成功加载当前版本、Bundle 与 TinyGo V2 产物
4. Admin 页面增删改查
5. 图片缓存页同步

## 常见问题

### 1. 页面能打开，但接口请求失败

- 确认后端服务是否已启动。
- 检查页面内 API 基址、`VITE_API_BASE_URL` 和默认地址是否一致。
- 若浏览器里缓存了旧地址，清理本地存储后重试。

### 2. Wasm 验证页加载不到 TinyGo 产物

- 确认 `src/engine/wasm/tinygo_engine_v2.wasm` 存在。
- 如果改过 TinyGo ABI 或 `tinygoV2Bridge.ts`，优先回查导出函数名和产物引用路径。

## 协作说明

- 这不是独立仓，而是 monorepo 下的前端专用 worktree。
- 前端默认消费已经同步到 `src/engine/wasm/` 的 TinyGo V2 产物，不再自动构建旧 Rust/Katarina Wasm。
- 默认主写入范围是 `web/**`，以及少量前端直接相关的 `tools/**` 和 `文档记录/**`。
- 更细的协作边界、完成定义与记忆回写规则，见同目录下的 `AGENTS.md`。
