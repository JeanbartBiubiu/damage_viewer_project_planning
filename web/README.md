# Damage Viewer Web

`web/` 是 Damage Viewer 的前端工作台。它负责当前阶段 0～7.5 的管理页面、图片缓存，以及底层 TinyGo V2 Wasm 运行时资源。

它在整条链路里的位置是：

1. 读取后端游戏列表、当前管理接口和 images。
2. 提供属性、角色、装备、技能分类、伤害类型、技能、状态和游戏配置管理页。
3. 在浏览器侧缓存并同步图片资源。

## 当前主要页面

- `src/App.tsx`：应用外壳、路由、API 基址和本地状态；根地址与未知 Hash 落到 `#/attributes`
- `src/pages/admin/attributes/`：属性管理（`#/attributes`）
- `src/pages/admin/characters/`：角色管理（`#/characters`）
- `src/pages/admin/equipment/`：装备管理（`#/equipment`）
- `src/pages/admin/skill-categories/`：技能分类管理（`#/skill-categories`）
- `src/pages/admin/damage-types/`：伤害类型管理（`#/damage-types`）
- `src/pages/admin/skills/`：技能管理（`#/skills`，含参数、公式、效果与结果及效果生命周期、过程与内部状态、条件与触发）
  - 冷却变化结果的“受影响技能”使用默认多选组件；请求与回显字段为 `detail.affectedSkillKeys`
  - 效果结果含斩杀、命中联动应用和攻击联动应用；条件与触发含应用命中联动、触发攻击联动
- `src/pages/admin/statuses/`：状态管理（`#/statuses`）
- `src/pages/admin/game-settings/`：游戏配置（`#/game-settings`）
- `src/pages/ImagesPage.tsx`：图片缓存与同步（`#/images`）

## 关键入口地图

- `src/App.tsx`：应用壳层、页面切换和全局本地状态
- `src/config/navigation.ts`：导航项
- `src/services/apiClient.ts`：API 基址、games/images
- `src/types/skillTriggerRule.ts`、`src/services/skillTriggerRuleClient.ts`：技能条件与触发规则 list/get/create/update/delete（`/api/admin/games/{gameId}/skills/{skillKey}/trigger-rules`）
- `src/engine/genericEngineClient.ts`：通用 ABI compile / run / release
- `src/engine/tinygoV2Bridge.ts`：低层 frame / loader
- `src/engine/wasm/`：Wasm 构建产物目录

## 开发范围

默认主写入范围：

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

```powershell
cd web
npm install
npm run dev
```

| 命令 | 作用 |
| --- | --- |
| `npm install` | 安装依赖 |
| `npm run dev` | 启动 Vite |
| `npm run lint` | 静态扫描：禁止已删除的旧 Bundle/Catalog/combat-data 页面与请求 |
| `npm run typecheck` | TypeScript 工程检查 |
| `npm run test` | Vitest 单元测试 |
| `npm run build` | `tsc -b + vite build` |
| `npm run preview` | 预览生产构建 |
| `npm run test:e2e:non-wasm` | 隔离的非 Wasm Playwright 验收：当前 9 类管理页；仅 Desktop Chrome，不覆盖移动端；无需 `E2E_*` |

## 常用验证

```powershell
cd web
npm run lint
npm run typecheck
npm run test
npm run build
```

本迭代默认页面回归为**非 Wasm**。可复用清单见 [../文档记录/测试记录/web/非Wasm最小回归清单.md](../文档记录/测试记录/web/非Wasm最小回归清单.md)。当前管理页只维护桌面布局，不覆盖移动端。

阶段 7.5 在技能行提供「条件与触发」入口，不新增导航或路由。配置范围为 21 种固定事件、4 种条件、3 种动作和 4 种动态输入来源；只保存规则聚合，不执行事件/公式，也不含运行时、Wasm 或阶段 7.6.5 丰富输出。效果结果共十六种，含斩杀、命中联动应用和攻击联动应用。

阶段提交前在 `web/` 运行：

```powershell
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:e2e:non-wasm
```

聚焦条件与触发：`npx vitest run --config vitest.config.ts src/services/skillTriggerRuleClient.test.ts src/pages/admin/skills/triggers`，以及 `npx playwright test --config playwright.non-wasm.config.ts -g "condition and trigger"`。

涉及页面或联调行为改动时，按固定顺序至少回归：

1. 静态：`npm run lint` → `typecheck` → `test` → `build` → `test:e2e:non-wasm`
2. `#/attributes`
3. `#/characters`、`#/equipment`、`#/skill-categories`、`#/damage-types`、`#/skills`、`#/statuses`、`#/game-settings`
4. `#/images`

## 常见问题

### 1. 页面能打开，但接口请求失败

- 确认后端服务是否已启动。
- 检查页面内 API 基址与 `VITE_API_BASE_URL`。
- 若浏览器缓存了旧地址，清理本地存储后重试。

### 2. 根地址没有进入属性管理

- 空 Hash 与无法识别的旧 Hash 都会落到 `#/attributes`。
- 确认前端构建已包含当前路由，而不是仍打开旧总览页。

## 协作说明

- 这不是独立仓，而是 monorepo 下的前端专用 worktree。
- 前端默认消费已经同步到 `src/engine/wasm/` 的 TinyGo V2 产物；本任务不改 Wasm ABI。
- 更细的协作边界见同目录 `AGENTS.md`。
