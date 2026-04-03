TASK_KEY: server-game-manage-api
DOC_TYPE: 详细设计
WORKSTREAM: server
STATUS: tracked
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: pending

# Java 后端开发方案（基于接口契约 + MyBatis）

## 0. 前置确认（已确认）
- 统一使用路径参数 `{gameId}`，不使用 header + ThreadLocal 的隐式切换机制。
- 数据访问层继续采用 MyBatis / MyBatis-Plus 体系。

相关契约与表设计：
- 接口契约：[接口定义.md](../../../接口/game_manage/接口定义.md)
- DB schema：[schema.sql](../../../db/game_manage/schema.sql)

## 1. 目标与边界
- 目标：实现“读写分离 + 版本发布 + 强缓存（ETag）”的一套 Java 后端，严格遵循接口契约。
- 非目标：采用响应 wrapper（例如 ResponseData/DataWithPage）或隐式切库/切 schema 方案。
- 性能假设：瓶颈主要是带宽；通过 Nginx/浏览器缓存 + ETag/304 降低重复传输。

## 2. 实现约束（必须遵守）
- 路由与返回结构严格按接口契约实现。
- 成功响应：直接返回 JSON 对象或数组，不做任何 wrapper。
- 失败响应：统一返回 `{ error: { code, message, details } }`。
- 鉴权：`/api/admin/**` 必须校验 `ES256` JWT，并以 `canEdit` 决定是否允许写入。

## 3. 工程分层与包结构（建议）
建议以“public/admin 分控制器、service 分用例、dao 分持久化、support 分横切”组织：
- `controller.publicapi`
- `controller.adminapi`
- `service.publicread`
- `service.adminwrite`
- `service.publish`
- `dao`（MyBatis Mapper Interface）
- `dao.mapperxml`（resources/mapper 下的 XML）
- `model.dto`（对外 DTO，与接口契约一致）
- `model.po`（持久化对象/表映射）
- `support.auth`（JWT 解析、权限）
- `support.error`（统一错误码与异常映射）
- `support.http`（ETag/If-None-Match 处理）

## 4. API 实现清单（按契约）
### 4.1 Public 读接口
- `GET /api/games/{gameId}/versions/current`
  - 数据来源：`public.game_versions`（`is_current=true`）
  - 返回：`{ gameId, versionId, versionCode, dataHash, updatedAt }`
  - 缓存：短 TTL + 可选 ETag（通常 dataHash 足够）

- `GET /api/games/{gameId}/versions/{versionId}/bundle`
  - 阶段 1：仅支持获取当前版本的 bundle（见第 5 节）
  - 读取 `game_versions` 获取 currentVersion，并校验 `versionId == currentVersion.versionId`
  - 读取 `game_versions` 拿 currentVersion 的 `data_hash`
  - `If-None-Match == data_hash` 时返回 304
  - 否则组装 `GameDataBundleV1` 并返回，响应头带 `ETag=data_hash`

- `GET /api/games/{gameId}/images`
  - 数据来源：`public.images`（不纳入版本）
  - 缓存：建议也提供 ETag（例如 `max(updated_at)+count` 或对 `(uri,updated_at)` 做 hash）

- `GET /api/games/{gameId}/owner-categories`
  - 数据来源：`public.owner_categories`（不纳入版本）
  - 缓存：建议提供 ETag（例如 `max(updated_at)+count` 或对 `(owner_type,updated_at)` 做 hash）

### 4.2 Admin 写接口（Upsert）
写接口只修改“原始表”，不会改变 current，除非 publish。为保证编辑器保存后能重新拉取最新草稿态，所有可编辑资源都应补齐 `GET list`。
- `GET /api/admin/games/{gameId}/heroes`
- `PUT/PATCH /api/admin/games/{gameId}/heroes/{heroId}`
- `GET /api/admin/games/{gameId}/skills`
- `PUT/PATCH /api/admin/games/{gameId}/skills/{skillId}`
- `GET /api/admin/games/{gameId}/items`
- `PUT/PATCH /api/admin/games/{gameId}/items/{itemId}`
- `GET /api/admin/games/{gameId}/attribute-definitions`
- `PUT/PATCH /api/admin/games/{gameId}/attribute-definitions/{attrKey}`
- `GET /api/admin/games/{gameId}/types`
- `PUT/PATCH /api/admin/games/{gameId}/types/{typeId}`
- `GET /api/admin/games/{gameId}/type-relations`
- `PUT/PATCH /api/admin/games/{gameId}/type-relations/{typeId}/{targetCategory}/{targetId}`
- `GET /api/admin/games/{gameId}/formula-profiles`
- `PUT/PATCH /api/admin/games/{gameId}/formula-profiles/{formulaId}`
- `GET /api/admin/games/{gameId}/formula-bindings`
- `PUT/PATCH /api/admin/games/{gameId}/formula-bindings/{targetCategory}/{targetId}/{bindingKey}`
- `GET /api/admin/games/{gameId}/coefficient-buckets`
- `GET /api/admin/games/{gameId}/coefficient-buckets/{bucketKey}`
- `PUT/PATCH /api/admin/games/{gameId}/coefficient-buckets/{bucketKey}`
- `GET /api/admin/games/{gameId}/status-action-control-rules`
- `GET /api/admin/games/{gameId}/status-action-control-rules/{ruleId}`
- `PUT/PATCH /api/admin/games/{gameId}/status-action-control-rules/{ruleId}`
- `PUT /api/admin/games/{gameId}/images/{uri}`
- 图片实时刷新继续复用 `GET /api/games/{gameId}/images`，不重复定义 admin list。

通用约束：
- 请求体禁止出现任何版本字段（`startVersionId/endVersionId/versionId/versionCode/isCurrent/dataHash` 等）。
- 所有写入成功后，必须更新该记录的 `updated_at=now()`（用于 publish 的变更识别）。
- `skills.ownerType` 的语义校验：必须存在于 `owner_categories(game_id, owner_type)`，否则返回 `422.SEMANTIC_ERROR`

### 4.3 Admin 发布接口
- `POST /api/admin/games/{gameId}/versions`
  - 创建版本草稿，`is_current=false`，`data_hash=null`，`published_at=null`

- `POST /api/admin/games/{gameId}/versions/{versionId}:publish`
  - 事务内完成：全量校验、版本区间推进、生成 dataHash、切换 current

## 5. bundle 取数规则（阶段 1：仅 current）
阶段 1 的约束：
- `GET /api/games/{gameId}/versions/{versionId}/bundle` 仅允许 `versionId == currentVersionId`
- 只从原始表读取，不读取 log 表
- 原始表按 `(game_id, 业务id)` 唯一，天然只有 1 条生效记录

示例（heroes）：
```sql
SELECT *
FROM public.heroes
WHERE game_id = :gameId;
```

后续如果需要支持历史版本 bundle，再引入“原始表 + log 表按版本区间取快照”的 union 查询，并为该查询单独做性能优化与压测。

## 6. 发布流水线（publish）设计
### 6.1 schema 增补（用于 publish）
已在 schema 增加：
- `public.game_versions.published_at`
- 原始表增加 `updated_at`（attribute_definitions/types/type_relations/heroes/skills/items）

对应修改位置：
- [schema.sql](../../../db/game_manage/schema.sql)

### 6.2 变更识别（使用 updated_at）
publish 时用“上次发布点”识别本次 draft 改动集合：
- `prevPublishedAt = currentVersion.published_at`（没有则使用最早时间）
- “改动集合” = 各原始表中 `updated_at > prevPublishedAt` 的记录

约束：
- `DEFAULT NOW()` 只保证插入时有值；更新时由写接口显式更新 `updated_at`。

### 6.3 publish 的事务步骤（推荐顺序）
1. 校验 `(gameId, versionId)` 存在且可发布
2. 获取 `prevCurrentVersion` 与 `prevPublishedAt`
3. 从各原始表按 `updated_at > prevPublishedAt` 拉取“改动集合”
4. 对“改动集合 + 当前全量数据”做校验（结构 + 语义）
5. 对“改动集合”执行版本区间推进与日志落库
   - 原则：只对改动 key 进行 log/更新，避免 log 爆炸
6. 按第 5 节规则，用 `versionId` 生成 bundle
7. 计算 `dataHash`（见 6.4）
8. 写回 `game_versions.data_hash`、设置 `published_at=now()`
9. 切换 `is_current`：旧 current false，新 version true

### 6.4 dataHash 计算规则（稳定化）
目标：同一份数据在任意机器/时间生成的 hash 必须一致。

规则：
- bundle 内数组排序固定（例如 heroes 按 heroId、skills 按 skillId、items 按 itemId）
- JSON 序列化必须稳定（字段顺序固定、数字格式一致）
- 采用 `sha256(hex)` 存入 `game_versions.data_hash`

## 7. MyBatis Mapper 与 SQL 组织
建议每张表拆出两类查询：
- Admin 写侧：
  - `upsert`（insert on conflict 或先 select 后 insert/update，按你惯用方式）
  - `selectById`（用于校验引用存在/写后回读）
- Public 读侧：
  - `selectForCurrent(gameId)`（阶段 1：只读原始表）

Mapper XML 建议：
- 每张表独立一个 XML
- 公用 SQL 片段可用 `<sql id="...">` 抽取（例如 union 原始表 + log 表）

## 8. 鉴权、错误码与响应
### 8.1 鉴权
- `/api/admin/**` 必须校验 JWT
- JWT 至少包含：`email`、`canEdit`、`paid`（签名算法固定为 `ES256`）
- `canEdit=false` 访问 admin 返回 `403.FORBIDDEN`

### 8.2 错误响应
失败响应严格输出契约：
```json
{
  "error": {
    "code": "400.INVALID_BODY",
    "message": "human readable message",
    "details": {}
  }
}
```

实现建议：
- `@ControllerAdvice` 统一把常见异常映射为契约错误码：
  - JSON/字段缺失：`400.INVALID_BODY`
  - 资源不存在：`404.NOT_FOUND`
  - 无权限：`403.FORBIDDEN`
  - 语义校验失败：`422.SEMANTIC_ERROR`

## 9. 开发拆解（按优先级逐步落地）
1. 基础骨架：路由按契约拆 public/admin；接入 MyBatis；接入统一异常输出与 JWT 解析
2. 读接口：
   - `versions/current`
   - `bundle`（先不做 Redis 缓存，仅 ETag/304）
   - `images`
3. 写接口（按实体逐个实现）：
   - heroes/skills/items
   - attribute_definitions/types/type_relations
   - images
4. 发布接口：
   - create version
   - publish（含 updated_at 变更识别、dataHash、切 current）
