TASK_KEY: planning-validation-milestones
DOC_TYPE: 详细设计
WORKSTREAM: planning
STATUS: draft
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: 2026-05-22

# V2 Batch I 普攻 Skill 化与挂载改造计划

关联总方案：[V2-单攻击方DPS协议与开发计划.md](./V2-单攻击方DPS协议与开发计划.md)

协同流程：[Cursor-GPT协同开发流程说明.md](../Cursor-GPT协同开发流程说明.md)

前置 Runtime 扩展：[V2-BatchH-状态型普攻被动Runtime扩展计划.md](./V2-BatchH-状态型普攻被动Runtime扩展计划.md)

后续自然键重构方案：[V2-BatchI-skill_mounts自然键接口一步到位改造方案.md](./V2-BatchI-skill_mounts自然键接口一步到位改造方案.md)

> 历史说明：本文记录的是 Batch I 已落地的 `mountId / mountKey` 基线方案。若继续推进 skill mount 自然键接口收口与一步到位去除 `mountId` / `mountKey`，以“后续自然键重构方案”为新的实现真源；本文保留用于回溯 Batch I 基线实现与验收口径。

## 1. 本文档边界

本文是 Batch I 的开发执行真源，目标读者是后续负责写代码的本地开发 agent。开发 agent 不需要重新判断产品口径，只能按本文执行；如果发现本文与代码事实冲突，必须停止并回报 GPT review 会话，不得自行改设计。

Batch I 解决的问题是：当前 V2 DPS 三个测试页面和 `single_attacker_dps` runtime 把普攻当成硬编码 `basic_attack` 动作；而当前数据模型的长期方向是“普攻是一类 skill，这个 skill 可以挂载到不同英雄上”。本批要把普攻来源从硬编码动作改为 published bundle 中真实挂载到英雄的 `action/basic_attack` skill。

本批只覆盖 V2 DPS 普攻主循环和其所需的数据挂载链，不重做完整技能轮转、不重写 M1/M2/M3/M4 验证页、不新增自由战斗编辑器。

## 2. 协同开发方式

本批按 `Cursor-GPT协同开发流程说明.md` 执行：

1. Cursor 或其它本地开发 agent 只负责编码，不负责最终判断“已完成”。
2. GPT 负责拆任务、review diff、给 fix prompt、跑最终验证和组织人工验收包。
3. Cursor 调用必须使用 `composer-2.5` 且显式 `fast=false`；不得使用 `composer-latest`、`composer` 或默认 fast 变体。
4. 每一轮 Cursor 开发必须返回：改动文件、关键实现摘要、运行过的命令、失败命令、残留风险。
5. GPT review 发现阻塞问题时，只把阻塞项转成下一轮 fix prompt；Cursor fix 不得顺手扩范围。
6. 最多连续 3 轮 Cursor fix；第 3 轮后仍有阻塞项时停止自动循环，由用户判断是否拆分或调整目标。
7. 开发开始前必须分别在三个 worktree 执行 `git status --short -uall`，不得回滚用户或其它 agent 的无关改动。

推荐 worktree 划分：

| Worktree | 分支前缀 | 职责 |
| --- | --- | --- |
| `C:\project\damage_backend_dev` | `backend/` 或 `server/` | DB schema、mapper、service、controller、publish bundle、默认数据导入/发布 |
| `C:\project\damage_web_dev` | `web/` | Admin 挂载页、API client/type、V2 DPS 三页和 bundle adapter |
| `C:\project\damage_wasm_dev` | `wasm/` | TinyGo V2 runtime、DPS 输入输出 DTO、runtime tests、文档和最终治理 |

如果实际执行只在 `C:\project\damage_wasm_dev` 的 monorepo 路径内完成，也必须在报告里说明没有使用独立 worktree，并保持写入范围等价。

## 3. 已确认设计决策

以下决策已在 grill-me 中确认，后续开发不得重新发散：

1. 普攻是 skill，不是 runtime 内置动作。
2. 普攻 skill 的动作分类是 `action/basic_attack`。
3. V2 DPS 识别普攻候选时，以 mounted skill 编译出的 action classifier 是否包含 `action/basic_attack` 为准；不以 `skillKey=AA` 或 `mountKey=basic_attack` 为准。
4. 同一英雄如果挂了多个 `action/basic_attack` skill，不做唯一性校验、不阻塞、不按优先级选一条；全部自动进入调度，配置错误由曲线结果暴露。
5. 普攻节奏由 skill cooldown 公式驱动；公式可以引用攻击方 `attack_speed`。
6. 默认 shared 普攻 skill 的主伤害写在 `on_spell_cast`。
7. `on_basic_attack_hit` 不表达普攻本体伤害，只作为英雄/装备/符文被动监听“普攻命中”的事件。
8. 默认 shared 普攻伤害采用期望值暴击公式：`attack_damage * (1 + crit_chance * (crit_damage - 1))`。
9. 缺少 mounted basic attack skill 时，V2 DPS 页面和 runtime 都必须 blocked，不允许 fallback 到硬编码 `basic_attack` 或直接 AD 伤害。
10. 新增通用 skill 挂载能力，允许非 hero 目标存在；Batch I 的 V2 DPS 只消费 `targetCategory=hero`。
11. `skills.owner_type` / `skills.owner_id` 改为可空；空归属表示 shared/template skill。
12. 本批必须落真实默认数据：shared default basic attack skill + 挂到当前已有英雄。不得用页面 mock 或 test-only 假数据冒充验收。

## 4. 当前代码事实

开发前必须核对以下事实仍成立；如果任一事实已被其它分支改掉，先停止并让 GPT review 更新本文。

### 4.1 Web 当前硬编码点

文件：`web/src/engine/tinygoV2DpsAdapter.ts`

当前存在硬编码：

```ts
const V2_DPS_BASIC_ATTACK_ACTION_ID = 'basic_attack';
```

并在 `prepareV2DpsInput(...)` 中写入：

```ts
simulationRules.autoAttackPlan.actionId = V2_DPS_BASIC_ATTACK_ACTION_ID
```

这正是 Batch I 要移除的核心假设。

三条页面路由共用同一个页面文件：

```text
web/src/pages/WasmValidationV2DpsPage.tsx
```

涉及路由：

```text
#/wasm-validation-v2-dps
#/wasm-validation-v2-dps-multi-hero
#/wasm-validation-v2-dps-stacking-passive
```

Batch I 不新增第四个正式 DPS 页；如需专门调试页，只能作为临时验证入口，并在最终验收前明确是否保留。

### 4.2 Web 通用 action 编译链

文件：`web/src/engine/tinygoV2BundleAdapter.ts`

当前 `collectActorActionSkills(...)` 只从两类来源收集 action skill：

1. `skill.ownerType === 'hero' && skill.ownerId === hero.heroId`
2. `item.skillRefs`

Batch I 后，shared/template skill 不再依赖 `ownerType/ownerId` 归属，必须通过 published bundle 的 `skillMounts` 把 skill 收集到 actor。

当前 `compileActionEffects(...)` 只编译 `on_spell_cast` trigger。这个行为符合 Batch I 的默认普攻主伤害口径，不能把默认普攻主伤害放到 `on_basic_attack_hit` 后再要求这里编译。

当前 TypeScript `TinyGoV2ActionTemplate` 没有显式 `classifier` 字段，而 TinyGo Go DTO `ActionTemplateV2` 已经有：

```go
Classifier model.ClassifierV2 `json:"classifier,omitempty"`
```

Batch I 必须补齐 Web 编译输出中的 action classifier，否则 runtime 不能按 `action/basic_attack` 识别普攻。

### 4.3 Wasm 当前硬编码点

文件：`wasm/tinygo_engine_v2/internal/runtime/dps_driver.go`

当前 `RunSingleAttackerDPS` 会默认并校验：

```go
rules.AutoAttackPlan.ActionID = "basic_attack"
rules.AutoAttackPlan.TargetRole = "target"
```

当前 `validateDPSCurve(...)` 会拒绝非 `basic_attack`：

```go
single_attacker_dps only supports autoAttackPlan.actionId=basic_attack
```

当前 `processAttack(...)` 直接读取 AD 并调用 `applyDamage(...)`：

```go
attackDamage := state.resolveBasicAttackRawDamage(...)
state.applyDamage(timeMs, state.rules.AutoAttackPlan.ActionID, "physical", attackDamage)
state.processAttackPassives(timeMs)
```

Batch I 后，DPS driver 不得再自行计算普攻伤害；它必须执行 mounted basic attack action 的完整 action chain。

### 4.4 Backend 当前限制

文件：`db/game_manage/schema.sql`

当前 `skills` 和 `skills_log`：

```sql
owner_id varchar(64) NOT NULL,
owner_type varchar(32) NOT NULL
```

并有 `(game_id, owner_type)` 外键到 `owner_categories`。Batch I 必须允许 shared/template skill，所以这两列要变成 nullable；外键保留，但只在 `owner_type IS NOT NULL` 时生效。

当前已有 `type_relations`，可把 type 挂到 `target_category='skill'`，这仍是表达 `action/basic_attack` 分类的推荐方式。Batch I 不新增 skill 内部 `isBasicAttack` 布尔字段。

## 5. 目标数据契约

### 5.1 DB：skill_mounts

新增通用挂载表，建议表名：

```text
public.skill_mounts
public.skill_mounts_log
```

字段建议：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `game_id` | `varchar(64)` | 是 | 游戏 ID |
| `mount_id` | `varchar(96)` | 是 | 稳定挂载 ID，主键组成部分 |
| `start_version_id` | `bigint` | 是 | 覆盖起始版本 |
| `end_version_id` | `bigint` | 是 | 覆盖结束版本 |
| `target_category` | `varchar(32)` | 是 | 挂载目标类别，允许 `hero/item/global/skill/type` 等；Batch I 只消费 `hero` |
| `target_id` | `varchar(64)` | 是 | 目标 ID；hero 时为 `hero_id` |
| `skill_id` | `varchar(64)` | 是 | 被挂载 skill |
| `enabled` | `boolean` | 是 | 是否生效，默认 `true` |
| `mount_key` | `varchar(64)` | 否 | 人类可读槽位，例如 `basic_attack`、`passive`、`custom`；V2 DPS 不用它判断普攻 |
| `extend` | `jsonb` | 是 | 扩展字段，默认 `{}` |
| `updated_at` | `timestamp` | 是 | 更新时间 |

主键建议：

```sql
PRIMARY KEY (game_id, mount_id)
```

索引建议：

```sql
CREATE INDEX idx_skill_mounts_target ON public.skill_mounts (game_id, target_category, target_id);
CREATE INDEX idx_skill_mounts_skill ON public.skill_mounts (game_id, skill_id);
```

外键建议：

1. `(game_id, skill_id)` -> `skills(game_id, skill_id)`。
2. `(game_id, start_version_id)` / `(game_id, end_version_id)` -> `game_versions`。
3. `target_category='hero'` 时发布校验 `heroes` 存在。
4. `target_category='item'` 时发布校验 `items` 存在。
5. 其它 target category 第一版允许存在，但必须在 publish validation 中保留字段，不得被静默丢弃。

不要加唯一约束禁止同一 hero 挂多个 basic attack skill。挂多个是用户数据问题，系统只负责如实执行。

### 5.2 Published Bundle：skillMounts

`GameDataBundle` 增加：

```ts
skillMounts?: SkillMount[];
```

推荐 JSON 形状：

```json
{
  "skillMounts": [
    {
      "mountId": "hero_ezreal__skill_lol_basic_attack_default",
      "targetCategory": "hero",
      "targetId": "hero_ezreal",
      "skillId": "skill_lol_basic_attack_default",
      "enabled": true,
      "mountKey": "basic_attack",
      "extend": {}
    }
  ]
}
```

字段命名必须在 backend DTO、frontend `web/src/types/api.ts` 和 Admin 页面保持一致。

### 5.3 Wasm DPS 输入：basicAttackActions

移除 V2 DPS 对单个 `autoAttackPlan.actionId` 的语义依赖。推荐替代结构：

```json
{
  "simulationRules": {
    "durationMs": 10000,
    "warmupMs": 0,
    "sampleBy": "none",
    "eventWindowPolicy": "timeMs < durationMs",
    "dotTickIntervalMs": 1000,
    "critPolicy": "expected",
    "firstAttackAtMs": 0,
    "basicAttackPlan": {
      "enabled": true,
      "startAtMs": 0,
      "targetRole": "target"
    }
  },
  "curves": [
    {
      "resolvedSnapshot": {
        "basicAttackActions": [
          {
            "actionId": "self::skill_lol_basic_attack_default",
            "skillId": "skill_lol_basic_attack_default",
            "mountId": "hero_ezreal__skill_lol_basic_attack_default"
          }
        ]
      }
    }
  ]
}
```

实现可选择把 `basicAttackActions` 放在 `DPSResolvedSnapshotV2`，也可放在 `DPSCurveSelectionV2` 与 resolved snapshot 双写。最低要求：

1. runtime 能得到每条 curve 的 basic attack action id 列表。
2. 导出 JSON 能看到这些 action 来自哪个 `skillId` / `mountId`。
3. 缺少列表时 blocked。
4. 列表长度大于 1 时全部调度，不排序选择单条。

为降低兼容破坏，第一版可以保留 `autoAttackPlan` 字段但废弃 `actionId` 语义；如果保留，`actionId` 不得再被 runtime 校验为 `basic_attack`。

### 5.4 Action Classifier

Web 编译出的 `TinyGoV2ActionTemplate` 必须补：

```ts
classifier?: {
  types?: string[];
};
```

对于 mounted skill，如果 `typeRelations` 中存在：

```json
{
  "targetCategory": "skill",
  "targetId": "skill_lol_basic_attack_default",
  "typeId": 50101
}
```

且 type 名称/路径表示 `basic_attack`，则编译 action 时输出：

```json
{
  "id": "self::skill_lol_basic_attack_default",
  "classifier": {
    "types": ["action/basic_attack"]
  }
}
```

如果现有 type 数据只能提供 `basic_attack` 而非 `action/basic_attack`，Web adapter 必须沿用 `tinygoV2BundleAdapter` 中现有 type 归一化规则；不得在 DPS 页面里写临时字符串判断。

## 6. 默认基础数据

Batch I 必须提供真实默认数据，不能让用户再手工录入后才能 E2E。

### 6.1 shared default basic attack skill

建议 skill：

```json
{
  "skillId": "skill_lol_basic_attack_default",
  "ownerType": null,
  "ownerId": null,
  "skillKey": "AA",
  "name": "默认普通攻击",
  "description": "共享默认普攻模板；特殊英雄可额外挂载专属 basic attack skill。",
  "cooldowns": [
    {
      "kind": "formula",
      "bindingKey": "cooldown.basic_attack"
    }
  ],
  "params": {
    "version": 1,
    "vars": [
      {
        "key": "expected_basic_attack_damage",
        "kind": "formula",
        "formulaText": "attack_damage * (1 + crit_chance * (crit_damage - 1))",
        "formulaVars": ["attack_damage", "crit_chance", "crit_damage"]
      }
    ]
  },
  "mechanicsConfig": {
    "version": 1,
    "triggers": [
      {
        "id": "basic_attack_cast",
        "event": { "type": "on_spell_cast" },
        "actions": [
          {
            "type": "deal_damage",
            "damageSource": "self",
            "damageTarget": "enemy",
            "damageType": "physical",
            "amount": {
              "kind": "formula",
              "bindingKey": "damage.basic_attack.expected"
            }
          }
        ]
      }
    ]
  }
}
```

上面的 JSON 是语义样例，不要求字段逐字一致；实现时必须遵守当前 skill editor / formula binding 的真实 schema。

### 6.2 cooldown formula

默认普攻 cooldown 语义：

```text
cooldownMs = 1000 / min(max(attack_speed, 0.01), 3.0)
```

注意：

1. 当前 `simulationRules.attackSpeedCap=3.0` 可以保留作为 DPS 规则，但实际普攻间隔必须来自 skill cooldown formula。
2. 如果当前 formula compiler 不支持 `min/max/clamp`，可以在 runtime 的 action cooldown formula 评估外层做 cap，但必须写测试证明超过 3.0 的攻速不会突破 cap。
3. 公式必须从 actor 当前属性读取 `attack_speed`，以支持 Batch H 的叠层攻速修改影响后续普攻。

### 6.3 批量挂载

默认 shared skill 必须挂到当前 published/draft 中已有英雄。建议 mount id：

```text
{heroId}__skill_lol_basic_attack_default
```

示例：

```json
{
  "mountId": "hero_ezreal__skill_lol_basic_attack_default",
  "targetCategory": "hero",
  "targetId": "hero_ezreal",
  "skillId": "skill_lol_basic_attack_default",
  "enabled": true,
  "mountKey": "basic_attack",
  "extend": {}
}
```

特殊英雄后续可以再挂专属 `action/basic_attack` skill；Batch I 不实现覆盖/优先级规则，多个候选全部执行。

## 7. 后端开发任务

后端开发 agent 的写入范围：

```text
db/game_manage/schema.sql
server/data_manage/src/main/java/xyz/game/datamanage/**
server/data_manage/src/main/resources/mapper/**
server/data_manage/src/test/java/xyz/game/datamanage/**
```

只读参考：

```text
server/data_manage/AGENTS.md
server/data_manage/README.md
server/data_manage/src/main/java/xyz/game/datamanage/controller/adminapi/SkillAdminController.java
server/data_manage/src/main/java/xyz/game/datamanage/controller/adminapi/TypeRelationAdminController.java
server/data_manage/src/main/java/xyz/game/datamanage/service/PostgresReadStore.java
server/data_manage/src/main/java/xyz/game/datamanage/service/PostgresWriteStore.java
server/data_manage/src/main/resources/mapper/skills/SkillsMapper.xml
server/data_manage/src/main/resources/mapper/type_relations/TypeRelationsMapper.xml
server/data_manage/src/test/java/xyz/game/datamanage/integration/ControllerPublishFlowIT.java
```

必须完成：

1. 修改 `skills` / `skills_log` 的 `owner_id`、`owner_type` 为 nullable。
2. 调整 `SkillsMapper.xml`、`SkillsMapper.java`、`PostgresReadStore.mapSkillRow(...)`、`PostgresWriteStore` skill upsert/validation，使 owner 可空。
3. 新增 `skill_mounts` / `skill_mounts_log` schema、mapper、read/write store 方法。
4. 新增 Admin API：
   - `GET /api/admin/games/{gameId}/skill-mounts`
   - `GET /api/admin/games/{gameId}/skill-mounts/{mountId}`
   - `PUT /api/admin/games/{gameId}/skill-mounts/{mountId}`
   - 删除可复用 tombstone/replace 口径；若当前 Admin 资源没有 DELETE 模式，保持与 type-relations 一致。
5. 发布 bundle 时输出 `skillMounts`。
6. 发布校验：
   - `skillMount.skillId` 必须存在。
   - `targetCategory=hero` 时 `targetId` 必须存在于 heroes。
   - `targetCategory=item` 时 `targetId` 必须存在于 items。
   - `enabled` 缺省按 `true`。
   - 不校验同一 hero 同一 basic attack 是否唯一。
7. 默认数据：
   - upsert `skill_lol_basic_attack_default`。
   - 写入其 `action/basic_attack` type relation。
   - 为当前已有 heroes 批量写入 skill mounts。
8. 后端测试至少覆盖：
   - owner 可空 skill 可写入、读取、发布。
   - skillMounts CRUD。
   - publish bundle 包含 skillMounts。
   - mount 到不存在 hero 时 publish blocked。
   - 同一 hero 多条 enabled mount 不 blocked。

后端验证命令：

```powershell
cd C:\project\damage_backend_dev\server\data_manage
mvn test
```

如果实际在 monorepo 路径执行：

```powershell
cd C:\project\damage_wasm_dev\server\data_manage
mvn test
```

## 8. Web 开发任务

Web 开发 agent 的写入范围：

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
web/src/pages/admin/resources/type-relations/**
web/src/pages/admin/resources/skills/**
web/src/pages/admin/resources/shared/useCrudResourcePage.ts
web/src/engine/tinygoV2Bridge.ts
```

必须完成：

1. `web/src/types/api.ts` 增加 `SkillMount` 类型和 `GameDataBundle.skillMounts?: SkillMount[]`。
2. `apiClient.ts` 增加 skill-mounts Admin API。
3. 新增 Admin 页面 `web/src/pages/admin/resources/skill-mounts/**`，复用现有 `useCrudResourcePage` 模式。
4. `navigation.ts` 和 `App.tsx` 接入 Skill Mounts 菜单和路由。
5. `tinygoV2BundleAdapter.ts`：
   - `collectActorActionSkills(...)` 增加 mounted skill 来源。
   - shared skill 的 `ownerType/ownerId` 可为空，不得因此崩溃。
   - action template 输出 `classifier`。
   - item skillRefs 原行为保持兼容。
6. `tinygoV2DpsAdapter.ts`：
   - 删除对 `V2_DPS_BASIC_ATTACK_ACTION_ID` 的依赖。
   - 每条 curve 根据 hero 挂载和 action classifier 解析 `basicAttackActions`。
   - 缺少 basic attack actions 时生成 blocked input 或前置错误，页面必须显示明确原因。
   - 多个 basic attack actions 全部进入 run input。
7. `WasmValidationV2DpsPage.tsx`：
   - 三个 V2 DPS 页面都展示“本次解析到的普通攻击 skill/action 列表”。
   - 导出 JSON 保留 `skillId`、`mountId`、`actionId`。
   - 页面文案不得暗示普攻来自硬编码 `basic_attack`。

Web 验证命令：

```powershell
cd C:\project\damage_web_dev\web
npm run build
```

如果实际在 monorepo 路径执行：

```powershell
cd C:\project\damage_wasm_dev\web
npm run build
```

页面 smoke 至少覆盖：

1. Admin Skill Mounts 能列出、创建/编辑一条 mount。
2. `#/wasm-validation-v2-dps` 能显示 Ezreal 的默认普攻 skill。
3. `#/wasm-validation-v2-dps-multi-hero` 多英雄行能各自解析 basic attack actions。
4. `#/wasm-validation-v2-dps-stacking-passive` 不因 basic attack skill 化破坏 Batch H stacking passive evidence。

## 9. Wasm Runtime 开发任务

Wasm 开发 agent 的写入范围：

```text
wasm/tinygo_engine_v2/internal/model/types.go
wasm/tinygo_engine_v2/internal/runtime/dps_driver.go
wasm/tinygo_engine_v2/internal/runtime/dps_driver_test.go
wasm/tinygo_engine_v2/internal/runtime/runtime.go
wasm/tinygo_engine_v2/internal/compile/**
wasm/tinygo_engine_v2/internal/testkit/**
wasm/tinygo_engine_v2/dist/tinygo_engine_v2.wasm
```

只读参考：

```text
wasm/tinygo_engine_v2/AGENTS.md
wasm/tinygo_engine_v2/README.md
wasm/tinygo_engine_v2/internal/runtime/runtime.go
wasm/tinygo_engine_v2/internal/runtime/runtime_test.go
wasm/tinygo_engine_v2/internal/compile/compile.go
```

必须完成：

1. `DPSAutoAttackPlan.ActionID` 不再作为唯一普攻动作。
2. 增加每条 curve 的 basic attack action 列表 DTO。字段名按 Web 最终结构同步，推荐 `BasicAttackActions []DPSBasicAttackActionRefV2`。
3. `validateDPSCurve(...)` 改为：
   - basic attack action 列表为空时 blocked。
   - 列表中的 action 必须存在于 attacker actor actions。
   - 对应 action classifier 必须包含 `action/basic_attack`。
   - 不要求 attack damage attr 存在；伤害由 action effect formula 决定。
   - 仍要求 target dummy、duration、dot tick、event window 等既有规则。
4. `processAttack(...)` 不再直接 `resolveBasicAttackRawDamage(...)`。
5. DPS driver 要调度每个 basic attack action：
   - 初始尝试时间为 `firstAttackAtMs` / `basicAttackPlan.startAtMs`，首版仍为 0。
   - 每个 action 维护自己的 next ready time。
   - 执行时复用 `RunContext` action chain，至少经过 `CanCast`、cooldown commit、resource/status gate、effect application。
   - action 成功造成普攻命中后触发现有 `processAttackPassives(...)` 或等价 on-hit 被动链。
6. cooldown 取 action 当前 cooldown formula 结果；攻击速度变化只影响后续调度，不回改已经处理的本次 action。
7. disarm/status action control 必须通过 action classifier `action/basic_attack` 生效。
8. 输出 evidence：
   - `attackTimeline.actionId` 使用真实 action id。
   - `damageBySource` / `effectBreakdown` 使用真实 skill/action source。
   - blocked reasons 能区分 `missing_basic_attack_action`、`invalid_basic_attack_classifier`、`action_not_found`。

允许的实现策略：

1. 优先抽取 `RunContext` 中可复用的 action 执行入口，避免在 DPS driver 再写一套 effect resolver。
2. 如果直接复用完整 scheduler 成本过高，可以先在 DPS driver 内部调用共享的 action gate/effect 方法，但不得复制伤害、抗性、状态控制和 cooldown 逻辑。
3. 不允许继续保留“AD 直伤 + processAttackPassives”作为成功路径 fallback。

Wasm 测试至少新增：

1. `TestSingleAttackerDPSBlocksMissingBasicAttackSkill`
2. `TestSingleAttackerDPSRunsMountedBasicAttackAction`
3. `TestSingleAttackerDPSRunsMultipleMountedBasicAttackActions`
4. `TestSingleAttackerDPSBasicAttackCooldownUsesAttackSpeedFormula`
5. `TestSingleAttackerDPSBasicAttackHitTriggersPassivesAfterActionDamage`
6. `TestSingleAttackerDPSDisarmBlocksClassifiedBasicAttack`

Wasm 验证命令：

```powershell
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go test ./internal/runtime -run "SingleAttackerDPS|Canonical" -count=1
go test ./...
go run ./cmd/bench
powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1
node .\scripts\smoke-node.mjs
```

如果 TinyGo build 报缺少 `wasm-opt`，先按既有本地约定设置：

```powershell
$env:WASMOPT='C:\project\damage_wasm_dev\.tools\binaryen-version_129\bin\wasm-opt.exe'
```

然后重跑同一条 build 命令。

## 10. 集成顺序

严格按以下顺序执行，不要让低能力开发 agent 自己调整顺序：

1. Backend schema/API/publish/data。
2. Backend tests 通过后，发布包含 `skillMounts` 和默认普攻挂载的 bundle。
3. Web types/api/Admin 页接入，确认 Admin 能读写 skill mounts。
4. Web bundle adapter 编译 mounted skill，并输出 action classifier。
5. Wasm DTO/runtime 支持 basic attack action list 和完整 action chain。
6. Web V2 DPS adapter/page 改为消费 mounted basic attack actions。
7. 同步 TinyGo wasm 产物到 Web。
8. 启动 backend + frontend 做 E2E。
9. GPT review 全量 diff 和测试结果。
10. 通过后补测试记录；未通过不得写“完成”结论。

如果某一步失败，只修当前步，不要跨步补救。例如 backend publish 没有 `skillMounts` 时，不允许 Web 临时从 draft API 拼数据。

## 11. Cursor 任务提示词模板

### 11.1 Backend 任务

```text
你是本轮 Backend 开发 agent。你不独占代码库，不得回滚用户或其它 agent 的无关改动。

目标：实现 V2 Batch I 的 skill_mounts 后端链路，让 shared/template skill 可被挂载到英雄并进入 published bundle。

必须先读：
- server/data_manage/AGENTS.md
- server/data_manage/README.md
- 文档记录/详细设计/最小验证/V2-BatchI-普攻Skill化与挂载改造计划.md
- db/game_manage/schema.sql
- server/data_manage/src/main/java/xyz/game/datamanage/service/PostgresReadStore.java
- server/data_manage/src/main/java/xyz/game/datamanage/service/PostgresWriteStore.java
- server/data_manage/src/test/java/xyz/game/datamanage/integration/ControllerPublishFlowIT.java

允许写入：
- db/game_manage/schema.sql
- server/data_manage/src/main/java/xyz/game/datamanage/**
- server/data_manage/src/main/resources/mapper/**
- server/data_manage/src/test/java/xyz/game/datamanage/**

禁止：
- 不要修改 web/** 或 wasm/**。
- 不要把 skill mount 做成 basic-attack-only 表。
- 不要加唯一约束禁止同一 hero 多个 basic_attack skill。
- 不要用 mock 数据代替默认普攻真实数据。

验证：
- cd server/data_manage
- mvn test

返回：
- 改动文件列表
- 新增 API 路径
- bundle 中 skillMounts 的示例
- mvn test 结果
- 未覆盖风险
```

### 11.2 Web 任务

```text
你是本轮 Web 开发 agent。你不独占代码库，不得回滚用户或其它 agent 的无关改动。

目标：接入 skillMounts Admin 页，并把 V2 DPS 三个页面的普攻来源改为 mounted action/basic_attack skill。

必须先读：
- web/AGENTS.md
- web/README.md
- web/src/pages/admin/AGENTS.md
- 文档记录/详细设计/最小验证/V2-BatchI-普攻Skill化与挂载改造计划.md
- web/src/engine/tinygoV2BundleAdapter.ts
- web/src/engine/tinygoV2DpsAdapter.ts
- web/src/pages/WasmValidationV2DpsPage.tsx
- web/src/pages/admin/resources/type-relations/**

允许写入：
- web/src/types/api.ts
- web/src/services/apiClient.ts
- web/src/config/navigation.ts
- web/src/App.tsx
- web/src/pages/admin/resources/skill-mounts/**
- web/src/engine/tinygoV2BundleAdapter.ts
- web/src/engine/tinygoV2DpsAdapter.ts
- web/src/pages/WasmValidationV2DpsPage.tsx

禁止：
- 不要在页面里手算普攻伤害。
- 不要 fallback 到 hardcoded basic_attack。
- 不要把 skillKey=AA 当作普攻识别依据。
- 不要只改 DPS 页而漏掉导出 JSON 证据。

验证：
- cd web
- npm run build

返回：
- 改动文件列表
- V2 DPS 如何解析 basic attack skill
- 页面新增的证据字段
- npm run build 结果
- 需要 GPT/人工 E2E 的内容
```

### 11.3 Wasm 任务

```text
你是本轮 Wasm Runtime 开发 agent。你不独占代码库，不得回滚用户或其它 agent 的无关改动。

目标：让 single_attacker_dps 执行 mounted action/basic_attack actions 的完整 action chain，而不是内置 AD 直伤。

必须先读：
- wasm/tinygo_engine_v2/AGENTS.md
- wasm/tinygo_engine_v2/README.md
- 文档记录/详细设计/最小验证/V2-BatchI-普攻Skill化与挂载改造计划.md
- wasm/tinygo_engine_v2/internal/model/types.go
- wasm/tinygo_engine_v2/internal/runtime/dps_driver.go
- wasm/tinygo_engine_v2/internal/runtime/runtime.go
- wasm/tinygo_engine_v2/internal/runtime/dps_driver_test.go

允许写入：
- wasm/tinygo_engine_v2/internal/model/types.go
- wasm/tinygo_engine_v2/internal/runtime/dps_driver.go
- wasm/tinygo_engine_v2/internal/runtime/dps_driver_test.go
- wasm/tinygo_engine_v2/internal/runtime/runtime.go
- wasm/tinygo_engine_v2/internal/compile/**
- wasm/tinygo_engine_v2/internal/testkit/**
- wasm/tinygo_engine_v2/dist/tinygo_engine_v2.wasm

禁止：
- 不要继续用 AD 直伤作为成功 fallback。
- 不要绕过 CanCast/status/cooldown/resource gate。
- 不要把 actionId=basic_attack 作为唯一合法普攻。
- 不要破坏已有 Canonical 和 Batch H stacking passive 行为。

验证：
- cd wasm/tinygo_engine_v2
- go test ./internal/runtime -run "SingleAttackerDPS|Canonical" -count=1
- go test ./...
- go run ./cmd/bench
- powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1
- node .\scripts\smoke-node.mjs

返回：
- 改动文件列表
- 新 DTO 字段
- 普攻 action chain 执行路径
- 测试结果
- 未覆盖风险
```

## 12. 最终 E2E 验收

最终验收必须由 GPT review 会话执行，不接受 Cursor 自述通过。

### 12.1 启动服务

Backend：

```powershell
cd C:\project\damage_backend_dev\server\data_manage
mvn spring-boot:run
```

Web：

```powershell
cd C:\project\damage_web_dev\web
npm run dev
```

如果端口被占用，记录实际端口，不要静默改配置。

### 12.2 数据与发布验证

必须验证：

1. `GET /api/admin/games/lol/skill-mounts` 能看到默认挂载。
2. `GET /api/games/lol/versions/current` 返回当前版本。
3. `GET /api/games/lol/versions/{versionCode}/bundle` 的 `skillMounts` 包含 `hero_ezreal` 的默认普攻挂载。
4. `bundle.skills` 包含 `skill_lol_basic_attack_default`。
5. `bundle.typeRelations` 能证明该 skill 属于 `action/basic_attack`。

### 12.3 浏览器验证

Playwright 或等价真实浏览器流程必须覆盖：

1. 打开 `#/wasm-validation-v2-dps`。
2. 选择 `hero_ezreal`。
3. 运行 DPS。
4. 页面展示 Ezreal 的 basic attack skill/action/mount。
5. 导出 JSON 中不存在硬编码 fallback 证据；应能看到 `skill_lol_basic_attack_default` 或对应真实 action id。
6. 再打开 `#/wasm-validation-v2-dps-stacking-passive`，选择一个已有被动英雄或 Batch H 场景，确认 stacking passive evidence 仍存在。

用户已经特别指出：不能声称 Ezreal 跑通，除非实际选择 `hero_ezreal` 并完成页面运行。

## 13. GPT Review Checklist

GPT review 必须逐项检查：

1. `git diff` 是否只包含 Batch I 范围。
2. `skills.owner_type/owner_id` 可空后，旧 hero/item skill 仍可发布。
3. `skillMounts` 是 published bundle 字段，不是前端 mock。
4. 默认普攻数据真实落库，并挂到已有 heroes。
5. V2 DPS 不再使用 `V2_DPS_BASIC_ATTACK_ACTION_ID`。
6. wasm `validateDPSCurve` 不再要求 `autoAttackPlan.actionId=basic_attack`。
7. wasm 成功路径没有 AD 直伤 fallback。
8. action classifier 从 type relation 进入 Web 编译输出，再进入 wasm。
9. 多个 basic attack actions 全部调度。
10. 缺少 basic attack actions 时 blocked。
11. `on_basic_attack_hit` 被动触发仍在 action damage 后发生。
12. Batch H stacking stat modifier 仍影响后续普攻 cooldown。
13. Ezreal 页面 E2E 是真实运行，不是仅 build 通过。
14. 失败或跳过的测试没有被写成通过。

## 14. 完成定义

Batch I 只有同时满足以下条件才能标为完成：

1. 后端 schema/API/publish/default data 完成并通过 `mvn test`。
2. Web Admin 和三条 V2 DPS 页面完成并通过 `npm run build`。
3. Wasm runtime 完成并通过 `go test ./...`、`go run ./cmd/bench`、TinyGo build、Node smoke。
4. published bundle 中存在 `skillMounts`、默认普攻 skill、默认普攻 type relation 和 hero 默认挂载。
5. 真实浏览器 E2E 跑通 `hero_ezreal`。
6. 真实浏览器 E2E 跑通至少一个已有被动/stacking 场景，证明 on-hit 和 Batch H 没被破坏。
7. GPT review 无阻塞 findings。
8. 测试记录补齐，且没有把人工未验收项标成完成。

如果只完成代码 build，但未启动 backend + frontend 做真实页面操作，只能报告“自动化构建通过，页面 E2E 未验收”，不得宣称 Batch I 完成。
