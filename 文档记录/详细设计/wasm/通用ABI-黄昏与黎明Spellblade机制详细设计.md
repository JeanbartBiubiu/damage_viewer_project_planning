TASK_KEY: wasm-generic-dusk-and-dawn-spellblade
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: partial
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-14

# 通用 ABI - 黄昏与黎明 Spellblade（item_2510）机制详细设计

关联验证记录：[通用 ABI 黄昏与黎明 Spellblade 机制验证记录](../../测试记录/wasm/通用ABI-黄昏与黎明Spellblade机制验证记录-2026-07-14.md)。本任务是精确主伤害的 `partial` 迁移：G8 候选 `item_passive|2510|item_passive|咒刃` 不得标为 fully migrated。

## 1. 目标与近似边界

数值真源为 `C:\project\damage_wasm_dev\数据参考\lol-wiki-current-items\current-items.normalized.json` 的 current item 2510。施放技能后，下一次基础攻击在 10 秒内造成 `0.75 * base AD + 0.10 * resolved AP` 额外魔法伤害，强化攻击命中后开始 1.5 秒冷却。

本轮**精确实现**该主目标伤害、ready 与 ICD。原效果中的治疗 `0.10 * AP + 0.03 * bonus HP` 及 0.2 秒后将攻击特效再施加一次都不在当前数据合同内：前者不是 1v1 主目标伤害，后者需要通用的延迟/延后 repeat 语义。二者均保留为 `remainingGap`，因此最终审计分类为 `partial`。

## 2. 数据合同

| 环节 | 合同 |
| --- | --- |
| provider | 独立 provider，仅 mount 到 `item_2510` |
| states | `spellblade_ready`：10,000ms；`spellblade_icd`：1,500ms |
| arm | `event/ability_started` + `event/source_owner`，`mul(eq(ready,0), eq(icd,0))` 数值 gate |
| damage | `damage/magic`，`0.75 * event.entry_source.attr.ad.base + 0.10 * event.entry_source.attr.ap.resolved`，`copyable_on_hit=false` |
| consume order | `basic_attack_hit` 上严格 damage → arm ICD → consume ready |

所有写入使用幂等 upsert；不写未支持的 boolean AST `and/or/not`，不执行 `DELETE`、`DROP`、`CASCADE`、自动 publish 或 legacy 写入。

## 3. Runtime 与 Web

不增加 Wasm ABI、DTO 或 production runtime 分支。既有 Generic Formula、provider-state expiry、source-owner listener、ordered operations、事件属性快照及 phantom exclusion 可精确表达主伤害合同。

Wasm 交叉验证取 `baseAD=100`、`AP=100`，raw=85；`magic_resist=100` 时=42.5。还须证明 arm gate、ICD/ready expiry、event-entry snapshot 及 `copyable_on_hit=false` phantom 隔离。

Web 只投影 source equipment 的 namespaced states、numeric gate、exact formula、listener 与 ordered operations。不得实现治疗、bonus-health read、延迟 repeat 或专用前端分支。

## 4. 非目标

- 治疗和 0.2 秒 delayed second on-hit application；它们是 partial gap，不是被静默丢弃的已实现效果。
- 多 Spellblade unique-group、完整 rotation、live migration、Admin publish 与浏览器对 live backend 的 E2E。

## 5. 验收

- Backend 幂等 seed/静态 SQL 合同和 Maven 通过。
- TinyGo 精确数值、state lifecycle、snapshot/phantom 回归和全量运行验证通过。
- Web lint/typecheck/Vitest/build 通过。
- G8 generator 将 2510 精确标记为 `partial` 并写入 health/heal/delay remaining gap；JSON/CSV、Planning task 和 Backend seed 一致。
- task governance rebuild/query 可解析两份文档。
