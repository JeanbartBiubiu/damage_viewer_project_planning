TASK_KEY: wasm-generic-statikk-shiv-energized
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-14

# 通用 ABI - 斯塔缇克电刃 Energized（item_3087）机制详细设计

关联验证记录：[通用 ABI 斯塔缇克电刃 Energized 机制验证记录](../../测试记录/wasm/通用ABI-斯塔缇克电刃Energized机制验证记录-2026-07-14.md)。本项只迁移 G8 精确候选 `item_passive|3087|item_passive|电疗`；`item_passive|3087|item_passive|电火花` 的次级弹射继续保持 `out_of_scope`。

## 1. 目标与数据边界

数值真源为 `C:\project\damage_wasm_dev\数据参考\lol-wiki-current-items\current-items.normalized.json` 的 current item 3087：基础攻击总共生成 15 层 Energize（其中本装备额外提供 9 层），上限为 100；满层后的下一次基础攻击对英雄主目标造成 60 额外魔法伤害。

本项精确覆盖单目标 60 魔法伤害与按普攻累计的充能循环。90 非英雄伤害、500 单位弹射、次级目标 on-hit、移动/距离充能、slow 与 Energized 共享池都不在 1v1 主目标范围内。

## 2. 数据合同

Backend 新增独立的 3087 provider，不改变已完成的 item_3094 provider：

| 环节 | 合同 |
| --- | --- |
| provider | 仅 mount 到 `item_3087` |
| state | `energized_charge`，default=0、max=100、无 duration |
| listener | `event/basic_attack_hit` + `event/source_owner` 的 ALL matcher |
| ready | `gte(provider.state.energized_charge, 100)` |
| ordered operations | ready 时 `damage/magic=60`（`copyable_on_hit=false`）→ ready 时 override charge=0 → 无条件 add charge=15 |

从零层开始，前 7 次普攻只充能并在第 7 次 clamp 到 100；第 8 次命中触发 60 伤害，消费后无条件回充为 15。seed 采用幂等 upsert，不执行 `DELETE`、`DROP`、`CASCADE`、自动 publish 或 legacy 写入。

## 3. Runtime 与 Web

不增加 Wasm ABI、DTO 或 production runtime 分支。既有 Generic provider state、capped add、condition、ordered listener operations、物理/魔法结算和 phantom 排除已能表示该合同。

Wasm 必须交叉验证 raw=60、`magic_resist=100` 时 magic result=30、7-hit charge clamp、第 8-hit damage→consume→add 的 15 层终态，以及 `copyable_on_hit=false` 下 Guinsoo phantom 不触发、不消费也不充能。

Web 只通过 `combatDataAssembler` 的既有结构化投影：source loadout 投影 3087 provider/state/listener/three operations；target loadout 不挂载该 provider。不得制造专用 Web 分支或虚构移动/弹射效果。

## 4. 非目标

- 不实现移动/距离充能、90 非英雄数值、弹射/次级 on-hit、slow 或共享 Energized 池。
- 不改变 3094 既有迁移，不将多个装备合并为“代表机制”。
- 不执行 live migration、Admin publish 或浏览器对 live backend 的 E2E。

## 5. 验收

- Backend 幂等 seed、静态 SQL 契约和 Maven 通过。
- TinyGo 3087 精确数值与 charge-cycle/phantom 回归通过，随后执行全量 test、bench、Wasm build 与 Node smoke。
- Web lint、typecheck、Vitest、build 通过。
- G8 generator 精确迁移 `电疗`，而 `电火花` 保持 out-of-scope；JSON/CSV、Planning task 和 Backend seed 证据一致。
- task governance rebuild/query 能解析本设计与验证记录。
