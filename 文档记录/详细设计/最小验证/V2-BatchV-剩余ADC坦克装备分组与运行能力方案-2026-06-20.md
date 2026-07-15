TASK_KEY: planning-validation-milestones
DOC_TYPE: 详细设计
WORKSTREAM: planning
STATUS: draft
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-15

# V2 BatchV 剩余 ADC/坦克装备分组与运行能力方案 2026-06-20

## 1. 结论

本轮只处理 `current-items-effect-review-neutral-zh-tank-adc.xlsx` 中标记为“现在做”、但当前 seed 里还没有可测试被动的 23 件唯一装备。

分成两组：

| 组 | 数量 | 处理方式 |
| --- | ---: | --- |
| A. 数据/seed/策略层处理 | 11 | 不先补 Wasm runtime；能导的先导，需要政策的先补转换/适配规则，无 DPS 价值的继续排除。 |
| B. 运行能力方案组 | 12 | 先准备 runtime 方案和验证矩阵；本轮不开发运行时代码。 |

机器可读分组文件：

```text
C:\project\damage_wasm_dev\数据参考\lol-wiki-current-items\current-items.reviewed-tank-adc.remaining-23.grouping.json
```

### 1.1 用户拍板后的近期执行状态

2026-06-20 用户对 B 组运行能力做了范围收缩：当前 DPS 只测输出、只管平 A，防御护盾、治疗/护盾放大、靶子反向光环、主动技能冷却变更都暂时不做。

| 原能力 | 关联装备 | 近期状态 |
| --- | --- | --- |
| 阈值护盾 / Lifeline / 溢出治疗转护盾 | `2504`, `3072`, `3155`, `3156`, `6673` | 暂时不做。 |
| 治疗/护盾/回复放大 | `3065` | 暂时不做；当前 DPS 只测输出。 |
| 靶子装备反向光环伤害 | `3068`, `6664` | 暂时不做。 |
| 心之钢永久 HP 成长 | `3084` | 晚点；优先在传结构体给 Wasm 前由 Web/转换层拦截修改目标 HP 基线。 |
| 普攻减少基础技能冷却 | `6675` | 后面再开发；当前只管平 A。 |
| 通用公式输入/最终伤害表达式 | `3082` | 不是缺 `max`，公式字节码已有 `max/min/input`；缺的是 DPS hp_change/公式路径把本次伤害量作为 `input` 暴露，并允许公式结果驱动 final damage 或 damage delta。 |
| 通用公式取余/命中计数条件 | `3302` | `every_n_basic_attack_hit` 内部已有取余，但不是通用 AST 运算；应补公式 `mod` opcode，并给公式条件暴露 hit count/parity 指标，而不是写 Terminus 专用分支。 |

近期真正还需要进入方案设计的是两类通用公式能力：

```text
3082 Warden's Mail：把“本次伤害量”接入公式 input，并让公式结果参与最终伤害/差值计算。
3302 Terminus：公式 AST/bytecode 支持 mod，并暴露命中序号/计数供条件公式读取。
```

### 1.2 2026-06-20 执行状态澄清

`23` 是本轮原始剩余唯一装备总数，不是已录入数量。

截至 `v2_batch_v_a_data_policy_items_001` 发布闭环，处理状态为：

| 分类 | 数量 | 状态 |
| --- | ---: | --- |
| A 组已录入并完成 Wasm DPS proof | 4 | `2051`、`3004`、`3036`、`6665` |
| A 组未录入但已完成排除/阻塞处置 | 7 | `1083`、`2512`、`2523`、`3033`、`3083`、`3123`、`8020` |
| B 组运行能力/方案项 | 12 | 当前不作为 ready seed 直接导入；其中 `3082` 的通用公式 input runtime 切片已完成 |
| 合计 | 23 | 其中已导入 4，runtime 能力推进 1，未导入或延期 19 |

机器可读总矩阵证据：

```text
C:\project\damage_wasm_dev\文档记录\测试记录\wasm\artifacts\V2-BatchV-remaining-23-processing-matrix-proof-20260620.json
```

### 1.3 2026-07-15 Jak'Sho 当前 generic ABI 受控 partial

`item_6665` 不再只保留 legacy single_attacker_dps 的“开局即满层”证明。当前 generic 合同为 target-owned synthetic partial：

| 项 | 当前合同 |
| --- | --- |
| mount / owner | `provider_item_6665_jaksho_voidborn_resilience` 只挂在 target；source 不持有 provider/state |
| 激活 | run 从 0ms 起视为已在战斗；`start_delay_ms=5000`，首个 provider tick 在 5000ms 把 `full_stack` override 为 1 |
| 幂等 | 后续每 5000ms tick 仍 set 1，不重复叠加 |
| 数值 | `armor += 0.30 * max(0, bonus_armor.resolved) * full_stack`；MR 同理 |
| 静态数据 | Backend 自包含 `item_6665`：hp 350 / armor 45 / magic_resist 45，并 ensure `bonus_armor` / `bonus_magic_resist` |

Wasm 输入必须显式提供 target 的总抗性与 bonus 抗性；runtime 不从 equipment/loadout 自动汇总。真实目标装备投影、自动战斗态检测和 live publish 均不在本 partial 内。

实现证据：Backend `ed2bf6a723c7c1fa5486c5daac00478093ac1ac0`；Wasm `7e2b40e26006ddb2c67636a8daeb5ab759719c6b`。旧 Batch V-A 满层 DPS proof 只作历史数值交叉证据，不反向定义 generic 时序。

## 2. 输入与已核对事实

输入文件：

```text
C:\project\damage_wasm_dev\数据参考\lol-wiki-current-items\current-items.reviewed-tank-adc.conversion-audit.json
C:\project\damage_wasm_dev\数据参考\lol-wiki-current-items\current-items.reviewed-tank-adc.backlog.json
C:\project\damage_wasm_dev\数据参考\lol-wiki-current-items\current-items.reviewed-tank-adc.seed-candidate.json
C:\project\damage_wasm_dev\数据参考\lol-wiki-current-items\review\current-items-effect-review-neutral-zh-tank-adc.xlsx
```

审阅统计：

| 指标 | 数量 |
| --- | ---: |
| “现在做”效果行 | 54 |
| “现在做”唯一装备 | 39 |
| 已有导入或可测试效果的唯一装备 | 16 |
| 本文处理的剩余唯一装备 | 23 |

现有 TinyGo V2 DPS 能力核对：

| 能力 | 当前状态 |
| --- | --- |
| `hp_change/outgoing/pre_mitigation` | 已支持，可做攻击方造成伤害前置增伤。 |
| `hp_change/incoming/pre_mitigation` | 已支持，可做目标承伤前置修正。 |
| `hp_change/final/post_mitigation` | 已支持，可做抗性后百分比/最终修正。 |
| `hp_change/flat/post_percent` | 已支持固定值后置修正，但 clamp 是绝对值，不是“最多减本次伤害 20%”这种相对 cap。 |
| `attr_ratio` valueSpec | 已支持，可从 attacker/target resolved 属性读值。 |
| `hp_diff_ratio` valueSpec | 已支持，但语义是双方 max HP 差，不等同于 target bonus health。 |
| formula valueSpec | 已支持公式；公式 bytecode 已有 `max/min/input`，但 DPS modifier 公式当前拒绝 `resource` 和 `counter` reader，且未把本次伤害量绑定到 `input`。 |
| stack/on-hit/phantom hit | 已支持一批基础模式；`every_n_basic_attack_hit` 内部用取余，但这不是通用公式/AST 的 `mod` 运算，也没有通用 hit count/parity 条件指标。 |
| DPS DoT | 支持对 target 的 DoT tick；不支持 target-owned aura 反向打 attacker。 |
| 普通 runtime shield | 已有骨架；single_attacker_dps 还没有装备被动 lifeline/阈值护盾派发。 |

## 3. A 组：数据/seed/策略层处理

这些装备不应该先改 Wasm runtime。

| itemId | 装备 | 处理判断 | 下一步 |
| --- | --- | --- | --- |
| 1083 | 萃取 Cull | 经济金币效果，无当前 DPS 价值。 | 继续排除。 |
| 2051 | 守护者号角 Guardian's Horn | 固定承伤减免可用 `hp_change/flat/post_percent` 表达；当前基础普攻不涉及 DoT 3.75 分支。 | 作为受控数据转换候选。 |
| 2512 | 猎魔人弩箭 Fiendhunter Bolts | 只给大招急速，当前基础普攻 DPS 不消费。 | 继续排除。 |
| 2523 | 海克斯镜片 C44 | `Magnification` 可用 outgoing hp_change 增伤；`Arcane Aim` 与用户标注冲突。 | 先做 source/policy resolution，不补 runtime。 |
| 3004 | 魔宗 Manamune | `Awe` 可在“mana 作为属性”政策下转 AD；`Manaflow` 是最大法力成长/基线问题。 | 明确满/未满充能政策后转换。 |
| 3033 | 凡性的提醒 Mortal Reminder | 重伤只影响目标治疗，当前无目标治疗模型。 | 继续排除。 |
| 3036 | 多米尼克领主的致意 Lord Dominik's Regards | 增伤乘区已有；缺 target bonus health 输入来源。 | 由转换/Web 适配补 `target_bonus_health` 政策后转换。 |
| 3083 | 狂徒铠甲 Warmog's Armor | 战斗外回血不进当前 DPS；`Vitality` 是 item-sourced bonus health 统计问题。 | 先保留基础属性，等 bonus health 聚合政策。 |
| 3123 | 死刑宣告 Executioner's Calling | 同重伤，无当前 DPS 价值。 | 继续排除。 |
| 6665 | 千变者贾修 Jak'Sho | 当前 generic 已完成 5 秒 target-owned synthetic partial；30% 只作用于显式 bonus armor/MR。 | 保留真实 equipment/loadout 投影与自动战斗态为 out-of-scope。 |
| 8020 | 深渊面具 Abyssal Mask | 靶子穿时是让附近敌人受到更多魔法伤害，不是靶子自己承伤增加。 | 当前靶子语义下继续排除。 |

A 组里可优先尝试转换的不是 11 件全部，而是：

```text
2051 Guardian's Horn
3004 Manamune
3036 Lord Dominik's Regards
6665 Jak'Sho, The Protean
```

条件是先把对应政策写进转换层和测试说明：

| 政策 | 用途 |
| --- | --- |
| mana 作为 DPS 属性 | 支持 Manamune 的 `2% maximum mana -> bonus AD`。 |
| target bonus health 输入 | 支持 Lord Dominik's Regards，避免把 target max HP 差误当 bonus health。 |
| item-sourced bonus armor/MR | 支持 Jak'Sho 只放大 bonus 抗性，不误放大全部抗性。 |
| Guardian's Horn basic-only 范围 | 先不处理 DoT 3.75 分支。 |

## 4. B 组：运行能力方案组

这些装备不能直接导入成 ready seed。先做方案，再决定是否拆 Batch 开发。

注意：下表是技术缺口清单，不是近期开发清单。近期执行状态以 1.1 节用户拍板为准。

| itemId | 装备 | 运行能力缺口 | 方案桶 |
| --- | --- | --- | --- |
| 2504 | 败魔 Kaenic Rookern | 定时/预置魔法护盾，DPS lane 需要 item passive 生成 shield evidence。 | shield/lifeline |
| 3065 | 振奋盔甲 Spirit Visage | 治疗、护盾、生命回复放大必须进入 heal/shield pipeline，不能硬写数值。 | shield/heal amp |
| 3068 | 日炎圣盾 Sunfire Aegis | 靶子装备的周期光环需要反向对 attacker 造成伤害。 | target-owned aura |
| 3072 | 饮血剑 Bloodthirster | 生命偷取 overheal 转护盾，需要 heal event 和 shield creation。 | shield/lifeline |
| 3082 | 守望者铠甲 Warden's Mail | `max` 本身已有；缺的是本次伤害量作为公式 `input`，以及公式结果写回 final damage / damage delta 的通用路径。 | general formula damage input |
| 3084 | 心之钢 Heartsteel | 精确行为需要叠层、攻击触发、永久生命成长；靶子场景可另设手动基线。 | permanent growth |
| 3155 | 海克斯饮魔刀 Hexdrinker | 受魔法伤害将低于 30% HP 前触发魔法盾。 | shield/lifeline |
| 3156 | 玛莫提乌斯之噬 Maw | 同 Hexdrinker，另有全能吸血/治疗联动。 | shield/lifeline |
| 3302 | 界弓 Terminus | 不应写专用奇偶分支；缺的是公式 `mod` opcode 和 hit count/parity 指标，之后再用普通 stack/stat modifier 表达层数。 | general formula modulo / hit-count metric |
| 6664 | 璀璨回响 Hollow Radiance | 同 Sunfire 的靶子反向光环。 | target-owned aura |
| 6673 | 不朽盾弓 Immortal Shieldbow | 受伤将低于 30% HP 前触发通用护盾。 | shield/lifeline |
| 6675 | 纳沃利烁刃 Navori Flickerblade | 普攻降低基础技能冷却，当前基础 DPS 没有这个调度变更能力。 | active skill cooldown |

## 5. 运行能力设计拆分

### 5.1 shield/lifeline

覆盖：

```text
2504 Kaenic Rookern
3072 Bloodthirster
3155 Hexdrinker
3156 Maw of Malmortius
6673 Immortal Shieldbow
3065 Spirit Visage
```

需要先设计：

| 设计点 | 说明 |
| --- | --- |
| 触发时机 | Lifeline 必须在 HP 伤害落地前判断“这次伤害是否会把目标打到阈值以下”。 |
| shield 类型 | Kaenic/Hexdrinker/Maw 是 magic shield；Shieldbow 是 all shield。 |
| 冷却 | Lifeline 类需要 item passive cooldown，不应每次命中重复触发。 |
| evidence | 输出 shieldBefore、shieldAfter、shieldGranted、shieldAbsorbed、triggeredPassive。 |
| Spirit Visage | 只在 heal/shield pipeline 已存在后接入，作为 received shield/heal multiplier。 |

非目标：

```text
本阶段不做全套治疗/吸血系统，除非 Bloodthirster/Maw 被明确纳入同一 Batch。
```

最小验证：

| 验证 | 期望 |
| --- | --- |
| 魔法伤害触发 Hexdrinker | 低于阈值前生成 magic shield，HP 少扣。 |
| 物理伤害不触发 Hexdrinker | 不生成 shield。 |
| Shieldbow 通用 shield | 任意伤害类型满足阈值都可触发。 |
| Spirit Visage + shield | shield granted 按 multiplier 放大，并有 evidence。 |

### 5.2 target-owned aura

覆盖：

```text
3068 Sunfire Aegis
6664 Hollow Radiance
```

需要先设计：

| 设计点 | 说明 |
| --- | --- |
| ownerRole | target 装备触发，但 damage targetRole 是 attacker。 |
| activation | taking/dealing damage 激活 3 秒；在当前单攻方打靶场景，至少要支持 target taking damage 激活。 |
| tick cadence | 每秒 tick，受 simulationRules dotTickIntervalMs 限制。 |
| damage formula | 基础值 + bonus health 百分比，需要 target bonus health 或 target hp 属性政策。 |
| evidence | attackerDamageTimeline、AttackerDamageBySource、itemPassiveTriggers 都要能看到。 |

非目标：

```text
不实现真实距离系统；当前可按“目标在光环范围内”作为受控测试前提。
```

### 5.3 general formula damage input

覆盖：

```text
3082 Warden's Mail
```

问题：

3082 的精确表达式可以写成：

```text
finalDamageAfter = max(finalDamage - 15, finalDamage * 0.8)
```

这里不是缺 `max`。`internal/formula` 已经有 `max/min/input`，真正缺的是 DPS hp_change/公式路径没有把本次 post-mitigation damage amount 绑定为公式 `input`，也没有明确一个“公式结果写回 final damage 或 damage delta”的通用 valueSpec 语义。

需要先设计：

| 设计点 | 说明 |
| --- | --- |
| damage amount input | 在 hp_change/final 或 flat/post_percent 类路径中，把当前伤害实例金额注入 `formula.EvalContext.Input`。 |
| formula result semantics | 明确公式返回的是 `finalDamageAfter`，还是 `damageDelta`；避免同一公式在不同 bucket 下语义漂移。 |
| scope gate | 先限制到 post-mitigation basic damage instance；后续再扩到技能、多段伤害或 DoT。 |
| evidence | 要显示 raw/finalBefore、formulaInput、formulaResult、actualReduction。 |

最小验证：

| raw damage | 期望实际减伤 |
| ---: | ---: |
| 100 | 15 |
| 40 | 8 |
| 10 | 2 |

2026-06-20 执行状态：

```text
已完成通用 runtime 切片：hp_change bucket 的 formula valueSpec 可读取当前 stage damage amount 作为 formula input。
已完成真实装备闭环：3082 守望者铠甲 seed、DB 导入、发布 bundle、published bundle + Wasm DPS proof 已通过。
```

验证记录：

```text
C:\project\damage_wasm_dev\文档记录\测试记录\wasm\V2-BatchV-B-3082-守望者铠甲公式input运行能力-测试记录-2026-06-20.md
```

### 5.4 general formula modulo and hit-count metric

覆盖：

```text
3302 Terminus
```

现状：

旧 Batch G 中存在 `item_3302_terminus_shadow_dps_v2`，但它只记录了历史版本/简化版本的 30 点 on-hit magic damage，并且说明 Light/Dark 交替效果仍是 backlog。当前 `every_n_basic_attack_hit` 内部用 `hitCounts % everyN` 做专用触发判断，但公式 AST/bytecode 没有通用 `mod` 运算，DPS 条件公式也没有可读的 hit count / hit index / parity 指标。

所以 3302 不应该补 Terminus 专用“次数 % 2”分支。正确方向是先补通用表达式能力，再用现有 stack/stat modifier 机制表达可复用的部分。

需要先设计：

| 设计点 | 说明 |
| --- | --- |
| `mod` opcode | `FormulaDefinitionV2.op` 增加 `mod`，compile/eval/trace/opName 都按通用公式运算处理。 |
| hit-count metric | 公式条件需要读取当前 passive/action 的 hit count 或 hit index；命名和 owner scope 要固定，避免和全局 counter 混用。 |
| condition source | 决定是扩展 DPS gate/condition formula，还是先给 valueSpec/trigger condition 引入公式判断。 |
| stack reuse | Light/Dark 分支命中后，优先复用现有 `add_stack` / `stat_modifier` / 过期机制表达层数。 |
| evidence | 每次命中记录 hitIndex、modResult、本次分支、层数、过期时间。 |

### 5.5 permanent growth or manual baseline

覆盖：

```text
3084 Heartsteel
```

两条路线：

| 路线 | 用途 | 风险 |
| --- | --- | --- |
| 手动基线 | 靶子穿心之钢时，直接在目标 preset 里给额外 HP。 | 不是机制模拟，只能用于受控靶子配置。 |
| runtime 精确机制 | 模拟 700 范围叠层、3 层后普攻触发、永久 HP 成长。 | 需要状态、距离假设、永久成长写回和 evidence。 |

建议：

```text
当前先走手动基线；除非后续要测试攻击方 Heartsteel，否则不要把它插进本轮 runtime 开发。
```

### 5.6 active skill cooldown

覆盖：

```text
6675 Navori Flickerblade
```

当前基础普攻 DPS 中没有价值。只有启用 active skill DPS 后，才需要实现：

| 设计点 | 说明 |
| --- | --- |
| cooldown mutation | basic attack on-attack 后减少 basic ability remaining cooldown。 |
| action class | 必须区分 basic abilities 和 ultimate/summoner/item。 |
| schedule update | 已排程 action 的 nextAtMs 要可被提前。 |
| evidence | 记录 cooldownBefore、cooldownAfter、affectedActionIds。 |

## 6. 开发顺序建议

按用户 2026-06-20 的拍板，近期不碰大部分 B 组 runtime 能力。推荐顺序调整为：

1. A 组数据/策略候选：`2051`、`3004`、`3036`；`6665` 已另行完成 5 秒 generic synthetic partial，后续只在宿主具备真实 target equipment/loadout 时重开。
2. `3084` 心之钢先走传入 Wasm 前的结构体/目标 HP 基线拦截方案，不作为近期 runtime 开发。
3. `3082` 守望者铠甲已完成通用公式 input runtime 切片；下一步是补真实装备 seed 与发布后单件 proof。
4. `3302` 界弓进入通用表达式能力方案：公式 AST/bytecode 支持 `mod`，并给公式条件提供 hit count / parity 指标。
5. `shield/lifeline`、`target-owned aura`、治疗/护盾放大、Navori 主动技能冷却全部进入后续 backlog。

## 7. 后续验证矩阵

| 阶段 | 验证命令/证据 |
| --- | --- |
| 只改分组/方案文档 | `git diff --check`，确认引用路径存在。 |
| A 组转换层变更 | 生成 seed candidate，导入 DB seed 候选，逐件单件 DPS 测试。 |
| Wasm runtime 变更 | `cd wasm/tinygo_engine_v2; go test -count=1 ./...; go run ./cmd/bench`。 |
| Wasm artifact 变更 | `powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1`，再跑 `node .\scripts\smoke-node.mjs`。 |
| Web 适配变更 | `cd C:\project\damage_web_dev\web; npm run build`，再用 Playwright 走单件装备测试。 |

## 8. 本文非目标

本文件不做以下事情：

```text
不修改 Wasm runtime。
不修改转换脚本。
不导入 DB。
不发布新 bundle。
不把暂不支持机制近似成 ready seed。
```
