TASK_KEY: wasm-generic-twitch-deadly-venom
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: cursor-agent
LAST_TRACKED_AT: 2026-07-21

# 通用 ABI - 图奇 P 死亡毒液（Deadly Venom）机制详细设计

关联验证记录：[通用 ABI 图奇 P 死亡毒液 Deadly Venom 机制验证记录](../../测试记录/wasm/最小验证剩余阻塞项汇总-2026-07-19.md)。本任务将精确候选 `hero_skill|hero_twitch|P|死亡毒液` 标为 `completed/full/generic_runtime`（G8 `migrated`）；关闭此前 `blocked_runtime` / `missing_poison_dot_stack_runtime`。**不**宣称完整游戏技能保真。冻结方案：`PLAN_REV twitch-deadly-venom-anchored-tick-v3`。

## 1. Exact candidate completed 声明

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_twitch\|P\|死亡毒液` |
| Wiki | `数据参考/lol-wiki-current-champions/normalized/generic/twitch-p.json`；revision `4013286`；contentSha256 `1567c0efec7f9e9021f6dc02410f92262dfa30128acc457c531199dbc9121b44`（G8/Unified 一致；**不以**首轮文档截断 hash 为准） |
| status | `completed/full/generic_runtime`；G8 `migrated` |
| 叠层 | max 6；duration 6000ms；`refresh_on_write`；普攻命中 `event/basic_attack_hit` 且 source-owner 时 `add 1` |
| tick | 每秒一次真实伤害；`(flat + 0.03 * AP.resolved) * stacks`；true damage 跳过护甲/魔抗 |
| flat by level | 1–4→1；5–8→2；9–12→3；13–16→4；17–18→5（锚点档位 1/5/9/13/17+） |
| 原语 | generic target-state-anchored provider tick：`TickSpec.anchorScope` + `anchorStateKey`；DB `tick_anchor_scope_type_id` + `tick_anchor_state_key` |
| 发布边界 | **不**执行 live migration / Admin publish / push |

## 2. Anchored tick 生命周期合同

| 规则 | 语义 |
| --- | --- |
| 配对字段 | Web `anchorScope` / `anchorStateKey`；DB 可空成对 `tick_anchor_*`（同 NULL 或同非空；半对拒绝） |
| 当前 scope | `state_scope/provider_target`；状态键 `deadly_venom_stacks` |
| 校验顺序 | 锚定配对校验在 start-delay 默认化**之前**；锚定模式下 `startDelayMs` 省略或 0，**不**默认成 `intervalMs` |
| 启动 | 不在 mount/seed 时启动；首次合格 `provider_target` 写入启动生命周期 |
| 刷新 | 触顶钳制后的 refresh 重启 cadence（新 generation） |
| 调度 | `GenericCategoryAnchoredTick` 在 expire cleanup **之前**；活跃操作使用 `bag.targetKey` |
| inclusive-at-expiry | 仅在公式/pipeline 求值窗口内保持可见；**不**改全局 expiry 语义 |

## 3. 端到端数据流

```text
Backend provider_lifecycles tick_anchor_*
  → Web TickSpec.anchorScope / anchorStateKey
  → Wasm CompileGeneric 配对校验
  → 普攻 hit → stacks write → schedule anchored ticks
  → 每秒 true damage onTick
```

| 层 | 合同 |
| --- | --- |
| Backend | 幂等 seed `lol_generic_twitch_deadly_venom_seed.sql`；lifecycle `tick_interval_ms=1000` / `start_delay_ms=0` / anchor→`provider_target`+`deadly_venom_stacks` |
| Web | 投影可空成对 tick-anchor 字段到 TickSpec；无英雄专用 special case |
| Wasm | 既有 generic ABI + anchored provider tick；CompileGeneric → RunGeneric |

## 4. 证据锚点

| Worktree / 阶段 | Commit |
| --- | --- |
| Wasm primitive | `8612d0d` feat(wasm): add anchored provider ticks |
| Exact Twitch Wasm | `7cb8b1d` test(wasm): cover twitch deadly venom |
| Backend owning | `e18c3ef` feat(backend): add anchored tick lifecycle |
| Backend 集成 | `92e100e` feat(backend): add anchored tick lifecycle |
| Web owning | `61b93bf` feat(web): project anchored tick lifecycles |
| Web 集成 | `5a0931a` feat(web): integrate anchored tick lifecycles |
| G8/Unified 审计 | `8e5ba82` chore(audit): mark twitch deadly venom completed |

## 5. 非目标 / 排除（非 remainingGap / 非 blocker）

- 非普攻来源上毒
- 英雄 vs 野怪等超出冻结 1v1 候选的特例
- E / Contaminate 交互
- 多目标 / Expunge / 净化 / 免疫
- live migration、Admin publish、E2E、完整游戏模拟保真
