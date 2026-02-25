# Data Manage Backend 整改 TODO

## 背景与范围
- 本文档用于沉淀 `server/data_manage` 初版后端 review 结果，并形成可执行整改清单。
- 目标是让实现行为与既有契约保持一致，不新增接口、不改路径，仅修正行为偏差。
- 本文档采用单文件汇总方式，按 `P0/P1/P2` 分级管理，支持状态跟踪。
- 状态标记约定：`[ ]` 未开始、`[~]` 进行中、`[x]` 已完成。

## P0（阻断上线）
### [ ] P0 创建版本接口被版本字段校验误杀
- 优先级：P0
- 现象：
  - `createVersion` 入口会触发“版本字段禁用校验”，导致合法字段 `versionCode` 被拒绝。
  - `POST /api/admin/games/{gameId}/versions` 可能直接返回 `400.INVALID_BODY`。
- 影响：
  - 版本创建接口不可用，后续 publish 链路无法正常启动。
  - 影响所有需要新建版本的管理流程。
- 代码定位：
  - [GameDataService.java:180](/c:/project/damage_viewer_project_planning/server/data_manage/src/main/java/xyz/game/datamanage/service/GameDataService.java:180)
  - [PostgresJsonSupport.java:24](/c:/project/damage_viewer_project_planning/server/data_manage/src/main/java/xyz/game/datamanage/service/PostgresJsonSupport.java:24)
- 修复方案：
  - 将“版本字段禁用”校验范围限定到 upsert 类写接口，不覆盖版本创建接口。
  - 为版本创建接口单独定义允许字段白名单（至少包含 `versionCode`、`releaseDate`）。
  - 保持其他 admin 写接口继续拒绝版本字段。
- 验收标准：
  - `POST /api/admin/games/{gameId}/versions` 带 `versionCode/releaseDate` 可成功。
  - 其他写接口仍拒绝版本字段。
- 回归测试：
  - 创建版本请求使用合法 body 成功返回。
  - 在 hero/skill/item/type 等写接口中携带 `versionId`/`versionCode` 仍返回 `400.INVALID_BODY`。

### [ ] P0 Public bundle 泄露未发布数据（读写隔离失效）
- 优先级：P0
- 现象：
  - 写接口更新原始表后，Public bundle 读取路径可能直接读取到未发布数据。
  - Public `bundle/current` 可能在未 publish 时出现数据变化。
- 影响：
  - 破坏“写入不影响读用户，只有 publish 才生效”的核心契约。
  - 可能导致 `dataHash` 与实际返回数据不一致，缓存与客户端同步逻辑异常。
- 代码定位：
  - [PostgresWriteStore.java:94](/c:/project/damage_viewer_project_planning/server/data_manage/src/main/java/xyz/game/datamanage/service/PostgresWriteStore.java:94)
  - [PostgresReadStore.java:129](/c:/project/damage_viewer_project_planning/server/data_manage/src/main/java/xyz/game/datamanage/service/PostgresReadStore.java:129)
  - [HeroesMapper.xml:15](/c:/project/damage_viewer_project_planning/server/data_manage/src/main/resources/mapper/heroes/HeroesMapper.xml:15)
- 修复方案：
  - 明确并实现“写入工作区”和“对外可见快照”边界，Public 读取仅基于已发布版本快照。
  - 若阶段内继续使用原始表，需保证查询严格受版本可见性约束（不可直接读取最新编辑态）。
  - 同步校正 `bundle` 生成与 `dataHash` 计算输入来源。
- 验收标准：
  - 未 publish 前，Public `bundle/current` 数据不变化。
  - publish 后才对外可见。
- 回归测试：
  - 写入 hero/skill/item 后，立刻调用 Public `current` 与 `bundle`，结果保持发布前一致。
  - 执行 publish 后再次调用，返回数据才反映最新变更。

## P1（高优先级）
### [ ] P1 publish 缺少“区间推进 + log 落库 + 全量校验”
- 优先级：P1
- 现象：
  - publish 主要处理 hash 和 current 切换，未完整实现版本区间推进、变更日志落库及全量校验流程。
  - `_log` 表存在但未形成一致使用闭环。
- 影响：
  - 难以支撑版本可追溯和历史差异分析。
  - 一旦出现数据异常，定位与回滚依据不足。
- 代码定位：
  - [PostgresWriteStore.java:296](/c:/project/damage_viewer_project_planning/server/data_manage/src/main/java/xyz/game/datamanage/service/PostgresWriteStore.java:296)
  - [schema.sql:73](/c:/project/damage_viewer_project_planning/db/game_manage/schema.sql:73)
- 修复方案：
  - 在 publish 事务内补齐：改动集合识别、全量结构/语义校验、版本区间推进、对应 `_log` 表落库。
  - 保证失败场景回滚，避免“部分推进/部分落库”。
  - 明确各表推进策略与顺序，保持可复核。
- 验收标准：
  - 发布时仅处理改动集合并写入对应 `_log` 表。
  - 原始表版本区间推进符合设计文档。
  - 发布失败时整体回滚。
- 回归测试：
  - publish 成功后校验各主表与 `_log` 表区间和数据一致。
  - 制造语义校验失败场景，验证事务未产生部分提交。

### [ ] P1 Admin JWT 未验签，可伪造权限
- 优先级：P1
- 现象：
  - 当前鉴权逻辑主要解码 payload 并读取 `email/canEdit`，未验证签名有效性。
  - 伪造 token 有概率绕过编辑权限保护。
- 影响：
  - 管理接口存在被未授权写入的安全风险。
  - 审计与责任追踪可信度下降。
- 代码定位：
  - [AdminAuthFilter.java:70](/c:/project/damage_viewer_project_planning/server/data_manage/src/main/java/xyz/game/datamanage/support/auth/AdminAuthFilter.java:70)
- 修复方案：
  - 引入标准 JWT 验签流程（签名、过期、发行者/受众等基础校验按接入约束配置）。
  - 鉴权失败统一返回 `401.UNAUTHORIZED`，权限不足返回 `403.FORBIDDEN`。
  - 保留 `email/canEdit` 语义校验作为验签后的二次检查。
- 验收标准：
  - 无效签名 token 返回 `401.UNAUTHORIZED`。
  - 仅合法 token 且 `canEdit=true` 可访问 admin 写接口。
- 回归测试：
  - 缺失 Authorization、伪造签名、过期 token、`canEdit=false`、合法 token 五类用例。

## P2（改进项）
### [ ] P2 编辑日志与业务写入非原子
- 优先级：P2
- 现象：
  - 控制器层在业务成功后单独记录 edit_log，日志写入与业务写入不在同一事务边界。
  - 日志失败可能造成“数据已变更但无留痕”或接口异常语义不一致。
- 影响：
  - 审计完整性与故障可定位性下降。
  - 客户端对成功/失败语义判断可能产生混淆。
- 代码定位：
  - [HeroAdminController.java:37](/c:/project/damage_viewer_project_planning/server/data_manage/src/main/java/xyz/game/datamanage/controller/adminapi/HeroAdminController.java:37)
  - [PostgresWriteStore.java:317](/c:/project/damage_viewer_project_planning/server/data_manage/src/main/java/xyz/game/datamanage/service/PostgresWriteStore.java:317)
- 修复方案：
  - 将日志写入并入业务事务，或定义明确补偿机制并固化失败策略。
  - 统一所有 admin 写接口行为，避免局部实现差异。
- 验收标准：
  - 一次 admin 写请求的数据变更与 edit_log 成功/失败行为一致（原子或明确补偿机制）。
- 回归测试：
  - 注入日志写入失败场景，验证系统行为与设计策略一致且可观测。

## 实施顺序建议
1. 先修 `P0-1`（版本创建可用性）。
2. 再修 `P0-2`（读写隔离正确性）。
3. 实现 `P1-3`（publish 完整语义）。
4. 实现 `P1-4`（JWT 验签）。
5. 收敛 `P2-5`（日志一致性）。

## 回归测试清单
- [ ] 创建版本：合法 body 成功、携带非法版本字段失败。
- [ ] 读写隔离：写入未发布数据后，Public current/bundle 不变。
- [ ] 发布后可见性：publish 后 `current` 与 `bundle` 同步更新，`ETag` 变化。
- [ ] JWT 鉴权：缺头、伪造 token、`canEdit=false`、合法 token 四类场景。
- [ ] 事务一致性：模拟日志写失败时验证策略（回滚或补偿）符合设计。

## 完成记录
- `2026-02-25`：创建 TODO 文档初版，纳入本轮 review 的 5 个整改项与回归清单。
- 后续每次整改完成后，更新对应问题状态与验证结论。
