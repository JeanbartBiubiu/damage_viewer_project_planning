# Damage Viewer Web

`web/` 是 Damage Viewer 的前端工作台。它负责当前阶段 0～9 的管理页面、图片缓存，以及底层 TinyGo V2 Wasm 运行时资源。

它在整条链路里的位置是：

1. 读取后端游戏列表和当前管理接口。
2. 提供属性、角色、装备、技能分类、伤害类型、技能、状态、游戏配置和图片管理页。
3. 在浏览器侧处理上传图片，并缓存、同步公开图片资源。

## 当前主要页面

- `src/App.tsx`：应用外壳、路由、API 基址和本地状态；根地址与未知 Hash 落到 `#/attributes`
- `src/pages/admin/attributes/`：属性管理（`#/attributes`）
- `src/pages/admin/characters/`：角色管理（`#/characters`）；关联技能行可直接「录入技能」，进入选中技能的参数、公式、效果、过程和触发编辑入口；「返回角色技能」重新打开同一角色的关联弹窗，并保留角色列表筛选。
- `src/pages/admin/equipment/`：装备管理（`#/equipment`）
- `src/pages/admin/skill-categories/`：技能分类管理（`#/skill-categories`）
- `src/pages/admin/damage-types/`：伤害类型管理（`#/damage-types`）
- `src/pages/admin/skills/`：技能管理（`#/skills`，含参数、公式、效果与结果及效果生命周期、过程与内部状态、条件与触发）
  - 冷却变化与技能急速修正共用“技能范围”（全部技能 / 指定技能 / 指定技能分类）；请求与回显字段为 `detail.affectedSkillScope`
  - 效果结果共十七种，含技能急速修正、斩杀、命中联动应用和攻击联动应用；条件与触发含应用命中联动、触发攻击联动
- `src/pages/admin/statuses/`：状态管理（`#/statuses`）
- `src/pages/admin/game-settings/`：游戏配置（`#/game-settings`）
- `src/pages/admin/images/`：图片管理、浏览器侧图片处理与缓存工具（`#/images`）

## 关键入口地图

- `src/App.tsx`：应用壳层、页面切换和全局本地状态
- `src/config/navigation.ts`：导航项
- `src/services/apiClient.ts`：API 基址、游戏列表和统一错误处理
- `src/types/image.ts`、`src/services/imageClient.ts`：图片管理详情与写入、公开同步接口
- `src/services/resourceImage.ts`、`src/services/imageCache.ts`：上传前处理与浏览器本地缓存
- `src/pages/admin/relations/`：角色和装备的技能挂载、七类对象代表图片、图片用途反查弹窗；在既有页面进入
- `src/services/skillRelationClient.ts`、`src/services/imageRelationClient.ts`：关系接口、严格响应校验和统一错误处理
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
| `npm run test:e2e:non-wasm` | 隔离的非 Wasm Playwright 验收：当前 10 类管理页；仅桌面版 Chrome，不覆盖移动端；无需 `E2E_*` |

## 常用验证

开发中先运行受影响的类型或测试检查；以下完整检查在功能收尾执行。阶段提交前再执行非 Wasm 端到端测试。已有结果对应最终代码时，不因代理交接重复执行。

```powershell
cd web
npm run lint
npm run typecheck
npm run test
npm run build
```

本迭代默认页面回归为**非 Wasm**。可复用清单见 [../文档记录/测试记录/web/非Wasm最小回归清单.md](../文档记录/测试记录/web/非Wasm最小回归清单.md)。当前管理页只维护桌面布局，不覆盖移动端。

技能效果、过程、内部状态和触发规则的数值统一提供「固定数值」「技能参数」「技能公式」三种取值来源。参数和公式限当前技能，固定 0 与未配置分别保存；纯固定值不依赖公式目录。时间允许符合范围的小数，次数与层数保持整数要求，直接参数与公式内的动态输入一起核对绑定。

阶段 7.5 在技能行提供「条件与触发」入口，不新增导航或路由。配置范围为 21 种固定事件、6 种条件、3 种动作和 5 种动态输入来源；只保存规则聚合，不执行事件/公式，也不含运行时或 Wasm。效果结果共十七种，含技能急速修正、斩杀、命中联动应用和攻击联动应用。

生命周期检查直接读取当前技能效果的实例，支持存在、不存在和层数比较；主体随效果已有范围显示，层数比较复用三种取值且禁止动态输入。已保存条件不能更换种类，删除后新增条件会避开原标识。

「命中目标类别」仅用于技能命中和普攻命中，支持多选英雄、史诗野怪、小兵、非史诗野怪和建筑，固定判断本次实际命中目标；切换到其他事件需确认清除该条件。类别条件不作为循环保护，也不代替尚未实现的命中事件生产。

「来源施放资源消耗」仅供已选择来源技能的技能命中规则绑定，属性来自当前游戏目录，目标限动作可达的计算时输入十进制参数。目录失败可保留草稿并刷新；已有绑定不能更换来源种类，需删除后用新标识新增。当前提供管理录入，不生产运行时施放消耗快照。

阶段 7.6.5 已完成桌面编写 UI：事件值当前 24 项，前序结果输出 10 项；条件与绑定共用一张事件能力表；前序结果按更早执行效果动作、即时来源结果、合法输出三级选择。未知字符串按协议错误拒绝，不从列表摘要推断输出，也不提供自由输出、跨规则引用、移动端或运行预览。

「技能命中被法术护盾阻挡」仅在技能命中的事件值条件和动态绑定中提供，结果按整数 0/1 解释，比较取值仍沿用现有数值规则；切换到其他事件需确认清除相关条件和绑定。原有伤害事件的阻挡值保持原义，当前不生产运行时命中判定。

阶段 8 图片管理位于 `#/images`。本地缓存工具在图片列表上方；列表直接读取当前游戏的浏览器本地数据库，不请求后端管理列表，缓存为空时由维护者执行全量同步。浏览器只接受不超过 5 MB、宽高不超过 4096 像素的 PNG/JPEG：宽高都不超过 64 像素时保持原内容，任一边超过 64 时按短边居中裁切并缩小到最大 64×64；后端不代为处理。浏览器本地数据库 `image_db` 使用版本 2，停用图片保留更新时间但不保留可展示内容。

阶段 9 在角色、装备列表提供「关联技能」，技能列表提供「挂载对象」；三处共用双向关系弹窗，可新增、调整顺序和移除。游戏配置独立显示「代表图片」面板，角色、属性、装备、技能、技能效果和状态行提供同名入口；图片行的「用途关系」按七类来源反查并维护。图片候选由后端按名称或标识搜索，图片内容只从当前游戏本地缓存预览。停用目标保留旧关系并显示不可用，接口错误保留草稿，切换游戏、API 或对象后丢弃迟到响应。

游戏摘要使用可空 `representativeImageKey`，不再读取旧封面地址字段。关系字段由专用接口保存，不混入对象主体请求。共享契约和当前验证记录由规划工作树的 `文档记录/详细设计/项目/关联管理详细设计.md` 维护入口；前端模块说明位于同一工作树的 `文档记录/详细设计/web/关联管理前端详细设计.md`。

各对象的「代表图片」默认直接上传：选择本地图片、预览后点击「上传并使用」，自动创建图片并建立当前对象的关系；名称与标识自动生成，无需先进入图片管理。新图片同时写入当前游戏缓存。替换会创建新图片并切换当前对象关系，其他对象共享的旧图保持原内容。「选择已有图片」保留为次要入口。

角色、属性、装备、技能、技能效果和状态表格在名称前固定显示「图片」列，使用 48×48 缩略图。关系从现行接口读取，所有表格合计最多同时读取 6 项，筛选或离页会取消旧请求；内容复用当前游戏缓存。上传、更换或移除后立即更新当前行。未设置、未缓存、停用及读取失败均显示对应占位，刷新列表会重新读取图片关系。

角色列表的「录入检查」读取当前角色和直接挂载技能，集中展示结构错误、人工待核对项、技能数量及直接引用。可以进入基础资料、等级属性、关联技能或单项技能维护，返回后重新读取检查结果并保留角色筛选。请求失败和缺失响应不会显示检查通过；被诊断的空名称、非法状态等值仍可显示。页面明确提示机制完整性待人工核对、战斗运行未执行，检查本身只发送 GET 请求。

阶段提交前在 `web/` 运行：

```powershell
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:e2e:non-wasm
```

聚焦条件与触发：`npx vitest run --config vitest.config.ts src/services/skillTriggerRuleClient.test.ts src/pages/admin/skills/triggers`，以及 `npx playwright test --config playwright.non-wasm.config.ts -g "condition and trigger"`。

页面或联调行为变化时，浏览器验证覆盖受影响的路径和关键操作。共享路由、API 基址、认证或缓存变化再扩大相关回归；普通字段修改无需人工逐页遍历。完整阶段检查保持上面的命令顺序。

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
