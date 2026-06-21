TASK_KEY: planning-validation-milestones
DOC_TYPE: 测试记录
WORKSTREAM: planning
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-06-06

# V2 Batch O 单攻击方 DPS 事件化联动机制测试记录 2026-06-06

关联计划：[V2-BatchO-单攻击方DPS事件化联动机制计划.md](../../详细设计/最小验证/V2-BatchO-单攻击方DPS事件化联动机制计划.md)

结论：
1. `O-contract-pass`：已固定 DPS passive 的 ownerRole、priority、trigger/matcher、targetRole、damage_modifier 和 event context 兼容契约。
2. `O-runtime-compat-pass`：旧 ADC attacker-side on-hit、every-N、stack、energized、phantom-hit 行为保持，通过 targeted/all Go tests 与 bench。
3. `O-target-side-pass`：target-owned `on_damage_taken` retaliation、attacker-owned `on_damage_dealt` target armor shred synthetic proof 通过。
4. `O-modifier-spell-pass`：incoming `damage_modifier` synthetic proof、`critOnly` 缺少 crit context blocked、synthetic `on_spell_hit` dispatch proof 通过。
5. 本批未做真实兰顿/卢登/反甲/黑切 seed、Web/Backend 接入、wasm artifact 构建或 live publish。

## 1. 改动范围

Wasm：
1. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\model\types.go`
2. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver.go`
3. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver_test.go`

Planning：
1. `C:\project\damage_wasm_dev\文档记录\详细设计\最小验证\V2-BatchO-单攻击方DPS事件化联动机制计划.md`
2. 本测试记录。
3. `C:\project\damage_wasm_dev\db\task_doc_governance\task_rules.json`

## 2. 命令级验证矩阵

| Worktree | 命令 | 结果 |
| --- | --- | --- |
| Wasm | `go test ./internal/runtime -run "DamageModifier\|SpellHit\|LinkedEffect\|Phantom\|OwnerRole\|TargetOwned\|Retaliation\|ArmorShred\|SingleAttackerDPS\|Canonical\|Energized\|Charge" -count=1` | 通过，`ok tinygo_engine_v2/internal/runtime 0.517s` |
| Wasm | `go test ./...` | 通过 |
| Wasm | `go run ./cmd/bench` | 通过，`samples=100 avg_us=427.83 max_us=6885.00` |
| Planning | `node tools/task-governance/cli.mjs rebuild` | 通过，`unassigned_docs: 0` |
| Planning | `node tools/task-governance/cli.mjs docs planning-validation-milestones` | 通过，Batch O 计划与本测试记录均归属任务 |

未执行：
1. TinyGo build / Node smoke：本批未构建或同步 wasm artifact，避免在 runtime 机制验证阶段混入发布产物。
2. Backend / Web / live page：本批只做 Wasm synthetic mechanism proof，不做真实装备数据闭环。

## 3. Runtime 关键断言

O1 compatibility：
1. legacy on-hit passive 无需迁移 JSON 仍可触发。
2. `on_hit` 可匹配基础普攻 hit。
3. `on_spell_hit` 不会在基础普攻或 phantom 阶段误触发。
4. same priority 按 `resolvedSnapshot.passiveEffects` 原始顺序稳定执行。
5. lower priority 先执行。
6. phantom repeat 阶段也复用 priority + originalIndex 排序。

O2 target-side：
1. target-owned `on_damage_taken` passive 可记录 attacker retaliation evidence。
2. retaliation 不计入 target `TotalDamage` / `DamageBySource` / `TargetHPTimeline`。
3. retaliation 不递归触发新的 linked damage event。
4. attacker-owned physical `on_damage_dealt` 可给 target 添加 armor shred stack。
5. targetRole=target 的 `stat_modifier` 会刷新目标 armor/magicResist，并影响下一次物理伤害。
6. unsupported operation targetRole 被 blocked，避免未实现语义静默落到旧路径。

O3 modifier / spell proof：
1. target-owned incoming `damage_modifier` 在 `applyDamage` 前生效。
2. `damage_modifier` effectBreakdown 记录 `valuePhase=incoming raw=... modified=... value=...`。
3. pure `damage_modifier` passive 不在后置 `on_damage_taken` 阶段重复 trigger。
4. `critOnly=true` 在当前缺少 crit event context 时 blocked。
5. synthetic `on_spell_hit` context 可通过 matcher 触发 attacker-owned passive damage。
6. phantom-hit 不复制 spell proc。

## 4. 新增测试

| 测试 | 断言 |
| --- | --- |
| `TestSingleAttackerDPSLinkedEffectDispatcherKeepsLegacyOnHitPassives` | 旧 on-hit passive 兼容 |
| `TestSingleAttackerDPSLinkedEffectDispatcherKeepsEveryNAndStacks` | every-N 与 stack 兼容 |
| `TestSingleAttackerDPSLinkedEffectDispatcherKeepsPhantomHitCopyRules` | phantom-hit copyable 兼容 |
| `TestSingleAttackerDPSLinkedEffectPriorityStableByInputOrder` | priority 与输入顺序稳定 |
| `TestSingleAttackerDPSLinkedEffectOnHitEventTriggersOnBasicAttack` | `on_hit` 匹配基础普攻 |
| `TestSingleAttackerDPSLinkedEffectOnSpellHitDoesNotTriggerOnBasicAttack` | spell-hit 不误触发基础普攻 |
| `TestSingleAttackerDPSBlocksUnsupportedLinkedEffectTrigger` | unsupported event blocked |
| `TestSingleAttackerDPSTargetOwnedOnDamageTakenRetaliates` | target-owned retaliation evidence |
| `TestSingleAttackerDPSTargetOwnedRetaliationDoesNotRecurse` | retaliation 不递归 |
| `TestSingleAttackerDPSAttackerOwnedPhysicalDamageAddsTargetArmorShredStack` | physical damage 后添加 target armor shred stack |
| `TestSingleAttackerDPSTargetArmorShredAffectsNextPhysicalHit` | target armor shred 影响下一次伤害 |
| `TestSingleAttackerDPSBlocksInvalidOwnerRoleOrTargetRole` | ownerRole / targetRole 基础校验 |
| `TestSingleAttackerDPSPhantomHitRepeatPriorityStableByInputOrder` | phantom repeat priority 稳定 |
| `TestSingleAttackerDPSBlocksUnsupportedOperationTargetRole` | unsupported operation targetRole blocked |
| `TestSingleAttackerDPSIncomingDamageModifierAppliesBeforeTimeline` | incoming modifier 写 timeline 前生效 |
| `TestSingleAttackerDPSIncomingCritOnlyModifierRequiresCritContext` | critOnly 缺少 crit context blocked |
| `TestSingleAttackerDPSLinkedEffectCanDispatchSyntheticSpellHit` | synthetic spell-hit dispatcher proof |
| `TestSingleAttackerDPSPhantomHitDoesNotCopySpellProc` | phantom-hit 不复制 spell proc |

## 5. Cursor 执行记录

所有编码轮均通过 Cursor local agent 执行，模型固定 `composer-2.5` 且 `fast=false`。GPT/Codex 负责 review diff 和最终验证。

| 阶段 | Artifact | 状态 |
| --- | --- | --- |
| O1 runtime compat | `.agents/artifacts/cursor-batch-o-o1-runtime-001` | finished |
| O1 fix | `.agents/artifacts/cursor-batch-o-o1-runtime-fix-001` | finished |
| O2 target-side | `.agents/artifacts/cursor-batch-o-o2-target-side-001` | finished |
| O2 fix | `.agents/artifacts/cursor-batch-o-o2-target-side-fix-001` | finished |
| O3 damage modifier / spell | `.agents/artifacts/cursor-batch-o-o3-damage-modifier-spell-001` | error，留下 partial diff |
| O3 fix | `.agents/artifacts/cursor-batch-o-o3-damage-modifier-spell-fix-001` | finished |

## 6. 收口状态

| Gate | 状态 | 依据 |
| --- | --- | --- |
| `O-contract-pass` | 通过 | Batch O 计划、DTO/runtime 字段与 validation tests |
| `O-runtime-compat-pass` | 通过 | legacy linked-effect targeted tests 与 all Go tests |
| `O-target-side-pass` | 通过 | retaliation、armor shred、targetRole validation tests |
| `O-modifier-spell-pass` | 通过 | incoming damage_modifier、critOnly blocked、synthetic spell-hit tests |

## 7. 残余风险

1. `critOnly=true` 的真实兰顿语义还缺 crit event context；当前一律 blocked，不做 expected crit 近似。
2. incoming `damage_modifier` 当前只接基础普攻预伤害路径；DoT、phantom-hit、被动伤害等未接。
3. target retaliation 只记录 attacker damage evidence，不扣攻击者 HP，也不做攻击者抗性结算。
4. synthetic `on_spell_hit` 只证明 dispatcher，可接卢登类机制；真实技能命中用户流仍需后续显式技能事件或 rotation 边界。
5. 本批未做 Backend/Web seed、publish、页面导出 JSON 或 live current version 证明。
