TASK_KEY: wasm-generic-yun-tal-practice-makes-lethal
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-14

# 通用 ABI - 育恩塔尔荒野箭 熟能生巧（item_3032）机制详细设计

关联验证记录：[通用 ABI 育恩塔尔熟能生巧机制验证记录](../../测试记录/wasm/最小验证剩余阻塞项汇总-2026-07-19.md)。本任务只迁移 G8 精确候选 `item_passive|3032|item_passive|熟能生巧`，不把同装备的 `疾风骤雨` 一并标为完成。

## 1. 目标与边界

数值真源为 `C:\project\damage_wasm_dev\数据参考\lol-wiki-current-items\current-items.normalized.json` 的 current item 3032：基础攻击永久获得 0.4% 暴击率，最多 63 层，暴击率上限 25%。

本项以 source-owner `basic_attack_hit` 后的永久状态变化表达 on-attack 的后续属性效果；伤害结算已使用当次事件快照，新增层数只影响后续攻击。`疾风骤雨` 的 30% 攻速、6 秒效果、30 秒冷却及命中/暴击减冷却不属于本任务，继续 `blocked`。

## 2. 数据合同

| 环节 | 合同 |
| --- | --- |
| provider | 独立 provider，仅 mount 到 `item_3032` |
| state | `practice_crit_stacks`，default=0、max=63、无 duration |
| listener | `event/basic_attack_hit` + `event/source_owner`，对 state 执行 add 1 |
| modifier | `crit_chance` attribute modifier，value-policy `add`，`min(0.25, 0.004 * provider.state.practice_crit_stacks)` |

63 层按公式会超过 25%，所以 modifier 公式显式 `min(0.25, ...)`；不能以 63×0.004=0.252 误报为正确结果。seed 采用幂等 upsert，不执行 destructive SQL、publish 或 legacy 写入。

## 3. Runtime 与 Web

现有 Generic provider state、max cap、状态写入、dynamic attribute modifier 与 Formula `min/mul` 已可表达，不增加 Wasm ABI/DTO/production runtime。Wasm 必须验证 0 → 0.004、63 层 → 0.25、重复命中不越界，且 phantom 不额外叠层或影响 source modifier。

Web 只投影 source provider 的 state、listener 和动态 crit modifier；target 无此 provider。不得加入 Flurry 的攻速/cooldown 或随机 crit 分支。

## 4. 非目标

- `item_passive|3032|item_passive|疾风骤雨`：30% AS、6s/30s 和 hit/crit cooldown reduction。
- 新 `basic_attack_started` 事件、逐击随机 crit event、live migration、publish 或浏览器 live E2E。

## 5. 验收结果

- Backend seed/静态 SQL 合同与全量 Maven 测试通过。
- TinyGo 验证 initial 0、1 次命中为 0.004、63/64 次原始命中均为 0.25、target 隔离及 Guinsoo phantom 回归，并完成全量运行、构建和 smoke 验证。
- Web source-only projection 的 lint/typecheck/Vitest/build 通过。
- G8 只迁移 `熟能生巧`；`疾风骤雨` 保持 `blocked`。治理 rebuild/query 已可解析两份文档。
