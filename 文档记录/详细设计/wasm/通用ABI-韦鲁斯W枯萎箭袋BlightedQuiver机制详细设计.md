TASK_KEY: wasm-generic-varus-blighted-quiver
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: cursor-agent
LAST_TRACKED_AT: 2026-07-21

# 通用 ABI - 韦鲁斯 W 枯萎箭袋（Blighted Quiver）机制详细设计

关联验证记录：[通用 ABI 韦鲁斯 W 枯萎箭袋 Blighted Quiver 机制验证记录](../../测试记录/wasm/通用ABI-韦鲁斯W枯萎箭袋BlightedQuiver机制验证记录-2026-07-21.md)。本任务将精确候选 `hero_skill|hero_varus|W|枯萎箭袋` 标为 `completed/full/generic_runtime`（G8 `migrated`）；关闭此前 `blocked_runtime` / `missing_blight_stack_consume_and_active_cast_runtime`。**不**宣称真实 Varus Q key 完成或完整游戏技能保真。冻结方案：`FROZEN_PLAN_REV varus-w-blighted-quiver-phase-a-v2`（DESIGN_REVIEW v1 REVISE `run-8f9a302a-2d3f-4c13-843b-c894fded476e`；v2 READY `run-c24dbdbc-19d3-41e3-9a26-34dd66d41ce2`）。

## 1. Exact candidate completed 声明

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_varus\|W\|枯萎箭袋` |
| Wiki | `数据参考/lol-wiki-current-champions/normalized/generic/varus-w.json`；pageId `1309980`；revision `4026472`；timestamp `2026-06-09`；contentSha256 `16307174c4039d8ce71e639396328b2473f4a7e16247a7b2f8a183599b0901d2`；sourceCount **仍为 12**（无新源） |
| status | `completed/full/generic_runtime`；G8 `migrated` |
| completedBoundary | `fixed_max_charge_primary_target; q_carrier_ordering_scaffold_only; q_physical_then_w_active_post_q_pre_blight_then_blight_detonation; rank5; no_equipment_interop` |
| Rank-5 被动 | on-hit magic `40 + 0.15*bonusAD + 0.25*AP`，随后目标 Blight `+=1`（max3 / 6000ms / `refresh_on_write`） |
| W active | provider 态 `blighted_quiver_active` max1 / 5500ms |
| W-scoped Q ordering scaffold | 仅主目标、固定满充能 carrier（scaffold only）：物理 `360 + 1.20*bonusAD` → W active magic `21%` missing HP（post-Q / pre-Blight）→ Blight 每层 maxHP `(5% + 1.3% per 100 AP) * 1.5`（满充能倍率）→ conditional blight/active reset |
| 发布边界 | **不**执行 live migration / Admin publish / push |

## 2. 生命周期与排序合同

| 规则 | 语义 |
| --- | --- |
| 被动 on-hit | 普攻命中后先结算 Rank-5 被动魔法伤害，再写入目标 Blight 层 |
| Blight 态 | max3；duration 6000ms；`refresh_on_write` |
| W active | cast 武装 provider 态 max1 / 5500ms |
| Q carrier | **仅** W-scoped ordering scaffold；**不**完成真实 `hero_skill\|hero_varus\|Q\|穿刺之箭` |
| 顺序 | Q physical → W active missing-HP（post-Q / pre-Blight）→ Blight detonation（满充能 ×1.5）→ conditional resets |

## 3. 端到端数据流

```text
Wiki varus-w.json (page1309980/rev4026472)
  → Backend seed lol_generic_varus_blighted_quiver_seed.sql
  → Web 既有 generic 投影（无本机制 Web 变更）
  → Wasm CompileGeneric → RunGeneric
  → passive on-hit magic + Blight write
  → W active arm → W-scoped max-charge Q ordering scaffold
```

| 层 | 合同 |
| --- | --- |
| Backend | 幂等 seed；owning `ca8809d` / 集成 `5b2a18e`；focused 41/41；full 641/641 |
| Web | 既有 generic 投影；owning/integrated lint/typecheck/test/build/generic PASS；**无**本任务 Web 代码变更 |
| Wasm | exact `d6f2ea5`（`generic_varus_blighted_quiver_test.go`）；CompileGeneric → RunGeneric |

## 4. 证据锚点

| Worktree / 阶段 | Commit / Run |
| --- | --- |
| Backend owning | `ca8809d` |
| Backend 集成 | `5b2a18e` |
| Wasm exact | `d6f2ea5` |
| Wasm 完成修复/审计（执行溯源） | `run-5d9a46d8-9ffe-4959-a91e-bd2ec964090a`（首轮 Cursor TLS 中断后的完成轮；runDelta1/845 parseable/无 truncation；仅 exact test 路径） |
| G8/Unified 审计实现 | `run-ae4a525a-9fe7-4bdb-9c02-0cf228216197`；commit `85910fb`；six paths / runDelta6 / outside0；1067 parseable / 无 truncation |
| DESIGN_REVIEW v1 | REVISE `run-8f9a302a-2d3f-4c13-843b-c894fded476e` |
| DESIGN_REVIEW v2 | READY `run-c24dbdbc-19d3-41e3-9a26-34dd66d41ce2`（valid read-only；audit runDelta0 / 1726 parseable / 无 mutation） |

## 5. 非目标 / 排除（非 remainingGap / 非 blocker）

- ranks 1–4
- 可变 Q 充能
- W cooldown / recast / death / CC
- Q resource / channel / projectile / multi-target
- Blight cooldown refund
- 其他技能消费者
- monster caps
- shield / blind / block / dodge
- Spellblade suppression
- Guinsoo / phantom / equipment interop
- live migration、Admin publish、E2E、完整游戏模拟保真
- **明确**：本闭环**不**完成真实 Varus Q key
