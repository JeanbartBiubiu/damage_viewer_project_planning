# 平台推进计划：Rust Wasm 主链 + 核心编辑后台

## Summary

- 本阶段先做两条主线：Rust Wasm 成为唯一计算核心；前端后台补齐 4 张核心表编辑与版本发布闭环。
- 当前 Rust 工程已经实现 `engine_init / engine_run / engine_response_ptr / engine_response_len` 的 JSON ABI，前端后续统一回到这条桥接，不再继续扩旧的 raw 数值 ABI。
- 首批后台只做 `formulaProfiles / formulaBindings / coefficientBuckets / statusActionControlRules`，并接上版本创建、版本发布、发布后刷新 current version 和 bundle。
- 本阶段不做图片缓存替换、不扩权限、不做英雄/技能/装备大表编辑、不新增前端自动化测试框架。
- Wasm 技术路线固定为 Rust；等平台关键链路稳定后再单独评估是否迁移到 Go。

## Recent Progress

### 已落地更新（2026-03-24）

- Rust Wasm 已在当前 Windows MSVC 环境下重新编译通过，`web/src/engine/wasm/katarina_mvp_engine.wasm` 已切换到 JSON ABI 导出：
  - `alloc(len)`
  - `dealloc(ptr, len)`
  - `engine_init(ptr, len)`
  - `engine_run(ptr, len)`
  - `engine_response_ptr()`
  - `engine_response_len()`
- `web/src/engine/wasmBridge.ts` 已补 ABI 校验；如果前端误加载旧的 raw-ABI 产物，会直接报 `Wasm ABI mismatch`，不再出现 `this.exports.alloc is not a function` 这种低信息量报错。
- `wasm/katarina_mvp_engine/build-web-wasm.ps1` 已改为 `cargo build` 非 0 立即失败，不再继续复制陈旧 wasm 产物伪装成功。
- `web/package.json` 已给 `dev` 加上前置 `build:wasm`，避免本地开发继续吃到过期 Wasm 文件。
- `npm run build` 已通过，当前链路为：
  - `build:wasm`
  - `tsc -b`
  - `vite build`
- `AdminPage` 已补“后台入口”模块，可直接聚焦 4 张核心表资源：
  - `公式档案`
  - `公式绑定`
  - `乘区桶`
  - `状态动作规则`
- 左侧导航已新增“后台资源”二级菜单，4 张核心表都可从侧栏直接进入，并高亮当前资源。
- 后台资源入口已支持深链：
  - `#/admin/formula-profiles`
  - `#/admin/formula-bindings`
  - `#/admin/coefficient-buckets`
  - `#/admin/status-action-control-rules`
- `AdminPage` 的 Detail 区已经补齐显式操作按钮：
  - `新增`
  - `编辑`
  - `修改(PATCH)`
- “新增”当前按后端现状建模为：
  - 用户填写新 key
  - 前端生成默认 payload 草稿
  - 调用 `PUT /api/admin/games/{gameId}/.../{id}` 完成创建
- 版本发布成功后，前端已可触发 `current version + bundle` 刷新，并把刷新种子透传到 `Katarina MVP` 页面。

### 当前仍需补齐的交互

- 4 张核心表目前已经拆成左侧独立二级菜单，但底层仍复用同一个 `AdminPage` 容器，而不是 4 个完全独立页面。
- 页面已经具备：
  - 列表
  - 详情加载
  - `新增`
  - `编辑`
  - `修改(PATCH)`
  - `PUT` 全量保存
  - `PATCH` 局部保存
- “新增”虽然已经可用，但仍依赖前端根据资源类型生成默认 payload 草稿；后续可以继续补强模板质量、字段校验和错误提示。
- 后续如果继续补前端后台交互，优先级建议为：
  - 继续打磨各资源的新增模板与字段校验
  - 视信息密度决定是否把 4 张表进一步拆成真正独立页面
  - 增补更细的保存结果反馈与操作指引

## Key Changes

### Wasm 主链

- 以 `wasm/katarina_mvp_engine` 为唯一计算核心，前端默认走 Wasm，TS runtime 仅保留迁移期兜底，最终不作为主路径。
- 把当前 TS runtime 已验证过的事件分项逻辑迁回 Rust，引擎输出继续包含 `events`，字段语义对齐前端 `EngineDamageEvent`。
- 废弃前端旧的 `run_basic_attack / run_death_lotus` 数值 ABI 读取方式，统一改为 JSON request/response 内存桥接。
- 新增中文说明文档，写清楚 Rust Wasm 当前支持范围、输入输出协议、黄金样例和已知限制，降低直接阅读 Rust 代码的门槛。

### 前端引擎桥接

- `wasmBridge` 改为分配输入内存、写入 `init/run` JSON、调用 `engine_init/engine_run`、读取 response buffer、解析成功和错误结构。
- `worker` 和 `client` 保持现有消息流，继续返回 `tick/done/error`，但 `done.events` 改由 Rust 引擎真实生成。
- 共享契约以 `web/src/engine/types.ts` 为前端真相源，Rust 侧按该契约对齐，不再长期维护两套语义。

### 核心编辑后台

- 在现有 `web/src/pages/AdminPage.tsx` 上新增 4 张核心表的列表、详情、编辑、保存入口，并从左侧导航提供独立二级菜单直达。
- 每类实体支持 `GET` 详情、`PUT` 全量保存、`PATCH` 局部保存；页面内已补 `新增 / 编辑 / 修改(PATCH)` 显式按钮，以及提交中、成功、校验失败、语义错误提示。
- 新增记录目前沿用 `PUT create` 模式，由前端先生成默认草稿并填写资源 key。
- 新增版本创建与发布按钮，发布成功后刷新 admin 快照，并触发前端重新获取 `current version + bundle`。

### 平台闭环

- 发布成功后，前端自动重新初始化引擎，再用当前 `Katarina MVP` 场景复跑同一输入，验证发布前后结果变化。
- 本阶段先打通从数据编辑到模拟结果变化的最短闭环，不扩展到图片缓存、权限、全量实体编辑。

## Delegation And Sequence

### 主代理

- 负责先落根目录计划文档，再负责共享契约整合、跨子任务冲突处理和最终联调。

### Wasm 工程

- `wasm_engineer` 独占 `wasm/katarina_mvp_engine/**`，负责把 Rust 引擎补齐到事件级输出，并更新 Wasm 中文协议文档。

### 前端平台层

- `frontend_platform_dev` 独占 `web/src/engine/wasmBridge.ts`、`web/src/engine/worker.ts`、`web/src/engine/client.ts`、`web/src/services/apiClient.ts`。
- 负责 JSON ABI 桥接、admin 写接口封装、发布后刷新 current version 和 bundle 的串联。

### 前端后台页

- `frontend_scene_dev` 独占 `web/src/pages/AdminPage.tsx` 和新增后台编辑组件。
- 负责 4 张核心表的编辑 UI、版本创建 UI、版本发布 UI 和结果反馈。

### 验证

- `test_engineer` 不做前端 UI 自动化测试，只维护黄金样例、编辑发布回归清单和结果对比记录。

### 执行顺序

- 先并行启动 `wasm_engineer` 与 `frontend_scene_dev`。
- `frontend_platform_dev` 在 Wasm ABI 目标明确后接桥接和发布闭环。
- 最后由主代理整合 shared types、联调和回归。

## Important Interfaces

### Rust JSON ABI

- `alloc(len)`
- `dealloc(ptr, len)`
- `engine_init(ptr, len)`
- `engine_run(ptr, len)`
- `engine_response_ptr()`
- `engine_response_len()`

### 前端引擎输出

- `EngineRunOutput.result`
- `EngineRunOutput.samples`
- `EngineRunOutput.events`

### 前端新增并接通的 admin 写接口

- `PUT/PATCH /api/admin/games/{gameId}/formula-profiles/{formulaId}`
- `PUT/PATCH /api/admin/games/{gameId}/formula-bindings/{targetCategory}/{targetId}/{bindingKey}`
- `PUT/PATCH /api/admin/games/{gameId}/coefficient-buckets/{bucketKey}`
- `PUT/PATCH /api/admin/games/{gameId}/status-action-control-rules/{ruleId}`
- `POST /api/admin/games/{gameId}/versions`
- `POST /api/admin/games/{gameId}/versions/{versionId}:publish`

## Test Cases

### Wasm 验真

- 平A本体、破败当前生命值伤害、纳什附伤、100 护甲/魔抗减伤、多段技能、取消运行。
- 每条样例同时检查总伤害、样本点、事件分项，不只看汇总值。

### 编辑发布闭环

- 4 张核心表各验证一次：详情加载、保存成功、服务端校验失败、语义错误提示。
- 修改一条公式或乘区桶，创建新版本并发布，前端刷新 `current version + bundle` 后同场景复跑，结果按预期变化。

### 构建回归

- Rust Web Wasm 产物可重新生成并复制到前端。
- `npx tsc -b` 与 `npx vite build` 通过。
- 若 Windows 本机仍缺 `link.exe` 导致 Rust host 依赖编译失败，则记录为环境前置条件，不改变本阶段技术路线。

## Assumptions

- 本阶段的 Wasm 语言固定为 Rust，Go 不进入实现范围。
- 计划文档落在仓库根目录，不放到 `wasm/` 子目录。
- 4 张核心表足够支撑第一轮数据发布闭环，英雄、技能、装备编辑延后。
- 图片缓存替换等后续提供现成实现后再单独接入。
- 不新增前端自动化测试框架，验证以黄金样例、手工闭环回归和构建通过为主。
