TASK_KEY: web-idb-cache-strategy
DOC_TYPE: 需求澄清
WORKSTREAM: web
STATUS: tracked
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: pending

# 前端 Image 处理方案（需求说明 V1）

目标：建立一套“图片上传 + 服务器存储 + 浏览器 IndexDB 缓存 + 手动增量同步”的前端体系，达到以下效果：
- 列表页/编辑器渲染图片优先走本地缓存，减少后端与网络压力
- 图片更新不依赖版本发布，可随时替换并立即生效
- 用户可手动触发“增量更新图片”，只拉取更新过的图片

本需求按你前端 demo 的体系落地（URI 规则、IndexDB 表结构、同步流程），并要求后端接口满足调用需求。
接口约束位置见：[接口定义](../../../接口/game_manage/接口定义.md#L49-L216)

---

## 1. 范围与非目标（需求边界）

### 1.1 范围
- 按 `gameId` 缓存图片（图片不纳入版本管理）
- 图片以 `uri` 唯一标识；同一 `uri` 更新时覆盖
- 支持两条主链路：
  - 上传并更新单张图片（更新后本地与服务器一致）
  - 从服务器同步图片到本地（全量/增量）

### 1.2 非目标（V1 不做）
- 自动定时拉取图片更新（按需求：用户手动触发）
- 图片 CDN/对象存储 URL 模式（V1 使用 base64）
- 图片“删除”能力（V1 仅允许覆盖更新，不做物理删除）

---

## 2. 关键概念与 URI 规则

### 2.1 服务器侧 URI（对外契约）
- 服务器接口使用的 `uri`：建议统一为 `{type}_{id}`，例如：
  - `equipment_100`
  - `character_ahri`（若 id 不是数字也允许，只要符合系统 `uri` 规范）
  - `attribute_ad`
  - `attribute_hp`

attribute 图片 URI 按 `attribute_${attrKey}` 派生，例如 `attrKey = ad` 对应 `attribute_ad`，`attrKey = hp` 对应 `attribute_hp`；该派生 URI 只用于图片资源索引与缓存，不写入 `attribute_definitions` 本体。

说明：这与现有契约里对 `uri` 的建议一致。

### 2.2 本地缓存 Key（IndexDB 主键）
- 为避免不同 `gameId` 的 `uri` 冲突，本地存储主键使用拼接：
  - `localUri = {gameId}_{uri}`
  - 示例：`lol_equipment_100`

## 3. 数据模型（IndexDB）

### 3.1 数据库与表结构（对齐 demo）
- DB 名：`image_db`
- DB version：`1`
- ObjectStore：`images`
  - 主键：`uri`（即 `localUri = {gameId}_{uri}`）
  - 索引：
    - `uri`（unique）
    - `create_time`
    - `update_time`

### 3.2 images 记录结构（对齐 demo）
```ts
type ImageData = {
  uri: string
  create_time: string
  update_time: string
  image: string
}
```

字段映射要求（与后端契约对齐）：
- `image = imageBase64`
- `update_time = updatedAt`
- `create_time`：V1 允许使用本地首次写入时间；不要求与后端一致

---

## 4. 与后端接口的对齐要求（必须满足）

### 4.1 Public：获取图片（全量/增量）
- `GET /api/games/{gameId}/images`
- 必须支持可选查询参数 `updatedAfter`：
  - `GET /api/games/{gameId}/images?updatedAfter=2026-02-16T00:00:00Z`
  - 语义：仅返回 `updatedAt > updatedAfter` 的图片

响应字段要求（V1 需要这些字段即可）：
- `uri`：服务器侧 uri（不含 game 前缀）
- `imageBase64`
- `updatedAt`

### 4.2 Admin：更新单张图片（不纳入版本）
- `PUT /api/admin/games/{gameId}/images/{uri}`
- 请求体：`{ imageBase64 }`
- 响应体：`ImageDTO`（至少包含 `uri/imageBase64/updatedAt`）

### 4.3 V1 不要求的接口
- 不要求 “按 uri 单独 GET” 的接口（有的话可优化，但不是 V1 必需）
- 不要求图片删除接口（V1 不支持删除）

## 5. 同步流程（前端行为）

### 5.1 首次初始化（全量拉取）
触发条件：
- 用户首次进入某 `gameId`
- 或 IndexDB 中该 `gameId` 下图片数量为 0

流程：
1. 调用 `GET /api/games/{gameId}/images`（不带 `updatedAfter`）
2. 将每条记录转换为 `ImageData`：
   - `localUri = {gameId}_{uri}`
   - `image = imageBase64`
   - `update_time = updatedAt`
   - `create_time`：若本地不存在则写入当前时间；若已存在则保留原值（可选）
3. 事务内 `put` 写入 `images`（同 `localUri` 覆盖）
4. UI 状态：展示“已缓存图片数量/最后同步时间”

### 5.2 用户手动更新（增量）
触发入口：
- 前端全局页或资源管理页提供按钮：“更新图片”（仅对当前 `gameId` 生效）

流程：
1. 从 IndexDB `images` 中计算本地 `max(update_time)`（仅统计当前 `gameId` 前缀下的记录）
2. 调用 `GET /api/games/{gameId}/images?updatedAfter={maxUpdateTime}`
3. 返回为空：提示“已是最新”
4. 返回非空：按 5.1 的转换规则 `put` 覆盖写入

### 5.3 并发与幂等
- 同一个 `gameId` 同时只能运行一个“图片同步任务”，按钮在进行中应置灰。
- 同步过程是幂等的：重复拉取同一批数据只会覆盖相同 `uri`。

---

## 6. 上传与保存流程（编辑器行为）

### 6.1 上传组件能力要求
- 选择图片后自动处理为正方形 64×64（与 demo 一致）
- 输出为 base64（可直接用于 `<img src>`）

### 6.2 保存链路（必须保证本地与服务器一致）
当用户上传图片后：
1. 前端调用 Admin 更新接口写入服务器
2. 以接口响应的 `updatedAt` 为准写入 IndexDB 的 `update_time`
3. 写入 IndexDB 失败时给出明确提示（例如“本地缓存写入失败，可继续使用但离线不可用”）

## 7. 渲染与引用方式

### 7.1 最简单策略（与 demo 一致）
- IndexDB 存 `image`（base64），前端直接：
  - `<img src={image} />`
- 优点：实现简单、无需额外转换。
- 风险：base64 占用内存较高，且比二进制膨胀约 33%（但你评估图片体量主要在这里，且 10MB 内的数据包不含图片，因此这部分属于可控成本）。

### 7.2 可选优化（阶段 2）
当图片数量/尺寸增大时，可以考虑：
- 后端改为 `bytea + content-type` 或对象存储 URL
- 前端把 base64 转 Blob 并缓存 Blob（二进制更省空间）

---

## 8. 容量、清理与迁移

### 5.1 容量风险
浏览器对 IndexDB 有 quota 限制，且不同浏览器策略不同：
- 当达到配额，写入会失败；必须在 UI 给出“清理缓存/重试”的兜底。

### 8.2 清理策略（V1）
- 提供“清理当前游戏图片缓存”按钮：
  - 删除 `images` 中 `uri` 以 `{gameId}_` 开头的记录
- 不做自动清理，避免误删导致离线体验下降。

### 5.3 版本迁移
- IndexDB 结构变更（例如主键从 `uri` 升级到 `gameId|uri`）时，通过 DB version 升级迁移数据。

---

## 9. 与版本轮询/Bundle 的关系
- 图片不纳入版本管理，因此：
  - `versions/current` 变化不必强制拉取图片
  - 用户可独立点击“更新图片”进行增量同步
- `bundle` 更新时如果引入了新 `uri` 引用，但本地还没有该图片：
  - UI 可以展示“占位图”，并提示用户点击“更新图片”
  - 或在后台静默触发一次增量同步（阶段 2 再考虑）

---

## 10. 验收标准（V1）

### 10.1 功能验收
- 首次进入某 `gameId` 时可全量同步图片到 IndexDB，并能从本地渲染
- 上传图片后，服务器与本地 IndexDB 都更新为新图片
- 用户点击“更新图片”只会拉取变更过的图片（增量），且本地图片被正确覆盖
- 断网情况下，已缓存图片仍可正常展示

### 10.2 性能与体验
- 同步过程中 UI 有 loading 状态与结果提示（成功/无更新/失败）
- IndexDB 写入失败时不影响页面继续运行，但必须提示用户

### 10.3 约束
- V1 不支持删除图片；若需要“删除效果”，以占位图覆盖实现
