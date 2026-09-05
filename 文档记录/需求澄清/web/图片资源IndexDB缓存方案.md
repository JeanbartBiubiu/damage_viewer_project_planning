TASK_KEY: web-idb-cache-strategy
DOC_TYPE: 需求澄清
WORKSTREAM: web
STATUS: done
EXECUTION_MODEL: GPT-5 主会话（保留历史内容）
LAST_TRACKED_AT: 2026-09-05

# 前端图片缓存处理方案（历史基线）

当前职责：本文保留浏览器本地缓存的既有背景和历史候选。阶段 8 的图片资源字段、接口、停用同步和当前缓存改造以[阶段 8 图片管理共享契约](../../详细设计/项目/图片管理详细设计.md)及其[前端详细设计](../../详细设计/web/图片管理前端详细设计.md)为准；本文不再定义图片管理公共契约。

目标：建立一套“图片上传 + 服务器存储 + 浏览器 IndexDB 缓存 + 手动增量同步”的前端体系，达到以下效果：
- 列表页/编辑器渲染图片优先走本地缓存，减少后端与网络压力
- 图片更新不依赖版本发布，可随时替换并立即生效
- 用户可手动触发“增量更新图片”，只拉取更新过的图片

本需求按你前端 demo 的体系落地（URI 规则、IndexDB 表结构、同步流程），并要求后端接口满足调用需求。
接口约束位置见：[接口定义](../../详细设计/server/game_manage/接口定义.md)

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
  - `item_100`
  - `character_ahri`（若 id 不是数字也允许，只要符合系统 `uri` 规范）
  - `attribute_ad`
  - `attribute_hp`

attribute 图片 URI 按 `attribute_${attrKey}` 派生，例如 `attrKey = ad` 对应 `attribute_ad`，`attrKey = hp` 对应 `attribute_hp`；该派生 URI 只用于图片资源索引与缓存，不写入 `attribute_definitions` 本体。

说明：这与现有契约里对 `uri` 的建议一致。

### 2.2 本地缓存 Key（IndexDB 主键）
- 为避免不同 `gameId` 的 `uri` 冲突，本地存储主键使用拼接：
  - `localUri = {gameId}_{uri}`
  - 示例：`lol_item_100`

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

### 7.2 可选优化（阶段 2，当前推迟）
当图片数量/尺寸增大时，可以考虑：
- 后端改为 `bytea + content-type` 或对象存储 URL
- 前端把 base64 转 Blob 并缓存 Blob（二进制更省空间）

> Blob 化在阶段 2 当前迭代里**不做**。当前图片体量（64×64、量级可控）下 base64 膨胀成本可接受，且 Blob 化会引入 `URL.createObjectURL`/`revokeObjectURL` 生命周期管理成本。Blob 化推迟到图片体量或数量明显增长时再评估，详见 §11.6。

---

## 8. 容量、清理与迁移

### 5.1 容量风险
浏览器对 IndexDB 有 quota 限制，且不同浏览器策略不同：
- 当达到配额，写入会失败；V1 仅给“清理缓存/重试”兜底，阶段 2 起引入 LRU 自动管理与配额分类提示（见 §11.3、§11.4）。

### 8.2 清理策略（V1）
- 提供“清理当前游戏图片缓存”按钮：
  - 删除 `images` 中 `uri` 以 `{gameId}_` 开头的记录
- V1 不做自动清理；阶段 2 起 LRU 自动清理其他游戏缓存（见 §11.3），手动按钮降级为可选运维操作。

### 5.3 版本迁移
- IndexDB 结构变更（例如主键从 `uri` 升级到 `gameId|uri`）时，通过 DB version 升级迁移数据。
- 阶段 2 新增 `cache_meta` store 时，DB version 从 1 升到 2，**不改动 `images` store**，存量图片数据零迁移（见 §11.2）。

---

## 9. 与版本轮询/Bundle 的关系
- 图片不纳入版本管理，因此：
  - `versions/current` 变化不必强制拉取图片
  - V1 由用户独立点击“更新图片”进行增量同步；阶段 2 起进入页面时自动静默触发增量同步（见 §11.1）。
- `bundle` 更新时如果引入了新 `uri` 引用，但本地还没有该图片：
  - V1 由 UI 展示“占位图”并提示用户点击“更新图片”
  - 阶段 2 起由自动增量同步覆盖，占位图仅在同步失败或断网时出现

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

---

## 11. 历史候选：自动同步与最近最少使用缓存管理

> 本节只保留历史候选，不是当前阶段 8 的设计真源。阶段 8 不实施本节的跨游戏自动清理、容量统计或其他候选优化。
>
> 阶段 2 目标：把 V1 的“用户手动同步 + 手动清理”升级为“进页面自动增量同步 + LRU 自动空间管理 + Quota 分类兜底”，让用户常规使用路径无感。
>
> 阶段 2 **不做**：Blob 化（§11.6）、后端删除接口、Worker 宿主与缓存的边界（Wasm 计算阶段再考虑）。

### 11.1 自动增量同步（复用现有 `updatedAfter` 接口，后端零改动）

触发时机：
1. `ImagesPage` 挂载或切换 `gameId` 时，静默执行一次增量同步。
2. `useResourceImageCache`（资源页图片缓存 hook）挂载时，静默执行一次增量同步。
3. 最小间隔 30 秒，避免短时间内频繁切换页面重复拉取。

同步流程（直接复用 V1 的 `GET /images?updatedAfter=` 增量接口，不新增 manifest 接口）：
1. `updatedAfter = 本地 max(update_time)`（仅当前 `gameId` 前缀下记录）。
2. `GET /api/games/{gameId}/images?updatedAfter={updatedAfter}`。
3. 返回空：本地已是最新，无操作。
4. 返回非空：`upsertRemoteImages` 覆盖写入（现有逻辑）。

> 为什么不新增 manifest 接口：`updatedAfter` 增量接口已经同时承担了“确认是否最新”和“拉差集完整 base64”两件事——后端只返回 `updatedAt > updatedAfter` 的图，返回值本身就是差集。再拆一层轻量 manifest 做“先判断再拉”是过度设计，且 `images` 接口无 ETag（见后端 §4.1），manifest 也无法借 304 省掉这一步。

> 与 Bundle 的区别：Bundle 适合“轻量 current + 全量 bundle”两步模式，因为 Bundle 体积大、变化靠 versionCode 精确命中。Image 增量接口本身已是差集，不需要套这个模式。

### 11.2 `cache_meta` store（DB version 1→2，不动 `images` store）

为支持 LRU 跨 game 清理，新增 `cache_meta` store 记录 game 级别元数据：

```ts
type CacheMetaRecord = {
  gameId: string;          // keyPath
  lastAccessedAt: string;  // 读/写该 game 图片时更新
  imageCount: number;      // 该 game 缓存条数（冗余，方便展示）
  approxSize: number;      // 估算占用（base64 字符数累加）
}
```

升级策略：
- `image_db` DB version 从 1 升到 2。
- `onupgradeneeded` 中**不改动 `images` store**（保留 V1 的 keyPath `uri` 与索引），仅 `createObjectStore('cache_meta', { keyPath: 'gameId' })`。
- 存量图片数据零迁移；`cache_meta` 首次按 game 前缀聚合 `images` 表惰性填充。

> 为什么用独立 meta store 而不是给 `images` 加 `lastAccessedAt` 字段：加字段要改 `images` store schema 并迁移所有行；meta store 只记 game 级别，行数极少，LRU 判断只需读 meta store，清理时按 meta 选出 game 再按 `{gameId}_` 前缀删 `images`。

更新时机：
- `upsertRemoteImages` / `upsertRemoteImage` 写入后，更新对应 `gameId` 的 `lastAccessedAt` / `imageCount` / `approxSize`。
- `listCachedImages` / `getCachedImage` 读取后，更新对应 `gameId` 的 `lastAccessedAt`（不强制，可降级为只在写入时更新以减少事务）。

### 11.3 LRU 跨 game 缓存管理

触发时机：`upsertRemoteImages` 捕获到 `QuotaExceededError` 时，自动按 LRU 清理其他 game，清理后重试一次。**不在正常写入时触发**，避免无故清缓存。

清理算法：
1. 读取 `cache_meta` 全量，按 `lastAccessedAt` 升序排序。
2. 跳过当前 `gameId`，从最久未访问的其他 game 开始清理。
3. 每清一个 game：按 `{gameId}_` 前缀删 `images` 行 + 删 `cache_meta` 行。
4. 清理后重试原 `upsertRemoteImages`；若仍失败，继续清下一个 game。
5. 所有其他 game 都清完仍失败 → 走 §11.4 的极端空间不足提示。

> 不做主动逐 uri 的 GC。脏 uri（后端已删但本地还在）的实际影响很小：资源页只按“资源引用的 uri”查本地缓存，bundle 不引用就不会显示；占空间时由 LRU 跨 game 清理 + 手动“清理当前缓存”按钮兜底。

### 11.4 Quota 兜底 UX

错误分类处理（替换 V1 的通用 throw）：
1. `QuotaExceededError` → 触发 §11.3 LRU 自动清理 + 重试。
2. 重试仍失败（只剩当前 game 还不够）→ UI 提示“浏览器存储空间不足，已自动清理其他游戏缓存仍无法写入。建议在浏览器设置里清理站点数据。”，并给出“查看缓存占用”入口。
3. 非配额错误（网络/接口）→ 保持 V1 通用提示。

`ImagesPage` 顶部新增常驻“缓存占用”卡片：总条数 + 按 game 分布 + 最近访问时间（数据来自 `cache_meta`）。让用户对空间有感知，而不是出问题才知道。

### 11.5 全量同步对账（顺手做，零新接口）

V1 的“全量同步”分支（`runSync('full')`）拉取的是完整集合。阶段 2 在此分支加一步对账：
- 全量返回的 uri 集合记为 `remoteSet`。
- 本地该 `gameId` 前缀下的 uri 集合记为 `localSet`。
- `localSet - remoteSet` 即“本地多余、后端已不存在”的 uri，逐条删除。

> 这是清理“后端已删但本地还在”脏 uri 的零成本方式：只在用户主动点“全量同步”时做，不依赖后端删除接口，也不需要 manifest。增量同步分支不做对账（增量返回的不是完整集合，无法对账）。

### 11.6 明确推迟的项

| 项 | 推迟原因 | 重新评估条件 |
|----|---------|------------|
| Blob 化（base64 → Blob） | 当前 64×64、量级可控，base64 膨胀成本可接受；Blob 化引入 `createObjectURL`/`revokeObjectURL` 生命周期管理成本 | 图片数量或尺寸明显增长，或单 game 缓存接近 quota |
| 后端删除接口 | 用户明确不加，防止误操作 | 出现强需求时再评估，当前本地对账 + LRU 已够 |
| Worker 宿主与缓存边界 | 与 Wasm 计算阶段耦合，本次不涉及 | 进入 Wasm 性能测试阶段时统一规划 |
| `images` store schema 变更 | V1 schema 已满足阶段 2 需求，`cache_meta` 用独立 store 承接 | 出现必须按行级元数据（如单图访问频次）决策的需求 |

### 11.7 阶段 2 验收标准

1. 进入 `ImagesPage` 或资源页时，自动静默执行增量同步，无需用户点按钮。
2. 30 秒内重复进入不重复拉取。
3. 写入遇 `QuotaExceededError` 时，自动 LRU 清理其他游戏缓存并重试，用户无感。
4. LRU 清理后仍空间不足时，给出针对性提示与“缓存占用”入口。
5. `ImagesPage` 展示按 game 分布的缓存占用与最近访问时间。
6. 用户点“全量同步”后，本地多余的脏 uri 被对账删除。
7. 断网时已缓存图片正常展示，自动同步失败不影响页面可用。
