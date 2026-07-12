TASK_KEY: wasm-generic-min-validation-coverage-audit
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: active
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-13

# 通用 ABI 最小验证机制迁移与 G0-G9 覆盖审计详细设计

说明：历史 Batch G 只正式定义 G0-G4；以下 G5-G9 是 generic 迁移新定义，不是历史真源。

## Gate

| Gate | 内容 |
|------|------|
| G0 | 输入资产与旧审计基线冻结 |
| G1 | generic contract 表达能力分类 |
| G2 | Wasm synthetic runtime / canonical tests |
| G3 | Backend seed、引用、preflight、publish |
| G4 | Web provider mount 与 compile projection |
| G5 | 真实机制单项 compile / run / release |
| G6 | 精确数值与事件顺序证据 |
| G7 | 机制组合、隔离、防递归和回归 |
| G8 | 242 候选重新分类与覆盖率汇总 |
| G9 | 治理、artifact hash、live revision、浏览器或等价 live E2E 最终验收 |

## 基线

旧审计：242 candidates、33 heroes、53 items。

分类计数：ready 1、covered 13、runtime 37、manual 45、out-of-scope 146。

该分类基于 legacy `DPSPassiveEffectV2`，必须按 generic provider / listener / effect / ability 重跑。

新分类固定为：`migrated` / `partial` / `blocked` / `out_of_scope`。

## 顺序

公式 on-hit → 完整鬼索 H+K → spellblade → energized → execute → linked effects → crit/modifier。

## 公式 On-Hit 批次进度

对应任务：`wasm-generic-formula-onhit-batch`（已完成闭环，详见 [公式 On-Hit 验证记录-2026-07-13](../../../测试记录/wasm/通用ABI-公式OnHit机制批次验证记录-2026-07-13.md)）。

本批已提供证据：

| Gate | 本批证据 |
| --- | --- |
| G0–G7 | 有：六机制 Backend seed/静态与全量测试、live DB revision 12、Web/TinyGo 单件与组合 compile/run/release、精确数值与零抗复算、组合回归 |
| G9 | 有：治理产物 hash、published revision/version、Playwright live E2E |
| G8 | **未完成**：242 candidates 全量重分类与覆盖率汇总仍未执行 |

因此 `wasm-generic-min-validation-coverage-audit` 总体审计任务仍保持 **active / 开发中**，不得因本批完成而标记完成。

## 真源与验证

### Planning 旧 Batch G 真源

- [V2 Batch G ADC 被动覆盖审计与录入计划](../../最小验证/V2-BatchG-ADC被动覆盖审计与录入计划.md)
- [V2 Batch G ADC 被动覆盖清单](../../最小验证/V2-BatchG-ADC被动覆盖清单.md)
- [V2 Batch G ADC 被动覆盖录入测试记录](../../../测试记录/wasm/V2-BatchG-ADC被动覆盖录入-测试记录-2026-05-20.md)

### 外部最小验证资产

- `C:\project\damage_wasm_dev\最小验证`

### 每批证据要求

每批需同时具备：

- Wasm 证据
- Backend 证据
- Web 证据
- live DB 证据
- 治理证据

本文档不记录尚未发生的结果。
