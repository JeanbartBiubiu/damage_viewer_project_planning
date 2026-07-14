TASK_KEY: wasm-generic-draven-spinning-axe
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-14

# 通用 ABI - 德莱文 Q 旋转飞斧（Spinning Axe）rank5 初斧机制详细设计

关联验证记录：[通用 ABI 德莱文 Q 旋转飞斧 Spinning Axe 机制验证记录](../../测试记录/wasm/通用ABI-德莱文Q旋转飞斧SpinningAxe机制验证记录-2026-07-14.md)。本任务只迁移 G8 精确候选中的 Draven Q / Spinning Axe **rank5 初斧**合同；G8 分类为 `partial`，不得标为 fully migrated。

## 1. 数据合同

| 环节 | 合同 |
| --- | --- |
| scope | 仅 rank5 初斧；英雄 baseline level1：hp675 / mana361 / ad62 / AS0.679 / armor29 / MR30 / hpregen3.75 / manaregen8.05；`statsByLevel` 完整，AD growth 3.6 |
| arm | Q cast 的 `event/ability_started` + `event/source_owner` 武装 timed `spinning_axe_ready` |
| state | `spinning_axe_ready`：max1、5800ms、`refresh_on_write` |
| damage | 首次 source-owner `basic_attack_hit` 触发 physical，`raw = 60 + 1.15 * (resolvedAD - baseAD)`，`copyable_on_hit=false`，随后 consume ready |
| cross-check | AD162 / base62、目标 armor100 → raw175、mitigated87.5 |

不新增 runtime、DDL、Wasm ABI/DTO 或生产发布流程；只复用既有 provider state、ability_started 武装、basic_attack_hit consume 与 physical/armor 结算管线。

## 2. 写入边界

- Backend：仅幂等 seed / 静态 SQL 合同与 `LolGenericDravenSpinningAxeSeedSqlTest`；禁止 destructive SQL、DDL、live migration、Admin publish。
- Wasm：仅 generic provider/listener/state/damage 表达与回归；禁止扩 ABI/DTO/production runtime。
- Web：仅 combat-data assembler 投影；禁止专用前端分支或 live E2E 宣称。
- Planning：仅本详细设计、验证记录与 `task_rules.json` 映射；sqlite 只由 CLI rebuild 生成。

## 3. 非目标

- 接斧 catch rearm、双斧 dual-axe cap。
- 45 mana 消耗、8s 冷却。
- 其它 rank 数值、落地位移 landing movement。
- W / E / R 主动技能。
- live migration、Admin publish、浏览器对 live backend 的 E2E。
- 把初斧 partial 误计为完整旋转飞斧闭环，或宣称 G8 全量 goal 完成。

## 4. 跨模块边界

| Worktree | 职责 | 不越界 |
| --- | --- | --- |
| Backend `b948aef` | seed + SQL 合同；英雄 baseline / rank5 初斧数据 | 不跑 migration/publish |
| Wasm `121b339` | Q cast arm、timed ready、首次 hit physical consume；G8 将该候选标 `partial`（`sourceWorktree=wasm` + 本 task key） | 不实现接斧/双斧/CD/mana |
| Web `b36e48d` | assembler 投影 source-only Spinning Axe 合同 | 不实现游戏侧接斧 UI/位移 |
| Planning | 治理映射与可审计文档；互相链接验证证据 | 不改 Backend/Wasm/Web 代码 |
