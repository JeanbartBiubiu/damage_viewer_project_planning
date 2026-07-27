TASK_KEY: wasm-generic-malzahar-malefic-visions
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: cursor-agent
LAST_TRACKED_AT: 2026-07-21

# 通用 ABI - 玛尔扎哈 E 恶咒降临（Malefic Visions）机制详细设计

关联验证记录：[通用 ABI 玛尔扎哈 E 恶咒降临 Malefic Visions 机制验证记录](../../测试记录/wasm/通用ABI-玛尔扎哈E恶咒降临MaleficVisions机制验证记录-2026-07-21.md)。本任务将精确候选 `hero_skill|hero_malzahar|E|恶咒降临` 标为 `completed/full/generic_runtime`（Unified EXTRA，**非** G8）；关闭此前 `blocked_runtime` / `status_resource_dot_migration_runtime`（Batch-J 仅作 stale regression）。**不**宣称完整游戏技能保真。冻结方案：`FROZEN_PLAN_REV malzahar-e-anchored-dot-phase-a-v2`（DESIGN_REVIEW READY：`run-2570cf99-908e-4d13-83c1-eb265282cd34`）。

## 1. Exact candidate completed 声明

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_malzahar\|E\|恶咒降临` |
| Wiki sidecar | EXTRA-only `数据参考/lol-wiki-extra-mechanisms/normalized/generic/malzahar-e.json`；pageId `1308233`；revision `4015185`；timestamp `2026-05-03`；contentSha256 `9098ee2fbe7dfb33d1ca375bbce0c68788fd60378780aa4ddab8afc46736ba84`（upstream raw 2228；仓库落盘 raw 经 trailing-whitespace 序列化为 2226，上游身份仍为 2228/hash） |
| status | `completed/full/generic_runtime`；Unified EXTRA（不进入 G8 / 165 英雄 identity / registry） |
| Rank-5 资源 | mana 100；CD 7000ms |
| 施法 | 仅 active cast 覆盖目标态 `active=1` |
| 状态 | max1；duration 4000ms；`refresh_on_write` |
| 锚定 | `anchored` 250 / 0（`TickSpec` + DB `tick_anchor_*`） |
| tick | 16 次 inclusive 魔法伤害，t=250..4000；每跳 `13.75 + 0.05*AP`；合计 `220 + 0.80*AP` |
| 发布边界 | **不**执行 live migration / Admin publish / push |

## 2. Anchored DoT 生命周期合同

| 规则 | 语义 |
| --- | --- |
| 配对字段 | Web `anchorScope` / `anchorStateKey`；DB 可空成对 `tick_anchor_*` |
| 当前 scope | `state_scope/provider_target`；状态键承载 active 覆盖 |
| 启动 | active cast 写入目标态后启动锚定 cadence |
| 调度 | inclusive-at-expiry：16 跳落在 `[250, 4000]`；不改全局 expiry 语义 |
| Batch-J | `skill_malzahar_e` / status-migration seed 仅 historical / data_only_regression，**不是**当前完成依据 |

## 3. 端到端数据流

```text
EXTRA Wiki sidecar (provenance-only document_json)
  → Backend seed lol_generic_malzahar_malefic_visions_seed.sql
  → Web TickSpec.anchorScope / anchorStateKey（既有投影，无本机制 Web 变更）
  → Wasm CompileGeneric → RunGeneric
  → active cast → target active → 250ms×16 inclusive magic ticks
```

| 层 | 合同 |
| --- | --- |
| Backend | 幂等 seed；lifecycle anchored 250/0；owning `8444018` / 集成 `4351827` |
| Web | 既有锚定 tick 投影（owning `61b93bf` / 集成 `5a0931a`）；**无**本任务 Web 代码变更 |
| Wasm | anchored primitive `8612d0d` + exact `0e69db1`（`generic_malzahar_malefic_visions_test.go`） |

## 4. 证据锚点

| Worktree / 阶段 | Commit |
| --- | --- |
| Sidecar Wasm | `7159cd6` |
| Sidecar Backend cherry-pick | `d8649bd` |
| Backend owning | `8444018` feat(backend): seed malzahar malefic visions |
| Backend 集成 | `4351827` feat(backend): seed malzahar malefic visions |
| Wasm exact test | `0e69db1` test(wasm): cover malzahar malefic visions |
| Anchored primitive | `8612d0d` feat(wasm): add anchored provider ticks |
| Unified 审计 | `3e9a715` chore(audit): mark malzahar malefic visions completed |
| Web owning（既有） | `61b93bf` feat(web): project anchored tick lifecycles |
| Web 集成（既有） | `5a0931a` feat(web): integrate anchored tick lifecycles |

## 5. 非目标 / 排除（非 remainingGap / 非 blocker）

- Q / R refresh
- death spread / bounce / multitarget
- 2% mana restore / minion execute
- cleanse / immunity
- indirect / spell-effect 标签扩展
- ranks 1–4
- cast targeting / 几何选敌
- mid-duration AP snapshot mutation
- live migration、Admin publish、E2E、完整游戏模拟保真
