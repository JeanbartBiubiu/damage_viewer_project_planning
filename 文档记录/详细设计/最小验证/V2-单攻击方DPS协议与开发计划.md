TASK_KEY: planning-validation-milestones
DOC_TYPE: 详细设计
WORKSTREAM: planning
STATUS: draft
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: 2026-05-16

# V2 单攻击方 DPS 协议与开发计划

本文承接 `文档记录/概要设计/验证里程碑V2.md`，只记录可执行的协议、模块边界和分批开发计划。概要文档继续负责 gate 和路线定义；本文件用于后续 goal/agent 按批实现。

## 1. 目标边界

V2 首期只做单攻击方站桩平A DPS 展示，不做完整 1v1、不做敌方动作、不做主动技能轮转、不做自由战斗编辑器。目标 actor 不行动；唯一主动动作是攻击方持续普攻。

技能被动效果包含英雄 P 被动，也包含 Q/W/E/R 描述中的被动、常驻、普攻触发、每 N 次攻击触发、on-hit、计数器和简单 DoT。需要主动释放后才生效的 buff、toggle 或模式切换，首期只通过 `scenarioStates` 作为显式假定状态参与对比，不算自然触发证据。

硬边界：

1. 只允许 self 攻击方和 fixed dummy 标靶；enemy/target 不产生任何主动事件。
2. 主循环只允许自动平A cadence，不支持主动技能轮转，不支持通用 rotation DSL。
3. 被动和装备联动只允许由普攻命中、on-hit/on-attack、持续效果 tick、已定义 trigger 或显式 `scenarioStates` 触发。
4. 不做自由战斗编辑器，不做本地隐藏 debug skill/action/effect。
5. published bundle 缺少所需英雄、标靶、技能被动、装备效果或公式时，对应 curve 必须输出 `blocked`，不能由前端或 wasm 私造替代数据。

## 2. 模块边界

### 2.1 Backend / DB

后端负责可发布数据的录入与发布链，首批至少包括：

1. `target_dummy` type。
2. 3 个标靶 actor：
   - `target_dummy_squishy`：HP 2000 / armor 50 / magic_resist 50
   - `target_dummy_fighter`：HP 3000 / armor 100 / magic_resist 80
   - `target_dummy_tank`：HP 5000 / armor 200 / magic_resist 150
3. 标靶只需要 HP、护甲、魔抗；其他属性默认 0 或在 DPS 计算中忽略。
4. ADC 装备池通过 Data Dragon tags + 人工排除初始整理，后续落入项目 type 表，不只停留在文档约束。
5. 装备属性要求首期全覆盖；装备被动按机制逐步闭环，未参与 DPS 的效果必须有显式状态。

标靶和装备数据不依赖用户手工管理页录入作为验收前提。实现方可以使用脚本、后端接口 upsert 或种子数据，但必须保留可重复执行和可审计的录入方式。

Backend 不持久化 `curveResults`，也不把 DPS 运行结果反写进 published bundle。ADC 装备池和标靶类型优先复用现有 type/type relation 体系；如果后续需要保存页面 preset，应作为独立 preset 资源设计，不污染引擎 bundle。

### 2.2 Frontend

前端负责：

1. 从 published bundle 解析用户选择，生成 wasm 所需的完整数值快照。
2. 不做 DPS 业务结算，不自行计算攻击排程、伤害、被动或装备触发。
3. 持有 `simulationRules`、`scenarioStates`、曲线配置和展示侧 curve 元数据，并把它们投影成 wasm batch run 输入。
4. actor2/目标选择栏按 type 分组排序，`target_dummy` 分组排最上面。
5. 展示 V2 DPS 页面、ECharts 曲线、汇总指标、触发明细和导出 JSON。
6. 导出 JSON 同时保留 `selection` 和 `resolvedSnapshot`，使人工可复核“用户选了什么”和“wasm 实际算了什么”。

首期页面拆成两类：

1. 单英雄多曲线页面：全局英雄、目标、时间窗和规则；每条 curve 独立配置英雄等级、技能等级、装备、启用被动、场景预设和符文/属性调整。
2. 多英雄同装备页面：全局目标、时间窗、规则、装备和符文/属性调整；每行英雄独立配置英雄、英雄等级、技能等级和启用被动。

Batch A 先新建 V2 DPS 验证页骨架，不塞进现有 M3/M4 验证页。首版页面只需支持选择攻击方、选择标靶、时间窗、运行和导出 JSON；完整多曲线编辑和图表在 Batch E 收口。

### 2.3 Wasm

wasm 负责 DPS 核心：

1. 新增 `single_attacker_dps` driver。
2. 一次接收多条 curve run spec，一次返回多条 `curveResults`；wasm 只把 `curveId` 作为透传关联键，不理解图表名称、排序、推荐出装池等展示语义。
3. 复用现有 runtime 的伤害、抗性、触发和效果结算能力，不另起伤害逻辑。
4. 按事件驱动生成普攻、DoT、状态到期、击杀截断和汇总事件。
5. 每次普攻命中后重新读取当前攻速，计算下一次攻击间隔。羊刀、克格莫 Q、致命节奏等改变攻速的效果只影响未来攻击。
6. 技能被动、装备被动、触发型符文和场景预设状态统一走 effect/trigger 数据结构，不写英雄或装备专属分支。

### 2.4 对象归属与投影

| 对象 | 归属 | 是否进 published bundle | 是否进 wasm input | 说明 |
| --- | --- | --- | --- | --- |
| `simulationRules` | Web/run input | 否 | 是 | 本次怎么跑：duration、seed、攻速 cap、DoT tick、暴击策略、自动平A计划。 |
| `scenarioStates` | Web/run input | 否 | 是 | 用户显式假定的开局状态、层数、预开启状态；参与计算但不算自然触发证据。 |
| `curves` | Web 配置，wasm batch envelope | 否 | 是 | 多条 run spec 的批量封装；wasm 只透传 `curveId`，不持有图表语义。 |
| `curveResults` | wasm output + Web 派生展示 | 否 | 否 | 从 wasm 执行结果和稳定 evidence 字段生成；不反写 bundle。 |
| `selection` | Web | 否 | 可选保留 | 用户选择项，用于证据导出和人工复核。 |
| `resolvedSnapshot` | Web 投影结果 | 否 | 是 | 从 published bundle 投影出的攻击方、标靶、装备、效果和属性快照。 |

投影链路：

1. Backend 发布 `EngineBundleV2` 所需静态数据，包括英雄、装备、标靶 actor、type、公式、status/effect/trigger。
2. Web 从 published bundle 读取用户选择，生成 `resolvedSnapshot` 和每条 curve run spec。
3. Web 把 `simulationRules`、`targetSnapshot`、curve run specs 传给 wasm。
4. wasm 使用现有 runtime/effect/trigger/status 能力执行单攻击方 DPS driver。
5. wasm 输出每条 curve 的执行证据；Web 只做展示聚合和导出，不补算业务结算。

## 3. Wasm 输入协议

顶层输入建议：

```json
{
  "mode": "single_attacker_dps",
  "caseId": "V2-BatchA-basic-aa-001",
  "versionCode": "lol-v16.10",
  "wasmSha256": "",
  "simulationRules": {},
  "targetSnapshot": {},
  "curves": []
}
```

### 3.1 simulationRules

`simulationRules` 是本次计算口径，不属于英雄、装备或目标数据。

```json
{
  "durationMs": 10000,
  "warmupMs": 0,
  "sampleBy": "none",
  "attackSpeedCap": 3.0,
  "firstAttackAtMs": 0,
  "eventWindowPolicy": "timeMs < durationMs",
  "dotTickIntervalMs": 1000,
  "critPolicy": "expected",
  "seed": 0,
  "autoAttackPlan": {
    "enabled": true,
    "actionId": "basic_attack",
    "startAtMs": 0,
    "targetRole": "target"
  },
  "maxEvents": 10000
}
```

规则：

1. `durationMs` 是 DPS 分母和正式时间截止，不允许用 `maxEvents` 替代时间窗。
2. `warmupMs` 首版固定为 0，不排除起手阶段。
3. `sampleBy` 首版固定为 `none`；曲线优先来自多条完整 run 的对比，不引入 run 内固定采样点。
4. 攻速上限首版固定 3.0，但由 input 传给 wasm，并进入导出 JSON。
5. 首刀在 0ms。
6. 事件计入规则固定为 `timeMs < durationMs`。
7. DoT 首跳在 `appliedAtMs + dotTickIntervalMs`，首版统一 1000ms，不做单技能或单装备 tick override。
8. 暴击首版使用期望值，`seed` 保留但 `critPolicy=expected` 时不用于随机。
9. `autoAttackPlan` 是 V2 唯一允许的自动动作原语，只表达“从固定时间开始持续普攻固定标靶”，不是通用 rotation editor。
10. `maxEvents` 只作为 runaway 防护；触发时输出 `stopReason=event_limit`。

### 3.2 curve

每条 curve 是一个完整对比方案。

```json
{
  "curveId": "vayne-lv11-bork",
  "label": "薇恩 Lv11 破败",
  "selection": {
    "heroId": "Vayne",
    "heroLevel": 11,
    "skillLevels": { "P": 1, "Q": 3, "W": 5, "E": 1, "R": 2 },
    "equipmentIds": ["3153"],
    "enabledPassiveEffectIds": ["vayne_w_silver_bolts"]
  },
  "resolvedSnapshot": {
    "attackerSnapshot": {},
    "equipmentSet": [],
    "equipmentStats": {},
    "enabledPassiveEffects": [],
    "externalPassiveEffects": [],
    "scenarioStates": [],
    "runeStatAdjustments": {}
  }
}
```

前端负责从 published bundle 把 `selection` 投影成 `resolvedSnapshot`。wasm 只消费数值快照和 effect 定义，不直接查询 DB、英雄库或装备库。

curve 缺少必要数据时不得静默降级。Web 在投影阶段能发现的缺项应直接把该 curve 标记为 `blocked`；wasm 在执行阶段发现缺项时也必须返回 blocked 结果和原因。

### 3.3 scenarioStates

`scenarioStates` 表示用户显式假定的状态，例如克格莫 W 预开启、击杀触发 buff、羊刀已有层数、致命节奏已有层数。

```json
{
  "stateId": "kogmaw_w_pre_enabled",
  "sourceType": "skill_passive",
  "sourceId": "KogMawW",
  "activation": "assumed_active_at_start",
  "stacks": 1,
  "startTimeMs": 0,
  "durationMs": 8000
}
```

规则：

1. `scenarioStates` 每条 curve 独立配置。
2. 默认关闭，只有用户显式开启才参与计算。
3. 参与 DPS 计算，但导出 JSON 必须标明 `assumed_active_at_start` 或 `assumed_triggered`。
4. 不计入“wasm 自然触发成功”的证据。

## 4. Wasm 输出协议

顶层输出建议：

```json
{
  "caseId": "V2-BatchA-basic-aa-001",
  "versionCode": "lol-v16.10",
  "wasmSha256": "",
  "simulationRules": {},
  "targetSnapshot": {},
  "curveResults": []
}
```

每条 `curveResults` 至少包含：

```json
{
  "curveId": "vayne-lv11-bork",
  "status": "ok",
  "selection": {},
  "resolvedSnapshot": {},
  "durationMs": 10000,
  "finalTimeMs": 10000,
  "stopReason": "duration_elapsed",
  "processedEvents": 0,
  "queuePeak": 0,
  "attackCount": 0,
  "attackTimeline": [],
  "attackIntervalTimeline": [],
  "damageTimeline": [],
  "targetHpTimeline": [],
  "effectTimeline": [],
  "totalDamage": 0,
  "timeWindowDps": 0,
  "killDps": null,
  "killTimeMs": null,
  "damageByType": {},
  "damageBySource": {},
  "skillPassiveTriggers": [],
  "itemPassiveTriggers": [],
  "externalPassiveTriggers": [],
  "effectBreakdown": [],
  "critPolicy": "expected",
  "seed": 0,
  "blockedReasons": []
}
```

规则：

1. 目标死亡后停止未来普攻、被动、装备触发和 DoT；HP 保持 0 到时间窗结束。
2. `timeWindowDps = totalDamage / durationMs` 对应的秒数。
3. `killDps = totalDamage / killTimeMs` 对应的秒数；只有击杀时输出，否则为 null。
4. `killTimeMs` 未击杀时为 null。
5. 吸血、治疗等不影响目标 DPS 的效果首版可以进入 stats 或 breakdown，但标记为 `recorded_not_applied_to_dps`，不输出攻击方 HP 曲线。
6. `attackIntervalTimeline` 每段至少记录 `timeMs`、`rawAttackSpeed`、`effectiveAttackSpeed`、`overflowAttackSpeed`、`attackIntervalMs` 和来源。
7. 每个 passive/equipment proc 明细至少记录 `procSourceCategory`、`sourceId`、`sourceType`、`triggerId` 和对应 damage/effect 结果。
8. blocked curve 输出 `status=blocked`、`blockedReasons` 和可复核的 `selection`，但不生成伪造伤害曲线。

## 5. 事件规则

### 5.1 时间线模型

V2 使用事件驱动，不做固定帧或固定 tick 主循环。事件来源包括：

1. 普攻命中时间点。
2. DoT tick 时间点。
3. buff/stack 到期时间点。
4. 击杀截断时间点。

### 5.2 同时间点优先级

同一 `timeMs` 下按固定优先级处理，并与现有 scheduler 语义对齐：

1. `status_tick` / `dot_tick` / periodic damage。
2. `expire_effects`。
3. `intent_recheck`。
4. `basic_attack_complete` / `basic_attack_hit`。
5. `on_hit` / 技能被动 / 装备被动 / 外部被动。
6. HP 与击杀汇总。
7. 根据最新攻速排下一次普攻。

边界：

1. DoT tick 恰好落在 `expireAt` 时，tick 先于过期执行。
2. 攻速 buff 恰好在普攻命中同一时刻过期时，按上表先处理过期，再处理普攻命中；因此该 buff 不影响这次命中后的下一次攻击间隔。
3. 普攻命中后才结算 on-hit 和每 N 次命中触发。
4. 击杀后不再排未来普攻、DoT、被动或装备事件。

### 5.3 动态攻速与 cap

1. 每次普攻命中和同刻触发结算完成后，用当时的 `effectiveAttackSpeed` 计算下一次攻击间隔。
2. 首版不模拟中途改写已排程前摇进度；攻速变化只影响未来攻击。
3. `rawAttackSpeed` 是所有属性、装备、被动、符文和场景状态叠加后的原始攻速。
4. `effectiveAttackSpeed = min(rawAttackSpeed, attackSpeedCap)`，用于 cadence。
5. `overflowAttackSpeed = max(0, rawAttackSpeed - attackSpeedCap)`，只在规则或 effect 明确消费时参与后续计算；默认不自动转化为攻击力。

### 5.4 暴击策略

1. 首版默认 `critPolicy=expected`，只用于线性纯伤害期望值。
2. 如果某个效果会因暴击改变状态、叠层、触发链或 on-crit 分支，不能只用期望值混过，必须改用 `seeded_random` 或显式 deterministic fixture。
3. 输出中必须保留 `critPolicy`、`seed`、`expectedCritChance`、`expectedCritMultiplier` 或等价标记。
4. `critPolicy=expected` 时，不把 `critResult=false` 解释为“暴击未参与处理”；页面应显示为期望暴击策略。

### 5.5 数值精度

1. 内部计算使用 `float64`。
2. 时间使用 `int64` 毫秒。
3. 攻击间隔由当前攻速换算后四舍五入到毫秒。
4. wasm 输出保留原始浮点值。
5. 前端展示层格式化，伤害/HP/DPS 可显示 1 到 2 位。
6. 验收 diff 使用容差：伤害/HP 建议 `±0.01`，时间建议 `±1ms`。

## 6. 首批英雄机制

首批 6 个英雄：薇恩、提莫、韦鲁斯、卡莎、图奇、克格莫。

首批机制取舍：

1. 薇恩：W 三环真实伤害进入首批；R 期间 Q 加 AD 暂不进入。
2. 提莫：E 普攻附带命中魔法伤害和后续 DoT 进入首批。
3. 韦鲁斯：W 被动普攻附带魔法伤害进入首批；普攻叠枯萎层可进入，主动引爆不进入。
4. 卡莎：第二层皮肤/电浆普攻叠层与触发伤害进入首批；Q/W/E/R 主动不进入。
5. 图奇：P 毒液叠层和 DoT 进入首批；E 主动引爆不进入，Q/R 主动状态暂不进入。
6. 克格莫：Q 被动攻速进入首批；W 作为 `scenarioStates` 预开启 preset 进入首批；其他主动不进入。

首批 trigger/operation 至少覆盖：

1. `on_basic_attack_hit`
2. `every_n_basic_attack_hit`
3. `stack_on_hit`
4. `damage_over_time`
5. `stat_modifier_always_on`
6. `pre_enabled_state_modifier`

### 6.1 被动与装备效果挂载入口

内容投影原则：

1. 可手动施放的 Q/W/E/R 动作继续进入 action/action template。
2. 常驻被动、入场即生效 passive、on-hit、on-attack、on-crit、periodic passive 统一编译为 initial statuses、triggers、attribute modifiers 和 effect definitions。
3. 英雄被动、技能描述中的被动、装备被动、符文被动都必须携带 `ownerType`、`ownerId`、`sourceCategory`、`sourceId` 和必要的 type refs。
4. wasm runtime 只识别通用 status/effect/trigger/attribute modifier，不写 `if hero == ...` 或 `if item == ...`。
5. 导出证据通过 `procSourceCategory/sourceId` 回溯来源，而不是依赖页面文案推断。

## 7. 装备与符文

### 7.1 装备

装备首期拆成三层：

1. 装备属性全覆盖：所有 ADC 相关装备的 AD、攻速、暴击、穿透、移速、吸血等直接属性进入 `equipmentStats`。
2. 装备被动分机制闭环：优先做 on-hit 额外伤害、每 N 次攻击触发、攻击叠层攻速/伤害、简单伤害增幅、简单 DoT。
3. 暂不参与 DPS 但保留数据标记：装备主动、击杀/参与击杀触发、位移/控制/护盾复杂交互、多目标扩散/弹射、需要敌方行为才能解释的效果。

装备效果状态建议：

1. `active_in_dps`
2. `stat_only`
3. `recorded_not_simulated`
4. `unsupported_mechanic`

击杀/参与击杀触发类效果可以通过 curve 级 `scenarioStates` 显式假定触发，用于对比触发态价值。

### 7.2 符文

1. 符文碎片和简单属性调整走 `runeStatAdjustments`。
2. 致命节奏等触发型、叠层型符文走 `externalPassiveEffects`。
3. 致命节奏进入 V2 首期扩展 case，但不阻塞普攻、英雄被动和装备主链。

## 8. 页面验收形态

### 8.1 页面 A：单英雄多曲线

全局字段：

1. 英雄。
2. 目标 actor。
3. 时间窗。
4. `simulationRules`。

每条 curve 独立字段：

1. curve 名称。
2. 英雄等级。
3. 技能等级。
4. 装备。
5. 启用的技能被动。
6. 场景预设状态。
7. 符文/属性调整。

### 8.2 页面 B：多英雄同装备

全局字段：

1. 目标 actor。
2. 时间窗。
3. `simulationRules`。
4. 装备。
5. 符文/属性调整。
6. 可选全局场景预设；只对能匹配 source 的英雄/装备生效。

每行英雄独立字段：

1. 英雄。
2. 英雄等级。
3. 技能等级。
4. 启用的技能被动。

### 8.3 图表与导出

主图默认展示累计伤害曲线；可切换目标剩余 HP 曲线。图表下方展示平均 DPS、总伤害、击杀时间、伤害构成和触发明细。导出 JSON 必须与页面展示值一致，并保留完整输入、快照和 wasm 输出。

新导出使用 `timeWindowDps` 和 `killDps`；如果需要兼容旧展示文案，“平均 DPS”只能作为 `timeWindowDps` 的 UI 文案，不新增 `averageDps` 字段。

## 9. 分批计划

### Batch A：协议冻结与 DPS driver 骨架

范围：

1. 冻结 V2 硬边界、对象归属、`simulationRules`、`durationMs`、`autoAttackPlan`、输出字段和 blocked 规则。
2. 新增 `target_dummy` type 和 3 个标靶 actor，并通过发布链进入 bundle。
3. 新增 V2 DPS 验证页骨架。
4. wasm 新增 `single_attacker_dps` driver，支持无装备、无被动的基础普攻时间线。
5. 固定 case：
   - `caseId`: `V2-BatchA-basic-aa-001`
   - attacker: Vayne
   - target: `target_dummy_fighter`
   - `durationMs`: 10000
   - `attackSpeedCap`: 3.0
   - equipmentSet: []
   - enabledPassiveEffects: []
   - scenarioStates: []
   - `critPolicy`: expected

验收：

1. 首刀 0ms。
2. 每次普攻时间点可由 attack speed 解释。
3. 普攻物理伤害经过护甲减免。
4. 目标死亡后停止后续事件。
5. `timeWindowDps` 和 `killDps` 区分清楚。
6. 无技能被动/装备被动触发。

Batch A 不要求用户提供截图。

### Batch B：英雄被动首批

范围：

1. 薇恩 W 三环。
2. 提莫 E 命中伤害 + DoT。
3. 克格莫 Q 被动攻速 + W 预开启。
4. 验证统一 status/effect/trigger 挂载入口、DoT 和动态攻击间隔。

需要用户补充少量训练营基线：

1. 薇恩等级、W 等级、面板 AD/攻速、W tooltip 三环伤害。
2. 提莫 E 等级、面板 AP/AD/攻速、E 命中伤害和 DoT tooltip。
3. 克格莫 Q/W 等级、面板攻速、W 预开启相关 tooltip 或面板变化。

### Batch C：装备属性全覆盖

范围：

1. 录入所有 ADC 相关装备属性。
2. 使用项目 type 表或等价发布链标记 ADC 装备池。
3. 页面能选择装备，`equipmentStats` 正确进入 wasm input 和导出 JSON。
4. 不要求所有装备被动闭环。

### Batch D：装备被动首批

范围：

1. 优先闭环破败、海妖、羊刀、智慧末刃等 on-hit / every-N / stacking 机制。
2. 验证 `itemPassiveTriggers`、`effectBreakdown` 和动态攻速变化。
3. 主动效果、击杀/参与击杀触发等先通过状态标记或 `scenarioStates` 参与对比。

### Batch E：页面和多曲线对比

范围：

1. 页面 A 单英雄多曲线。
2. 页面 B 多英雄同装备。
3. ECharts 累计伤害曲线和目标 HP 曲线。
4. 汇总表、伤害构成、触发明细。
5. 导出 JSON 和 Playwright 快照。

## 9.1 Canonical 回归 case

每类机制先用一个 canonical case 证明语义，不用英雄数量堆覆盖：

1. 同刻 buff 失效：攻速 buff 在下一次普攻时刻恰好结束，验证同时间点优先级。
2. 攻速 cap 临界值：`2.99 / 3.0 / 3.01` 三个点，验证 raw/effective/overflow attack speed、interval 和 cap 规则。
3. DoT 到期边界：DoT tick 恰好落在 `expireAt`，验证 tick 先于过期。
4. 来源顺序：同一次普攻触发 hero passive、item on-hit 和 DoT apply，验证 source metadata 和效果顺序。
5. 暴击策略：同输入分别跑 `expected` 与 `seeded_random`，验证导出字段可区分；涉及状态变化的 on-crit 不允许只用 expected。
6. blocked：published bundle 缺少所需被动、装备效果、公式或标靶数据时，curve 输出 `blocked`，不得本地私造。

## 10. 验证命令

具体命令由各 worktree 最近层 `AGENTS.md` 和 README 决定。默认验收链：

1. wasm：在 `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2` 跑 `go test ./...`，必要时重建 wasm 并同步到 web。
2. web：在 `C:\project\damage_web_dev\web` 跑 `npm run build`，并用 Playwright 验证 V2 页面导出 JSON。
3. backend：通过后端现有测试、脚本或发布接口验证标靶 actor 和装备 type 进入 published bundle。
4. docs：新增或调整文档映射后，在 `C:\project\damage_wasm_dev` 跑 `node tools/task-governance/cli.mjs rebuild`，要求 `unassigned_docs: 0`。

## 11. 残余风险

1. Data Dragon 本地字段不一定完整暴露所有英雄/装备公式，Batch B/D 仍可能需要训练营 tooltip 或人工基线。
2. 装备唯一被动冲突、主动技能、多目标扩散、击杀刷新等机制首期不闭环，需要明确状态标记，避免误导用户。
3. 前端解析 published bundle 到 wasm snapshot 的投影必须可导出，否则人工无法复核输入来源。
4. 动态攻速会影响事件排程，相关 case 必须验证 `attackIntervalTimeline`，不能只看总伤害。
