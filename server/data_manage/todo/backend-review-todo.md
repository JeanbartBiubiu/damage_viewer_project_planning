# Data Manage Backend 整改 TODO

## 背景与范围
- 本文档用于跟踪 `server/data_manage` 尚未完成的整改项。
- 已完成项已从清单移除，仅保留待完成项。
- 状态标记约定：`[ ]` 未开始、`[~]` 进行中、`[x]` 已完成。

## P0（阻断上线）
### [~] P0 Public bundle 泄露未发布数据（读写隔离失效）
- 优先级：P0
- 现象：
  - 写接口更新原始表后，Public bundle 读取路径可能直接读取到未发布数据。
  - Public `bundle/current` 可能在未 publish 时出现数据变化。
- 影响：
  - 破坏“写入不影响读用户，只有 publish 才生效”的核心契约。
  - 可能导致 `dataHash` 与实际返回数据不一致，缓存与客户端同步逻辑异常。
- 当前状态：
  - 已落地缓存缓解策略：非 publish 写入仅清理 `games/images/ownerCategories`，保留 `currentVersion/bundle` 缓存。
  - 仍未完成严格读写隔离，冷启动/缓存丢失场景仍存在未发布数据暴露风险。
- 代码定位：
  - [GameDataService.java:26](/c:/project/damage_viewer_project_planning/server/data_manage/src/main/java/xyz/game/datamanage/service/GameDataService.java:26)
  - [PostgresReadStore.java:129](/c:/project/damage_viewer_project_planning/server/data_manage/src/main/java/xyz/game/datamanage/service/PostgresReadStore.java:129)
  - [HeroesMapper.xml:15](/c:/project/damage_viewer_project_planning/server/data_manage/src/main/resources/mapper/heroes/HeroesMapper.xml:15)
- 修复方案：
  - 明确并实现“写入工作区”和“对外可见快照”边界，Public 读取仅基于已发布版本快照。
  - 若阶段内继续使用原始表，需保证查询严格受版本可见性约束（不可直接读取最新编辑态）。
  - 同步校正 `bundle` 生成与 `dataHash` 计算输入来源。
- 验收标准：
  - 未 publish 前，Public `bundle/current` 数据不变化。
  - publish 后才对外可见。

## P1（测试保障）
### [x] P1 增加 controller-only、zero-mock 的真实 DB 集成测试链路
- 优先级：P1
- 目标：
  - 单测/集成测试只通过 controller 接口驱动，不调用 mock，不绕过 HTTP/鉴权层。
  - 引入单测专用数据库环境，覆盖版本流转与发布后的读路径验证。
- 测试流程（每次执行）：
  - 创建一个新的 `gameId`（避免与历史数据冲突，建议带时间戳/随机后缀）。
  - 调用版本创建接口，创建初始版本号。
  - 通过 admin controller 写接口向各主表至少写入 1 条数据（`attribute_definitions/types/type_relations/heroes/skills/items`，按依赖顺序）。
  - 执行 publish，再通过 public controller 获取 `current` / `bundle`，校验版本号、dataHash、关键数据内容符合预期。
  - 支持单独执行的数据清理动作：针对该 `gameId` 的分区对象执行清理（可 drop 分区/表），默认不在每次测试后自动执行，便于人工验数。
- 验收标准：
  - 测试代码中不存在 mock（`@Mock`/`mock()`）用于被测 controller 主链路。
  - 全链路仅通过 controller 对外接口完成“创建游戏 -> 创建版本 -> 写入 -> 发布 -> 读取校验”。
  - 提供可独立触发的清理入口（脚本/命令/测试开关），并文档化执行方式与风险提示。
- 完成说明：
  - 已新增 `ControllerPublishFlowIT`：真实 DB、真实 HTTP、真实鉴权、zero-mock。
  - 已新增 `GamePartitionCleanupMain`：支持 `--gameId`、`--confirm`、`--dryRun` 独立清理。
  - 已新增执行文档：`todo/p1-controller-db-it-runbook.md`。
  - 读写隔离/发布后可见性当前覆盖“暖缓存链路”回归；冷启动/缓存丢失场景继续由 P0 跟踪。

## P2（MVP 后续）
### [ ] P2 按 `game_id` 配置阶段制度（LEVEL/STAR），替代当前默认 `1~18`
- 优先级：P2
- 背景：
  - 当前 MVP 数据采集默认按 `1~18`（LOL 经典等级）填写，先保障链路跑通。
  - 后续不同 `game_id` 可能存在不同阶段制度：`1~20`、`1~30`、`1~3 星`、`1~4 星`。
- 当前临时策略（MVP）：
  - 前端与数据采集流程默认按 `stage=1..18` 处理。
  - 该策略仅作为过渡，不作为长期契约。
- 后续改造目标：
  - 新增按 `game_id` 管理的阶段制度配置（建议：`game_progression_schema`）。
  - 至少包含：`progression_kind(LEVEL/STAR)`、`stage_min`、`stage_max`、`require_all_stages`。
  - 前端录入根据 `game_id` 自动渲染可填阶段范围，不再让用户手工判断填 18 级还是 3 星。
  - 后端对录入阶段范围做语义校验（越界/缺失按配置报错）。
- 验收标准：
  - 切换不同 `game_id` 时，录入界面阶段数自动变化。
  - 不符合该 `game_id` 阶段制度的数据无法入库。
  - 移除“全局默认 1~18”硬编码依赖。

## 回归测试清单
- [x] 读写隔离：写入未发布数据后，Public `current` / `bundle` 不变（暖缓存链路回归）。
- [x] 发布后可见性：publish 后 `current` 与 `bundle` 同步更新，`ETag` 变化（暖缓存链路回归）。
- [x] controller-only 集成测试：不使用任何 mock，完成完整发布链路并断言 `current/bundle`。
- [x] 分区清理能力：可按 `gameId` 单独执行清理，默认不自动清库。

## 完成记录
- `2026-02-25`：创建 TODO 文档初版，纳入本轮 review 的 5 个整改项与回归清单。
- `2026-02-26`：完成 P0-1、P1-3、P1-4、P2-5；P0-2 先按缓存缓解策略落地（非严格隔离硬修）。
- `2026-02-26`：复核代码与测试后，已完成项从清单删除，仅保留 P0-2。
- `2026-02-26`：新增 P1 测试保障项：controller-only、zero-mock、真实 DB 集成测试与可单独触发的分区清理。
- `2026-02-26`：完成 P1 测试保障项：新增 `application-it.yml`、`ControllerPublishFlowIT`、`GamePartitionCleanupMain` 与 runbook，回归清单中 controller-only 与分区清理能力已闭环。
- `2026-03-01`：新增 P2 待办：按 `game_id` 配置阶段制度（LEVEL/STAR）；MVP 阶段暂按默认 `1~18` 采集。
