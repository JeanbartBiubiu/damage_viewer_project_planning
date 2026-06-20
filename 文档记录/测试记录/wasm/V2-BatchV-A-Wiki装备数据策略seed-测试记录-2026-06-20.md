TASK_KEY: planning-validation-milestones
DOC_TYPE: 测试记录
WORKSTREAM: planning
STATUS: pass
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: 2026-06-20

## 2026-06-20 DB/Admin + Published Bundle + Wasm DPS 补充闭环

状态：pass（限本记录覆盖的 A 组 4 件：`2051`、`3004`、`3036`、`6665`）。

补充验证范围：

1. 本地后端 `http://127.0.0.1:8080` 当前版本为 `v2_batch_v_a_data_policy_items_001`。
2. Published bundle 已包含 4 件 item、4 个 item-owned skill、5 个 coefficient bucket，以及 `target_bonus_health`、`bonus_armor`、`bonus_magic_resist`、`mana`、`ad`、`armor`、`magic_resist` 属性定义。
3. 使用 `tinygo_engine_v2.wasm` ABI harness 初始化最小 DPS EngineBundle，并从 published bundle 投影 A 组 4 件 dpsPassiveEffects/buckets 进入 single_attacker_dps 输入。

证据文件：

```text
C:\project\damage_wasm_dev\文档记录\测试记录\wasm\artifacts\V2-BatchV-A-proof-harness-20260620.mjs
C:\project\damage_wasm_dev\文档记录\测试记录\wasm\artifacts\V2-BatchV-A-published-bundle-proof-20260620.json
C:\project\damage_wasm_dev\文档记录\测试记录\wasm\artifacts\V2-BatchV-A-wasm-dps-proof-20260620.json
```

运行命令：

```powershell
node "C:\project\damage_wasm_dev\文档记录\测试记录\wasm\artifacts\V2-BatchV-A-proof-harness-20260620.mjs"
```

结果摘要：

| curve | 装备策略 | 关键结果 |
| --- | --- | --- |
| `baseline_no_batch_v_a_item` | 无 Batch V A item | `totalDamage=100` |
| `target_2051_guardians_horn` | target `2051`，`flat_post_percent=-15` | `totalDamage=85`，bucket `flat_post_percent` 命中 |
| `attacker_3004_manamune` | attacker `3004`，`ad_flat_bonus=2% resolved mana` | `resolved ad=165`，`totalDamage=165`，bucket `ad_flat_bonus` 命中 |
| `attacker_3036_lord_dominiks` | attacker `3036`，target `target_bonus_health=1500` | `totalDamage=155.25`，bucket `outgoing_damage_amp` 命中 |
| `target_6665_jaksho` | target `6665`，`bonus_armor=100`、`bonus_magic_resist=80` | `resolved armor=75`、`resolved magic_resist=69`、`totalDamage=57.142857`，两个 target resist bucket 命中 |

注意：target 侧装备属性仍由 Web/测试输入在 `targetSnapshot` 中显式投影；Wasm 不根据 `targetEquipmentStats` 自动叠加目标装备属性，`targetEquipmentStats` 在当前契约中用于校验与解释。

## 2026-06-20 A 组剩余项处置 proof

状态：pass（证明剩余 A 组 7 件没有继续导入为 ready seed）。

证据文件：

```text
C:\project\damage_wasm_dev\文档记录\测试记录\wasm\artifacts\V2-BatchV-A-remaining-disposition-proof-20260620.json
```

核验范围：

1. 从 `current-items.reviewed-tank-adc.remaining-23.grouping.json` 读取 A 组 11 件，并排除本轮已导入的 `2051`、`3004`、`3036`、`6665`。
2. 从当前 published bundle `v2_batch_v_a_data_policy_items_001` 读取剩余 7 件 base item、`skillRefs`、item-owned skills 和 DPS passive 计数。
3. 检查剩余 7 件是否存在意外的 `batch_v_a` skillRef 或 item-owned skill。

结果摘要：

```json
{
  "remainingAItemCount": 7,
  "publishedBaseItemFoundCount": 7,
  "unexpectedBatchVImportCount": 0,
  "unexpectedBatchVImports": [],
  "closureCounts": {
    "closed_excluded_no_current_basic_dps_value": 5,
    "blocked_source_or_policy_resolution": 1,
    "blocked_data_policy_resolution": 1
  }
}
```

处置结论：`1083`、`2512`、`3033`、`3123`、`8020` 继续按无当前 single-attacker basic DPS 价值排除；`2523` 等 source/policy resolution；`3083` 等 bonus health 聚合/数据策略。A 组在本轮范围内没有新的 ready seed 可继续导入。

## 2026-06-20 原始 23 件总盘子澄清

状态：pass（数量口径校正）。

`23` 是 `current-items-effect-review-neutral-zh-tank-adc.xlsx` 中标记为“现在做”、且当前 seed 里还没有可测试被动的原始剩余唯一装备总数。`7` 不是已录入数量，而是 A 组中未继续导入、只做排除或策略阻塞处置的数量。

证据文件：

```text
C:\project\damage_wasm_dev\文档记录\测试记录\wasm\artifacts\V2-BatchV-remaining-23-processing-matrix-proof-20260620.json
```

结果摘要：

```json
{
  "totalItems": 23,
  "importedAndWasmDpsTestedCount": 4,
  "runtimeSliceCompletedNotImportedCount": 1,
  "notImportedOrDeferredCount": 19,
  "dataSeedOrPolicyGroupCount": 11,
  "runtimePlanRequiredGroupCount": 12
}
```

分解：A 组 11 件中只有 `2051`、`3004`、`3036`、`6665` 已录入并完成 Wasm DPS proof；A 组剩余 7 件已闭环为排除或阻塞；B 组 12 件仍不是当前可直接导入的 ready seed，其中 `3082` 的通用 runtime 切片已完成，但真实装备 seed/发布闭环未做。

# V2 BatchV-A Wiki 装备数据策略 Seed 测试记录 2026-06-20

## 范围

本记录承接 `V2-BatchV-剩余ADC坦克装备分组与运行能力方案-2026-06-20.md` 的 A 组近期执行项，只验证从 Wiki/review 结果整理出的数据/策略层 seed 是否结构完整、是否匹配当前 TinyGo V2 通用 bucket 能力。

本轮不做 DB 导入、不发布 bundle、不启动 Web 页面 smoke、不修改 Wasm runtime。

## 输入

```text
C:\project\damage_wasm_dev\数据参考\lol-wiki-current-items\current-items.reviewed-tank-adc.remaining-23.grouping.json
C:\project\damage_wasm_dev\最小验证\V2-BatchV-A-data-policy-items.seed.json
C:\project\damage_wasm_dev\最小验证\V2-BatchV-A-coefficient-buckets.json
```

## 录入结论

状态：pass（按本轮收窄范围：4 件完成导入/发布/Wasm DPS 闭环，剩余 A 组 7 件完成排除或阻塞处置 proof）。

A 组近期只录入 4 件数据/策略候选，不把 11 件全部强行转成 ready seed。

| itemId | 装备 | 本轮 seed 状态 | 策略口径 |
| --- | --- | --- | --- |
| `2051` | Guardian's Horn | 已建 item-owned skillRef | `flat_post_percent`，普通基础普攻承伤固定 `-15`；DoT `3.75` 分支只记录不模拟。 |
| `3004` | Manamune | 已建 item-owned skillRef | `ad_flat_bonus`，读取 attacker resolved `mana`，按 `2% maximum mana -> bonus AD`。 |
| `3036` | Lord Dominik's Regards | 已建 item-owned skillRef | `outgoing_damage_amp`，读取显式 `target_bonus_health`，`0..15%` clamp。 |
| `6665` | Jak'Sho, The Protean | 已建 item-owned skillRef | 受控满层策略，读取 target `bonus_armor` / `bonus_magic_resist`，各按 `30%` 加回最终抗性。 |

继续排除或后续处理的 A 组项保持原分组文档判断：`1083`、`2512`、`3033`、`3123`、`8020` 当前无 single-attacker basic DPS 价值；`2523` 需要 source/policy resolution；`3083` 等 bonus health 聚合政策。

## 结构校验

命令：

```powershell
cd C:\project\damage_wasm_dev
@'
const fs=require('fs');
const files = [
  '\u6700\u5c0f\u9a8c\u8bc1/V2-BatchV-A-data-policy-items.seed.json',
  '\u6700\u5c0f\u9a8c\u8bc1/V2-BatchV-A-coefficient-buckets.json',
  '\u6570\u636e\u53c2\u8003/lol-wiki-current-items/current-items.reviewed-tank-adc.remaining-23.grouping.json'
];
for (const file of files) JSON.parse(fs.readFileSync(file, 'utf8'));
const seed=JSON.parse(fs.readFileSync(files[0],'utf8'));
const buckets=JSON.parse(fs.readFileSync(files[1],'utf8'));
const refs=new Set(); const valueAttrs=new Set(); const skillIds=new Set(seed.skills.map(s=>s.skillId));
for (const skill of seed.skills) for (const passive of skill.mechanicsConfig.dpsPassiveEffects) for (const op of passive.operations) { if (op.bucketKey) refs.add(op.bucketKey); if (op.valueSpec?.attrKey) valueAttrs.add(op.valueSpec.attrKey); }
const bucketDefs=new Set(buckets.coefficientBuckets.map(b=>b.bucketKey));
const attrDefs=new Set(seed.attributeDefinitions.map(a=>a.attrKey));
const missingBuckets=[...refs].filter(k=>!bucketDefs.has(k));
const missingValueAttrs=[...valueAttrs].filter(k=>!attrDefs.has(k));
const missingTargetAttrs=buckets.coefficientBuckets.map(b=>b.targetAttrKey).filter(Boolean).filter(k=>!attrDefs.has(k));
const missingSkillRefs=[];
for (const item of seed.items) for (const ref of item.skillRefs) if (!skillIds.has(ref)) missingSkillRefs.push(item.itemId + ':' + ref);
console.log(JSON.stringify({ok: missingBuckets.length===0 && missingValueAttrs.length===0 && missingTargetAttrs.length===0 && missingSkillRefs.length===0, files: files.length, skills: seed.skills.length, items: seed.items.length, buckets: buckets.coefficientBuckets.length, missingBuckets, missingValueAttrs, missingTargetAttrs, missingSkillRefs}, null, 2));
if (missingBuckets.length || missingValueAttrs.length || missingTargetAttrs.length || missingSkillRefs.length) process.exitCode=1;
'@ | node -
```

结果：

```json
{
  "ok": true,
  "files": 3,
  "skills": 4,
  "items": 4,
  "buckets": 5,
  "missingBuckets": [],
  "missingValueAttrs": [],
  "missingTargetAttrs": [],
  "missingSkillRefs": []
}
```

## Runtime 依赖回归

命令：

```powershell
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go test -count=1 ./internal/runtime -run "TestSingleAttackerDPS(HPChangeSameBucketAdditivePercent|TargetArmorAttributeBucketAffectsMitigation|BucketKeyStatModifierWithoutAttrKeyResolvesTargetAttr|HPChangeHPDiffRatioValueSpec|HPChangeFormulaValueSpecUsesAttackerAttributeFormula|CoefficientModifierDrivesHPChangeBucket|CoefficientModifierDrivesAttributeBucket|CoefficientBucketEvidenceIncludesEvidenceKey)$"
```

结果：

```text
ok  	tinygo_engine_v2/internal/runtime	0.342s
```

## 剩余验证

1. DB/Admin 导入与发布闭环已由补充 proof 覆盖：当前 published bundle 为 `v2_batch_v_a_data_policy_items_001`，且包含本轮 4 件 item-owned skills 与所需 coefficient buckets。
2. Wasm DPS ABI proof 已覆盖 4 条受控曲线：Guardian's Horn 减伤、Manamune AD、Lord Dominik's 增伤、Jak'Sho target 抗性。
3. Web 页面 smoke 未在本记录中执行；`target_bonus_health`、`bonus_armor`、`bonus_magic_resist`、`mana` 的受控输入来源仍必须由 Web/适配层显式给定，不由 Wasm runtime 猜测。
4. 剩余 A 组 7 件已通过 disposition proof 收口为排除或策略阻塞，不继续导入 ready seed。
