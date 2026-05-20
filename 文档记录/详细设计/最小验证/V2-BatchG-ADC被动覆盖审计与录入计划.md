TASK_KEY: planning-validation-milestones
DOC_TYPE: 详细设计
WORKSTREAM: planning
STATUS: draft
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: 2026-05-20

# V2 Batch G ADC 被动覆盖审计与录入计划

关联概要：[验证里程碑V2.md](../../概要设计/验证里程碑V2.md)

关联总方案：[V2-单攻击方DPS协议与开发计划.md](./V2-单攻击方DPS协议与开发计划.md)

前置回归：[V2-BatchF-Canonical回归硬化计划.md](./V2-BatchF-Canonical回归硬化计划.md)

## 1. 目标

Batch G 的目标是把“所有 ADC / 平 A 流英雄与 ADC 成装的 DPS 相关被动”推进到可维护状态。

本批不直接承诺所有被动都一次性可运行，而是先建立可审计、可分批录入、可阻塞输出的覆盖链：

1. 基于 `数据参考/champion.json` 和 `数据参考/champion/*.json` 生成 Marksman 英雄候选池。
2. 基于 `最小验证/V2-Batch-C-adc-items.seed.json` 和 `数据参考/item.json` 生成 ADC 成装候选池。
3. 对每个 P/Q/W/E/R 技能被动和每个装备被动做机制分级。
4. 对当前 runtime 已支持的机制直接录入 seed。
5. 对无法表达的机制输出明确 backlog，不私造近似逻辑。
6. 对每个进入录入链路的英雄补齐 `statsByLevel`，并对 P/Q/W/E/R 中参与 DPS 的被动补齐技能等级 rank 表。
7. 发布后用 V2 页面 A/B 和 wasm canonical 回归验证不退化。

## 2. 当前基线

当前已知基线：

| 类别 | 当前数量/状态 |
| --- | --- |
| Marksman 初筛英雄 | `33` 个，来自 `champion.json` 的 `tags` 包含 `Marksman` |
| 已录入英雄被动首批 | 薇恩、提莫、韦鲁斯、卡莎、图奇、克格莫 |
| 已补齐等级/rank 数据首批 | 薇恩、提莫、韦鲁斯、卡莎、图奇、克格莫；current version `v2_batch_g_adc_level_tables_002` |
| ADC 成装属性池 | `53` 件，来自 `V2-Batch-C-adc-items.seed.json` |
| 已录入装备被动首批 | 破败、海妖、羊刀简化 on-hit |
| runtime 可表达机制 | on-hit、every-N、叠层伤害、简单 DoT、当前/最大/已损生命值比例、常驻/预开启属性 modifier |
| 已完成回归 | Batch F F1-F6 canonical case |

## 3. 非目标

1. 不把所有技能主动释放动作纳入 Batch G。
2. 不做完整技能轮转、敌方动作、1v1 AI 或多人战斗。
3. 不把 Data Dragon 描述无法还原的数值写成最终人工验收通过。
4. 不把 unsupported 机制伪装成 ok；必须进入 `blocked` 或 backlog。
5. 不覆盖散件、鞋子、装备主动效果和非 ADC 装备池。
6. 不在前端写英雄/装备专属分支绕过 runtime 语义。

## 4. 机制分级

每个候选被动必须分到一个且只分到一个状态：

| 状态 | 含义 | 处理 |
| --- | --- | --- |
| `ready_to_encode` | 当前 `DPSPassiveEffectV2` 和 runtime 能完整表达 | 本批录入 seed 并验证 |
| `needs_runtime_extension` | 单攻击方 DPS 需要该机制，但当前 operation 不够 | 先写 backlog，单独开发 runtime extension |
| `out_of_scope_for_single_target_dps` | 主动释放、多目标、位移、控制、金币、视野等不影响当前 DPS 曲线 | 记录为非目标 |
| `needs_manual_baseline` | 描述可表达但数值缺少可靠公式或面板基线 | 等用户截图/训练营数据 |
| `already_covered` | 已在 Batch B/D 录入且本轮只复核 | 不重复录入 |

## 5. 当前可直接录入的机制

优先录入这些模式：

1. 普攻命中额外物理/魔法/真实伤害。
2. 每 N 次普攻额外伤害。
3. 普攻叠层，达到 N 层触发伤害。
4. 普攻叠层后简单 DoT。
5. 基于目标当前生命值、最大生命值、已损生命值的额外伤害。
6. 常驻属性增益，例如被动攻速。
7. 由页面 scenario state 预开启的属性增益或 on-hit 增益。
8. 简单固定伤害增幅，前提是能用现有字段表达。

### 5.1 等级与技能 rank 前置规则

Batch G 录入不能只录 1 级标量。任何英雄或技能被动进入 `ready_to_encode` 前，必须先满足以下数据 gate：

1. 英雄必须有 `statsByLevel`，覆盖 1-18 级，字段至少包含会影响 DPS 或验证展示的基础属性：
   - `hp`
   - `mana`
   - `ad`
   - `armor`
   - `magic_resist`
   - `hp_regen`
   - `mana_regen`
   - `attack_speed`
2. `statsByLevel` 采用当前页面适配器语义：数组第 1 项是 1 级增量 `0`，后续项是相对 `baseStats` 的每级增量，不写 18 级绝对值快照。
3. P/Q/W/E/R 中被页面暴露为可调等级、且影响 DPS 的被动参数必须写 rank 表：
   - 5 级技能写 5 项数组。
   - 3 级技能写 3 项数组。
   - 英雄 P 如果随英雄等级、技能等级或阈值变化，必须明确写入公式来源或分段表；不能只写 1 级常量。
4. 如果本地 Data Dragon 只暴露 1 级标量，不能把该项标成 `ready_to_encode`。必须转为：
   - `needs_manual_baseline`：缺少数值表或截图基线。
   - `needs_runtime_extension`：有数值但当前 runtime 无法表达。
   - `out_of_scope_for_single_target_dps`：不影响单标靶 DPS。
5. 页面 A/B 验证必须至少抽查一个英雄等级变化和一个技能等级变化，证明曲线、导出 JSON、`resolvedSnapshot` 都使用了新等级数据。

首批 6 个英雄的补录结果是本规则的参考样例：

| 类型 | 已验证字段 |
| --- | --- |
| 英雄等级 | `statsByLevel.hp` 等数组长度均为 18 |
| 克格莫 Q | `attackSpeedPercent` rank 表，Q5 解析为 `0.25` |
| 克格莫 W | `targetMaxHpRatio` rank 表，W5 解析为 `0.06` |
| 页面 B 回归 | 克格莫 18 级 Q5/W5 与 1 级 Q5/W5 的 AD、攻速、攻击次数、击杀时间均不同 |

## 6. 暂缓录入的高风险机制

以下机制必须先进入 backlog，不允许用近似数据直接标记通过：

| 机制 | 例子 | 原因 |
| --- | --- | --- |
| phantom-hit / 额外触发攻击特效 | 羊刀满层每第三次附带额外攻击特效 | 需要定义是否复制英雄、装备、符文全部 on-hit，以及顺序和防递归 |
| 攻击叠层属性并按持续时间掉层 | 羊刀沸腾打击、部分攻速叠层 | 当前没有“每层 timed stat modifier 聚合”契约 |
| 盈能系统 | 火炮、电刀、岚切等 | 需要移动/攻击充能、充能消耗、首次攻击状态 |
| 咒刃 | 三相、夺萃、巫妖 | 需要“施法后下一次普攻”状态；首期不做主动技能轮转 |
| 处决阈值 | 收集者 | 需要阈值击杀语义和 target HP after damage 顺序 |
| 多目标或弹射 | 卢安娜、电刀连锁、九头蛇 | 当前目标是单标靶 DPS |
| 护盾、治疗、吸血转盾 | 饮血剑、盾弓、饮魔刀 | 当前 DPS 输出不闭环生存收益 |
| on-crit 随机触发 | 依赖真实暴击序列的效果 | 当前主链 `critPolicy=expected`，`seeded_random` 尚未闭环 |
| 冷却缩短 | 纳沃利 | 当前不做主动技能轮转，DPS 价值无法体现 |

## 7. 输出物

Batch G 应新增或更新这些文件：

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `文档记录/详细设计/最小验证/V2-BatchG-ADC被动覆盖审计与录入计划.md` | 详细设计 | 本文件 |
| `文档记录/详细设计/最小验证/V2-BatchG-ADC被动覆盖清单.md` | 详细设计/清单 | 33 个 Marksman 和 53 件 ADC 成装的机制分级表 |
| `最小验证/V2-Batch-G-adc-passive-audit.json` | 机器清单 | 由脚本生成，记录每条候选的状态、来源、阻塞原因 |
| `最小验证/V2-Batch-G-adc-passives-ready.seed.json` | seed | 只包含 `ready_to_encode` 的英雄/装备被动 |
| `最小验证/数据/build-v2-batch-g-adc-passive-audit.mjs` | 脚本 | 从 Data Dragon 本地 JSON 和现有 seed 生成审计清单 |
| `server/data_manage/src/test/java/.../KatarinaMvpImportMainTest.java` | 测试 | 如 seed schema 或导入字段有变，补导入断言 |
| `server/data_manage/src/test/java/.../ControllerPublishFlowIT.java` | 测试 | 如发布链新增 Batch G seed，补 bundle 断言 |
| `web/src/engine/tinygoV2DpsAdapter.ts` | 前端适配 | 把新增可选被动暴露给页面选择，不写专属计算逻辑 |
| `文档记录/测试记录/wasm/V2-BatchG-ADC被动覆盖录入-测试记录-2026-05-xx.md` | 测试记录 | 录入、发布、页面 smoke、阻塞项 |

如果 Batch G 只做审计不录入，则可以只交付清单和 audit JSON，不创建 ready seed。

## 8. 实施步骤

### G0：审计脚本与候选池

写入：

1. `最小验证/数据/build-v2-batch-g-adc-passive-audit.mjs`
2. `最小验证/V2-Batch-G-adc-passive-audit.json`
3. `文档记录/详细设计/最小验证/V2-BatchG-ADC被动覆盖清单.md`

要求：

1. Marksman 英雄从 `数据参考/champion.json` 的 `tags` 包含 `Marksman` 得到。
2. 英雄技能描述从 `数据参考/champion/<Champion>.json` 读取。
3. ADC 成装从 `V2-Batch-C-adc-items.seed.json` 得到，不重新发明筛选规则。
4. 装备描述和 tags 从 `数据参考/item.json` 读取。
5. 已录入项通过 `V2-Batch-B-hero-passives.seed.json` 和 `V2-Batch-D-adc-item-passives.seed.json` 标记 `already_covered`。

审计字段：

```json
{
  "sourceKind": "hero_skill|item_passive",
  "ownerId": "hero_vayne|3153",
  "ownerName": "薇恩|破败王者之刃",
  "skillKey": "P|Q|W|E|R|item_passive",
  "passiveName": "...",
  "sourceText": "...",
  "classification": "ready_to_encode|needs_runtime_extension|out_of_scope_for_single_target_dps|needs_manual_baseline|already_covered",
  "mechanismTags": ["on_hit", "every_n_hit"],
  "levelDataStatus": "complete|missing|not_applicable",
  "rankTableStatus": "complete|missing|not_applicable",
  "candidateDpsPassiveEffect": {},
  "blockedReason": "...",
  "needsUserData": []
}
```

### G1：可表达英雄被动录入

输入：G0 中 `sourceKind=hero_skill` 且 `classification=ready_to_encode` 的项。

写入：

1. `最小验证/V2-Batch-G-adc-passives-ready.seed.json`
2. 必要时追加导入/发布测试断言。
3. 必要时更新 `web/src/engine/tinygoV2DpsAdapter.ts` 的 passive option 列表。

规则：

1. `ownerType=hero`。
2. `ownerId` 使用已有 `hero_<lower_id>` 形态。
3. `skillId` 使用 `skill_<hero>_<skill>_<effect>_dps_v2`。
4. `mechanicsConfig.dpsPassiveEffects[]` 必须满足当前 runtime validation。
5. 需要预开启状态的效果必须带 `requiresScenarioStateId`，并在 adapter 暴露 scenario option。
6. 同一英雄写入 ready seed 前必须确认该英雄已经有 1-18 级 `statsByLevel`；没有则先补英雄数据，不允许只录技能被动。
7. 同一技能的 DPS 参数如果随技能等级变化，必须写 rank 数组；页面中可调的 Q/W/E/R 不允许只写 1 级标量。
8. 如果只找到 1 级数值但找不到完整 rank 表，该候选保持 `needs_manual_baseline`，并在 `needsUserData` 里写清需要用户提供的技能等级、英雄等级、目标双抗和截图字段。

### G2：可表达装备被动录入

输入：G0 中 `sourceKind=item_passive` 且 `classification=ready_to_encode` 的项。

写入：

1. `最小验证/V2-Batch-G-adc-passives-ready.seed.json`
2. 更新对应 item `skillRefs`。
3. 必要时追加导入/发布测试断言。

规则：

1. `ownerType=item`。
2. `ownerId` 使用装备数字 ID。
3. `skillId` 使用 `item_<itemId>_<slug>_dps_v2`。
4. 装备属性仍以 Batch C 的 `statModifiers` 为准；Batch G 不重复改属性，除非发现 Batch C 属性错误。

### G3：发布与页面验证

前提：后端和前端服务已启动。

步骤：

1. 导入 Batch G seed。
2. 发布新版本，例如 `v2_batch_g_adc_passives_001`。
3. 打开页面 A `#/wasm-validation-v2-dps`，选择新增英雄/装备被动组合，运行。
4. 打开页面 B `#/wasm-validation-v2-dps-multi-hero`，用相同装备跑多英雄对比。
5. 导出 JSON，抽查：
   - `enabledPassiveEffects`
   - `skillPassiveTriggers`
   - `itemPassiveTriggers`
   - `effectBreakdown`
   - `blockedReasons`
   - `attackIntervalTimeline`
6. 对至少一个新增英雄执行等级回归：
   - 英雄等级从 1 改到 18 后，`resolvedSnapshot.attackerSnapshot.level` 和基础属性必须变化。
   - 曲线的攻击间隔、攻击次数、击杀时间或总伤害构成至少有一项变化。
7. 对至少一个新增 Q/W/E/R 被动执行技能等级回归：
   - 技能等级从 1 改到满级后，`resolvedSnapshot.passiveEffects[].operations` 中对应数值必须变化。
   - 不允许出现 `enabled passive effect ... is missing from resolvedSnapshot.passiveEffects`。

### G4：runtime extension backlog

如果 G0 审计发现高价值机制无法表达，不在本批硬录。

先输出 backlog，按机制聚合：

1. `stacking_stat_modifier_on_hit`
2. `phantom_hit_on_hit_repeat`
3. `energized_charge_and_consume`
4. `spellblade_next_attack_state`
5. `execute_threshold`
6. `lifesteal_or_shield_value_output`
7. `seeded_random_crit_sequence`

每个 backlog 需要包含：

1. 影响英雄/装备列表。
2. 需要新增的 operation 或 scenario state 语义。
3. canonical test 草案。
4. 是否需要用户游戏截图。

## 9. 验证命令

Wasm：

```powershell
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go test ./internal/runtime -run "Canonical|SingleAttackerDPS" -count=1
go test ./...
go run ./cmd/bench
```

Backend seed/import/publish：

```powershell
cd C:\project\damage_wasm_dev
node .\最小验证\数据\build-v2-batch-g-adc-passive-audit.mjs
```

如修改后端导入或发布测试：

```powershell
cd C:\project\damage_backend_dev\server\data_manage
.\mvnw test
```

Web：

```powershell
cd C:\project\damage_web_dev\web
npm run build
```

Docs：

```powershell
cd C:\project\damage_wasm_dev
node tools/task-governance/cli.mjs rebuild
```

收尾：

```powershell
cd C:\project\damage_wasm_dev
git -c safe.directory=C:/project/damage_wasm_dev diff --check

cd C:\project\damage_web_dev
git -c safe.directory=C:/project/damage_web_dev diff --check
```

## 10. 通过标准

1. `V2-Batch-G-adc-passive-audit.json` 覆盖 33 个 Marksman 英雄和 53 件 ADC 成装。
2. 每个候选被动都有明确 `classification`，无空白状态。
3. 每个新增 ready 英雄都有 1-18 级 `statsByLevel`，不允许只靠 `baseStats` 跑 1 级。
4. 每个新增 ready 的 Q/W/E/R DPS 被动都有完整 rank 表，除非该参数经审计确认全等级不变。
5. `ready_to_encode` 项能导入、发布并在页面导出 JSON 中出现。
6. `already_covered` 项与 Batch B/D seed 对齐，不重复生成冲突 skillId。
7. `needs_runtime_extension` 项有机制级 backlog，不以近似逻辑混入 ready seed。
8. 页面 A/B 至少各跑一组包含新增 hero passive 和 item passive 的组合。
9. 页面 A/B 至少证明一个英雄等级变化和一个技能等级变化会改变 `resolvedSnapshot` 和曲线结果。
10. `go test ./...`、`npm run build`、治理 rebuild 通过。
11. 新测试记录纳入 `planning-validation-milestones`，`unassigned_docs: 0`。

## 11. 需要用户确认或补充的数据

G0 审计完成后再向用户要数据，不在计划阶段提前要求截图。

可能需要用户补充：

1. Data Dragon 未给出明确数值的 tooltip 面板截图。
2. 技能等级 1 到满级的 rank 表缺失时，需要对应等级截图或可靠公式来源。
3. 英雄 1-18 级基础属性缺失时，需要确认采用版本公式、CommunityDragon 数据还是人工面板基线。
4. 同一描述存在近战/远程不同收益时的远程基线。
5. 盈能、咒刃、处决、phantom-hit 等机制是否优先开发 runtime extension。
6. 被动默认是否开启：常态、预开启、击杀后、参与击杀后、满层后。
7. 版本口径：继续按当前 `V16.10` 人工数据口径记录；本地 Data Dragon 源如果仍是 `16.9.1`，必须在审计里标明。

## 12. 建议执行顺序

1. 先执行 G0，只生成审计清单，不写 DB seed。
2. 对 G0 结果先做等级/rank gate 复核，缺表项先降级为 `needs_manual_baseline`。
3. 人工快速 review `ready_to_encode` 和 `needs_runtime_extension` 分类。
4. 再执行 G1/G2 录入 `ready_to_encode`。
5. 发布并做页面 A/B smoke，必须包含英雄等级和技能等级变化回归。
6. 根据 backlog 决定是否开启 Batch H runtime extension。
