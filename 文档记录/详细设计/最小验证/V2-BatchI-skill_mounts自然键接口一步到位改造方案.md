TASK_KEY: planning-validation-milestones
DOC_TYPE: 详细设计
WORKSTREAM: planning
STATUS: draft
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-05-23

# V2 Batch I skill_mounts 自然键接口一步到位改造方案

关联基线方案：[V2-BatchI-普攻Skill化与挂载改造计划.md](./V2-BatchI-普攻Skill化与挂载改造计划.md)

协同流程：[Cursor-GPT协同开发流程说明.md](../Cursor-GPT协同开发流程说明.md)

## 1. 文档边界

本文是后续自然键重构的详细设计真源，目标读者是负责 backend / web / wasm 联动改造的本地开发 agent 与 GPT review owner。

本文不重写 Batch I 已完成的 mountId / mountKey 基线实现，也不回写历史验收结论；它只定义下一轮“一步到位切到自然键接口”的目标契约、迁移边界、写入范围与验证要求。

如发现当前代码、现存数据或 Batch I 既有文档与本文的前提冲突，必须停止编码并先回报 GPT review，不得自行降级为兼容模式。

## 2. 已确认决策

以下决策已在会话中确认，后续开发不得再回到 mountId / mountKey 方案：

1. `skill_mounts` 的资源身份改为自然键 `(game_id, target_category, target_id, skill_id)`。
2. 不再保留 `mount_id`、`mount_key` 字段，也不再在 Admin API、published bundle、web types、wasm DTO、导出 JSON 中暴露这两个字段。
3. 单条资源接口改为按自然键寻址，不再使用 `/skill-mounts/{mountId}`。
4. 同一 `target` 下，同一 `skill_id` 最多允许一条 enabled/disabled mount 记录；第二次写入是 update，不是新增。
5. 同一 hero 仍允许挂多个 `action/basic_attack` skill，但这些 skill 必须是不同 `skill_id`。
6. wasm runtime 继续只按 `skillId` / `actionId` 执行动作链，不再感知 mount 关系 ID。
7. 本轮采用一步到位切换，不保留 mountId 兼容字段、兼容路由或双写过渡层。

## 3. 当前代码事实与必须处理的冲突

编码前必须承认以下现状，否则会把旧约束带回新设计：

1. 现有 Batch I 基线文档把 `mount_id` 定义为主键组成部分，并要求导出 JSON 保留 `mountId`。
2. 现有 backend / web / wasm 代码已经广泛使用 `mountId` 作为 API 路由参数、bundle 字段、前端去重键与证据字段。
3. 现有 integration test 已经覆盖“同一 hero、同一 `skill_id`、两条不同 `mountId`”的旧模型。这条测试在新模型下必须改掉，不能为了保留测试而保留 mountId。

进入开发前，先执行重复数据预检查：

```sql
select game_id, target_category, target_id, skill_id, count(*)
from public.skill_mounts
group by 1, 2, 3, 4
having count(*) > 1;
```

若返回非空，直接 blocked。本轮不允许在迁移脚本里自动合并冲突记录，也不允许偷偷保留 `mount_id` 作为后门唯一键。

## 4. 目标契约

### 4.1 DB：skill_mounts / skill_mounts_log

目标表结构：

```text
public.skill_mounts
public.skill_mounts_log
```

`skill_mounts` 建议字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `game_id` | `varchar(64)` | 是 | 游戏 ID |
| `start_version_id` | `bigint` | 是 | 覆盖起始版本 |
| `end_version_id` | `bigint` | 是 | 覆盖结束版本 |
| `target_category` | `varchar(32)` | 是 | 挂载目标类别；本轮仍允许通用值，但 V2 DPS 只消费 `hero` |
| `target_id` | `varchar(64)` | 是 | 目标 ID |
| `skill_id` | `varchar(64)` | 是 | 被挂载的 skill |
| `enabled` | `boolean` | 是 | 是否生效，默认 `true` |
| `extend` | `jsonb` | 是 | 扩展字段，默认 `{}` |
| `updated_at` | `timestamp` | 是 | 更新时间 |

主键改为：

```sql
PRIMARY KEY (game_id, target_category, target_id, skill_id)
```

`skill_mounts_log` 主键改为：

```sql
PRIMARY KEY (game_id, target_category, target_id, skill_id, start_version_id)
```

索引保留：

```sql
CREATE INDEX idx_skill_mounts_target
ON public.skill_mounts (game_id, target_category, target_id);

CREATE INDEX idx_skill_mounts_skill
ON public.skill_mounts (game_id, skill_id);
```

不再存在：

1. `mount_id`
2. `mount_key`
3. 任何基于 `mount_id` 的索引、FK、冲突键、日志键

### 4.2 Admin API

列表接口保留：

```text
GET /api/admin/games/{gameId}/skill-mounts
```

单条读写接口改为自然键：

```text
GET /api/admin/games/{gameId}/skill-mounts/{targetCategory}/{targetId}/{skillId}
PUT /api/admin/games/{gameId}/skill-mounts/{targetCategory}/{targetId}/{skillId}
```

接口约束：

1. `PUT` 路由参数与 body 中的 `targetCategory` / `targetId` / `skillId` 必须一致；若 body 省略，可由路由回填。
2. 同一自然键重复 `PUT` 是更新，不是新增。
3. 不保留 `/skill-mounts/{mountId}` 兼容路由。
4. 不返回 `mountId` / `mountKey` 占位字段。

### 4.3 Published Bundle

`GameDataBundle.skillMounts` 目标形状：

```json
{
  "skillMounts": [
    {
      "targetCategory": "hero",
      "targetId": "hero_ezreal",
      "skillId": "skill_lol_basic_attack_default",
      "enabled": true,
      "extend": {}
    }
  ]
}
```

约束：

1. 不再输出 `mountId` / `mountKey`。
2. 同一 bundle 中，不得出现同一 `(targetCategory, targetId, skillId)` 的两条 mount。
3. web adapter 以 `targetCategory + targetId` 筛选候选 skill，再以 `skillId` 区分具体挂载 skill。

### 4.4 Wasm DPS 输入

`basicAttackActions` 目标形状：

```json
{
  "basicAttackActions": [
    {
      "actionId": "self::skill_lol_basic_attack_default",
      "skillId": "skill_lol_basic_attack_default"
    }
  ]
}
```

约束：

1. 不再向 runtime 传 `mountId`。
2. 当前 curve 先按 attacker hero 过滤出 mounted skills，再按 `skillId` 唯一区分。
3. 当同一 hero 挂多个 basic attack skill 时，多个 `skillId` 全部进入 `basicAttackActions`。
4. 缺失列表时仍然 blocked，不允许 fallback 到硬编码 `basic_attack` 或 AD 直伤。

### 4.5 页面导出与证据

V2 DPS 页面导出 JSON 仍需保留“普攻来自真实 mounted skill”的证据，但证据字段改为：

1. `skillId`
2. `actionId`
3. `sourceKind = "mount"` 或等价页面证据字段
4. 若需要显示挂载来源目标，则使用 `targetCategory` / `targetId`，不再显示 `mountId`

不再要求导出 `mountId`。

## 5. 一步到位迁移原则

本轮是 schema / API / DTO / 页面证据的一步切换，不做兼容桥。

必须同时满足：

1. DB schema 一次性去掉 `mount_id` / `mount_key`。
2. backend controller / service / mapper 一次性切到自然键。
3. web admin / apiClient / types / adapter 一次性切到自然键。
4. wasm model / tests 一次性移除 `MountID`。
5. 旧测试、旧文档、旧页面文案同步收口。

禁止项：

1. 保留旧字段但标记 deprecated。
2. 保留旧路由并内部转发。
3. 在 web 层偷偷拼一个 synthetic `mountId` 继续用。
4. 在 wasm DTO 里保留 `mountId` 仅供 debug。

## 6. Backend 任务

后端写入范围：

```text
db/game_manage/schema.sql
db/game_manage/triggers.sql
server/data_manage/src/main/java/xyz/game/datamanage/**
server/data_manage/src/main/resources/mapper/**
server/data_manage/src/test/java/xyz/game/datamanage/**
```

只读参考：

```text
server/data_manage/AGENTS.md
server/data_manage/README.md
server/data_manage/src/main/java/xyz/game/datamanage/service/PostgresReadStore.java
server/data_manage/src/main/java/xyz/game/datamanage/service/PostgresWriteStore.java
server/data_manage/src/main/resources/mapper/skill_mounts/SkillMountsMapper.xml
server/data_manage/src/test/java/xyz/game/datamanage/integration/ControllerPublishFlowIT.java
```

必须完成：

1. `skill_mounts` / `skill_mounts_log` DDL 改为自然键，无 `mount_id` / `mount_key`。
2. `SkillMountsMapper` 查询、upsert、publish log、version range 更新全部改为自然键参数。
3. `SkillMountAdminController` 路由改为 `{targetCategory}/{targetId}/{skillId}`。
4. `GameDataService` / `PostgresReadStore` / `PostgresWriteStore` 的 skill mount 读写签名全部收口到自然键。
5. publish validation 继续校验：
   - `skillId` 存在
   - `targetCategory=hero` 时 `targetId` 存在于 `heroes`
   - `targetCategory=item` 时 `targetId` 存在于 `items`
6. `DefaultBasicAttackProvisioner` 不再生成 `{heroId}__{skillId}` 挂载 ID，只按自然键 upsert 默认挂载。
7. 旧 integration test 中“同 hero + 同 skillId + 两条 mountId”的场景改为：
   - 同 hero + 两个不同 `skillId` 的 basic attack skill
   - 或同自然键二次写入是 update

后端验证命令：

```powershell
cd C:\project\damage_backend_dev\server\data_manage
mvn test
```

## 7. Web 任务

Web 写入范围：

```text
web/src/types/api.ts
web/src/services/apiClient.ts
web/src/config/navigation.ts
web/src/App.tsx
web/src/pages/admin/resources/skill-mounts/**
web/src/engine/tinygoV2BundleAdapter.ts
web/src/engine/tinygoV2DpsAdapter.ts
web/src/pages/WasmValidationV2DpsPage.tsx
```

只读参考：

```text
web/AGENTS.md
web/README.md
web/src/pages/admin/AGENTS.md
web/src/pages/admin/resources/skills/**
web/src/pages/admin/resources/type-relations/**
```

必须完成：

1. `SkillMount` 类型删除 `mountId` / `mountKey`。
2. `apiClient.ts` skill-mounts 单条路由改为自然键路径。
3. Admin Skill Mounts 页面不再录入或展示 `mountId` / `mountKey`。
4. Admin 表格 `rowKey` 改为组合字符串，例如 `${targetCategory}:${targetId}:${skillId}`，但这只是前端行键，不是后端业务字段。
5. `tinygoV2BundleAdapter.ts`：
   - 去掉 `seenMountIds`
   - 先按 target 筛 mount，再按 `skillId` 识别 mounted skill
   - 不再构造或消费 synthetic `mountId`
6. `tinygoV2DpsAdapter.ts`：
   - `basicAttackActions` 只输出 `actionId` / `skillId`
   - 无 `mountId` 字段
7. `WasmValidationV2DpsPage.tsx`：
   - 证据表不再展示 `mountId`
   - 改为展示 `skillId` / `actionId` / `sourceKind`
   - 页面文案不得再暗示存在 mountId

Web 验证命令：

```powershell
cd C:\project\damage_web_dev\web
npm run build
```

## 8. Wasm 任务

Wasm 写入范围：

```text
wasm/tinygo_engine_v2/internal/model/types.go
wasm/tinygo_engine_v2/internal/runtime/dps_driver.go
wasm/tinygo_engine_v2/internal/runtime/dps_driver_test.go
wasm/tinygo_engine_v2/internal/runtime/runtime.go
```

只读参考：

```text
wasm/tinygo_engine_v2/AGENTS.md
wasm/tinygo_engine_v2/README.md
wasm/tinygo_engine_v2/internal/runtime/dps_driver.go
wasm/tinygo_engine_v2/internal/runtime/dps_driver_test.go
```

必须完成：

1. 删除 `DPSBasicAttackActionRefV2.MountID`。
2. runtime 不再期望 `mountId` 存在。
3. 相关测试数据改为只断言 `skillId` / `actionId` / classifier 行为。
4. 若现有测试用两个 basic attack action，必须使用不同 `skillId`，不能再用相同 `skillId` + 不同 `mountId` 伪造多挂载。

Wasm 验证命令：

```powershell
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go test ./internal/runtime -run "SingleAttackerDPS|Canonical" -count=1
go test ./...
```

## 9. 实施顺序

严格按以下顺序执行：

1. 更新本文与旧 Batch I 文档的前向链接，确认权威源。
2. 运行 DB 重复数据预检查；若失败，直接 blocked。
3. backend 先改 schema / mapper / API / publish / provisioner / tests。
4. backend `mvn test` 通过后，再改 web admin / adapter / export。
5. web `npm run build` 通过后，再改 wasm DTO / tests。
6. wasm 测试通过后，再做浏览器 E2E。

不允许跳步补救。若 backend 仍输出 `mountId`，web 不得本地先行删除字段并硬适配。

## 10. Review Checklist

GPT review 必须逐项检查：

1. DB 中不存在 `mount_id` / `mount_key` 剩余列、索引、约束或 log 表残留。
2. Admin API 不再暴露 `/skill-mounts/{mountId}`。
3. bundle `skillMounts` 不再包含 `mountId` / `mountKey`。
4. web adapter 不再维护 `seenMountIds`。
5. wasm DTO 中不再有 `MountID`。
6. 旧测试中“同 hero 同 skillId 两条 mountId”已被删除或改写。
7. V2 DPS 在真实页面上仍能解析 Ezreal 的 basic attack skill，并输出真实 `skillId` / `actionId`。
8. 缺少 mounted basic attack skill 时仍然 blocked。
9. 多个不同 `skillId` 的 basic attack skill 仍然全部调度。
10. 没有通过 synthetic `mountId` 在其他层偷偷保留旧模型。

## 11. 完成定义

本轮自然键改造只有同时满足以下条件才算完成：

1. 本文定义的 schema / API / bundle / wasm DTO 契约全部落地。
2. backend `mvn test` 通过。
3. web `npm run build` 通过。
4. wasm `go test ./internal/runtime -run "SingleAttackerDPS|Canonical" -count=1` 与 `go test ./...` 通过。
5. 浏览器 E2E 证实 Ezreal V2 DPS 页面可运行，且证据不再依赖 `mountId`。
6. 旧 Batch I 文档已明确标注它是历史基线方案，新的自然键真源是本文。
