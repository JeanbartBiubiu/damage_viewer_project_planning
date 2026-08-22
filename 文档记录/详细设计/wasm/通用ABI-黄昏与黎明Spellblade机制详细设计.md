TASK_KEY: wasm-generic-dusk-and-dawn-spellblade
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-21

# 通用 ABI - 黄昏与黎明 Spellblade（item_2510）机制详细设计

关联验证记录：[通用 ABI 黄昏与黎明 Spellblade 机制验证记录](../../测试记录/wasm/最小验证剩余阻塞项汇总-2026-07-19.md)。本任务将精确候选 `item_passive|2510|item_passive|咒刃` 标为 `completed/full/generic_runtime`（G8 `migrated`）；不再保留治疗或延迟 on-hit 的 `remainingGap`。

## 1. Exact candidate completed 声明

| 环节 | 合同 |
| --- | --- |
| stable key | `item_passive\|2510\|item_passive\|咒刃` |
| Wiki | current item 2510；manifest revid `4030984`；SHA `e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d` |
| ready | 施放技能后武装 10s `spellblade_ready` |
| damage | 强化普攻附加魔法 `0.75 * base AD + 0.10 * resolved AP`；`copyable_on_hit=false` |
| heal | 强化命中一次自身治疗 `0.10 * AP + 0.03 * bonus HP` |
| delayed repeat | 强化命中后 +200ms 一次 canonical copyable-on-hit replay |
| ICD | 1.5s `spellblade_icd` 自强化命中起算 |
| gate | damage / heal / repeat / ICD / ready 五步共用同一 ready gate；未武装命中不跑 heal/repeat |
| recursion | 自身 Spellblade 伤害 non-copyable；无递归重复/治疗/状态突变 |

## 2. 通用 ABI：`repeatDelayMs`

| 项 | 合同 |
| --- | --- |
| 字段 | 可选非负整数毫秒 `repeatDelayMs` |
| 兼容 | 省略或 `0`：即时 phantom replay，行为与旧合同完全一致 |
| 调度 | `>0` 时在 ability attempts 之后、samples 之前登记；到点派发 `GenericEventTriggeredContinuation` |
| provenance | run-local 冻结合格 on-hit provenance；continuation 独立 command 计数，不继承原 hit collector 余额 |
| 校验 | 负值失败；非 `repeat` 操作上的非零值失败 |

## 3. Backend / Web / item 操作顺序

| 层 | 合同 |
| --- | --- |
| Backend schema/log | `delay_ms` + 兼容迁移；mapper/service/API 默认 `0` |
| item_2510 seed 顺序 | 严格 `damage → heal → repeat(+200ms) → ICD arm → ready consume` |
| Backend 测试 | `LolGenericDuskAndDawnSpellbladeSeedSqlTest`（JUnit） |
| Web | `delayMs>0` → `repeatDelayMs`；省略/`0` 保持 legacy 无该字段；admin 非负整数、空白默认 `0` |
| 发布边界 | **不**执行 live migration / Admin publish |

所有写入使用幂等 upsert；不写未支持的 boolean AST `and/or/not`，不执行 `DELETE`、`DROP`、`CASCADE`、自动 publish 或 legacy 写入。

## 4. Runtime 证据边界

独立 provider 仅 mount 到 `item_2510`。既有 Generic Formula、provider-state expiry、source-owner listener、ordered operations、事件属性快照及 phantom exclusion 与新增 `repeatDelayMs` 共同表达完整合同。

Wasm 交叉验证取 `baseAD=100`、`AP=100`：raw 魔法=85；`magic_resist=100` 时=42.5。另须证明 heal 一次、+200ms copyable replay、未武装跳过 heal/repeat、arm gate、ICD/ready expiry、event-entry snapshot 及 `copyable_on_hit=false` phantom 隔离。

## 5. 非目标

- 多 Spellblade unique-group、完整 rotation、live migration、Admin publish 与浏览器对 live backend 的 E2E。
- 不把已闭环的 heal / +200ms repeat 再标为 gap 或 partial。

## 6. 验收

- Backend 幂等 seed/静态 SQL 合同与 Maven 通过；无 live migration/publish。
- TinyGo 精确数值、heal/delayed repeat、state lifecycle、snapshot/phantom 回归与全量运行验证通过。
- Web lint/typecheck/Vitest/build/`test:wasm-generic` 通过；`delayMs`→`repeatDelayMs` 投影与 admin 非负整数默认 0。
- G8 将 2510 精确标记为 `migrated` 且 `remainingGap` 为空；Unified 为 `completed/full/generic_runtime`。
- task governance rebuild/query 可解析两份文档。
