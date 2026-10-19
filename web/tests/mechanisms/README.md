# 机制回归用例

引擎或前端适配层变化后的回归，以这里的固定合成用例为准，不再逐个重跑已准入英雄。每个用例是一份不变的管理端业务数据（合成游戏 `mechanism_lab`，不引用 LoL 实库或英雄配置），加上事先手算好的期望结果。

```powershell
npm run test:mechanisms   # 只跑机制回归；npm test 也会包含
```

## 链路与比对

`mechanisms.test.ts` 对每个用例走与战斗分析页相同的生产链路：快照校验、公式预检、适配层装配、编译、按模式生成运行请求、真实 Wasm（`src/engine/wasm/tinygo_engine_v2.wasm`）运行、结果完整性核对、同会话重放一致、释放会话。

结果先投影成只含业务语义的字段（见 `mechanismRunner.ts` 的 `MechanismProjection`），再与 `expected` 比对：

- 对象只比较写出的字段，数值按相对误差 1e-9 比较。
- `damage`、`healing`、`skillStarts` 列表按发生顺序比较，条数必须一致；`attackStarts` 整体相等。
- 失败时实际投影写到被忽略的 `web/output/mechanisms/<caseKey>.actual.json`。

## 文件

| 路径 | 内容 |
| --- | --- |
| `catalogs/mechanism_lab.json` | 合成游戏的共享规则：属性、物理/魔法/真实伤害公式（先百分比后固定穿透、最低为0，倍率 100/(100+有效抗性)）、暴击与攻速属性键、普攻生命偷取规则 |
| `cases/<caseKey>.json` | 单个用例，文件名必须等于 `caseKey` |
| `admitted-coverage.json` | 正式准入对象依赖的机制标签，供证明刷新脚本核对覆盖 |

用例字段：`schemaVersion`（固定 `mechanism-case-v1`）、`caseKey`、`title`、`mechanisms`（机制标签）、`derivation`（手算推导，逐步写清）、`catalog`、`snapshot`（与管理端 `SimulationSnapshot` 相同，去掉 `gameId`、`catalogs`、`snapshotDigest`、`readAt`）、`scenario`、`expected`。`scenario.mode` 为 `continuous_attack`、`skill_action` 或 `automatic_skill`，后两者分别需要 `actions` 和 `automaticRules`，形状见 `src/engine/skillActionRequest.ts`、`src/engine/automaticSkillRequest.ts`。

## 编写规则

1. 期望值必须来自手算或游戏机制资料，推导写进 `derivation`。不得先跑引擎再把输出抄成期望；跑出来与手算不符时，先复核推导和机制语义，确认是产品缺陷就修产品代码。只有能证明原推导错误时才改期望，并在 `derivation` 说明。
2. 一个用例只验证一个主机制，可以顺带已覆盖的基础机制。数值取整或便于手算，避开恰好落在观察时长边界的时刻，除非边界本身就是要验的机制。
3. 从最接近的现有用例复制后修改，JSON 是唯一来源，不写生成器。属性值写进角色等级值，`scenario.attributeInputs` 只能填本次计算实际需要的属性。
4. 共享目录只追加属性、伤害类型或规则，不改已有含义；追加后跑全量确认旧用例不变。需要不同规则时新建目录文件。
5. 新增机制标签时同步更新下方词表。新机制进入引擎或适配层时，同一改动里带上对应用例。

已知的适配约束：

- 技能施放事件直接执行效果的规则必须带来源属性条件，可用恒真条件（当前生命比例 ≥ 0），见 `direct_heal_overheal`。
- 持续普攻模式不返回治疗明细，生命偷取只比较汇总。

## 机制标签

| 标签 | 用例 |
| --- | --- |
| `basic_attack.cadence` | `basic_attack_armor_cadence` |
| `basic_attack.interval_rounding` | `basic_attack_kill_rounding` |
| `combat.kill_stop`、`combat.overkill_clamp` | `basic_attack_kill_rounding` |
| `damage.physical_armor` | `basic_attack_armor_cadence` |
| `damage.physical_penetration`、`damage.type_formula` | `physical_penetration_order` |
| `damage.critical_expectation` | `basic_attack_critical_expectation` |
| `damage.magic_resist`、`damage.magic_penetration` | `skill_magic_ratio_cast_delay` |
| `damage.true` | `automatic_cooldown_true_damage` |
| `skill.formula_attribute_ratio`、`skill.delay_hit`、`skill.manual_cast` | `skill_magic_ratio_cast_delay` |
| `skill.automatic_cooldown` | `automatic_cooldown_true_damage` |
| `healing.life_steal` | `basic_attack_life_steal` |
| `healing.direct`、`healing.overheal_clamp` | `direct_heal_overheal` |

待补机制（括号内是可参考作者结构的现有单测）：护盾吸收（`src/engine/processShieldAdapter.test.ts`）、限时减伤（`timedDamageReductionAdapter.test.ts`）、限时属性增减（`timedAttributeEffectAdapter.test.ts`）、强化普攻（`empoweredAttackAdapter.test.ts`）、普攻计时重置（`attackTimerResetAdapter.test.ts`）、弹药与充能（`simulationAmmoMechanics.test.ts`、`activeAmmoAdapter.test.ts`）、资源消耗与上限（`finiteResourceMechanisms.test.ts`）、有限引导（`finiteChannelAutomatic.test.ts`）、命中与未命中、持续结果与周期伤害（`persistentResultAdapter.test.ts`）、被动触发与控制（`simulationPassiveControl.test.ts`）、触发型装备（`simulationTriggeredEquipment.test.ts`）、属性派生与转换（`simulationAttributeConversion.test.ts`）、场景初始属性（`sceneAttributeSnapshotIntegration.test.ts`）、自动规则的冷却等待与后继（`automaticSkillRequest.test.ts`）、每次使用一次与目标冷却、按生命比例的条件与斩杀。

## 与准入证明的关系

正式准入证明（`server/data_manage/src/main/resources/simulation-verification/<gameId>/combat-analysis.json`）绑定 Wasm 摘要和适配器版本。引擎或适配层变化后运行：

```powershell
node scripts/refresh-verification-identity.mjs          # 只检查
node scripts/refresh-verification-identity.mjs --write  # 条件全部满足后改写证明根
```

脚本要求 Wasm 身份常量与产物一致、相关源码已提交（源码身份即提交号）、每个 `PASSED` 对象在 `admitted-coverage.json` 声明的依赖机制都有用例，且机制回归全部通过；然后只改写证明根上的 `wasmSha256`、`adapterVersion` 和 `mechanismRegression`，各对象的内容摘要不变。覆盖未声明或有缺口时脚本拒绝刷新，并列出缺少的机制。

`admitted-coverage.json` 的对象键为 `<kind>:<key>`，例如：

```json
{ "schemaVersion": "mechanism-coverage-v1", "games": { "lol": { "CHARACTER:champion_annie": { "mechanisms": ["damage.magic_resist", "skill.delay_hit"] } } } }
```

新对象首次准入仍需按其真实配置单独验收；回归阶段只依赖这里的机制用例。
