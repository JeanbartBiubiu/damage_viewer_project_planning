TASK_KEY: planning-validation-milestones
DOC_TYPE: 详细设计
WORKSTREAM: planning
STATUS: draft
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: 2026-05-24

# V2 Batch J 状态资源迁移与 1v1 伤害闭环计划

关联总方案：[V2-单攻击方DPS协议与开发计划.md](./V2-单攻击方DPS协议与开发计划.md)

前置批次：[V2-BatchH-状态型普攻被动Runtime扩展计划.md](./V2-BatchH-状态型普攻被动Runtime扩展计划.md)

前置批次：[V2-BatchI-普攻Skill化与挂载改造计划.md](./V2-BatchI-普攻Skill化与挂载改造计划.md)

协同流程：[Cursor-GPT协同开发流程说明.md](../Cursor-GPT协同开发流程说明.md)

设计来源：

1. `db/game_manage/status_resource_schema.sql`
2. `文档记录/需求澄清/server/wasm-db-design-gap-todo.md`
3. `文档记录/详细设计/server/game_manage/接口定义.md`

## 1. 本文档边界

本文档是后续 `backend / web / wasm` 三个 Cursor Composer 2.5 开发会话的唯一执行真源。Cursor 只负责按本文编码，不负责自行扩展目标；GPT/Codex 负责 review、集中测试、验证和最终验收。

本批目标不是一次性把所有 `skills.mechanics_config` 全部替换成新表，而是把“真正属于状态资源的数据”从 `mechanics_config/config` 中剥离出来，优先打通 1v1 伤害测试链路。这里的“1v1 伤害测试”特指：

1. 能在现有验证页和 wasm 运行链路里正确处理普攻伤害、技能直伤、持续伤害和会影响伤害结果的状态属性修饰。
2. 不要求本批实现控制、打断、击飞、沉默等控制态验收。
3. 不要求本批实现护盾验收。
4. 不要求本批把所有治疗/HoT 数据都迁入新表，但必须把“治疗暴击 1.45”所需的数据契约一次补齐，避免后改。

本批硬边界：

1. 不新增“模式感知”分支。召唤师峡谷、海克斯/竞技场如果规则不同，按两个独立 `gameId` 或独立发布数据版本配置，不在运行时根据 mode 切换。
2. 不把暴击语义重新塞到 `types` 或 `extend/config` blob 里。
3. 不把所有 `schedule_tick` 自动翻译成状态表；只迁真正具备“状态生命周期”的对象。
4. 不在前端手算伤害、DoT、暴击或治疗；前端只负责编译、展示和导出证据。

## 2. 当前事实与已确认决策

### 2.1 状态资源的原始职责已明确

`db/game_manage/status_resource_schema.sql` 已经把职责切开：

1. `skills.mechanics_config` 继续负责触发入口、动作编排和 `apply_status` 调用点。
2. `status_definitions` 负责状态本体、持续时间、叠层和快照策略。
3. `status_modifier_groups` 负责状态下的生效分组和 interval 生命周期。
4. `status_attribute_modifiers` 负责属性修饰。
5. `status_periodic_hp_effects` 负责 DoT / HoT。

所以本批不是重做新的建模方向，而是把现有设计真正接入已发布数据、web adapter 和 wasm runtime。

### 2.2 当前实现链路仍然是“后端已透出，前端仍在合成”

截至 2026-05-24，本地代码和 DB 现状如下：

1. `PostgresReadStore` / `PostgresWriteStore` 已经把 `statusDefinitions`、`statusModifierGroups`、`statusAttributeModifiers`、`statusPeriodicHpEffects`、`controlStateProfiles` 接入 Admin API 和 publish bundle。
2. `web/src/pages/admin/resources/status-management/index.tsx` 已经有状态资源管理页，但仍保留大量 `extendText` 入口。
3. `web/src/engine/tinygoV2BundleAdapter.ts` 仍在根据 `mechanics_config` 里的 `schedule_tick` / `grant_shield` / inline `apply_status` 合成 synthetic status。
4. `wasm/tinygo_engine_v2` 已经支持编译后的 `statuses[]`，包括：
   - `durationMs`
   - `tickIntervalMs`
   - `tickCount`
   - `tickEffectType`
   - `tickFormulaId`
   - `tickAmount`
   - `tickDamageType`
   - `attrModifiers`
5. 本地 DB `test0221` 的 `lol` 分区中，`status_definitions`、`status_modifier_groups`、`status_attribute_modifiers`、`status_periodic_hp_effects`、`control_state_profiles` 当前全部为 0 行；状态资源还没有真实落库数据。

### 2.3 当前 `schedule_tick` 不能被批量误迁

2026-05-24 本地 DB 审计结果：

1. `lol.skills` 共 44 条。
2. 含 `schedule_tick` 的技能共 7 条：
   - `skill_ahri_q`
   - `skill_brand_w`
   - `skill_drmundo_r`
   - `skill_katarina_r`
   - `skill_leona_r`
   - `skill_leona_w`
   - `skill_malzahar_e`
3. 这些技能语义并不一致，不能用“一键迁移 `schedule_tick`”处理。

### 2.4 迁移白名单与禁止误迁清单

| 模式 | 当前样例 | 本批处理 | 原因 |
| --- | --- | --- | --- |
| 持续伤害 DoT，`on_spell_cast -> apply status -> 周期伤害` | `skill_malzahar_e` | 必须迁移到 `status_*` | 这是标准状态生命周期，不应继续用 `schedule_tick` 假装 |
| 延时落点的一次伤害 | `skill_brand_w`、`skill_leona_r`、`skill_leona_w` | 必须保留在 `mechanics_config` | 它们是施法后延迟命中，不是附着状态 |
| 多段或回程命中编排 | `skill_ahri_q`、`skill_katarina_r` | 必须保留在 `mechanics_config` | 它们表达命中时序，不是状态实体 |
| 周期治疗 HoT | `skill_drmundo_r` | 契约补齐，数据迁移延后 | 本批聚焦 1v1 伤害测试，但不能把治疗暴击契约留成后补 |
| inline `apply_status` 控制态 | `skill_lux_q` | 本批不迁 | 控制态不在当前验收范围 |
| `grant_shield` / shield status | `skill_lux_w` | 本批不迁 | 护盾不在当前验收范围 |

白名单结论：

1. 当前 live data 唯一 ready 的真实迁移候选是 `skill_malzahar_e`。
2. 代码必须支持后续继续追加白名单，但第一轮不允许实现成“扫库后自动迁所有 `schedule_tick`”。
3. 迁移工具只能是显式白名单驱动，不允许做无人工审核的泛化翻译器。

### 2.5 暴击口径硬决策

本批直接固定以下规则：

1. 普攻暴击倍率按数据录入，LoL 默认录 `2.0`。
2. 技能暴击和治疗暴击也按数据录入，海克斯/竞技场配置可以录 `1.45`。
3. 不引入 mode-aware runtime 分支；如果两个模式规则不同，就发布两套独立数据。
4. 暴击定义不放 `types`。
5. 对于状态型 HP 变化，暴击定义不放在 `status_definitions.extend`，而是放在真正承载 HP 变化的 `status_periodic_hp_effects` typed 字段上。
6. `status_definitions` 只保留状态生命周期语义，不承担“这条 tick 到底能不能暴击、倍率是多少”的叶子效果定义。

## 3. 目标契约

### 3.1 数据所有权边界

迁移后的数据归属必须固定为：

1. `skills.mechanics_config`
   - 保留 `on_spell_cast` / `on_hit` / `on_tick` 等触发入口。
   - 保留 `deal_damage`、`heal`、`schedule_tick`、`apply_status` 等动作编排。
   - 保留不属于状态资源的时序逻辑，例如延时命中、多段命中、回程命中。
   - 保留本批未拆表的直伤/直疗动作。
2. `status_definitions`
   - 保留状态 ID、本体名称、持续时间、叠层、快照和 source scope。
3. `status_modifier_groups`
   - 保留 `on_interval` 组的 interval 语义和 group 级 snapshot policy。
4. `status_attribute_modifiers`
   - 保留状态期间对攻击力、攻速、法强、抗性、穿透等属性的修饰。
5. `status_periodic_hp_effects`
   - 保留周期伤害/治疗本身，包括能否暴击和暴击倍率。

### 3.2 状态型周期 HP 效果的 typed crit 契约

`status_periodic_hp_effects` 在现有字段基础上必须补齐：

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `canCrit` | `boolean` | 是 | 该周期 HP 效果是否允许暴击 |
| `critChanceSource` | `"none" \| "attacker_crit_chance" \| "fixed"` | 是 | 暴击概率来源 |
| `critChance` | `number?` | 条件必填 | `critChanceSource="fixed"` 时必填，范围 `[0,1]` |
| `critMultiplier` | `number?` | 条件必填 | `canCrit=true` 时必填，且 `> 0` |

发布校验规则：

1. `canCrit=false` 时，`critChanceSource` 必须为 `none`，`critChance`、`critMultiplier` 必须为空。
2. `canCrit=true` 时，`critMultiplier` 必须存在且大于 0。
3. `critChanceSource="fixed"` 时，`critChance` 必须存在。
4. `critChanceSource="attacker_crit_chance"` 时，`critChance` 必须为空。
5. `effectKind="damage"` 与 `effectKind="heal"` 都允许 `canCrit=true`。

本批不新增 mode-aware 默认值。示例：

1. LoL DoT 一般录 `canCrit=false`。
2. 海克斯技能 DoT 如果允许技能暴击，则录 `canCrit=true`、`critChanceSource="attacker_crit_chance"`、`critMultiplier=1.45`。
3. 海克斯 HoT 如果允许治疗暴击，则录 `canCrit=true`、`critChanceSource="attacker_crit_chance"`、`critMultiplier=1.45`。

### 3.3 直伤/直疗动作的最小 crit 契约

本批不新建 `skill_action_effects` 表。直伤和直疗继续留在 `mechanics_config`，但其可暴击能力必须统一成稳定 shape，供 web/wasm 直接消费：

```json
{
  "type": "deal_damage",
  "damage": {
    "source": "self",
    "target": "enemy",
    "damageType": "physical",
    "formulaText": "base_damage + bonus_ad"
  },
  "crit": {
    "policy": "expected",
    "chanceSource": "attacker_crit_chance",
    "multiplier": 2.0
  }
}
```

治疗动作同理：

```json
{
  "type": "heal",
  "heal": {
    "source": "self",
    "target": "self",
    "formulaText": "base_heal + ap_heal"
  },
  "crit": {
    "policy": "expected",
    "chanceSource": "attacker_crit_chance",
    "multiplier": 1.45
  }
}
```

解释：

1. 这里仍然是 `mechanics_config` 内的 typed 子对象，不是继续把语义塞进 `extend`。
2. 本批 `single_attacker_dps` 只接受 `policy="expected"`；随机暴击不是本轮验收目标。
3. `chanceSource="attacker_crit_chance"` 表示运行时在效果结算时读取攻击方当前 `crit_chance` 属性。

### 3.4 `schedule_tick` 迁移前后对照

真正需要迁移的状态型 DoT，以 `skill_malzahar_e` 为标准样例。

迁移前：

```json
{
  "triggers": [
    {
      "id": "cast_schedule_dot",
      "event": { "type": "on_spell_cast" },
      "actions": [
        { "type": "schedule_tick", "times": 4, "everyMs": 1000, "tickKey": "malzahar_e_dot" }
      ]
    },
    {
      "id": "dot_tick_damage",
      "event": { "type": "on_tick", "tickKey": "malzahar_e_dot" },
      "actions": [
        {
          "type": "deal_damage",
          "damage": {
            "source": "self",
            "target": "enemy",
            "damageType": "magic",
            "formulaText": "tick_damage + ap_tick_damage"
          }
        }
      ]
    }
  ]
}
```

迁移后：

```json
{
  "triggers": [
    {
      "id": "cast_apply_dot",
      "event": { "type": "on_spell_cast" },
      "actions": [
        {
          "type": "apply_status",
          "status": {
            "statusId": "status_malzahar_e_dot",
            "kind": "dot",
            "source": "self",
            "target": "enemy"
          }
        }
      ]
    }
  ]
}
```

对应资源必须落库为：

1. `status_definitions.statusId = status_malzahar_e_dot`
2. `status_modifier_groups.statusId = status_malzahar_e_dot`, `groupKey = tick_main`, `phaseKey = on_interval`, `intervalMs = 1000`, `maxTicks = 4`
3. `status_periodic_hp_effects.statusId = status_malzahar_e_dot`, `groupKey = tick_main`, `effectKind = damage`

### 3.5 兼容策略

本批必须增量兼容，不能要求“所有旧技能先手工全迁完”才能运行。

编译优先级固定为：

1. 如果 `apply_status.statusId` 命中了 published bundle 中真实存在的 `statusDefinitions`，则按 published status resource 编译。
2. 如果 `apply_status` 没命中 published status resource，但动作里带着 legacy inline `status` 信息，则继续走旧的 synthetic status fallback。
3. 如果 `schedule_tick` 只是在表达延时命中或多段命中，则继续按旧逻辑保留，不强制 status 化。
4. 只有白名单迁移完成的 DoT/HoT 才从 `schedule_tick` 改成 `apply_status + published status`.

## 4. Backend 章节

### 4.1 Cursor 角色与写入范围

本章节交给一个独立 Cursor Composer 2.5 会话执行。

模型硬约束：

1. `composer-2.5`
2. `fast=false`

允许写入：

1. `C:\project\damage_backend_dev\db\game_manage\status_resource_schema.sql`
2. `C:\project\damage_backend_dev\db\game_manage\triggers.sql`
3. `C:\project\damage_backend_dev\db\game_manage\status_periodic_hp_effects_crit_compatibility.sql`
4. `C:\project\damage_backend_dev\server\data_manage\src\main\java\xyz\game\datamanage\controller\adminapi\Status*.java`
5. `C:\project\damage_backend_dev\server\data_manage\src\main\java\xyz\game\datamanage\service\PostgresReadStore.java`
6. `C:\project\damage_backend_dev\server\data_manage\src\main\java\xyz\game\datamanage\service\PostgresWriteStore.java`
7. `C:\project\damage_backend_dev\server\data_manage\src\main\resources\mapper\status_*`
8. `C:\project\damage_backend_dev\server\data_manage\src\test\java\xyz\game\datamanage\integration\ControllerPublishFlowIT.java`
9. `C:\project\damage_backend_dev\server\data_manage\src\test\java\xyz\game\datamanage\tools\KatarinaMvpImportMain.java`
10. `C:\project\damage_backend_dev\server\data_manage\src\test\java\xyz\game\datamanage\tools\KatarinaMvpImportMainTest.java`
11. `C:\project\damage_backend_dev\最小验证\V2-Batch-J-status-damage-audit.json`
12. `C:\project\damage_backend_dev\最小验证\V2-Batch-J-status-damage-migration.seed.json`
13. `C:\project\damage_backend_dev\最小验证\数据\build-v2-batch-j-status-damage-audit.mjs`

只读参考：

1. `C:\project\damage_backend_dev\server\data_manage\AGENTS.md`
2. `C:\project\damage_backend_dev\server\data_manage\README.md`
3. `C:\project\damage_wasm_dev\db\game_manage\status_resource_schema.sql`
4. `C:\project\damage_wasm_dev\文档记录\详细设计\server\game_manage\接口定义.md`
5. `C:\project\damage_wasm_dev\文档记录\详细设计\最小验证\V2-BatchJ-状态资源迁移与1v1伤害闭环计划.md`

禁止事项：

1. 不要修改 `web/**` 或 `wasm/**`。
2. 不要把控制态、护盾态一起塞进本批迁移。
3. 不要实现“扫描所有 `schedule_tick` 自动迁移”的通用脚本。
4. 不要把新字段写回 `extend`。

### 4.2 必须完成的后端改动

1. 在 `status_periodic_hp_effects` / `_log` DDL 中新增：
   - `crit_chance_source`
   - `crit_chance`
   - `crit_multiplier`
2. 为 live DB 准备显式兼容 SQL：
   - `status_periodic_hp_effects_crit_compatibility.sql`
   - 要求 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...`
3. 更新 status periodic HP effect 的：
   - Admin 读接口
   - Admin 写接口
   - publish bundle 输出
   - publish semantic validation
   - log 表写入
4. `接口定义.md` 的 DTO 口径在代码中对齐：
   - `StatusPeriodicHpEffectDTO.critChanceSource?: "none" | "attacker_crit_chance" | "fixed"`
   - `StatusPeriodicHpEffectDTO.critChance?: number`
   - `StatusPeriodicHpEffectDTO.critMultiplier?: number`
5. `KatarinaMvpImportMain` 的 seed schema 必须支持写入上述 3 个字段。
6. 新增白名单审计脚本：
   - 读取 `lol.skills.mechanics_config`
   - 输出候选清单
   - 明确标记 `migrate_to_status_resource` / `keep_mechanics_config` / `out_of_scope`
7. 第一版 seed 只允许迁移 `skill_malzahar_e`，且必须显式保留：
   - `skill_brand_w`
   - `skill_ahri_q`
   - `skill_katarina_r`
   - `skill_leona_r`
   - `skill_leona_w`
   - `skill_drmundo_r`
8. `skill_malzahar_e` 的 seed 必须同时完成：
   - skills 表中 `mechanics_config` 从 `schedule_tick` 改为 `apply_status`
   - `statusDefinitions`
   - `statusModifierGroups`
   - `statusPeriodicHpEffects`
   - 如需要公式绑定，补齐 `formulaProfiles/formulaBindings`

### 4.3 后端数据迁移规则

迁移规则必须写死成白名单，不允许泛化推断：

1. 只有同时满足以下条件的 skill 才能被标记为 `migrate_to_status_resource`：
   - `on_spell_cast` 内只是在附着一个持续效果
   - 后续 tick 对同一目标重复执行
   - 该效果具备独立持续时间/次数/interval 语义
2. 满足以下任一条件必须标记为 `keep_mechanics_config`：
   - 首次延迟命中
   - 多段命中编排
   - 回程命中
   - 施法后单次爆炸
3. 满足以下任一条件必须标记为 `out_of_scope`：
   - 控制态
   - 护盾态
   - 需要完整 sustain/HoT 验收但当前验证链路尚未覆盖

`V2-Batch-J-status-damage-audit.json` 最低结构：

```json
{
  "meta": {
    "generatedAt": "2026-05-24T00:00:00Z",
    "gameId": "lol"
  },
  "records": [
    {
      "skillId": "skill_malzahar_e",
      "classification": "migrate_to_status_resource",
      "reason": "true dot with persistent interval semantics",
      "targetStatusId": "status_malzahar_e_dot"
    }
  ]
}
```

### 4.4 后端测试

至少补以下测试：

1. `ControllerPublishFlowIT`
   - `statusPeriodicHpEffects` 新字段能通过 Admin 写入和 publish。
   - `skill_malzahar_e` 发布后 bundle 中存在 `status_malzahar_e_dot`。
   - 发布后的 `skill_malzahar_e.mechanicsConfig` 不再包含 legacy `schedule_tick` DoT。
   - `skill_brand_w` 等保留 legacy path 的技能不会被错误改写。
2. `KatarinaMvpImportMainTest`
   - seed 新字段可解析。
   - 白名单 seed 只改指定 skill。
3. `PostgresWriteStore` 相关单测
   - `canCrit=false` 时拒绝携带 `critMultiplier`。
   - `critChanceSource=fixed` 时缺少 `critChance` 会 blocked。
   - `critChanceSource=attacker_crit_chance` 时不允许再传固定 `critChance`。

### 4.5 后端验证命令

```powershell
cd C:\project\damage_backend_dev\server\data_manage
mvn test

mvn -q -DskipTests test-compile org.codehaus.mojo:exec-maven-plugin:3.5.0:java "-Dexec.classpathScope=test" "-Dexec.mainClass=xyz.game.datamanage.tools.KatarinaMvpImportMain" "-Dexec.args=--dryRun --seedFile=C:\project\damage_backend_dev\最小验证\V2-Batch-J-status-damage-migration.seed.json --versionCode=v2_batch_j_status_damage_001"
```

如果 dry-run 通过，再执行真实导入和 publish。

### 4.6 后端停止条件

遇到以下问题必须停止并回报 GPT/Codex，不得自行扩 scope：

1. `skill_malzahar_e` 以外还出现看起来像 DoT 的技能，但语义不明确。
2. 当前 live DB 缺少 status 相关 parent table 或分区。
3. 发现要支持治疗/HoT 发布才能让现有测试页继续工作。
4. 发现必须新增 `skill_action_effects` 一类新表才能继续。

### 4.7 后端回报格式

必须返回：

1. 改动文件列表
2. 新增/变更的字段和校验规则
3. `V2-Batch-J-status-damage-audit.json` 结论摘要
4. `V2-Batch-J-status-damage-migration.seed.json` 包含哪些 skill/status
5. `mvn test` 结果
6. dry-run/import/publish 是否通过
7. 未覆盖风险

## 5. Web 章节

### 5.1 Cursor 角色与写入范围

本章节交给一个独立 Cursor Composer 2.5 会话执行。

允许写入：

1. `C:\project\damage_web_dev\web\src\types\api.ts`
2. `C:\project\damage_web_dev\web\src\services\apiClient.ts`
3. `C:\project\damage_web_dev\web\src\pages\admin\resources\status-management\index.tsx`
4. `C:\project\damage_web_dev\web\src\engine\tinygoV2BundleAdapter.ts`
5. `C:\project\damage_web_dev\web\src\engine\tinygoV2DpsAdapter.ts`
6. `C:\project\damage_web_dev\web\src\pages\WasmValidationM3Page.tsx`
7. `C:\project\damage_web_dev\web\src\pages\WasmValidationV2DpsPage.tsx`
8. `C:\project\damage_web_dev\web\src\App.tsx`
9. `C:\project\damage_web_dev\web\src\config\navigation.ts`

只读参考：

1. `C:\project\damage_web_dev\web\AGENTS.md`
2. `C:\project\damage_web_dev\web\README.md`
3. `C:\project\damage_web_dev\web\src/pages/admin/AGENTS.md`
4. `C:\project\damage_wasm_dev\文档记录\详细设计\最小验证\V2-BatchJ-状态资源迁移与1v1伤害闭环计划.md`
5. `C:\project\damage_web_dev\web\src\engine\tinygoV2BundleAdapter.ts`
6. `C:\project\damage_web_dev\web\src\pages\admin\resources\status-management\index.tsx`

禁止事项：

1. 不要在页面层手算期望伤害、期望暴击或 DoT。
2. 不要删除 legacy synthetic status fallback，除非 backend 白名单数据已经全迁完。
3. 不要把所有 `schedule_tick` 视为 status。
4. 不要修改 backend 或 wasm 代码。

### 5.2 必须完成的前端改动

1. `api.ts` / `apiClient.ts`
   - 为 `StatusPeriodicHpEffect` 增加：
     - `critChanceSource`
     - `critChance`
     - `critMultiplier`
2. `status-management/index.tsx`
   - 在“周期生命效果”表单中把上述 3 个字段做成 typed UI。
   - `extend` 继续保留，但不得要求用户再把暴击配置写进 JSON。
   - `effectKind=damage` 与 `effectKind=heal` 都允许展示 `canCrit` 和 `critMultiplier`。
3. `tinygoV2BundleAdapter.ts`
   - 新增 published status resource 编译链：
     - 从 `statusDefinitions`
     - `statusModifierGroups`
     - `statusAttributeModifiers`
     - `statusPeriodicHpEffects`
     - 生成真正的 `statuses[]`
   - 编译优先级按本文 `3.5` 执行。
   - legacy inline `apply_status` / `schedule_tick` / `grant_shield` fallback 保留。
4. 为 status tick 编译补齐 crit 字段：
   - `tickCritPolicy`
   - `tickCritChanceSource`
   - `tickCritChance`
   - `tickCritMultiplier`
5. 为直伤/直疗动作编译补齐新的 crit source shape：
   - 从 `crit.policy`
   - `crit.chanceSource`
   - `crit.chance`
   - `crit.multiplier`
6. `WasmValidationM3Page.tsx`
   - 导出 JSON 中必须能看到：
     - `statusId`
     - `statusSource`
     - `tickFormulaId`
     - `tickCritMultiplier`
   - 页面上至少要显示“本次技能编译得到的 published statuses / synthetic statuses”列表。
7. `WasmValidationV2DpsPage.tsx`
   - 保持当前普攻暴击期望能力不回退。
   - 导出 JSON 中必须保留普攻 action 和 crit 配置证据。
   - 如果某条 curve 命中了 published status 资源，也要能在导出中体现来源。

### 5.3 前端编译规则

必须固定以下编译规则：

1. published status 编译入口只认 `apply_status.statusId`。
2. `statusDefinitions` 本身不直接生成 tick；必须串上 `statusModifierGroups.phaseKey="on_interval"` 和 `statusPeriodicHpEffects`。
3. `statusAttributeModifiers` 必须编译进 `StatusTemplateV2.attrModifiers`。
4. `statusModifierGroups.snapshotPolicy`
   - `on_apply`
   - `dynamic`
   - `per_tick`
   要原样透传到 wasm 所需结构，不要在前端先算死。
5. 只要 status 是从 published resource 编出来的，就在导出证据里打上：
   - `statusSource: "published_status_resource"`
6. 只要 status 是 legacy fallback 合成的，就打：
   - `statusSource: "synthetic_from_mechanics_config"`

### 5.4 前端页面验证范围

本批页面验收至少覆盖两个入口：

1. `#/wasm-validation-m3`
   - 用于验证 `skill_malzahar_e` 这类主动技能 DoT。
2. `#/wasm-validation-v2-dps`
   - 用于验证普攻 crit expected 不回退。

`M3` 页必须能证明：

1. `skill_malzahar_e` 的 DoT 来源是 published status resource，不是 synthetic fallback。
2. 导出 JSON 中看得到 `status_malzahar_e_dot`。
3. tick 间隔、tick 次数和公式来源来自 published bundle。

`V2 DPS` 页必须能证明：

1. `hero_ezreal` 普攻期望暴击仍然可计算。
2. 如果普攻 skill 自带 crit 配置，导出中能看到 `multiplier=2.0`。

### 5.5 前端验证命令

```powershell
cd C:\project\damage_web_dev\web
npm run build
```

### 5.6 前端停止条件

遇到以下情况必须停止：

1. published status 编译需要 wasm 先扩字段，否则 TS 端无法落地。
2. `M3` 页面当前证据结构不足以区分 published / synthetic 来源。
3. 为了支持 `skill_malzahar_e` 必须改出一个全新的验证页。

### 5.7 前端回报格式

必须返回：

1. 改动文件列表
2. 新增 API/DTO 字段
3. published status 与 synthetic status 的编译优先级说明
4. `M3` / `V2 DPS` 导出新增了哪些证据字段
5. `npm run build` 结果
6. 需要 GPT/Codex 做的页面 smoke 点

## 6. Wasm 章节

### 6.1 Cursor 角色与写入范围

本章节交给一个独立 Cursor Composer 2.5 会话执行。

允许写入：

1. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\model\types.go`
2. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\compile\compile.go`
3. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\runtime.go`
4. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\runtime_test.go`
5. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver.go`
6. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver_test.go`
7. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\dist\tinygo_engine_v2.wasm`

只读参考：

1. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\AGENTS.md`
2. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\README.md`
3. `C:\project\damage_wasm_dev\文档记录\详细设计\最小验证\V2-BatchJ-状态资源迁移与1v1伤害闭环计划.md`
4. `C:\project\damage_web_dev\web\src\engine\tinygoV2BundleAdapter.ts`

禁止事项：

1. 不要实现 mode-aware crit 分支。
2. 不要把暴击倍率硬编码成 LoL 或海克斯常量默认值。
3. 不要破坏现有 direct damage / heal / shield / legacy synthetic status 行为。
4. 不要要求 backend 先全量迁完状态资源才能运行。

### 6.2 必须完成的 wasm 契约改动

1. `StatusTemplateV2` 增加：
   - `TickCritPolicy string`
   - `TickCritChanceSource string`
   - `TickCritChance float64`
   - `TickCritMultiplier float64`
2. `EffectDefinitionV2` 增加：
   - `CritChanceSource string`
   - 保留现有 `CritPolicy`、`CritChance`、`CritMultiplier`
3. `CompiledStatus` / `CompiledEffect` 同步补齐上述字段。
4. `runtime.go` 抽出共享 crit 解析逻辑，让 direct effect 和 status tick 走同一套代码。

### 6.3 必须完成的运行时语义

1. direct effect crit
   - `CritChanceSource=""` 或 `none` 时沿用现有行为
   - `CritChanceSource="fixed"` 时使用 `CritChance`
   - `CritChanceSource="attacker_crit_chance"` 时读取当前 source actor 的 `crit_chance`
2. status tick crit
   - `TickCritPolicy=""` 时不暴击
   - `TickCritChanceSource="fixed"` 时使用固定概率
   - `TickCritChanceSource="attacker_crit_chance"` 时按 group/status snapshot policy 读取 `crit_chance`
3. `single_attacker_dps`
   - 继续只接受 `simulationRules.critPolicy=expected`
   - 但 direct effect 和 status tick 都必须能在 `expected` 下输出正确的期望倍率结果
4. direct damage 与 status tick 都必须把 crit evidence 写进 effect breakdown：
   - `CritPolicy`
   - `CritMultiplier`
   - `HasCritMultiplier`
   - 如适用，`CritResult`/`CritRoll`

### 6.4 快照语义

status tick 的 crit chance 读取必须遵守状态快照口径：

1. `statusModifierGroups.snapshotPolicy = on_apply`
   - `attacker_crit_chance` 在状态施加时冻结
2. `snapshotPolicy = dynamic`
   - 每次 tick 读取当前状态
3. `snapshotPolicy = per_tick`
   - 每次 tick 单独重新求值

如果当前 runtime 无法完整区分 `dynamic` 与 `per_tick`，允许在本批统一为“tick 时重新读取”，但必须在测试和回报中明确写出简化点，不得静默处理。

### 6.5 wasm 测试

至少补以下测试：

1. `TestStatusTickDamageUsesPublishedCritMultiplier`
   - 构造 status tick damage
   - `TickCritChanceSource="attacker_crit_chance"`
   - `TickCritMultiplier=1.45`
   - 在 `expected` 下验证期望值
2. `TestStatusTickHealUsesPublishedCritMultiplier`
   - 构造 status tick heal
   - 验证 heal 侧同样走 crit path
3. `TestDirectEffectCritReadsAttackerCritChance`
   - direct damage 不再只支持固定 `CritChance`
4. `TestLegacyStatusWithoutCritFieldsKeepsBehavior`
5. `TestSingleAttackerDPSSupportsPublishedDotStatus`
   - `skill_malzahar_e` 样式的 status 能在 DPS/M3 所需运行链路内生效
6. `TestSingleAttackerDPSExpectedCritStillWorksForBasicAttack`
   - 普攻 2.0 口径不回退

### 6.6 wasm 验证命令

```powershell
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go test ./internal/runtime -run "Crit|SingleAttackerDPS" -count=1
go test ./...
go run ./cmd/bench
powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1
node .\scripts\smoke-node.mjs
```

### 6.7 wasm 停止条件

遇到以下情况必须停止：

1. direct effect crit 与 status tick crit 需要两套完全不同的 runtime path。
2. 为了读 `attacker_crit_chance` 必须先引入 mode-aware 逻辑。
3. 发现现有 `M3` / `DPS` 输入协议无法承载新增字段，且必须改动大量页面协议。

### 6.8 wasm 回报格式

必须返回：

1. 改动文件列表
2. 新增字段和运行时语义
3. 哪些地方复用了共享 crit 逻辑
4. 新增测试及其通过情况
5. `go test ./...`、`go run ./cmd/bench`、TinyGo build、Node smoke 结果
6. 是否存在快照语义简化点

## 7. 执行顺序

严格按以下顺序执行，不允许 Cursor 自己调整：

1. Backend：补 schema / DTO / publish validation / seed audit / seed migration。
2. Backend：dry-run、import、publish，确认 current bundle 有真实 `status_malzahar_e_dot`。
3. Web：接 status periodic HP effect 新字段，编译 published status resource，并保留 legacy fallback。
4. Wasm：扩 direct effect crit + status tick crit。
5. Web：同步 wasm 产物后，补 `M3` / `V2 DPS` 导出证据。
6. GPT/Codex：集中启动 backend + web，跑页面 smoke、bundle 校验和最终验收。

任何一步失败，只修当前步，不允许跨步补救。例如：

1. backend publish 还没有 `status_malzahar_e_dot` 时，web 不得临时从 draft API 拼状态。
2. wasm 还没支持 tick crit 字段时，web 不得在导出层自己补算倍率。

## 8. Codex 集中验收

最终验收只由 GPT/Codex 执行，不接受 Cursor 自述完成。

### 8.1 后端验收

至少验证：

1. `GET /api/admin/games/lol/status-definitions` 中存在 `status_malzahar_e_dot`
2. `GET /api/admin/games/lol/status-periodic-hp-effects` 中存在对应 `critChanceSource` / `critMultiplier` 字段
3. current published bundle 中：
   - `statusDefinitions`
   - `statusModifierGroups`
   - `statusPeriodicHpEffects`
   都能查到 `status_malzahar_e_dot`
4. current bundle 的 `skill_malzahar_e.mechanicsConfig` 已改为 `apply_status`
5. `skill_brand_w`、`skill_ahri_q` 等仍保留 legacy 编排，不被错误 status 化

### 8.2 页面验收

至少覆盖：

1. `#/wasm-validation-m3`
   - 选择 `skill_malzahar_e`
   - 运行 1v1 dummy 伤害
   - 导出 JSON
   - 确认 `statusSource = published_status_resource`
2. `#/wasm-validation-v2-dps`
   - 选择 `hero_ezreal`
   - 运行普攻 DPS
   - 导出 JSON
   - 确认普攻 crit expected 仍成立，且倍率来源为真实 effect crit 配置而非页面补算

### 8.3 验收通过标准

本批只有同时满足以下条件，才能标记完成：

1. backend schema / publish / seed 全通过
2. web build 通过
3. wasm tests / bench / TinyGo build / Node smoke 全通过
4. `skill_malzahar_e` 真正从 `schedule_tick` 迁到 published status resource
5. `skill_brand_w` 等禁止误迁对象未被错误改写
6. `M3` 页面能展示 published status 证据
7. `V2 DPS` 页面普攻暴击期望不回退
8. GPT/Codex review 无阻塞 findings

如果只完成了 build 和单测，但没有完成页面验证或 current bundle 校验，只能报告“开发自测通过，集中验收未完成”，不得宣称 Batch J 完成。
