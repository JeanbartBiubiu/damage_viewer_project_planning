TASK_KEY: wasm-generic-energized
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: active
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-13

# 通用 ABI — Energized（疾射火炮）机制详细设计

可直接编码的简洁详细设计。旧 Batch N / legacy DPS `energized_charge_and_consume` 仅作语义参考，**禁止复活** legacy DTO/bundle。实现以本文合同为准。

对应任务：`wasm-generic-energized`（feature：`generic_energized`）。覆盖审计总任务 `wasm-generic-min-validation-coverage-audit` 中 Energized 子批段应引用本文；**总体审计任务保持 active**，不得因本批完成而收口。

## 1. 目标

在通用 ABI / 通用引擎上落地 **疾射火炮（`item_3094`）** 单真实 gate 的简化 Energized 充能闭环，作为 ABI 时序与状态合同验证：

| 环节 | 合同摘要 |
|------|----------|
| 入口 | 每次**独立真实** `event/basic_attack_hit`（type_id **20211**）+ ALL `event/source_owner`（**20212**） |
| 状态 | `energized_charge`：初始 **0**，max **100**，**无时长** |
| 判定 | 用本刀 hit **前**快照：`charge >= 100` 则 ready |
| 触发 | ready → **40** `damage/magic`（**20221**，`copyable_on_hit=false`）→ **override** charge=0 |
| 充能 | 本刀末尾**无条件** add **25**（max clamp） |
| 样例 | 第 4 刀 75→100 **不触发**；第 5 刀触发，消费后变 **25** |

闭环：Wasm 合同测试 → Backend 幂等 seed → live 14/14→15/15 → Web 现有 generic 页真实 compile/run/release。

## 2. 非目标

1. 不模拟移动/距离充能、额外射程、多目标/弹射/减速、共享盈能池。
2. 不实现电刀（3087）/ 岚切（3097）/ 电震（6699）等其它 Energized 装备；不做唯一组冲突。
3. 不实现 execute / linked effects / crit / modifier / spellblade 扩展。
4. 不新增 type、DDL、API；不往 reserved 补种。
5. 不改 model / ABI / compile / formula，除非测试证明同 sequence 条件/状态顺序阻塞——若必需，**仅**允许触及 `generic_execution.go` 并先报告。
6. Web **预计无需** production adapter；不在页面本地算充能/伤害。
7. Seed **无 DELETE**、**不自动 publish**；仅 material change 才推 revision。
8. `provider_state_fields` **不写非 0 default_value**（初始 0）。
9. **禁止**复活 legacy DPS `triggerKind=energized_charge_and_consume` 路线。

## 3. 核心机制合同

### 3.1 唯一真实 gate

- 只做 **`item_3094` 疾射火炮** 一条简化闭环。
- 静态度（攻速/暴击等）已由 Batch C 存在则复用；本批只补 Energized provider 图。

### 3.2 单刀时序（编码真源）

每次**独立真实** `basic_attack_hit`：

```
hit 前快照 charge0 = provider.state.energized_charge
  → 若 charge0 >= 100：
       damage magic raw=40（copyable_on_hit=false）
       override energized_charge = 0
  → 无条件 add 25（clamp 到 max=100）
```

| 刀序 | hit 前 | 是否触发 | hit 后 |
|------|--------|----------|--------|
| 1 | 0 | 否 | 25 |
| 2 | 25 | 否 | 50 |
| 3 | 50 | 否 | 75 |
| 4 | 75 | **否**（75→100） | 100 |
| 5 | 100 | **是**（40 magic →0 →+25） | **25** |
| 6…8 | 25→50→75 | 否 | … |
| 9 | 100 | 是（第二轮） | 25 |

**关键：** 第 4 刀把充能推到阈值**本刀不触发**；第 5 刀才消费。消费后本刀仍 add25。

### 3.3 Provider state

| State key | max | duration | 语义 |
|-----------|-----|----------|------|
| `energized_charge` | **100** | **无**（不写 duration / 不 expire） | 盈能充能 |

- scope：`state_scope/provider`（type_id **20250**）。
- 读写：`value_policy/add`（20170）与 `value_policy/override`（20172）。
- 条件公式读 **hit 前快照**（或合同等价：同 sequence 内条件求值不得被本刀先前 step 的 override/add 污染判定口径以外的语义；本批 gated block 只用 hit 前值）。

### 3.4 Phantom 禁区

Guinsoo phantom（及任何非独立真实 `basic_attack_hit`）**不得**：

- add / override `energized_charge`
- 触发 40 magic
- 复制 Energized damage（`copyable_on_hit=false`）

组合回归：phantom 证据中 **不含** Energized `operationRef`；`finalSnapshot.providerState.energized_charge` 不被 phantom 推进。

### 3.5 数值与抗性

| 规则 | 合同 |
|------|------|
| raw | 常量 **40** 魔法伤害 |
| 结算 | 走既有 magic 抗性管线（`damage/magic` → MR）；零抗 raw=final=40 |
| 非零 MR | 断言 final 按精确结算合同衰减，raw 仍为 40 |
| fail closed | missing / invalid state key 或非法 state_change → **编译或运行失败**，不得静默当成功 |

## 4. 当前 DB / live 事实（设计基线）

编码前以 live 再确认；本文冻结规划时事实：

| 事实 | 值 |
|------|-----|
| live | lol **14/14**，version `lol-generic-spellblade-v1-20260713` |
| `item_3094` | Batch C 静态度实体应已存在；**无** Energized provider mount |
| Energized 数据行 | provider / listener / state / formula **为 0** |
| 复用 types | `event/basic_attack_hit` **20211**；`event/source_owner` **20212**；`damage/magic` **20221**；`state_scope/provider` **20250** |
| reserved / schema | 足够；**零**新 type / DDL / API |

建议发布 version（执行前检查未占用）：`lol-generic-energized-v1-20260713`。

Revision 路径：**14/14 → 15/14**（seed；幂等保持）→ publish **15/15**。

## 5. 数据合同（Backend seed）

### 5.1 Seed 约束

- 新增幂等 generic Energized seed + 静态测试 + README。
- **单事务**；candidate revision；**material-change** 才推进。
- **无 DELETE**；**不自动 publish**。
- 零 DDL / 零新 API；复用既有 state / listener / effect / schema / reserved。

### 5.2 `item_3094` provider 图（逻辑）

建议稳定 key（编码可微调，但须幂等稳定）：

| 对象 | 建议 key / 合同 |
|------|-----------------|
| Provider | `provider_item_3094_energized`（passive，mount 到 `item_3094`） |
| Listener | `listener_item_3094_energized`：ALL-match **20211** + **20212** |
| Sequence | `sequence_item_3094_energized` |
| State | `energized_charge`（max=100，无时长，scope **20250**） |
| Formula（ready） | `formula_item_3094_energized_ready`：`provider.state.energized_charge >= 100` |
| Formula（damage） | `formula_item_3094_energized_damage`：常量 `40` |
| Spell / effect 细节 | 对齐既有 Guinsoo / 公式 on-hit / Spellblade seed 风格的 spell/effect/step 键前缀 `*_item_3094_energized*` |

Sequence 步骤顺序（必须）：

1. **condition** ready → damage magic 40（`copyable_on_hit=false`）→ **override** charge=0  
2. **无条件** state_change **add** 25（clamp max）

Listener / effect / step 细节对齐既有 seed 风格；不得拆成两个独立 listener 导致「先 add 再判定」破坏第 4/5 刀合同。

### 5.3 读回与发布

- API 读回：provider state / listener / effect / formula / mount。
- 正式 publish 后保留完整发布日志；version 见 §4。

## 6. Wasm 精确范围

### 6.1 允许写入

| 区域 | 路径 | 条件 |
|------|------|------|
| 测试（优先） | `wasm/tinygo_engine_v2/internal/runtime/generic_energized_test.go`（**新建**） | **默认只新增此文件** |
| 运行时 | `wasm/tinygo_engine_v2/internal/runtime/generic_execution.go` | **仅当**测试暴露同 sequence 条件/状态顺序（hit 前快照、override 后 add、clamp）问题时才允许改 |

### 6.2 默认禁止

- `internal/model/**`、`internal/compile/**`、`internal/pipeline/**` formula、ABI / schema 序列化面（除非阻塞报告后另批）。

### 6.3 验证命令

- `go test -count=1 ./internal/runtime -run Energized`
- `go test -count=1 ./...`、bench、TinyGo build、smoke、node bench

## 7. Backend 精确范围

### 7.1 允许写入

| 区域 | 内容 |
|------|------|
| Seed | `db/game_manage/seeds/lol_generic_energized_seed.sql`（**新建**） |
| 测试 | `server/data_manage/src/test/java/xyz/game/datamanage/db/LolGenericEnergizedSeedSqlTest.java`（**新建**） |
| README | `server/data_manage/README.md` 执行顺序与依赖说明（最小追加） |

### 7.2 默认禁止

- 直接改 SQLite / 手改 live 行绕过 seed
- 新 DDL、新 API、自动 publish、DELETE
- 给 state 写非 0 default_value；reserved 补种

### 7.3 Backend / live 验证

1. 静态合同、幂等、no DELETE / no auto publish。
2. Revision：**14/14 → 15/14**（再跑幂等保持）→ publish **15/15**。
3. Version：`lol-generic-energized-v1-20260713`（执行前确认未占用）。
4. API 读回 provider/state/listener/effect/formula/mount。
5. 发布日志完整。

## 8. Web 精确范围

### 8.1 默认策略

- **预计无需** production adapter 改动。
- 用现有 `#/wasm-validation-generic`：选 **Vayne + tank dummy + `item_3094`**，至少 **5** 次真实 AA。
- 仅当缺展示/默认验证入口时，才对页面或测试做**最小**改动。
- Wasm artifact 仅在 Wasm 侧有实质变更时同步；hash 与 Wasm 构建一致。

### 8.2 默认禁止

- 页面不得本地计算 charge / 40 magic。
- 不顺手改无关 assembler / 其它装备路径。

### 8.3 Browser 合同

- compile / run / release 成功；**warnings=0**
- 证据：第 4 刀不触发、第 5 刀 raw40 magic、消费后 charge=25、可选第二轮；加 Guinsoo 时 phantom 无 Energized 复制

### 8.4 Web 验证命令

- lint / typecheck / Vitest / build

## 9. Planning 范围

| 本编写会话 | 仅本文 |
|------------|--------|
| 后续治理会话 | 最终测试记录；`task_rules` 映射；覆盖审计文档引用本批（**总体审计仍 active**） |

**本文编写会话禁止改其他文件。**

## 10. 测试矩阵

### 10.1 Wasm（`generic_energized_test.go` Canonical）

| # | 命题 | 通过标准 |
|---|------|----------|
| W1 | 4→5 刀 | 第 4 刀 75→100 无 40 magic；第 5 刀触发 |
| W2 | 第五刀 raw | magic raw=40；`copyable_on_hit=false` |
| W3 | 消费后 | 第 5 刀结束后 `energized_charge=25` |
| W4 | 第二轮 | 再充至 100 后下一真实刀再次触发并回到 25 |
| W5 | Phantom 禁区 | 不增/不耗/不触发/不复制 |
| W6 | 魔抗结算 | 非零 MR 下 final 按精确结算；raw 仍 40 |
| W7 | fail closed | missing/invalid state → 失败，非静默成功 |
| W8 | 工程门禁 | full Go test、bench、build、smoke、node bench |

### 10.2 Backend / live

| # | 命题 | 通过标准 |
|---|------|----------|
| B1 | 静态合同 | provider/listener/sequence/state/formula/mount 键与 40/25/100 顺序 |
| B2 | 幂等 | 二次执行不无意义推 revision |
| B3 | 安全边界 | no DELETE；no auto publish |
| B4 | Revision | 14/14→15/14→（幂等）15/14→（publish）15/15 |
| B5 | Version | `lol-generic-energized-v1-20260713` |
| B6 | API 读回 | state/listener/effect 可见 |
| B7 | 发布日志 | 完整可追溯 |

### 10.3 Web / browser

| # | 命题 | 通过标准 |
|---|------|----------|
| F1 | 工程门禁 | lint / typecheck / Vitest / build |
| F2 | 场景 | Vayne + tank + 3094，≥5 次 AA |
| F3 | compile/run/release | 成功；**warnings=0** |
| F4 | 证据链 | 4→5、raw40、post=25；（可选）第二轮 / Guinsoo phantom 禁区 |

## 11. 执行顺序与 Cursor prompts

驱动模型收敛后按序派发；每轮 Cursor 固定编码角色。每条 prompt **必须**含：目标 / 允许范围 / 非目标 / 验证 / 停止条件。

### Prompt A — Wasm 合同测试（优先）

| 字段 | 内容 |
|------|------|
| **目标** | 新建 `generic_energized_test.go`，锁死 §3.2 / §10.1（含 4→5、消费后 25、第二轮、phantom、MR、fail closed） |
| **允许范围** | 仅 `internal/runtime/generic_energized_test.go` |
| **非目标** | 不改 `generic_execution.go`、model/compile/ABI；不写 Backend/Web |
| **验证** | `go test -count=1 ./internal/runtime -run Energized`；必要时 `./...` |
| **停止条件** | 同 sequence 条件读到消费后状态导致 4/5 刀合同无法用纯数据表达；或必须改 execution——**停止并报告**，不得擅自改 runtime |

### Prompt B — Wasm runtime 修复（按需）

| 字段 | 内容 |
|------|------|
| **目标** | 仅修复 Prompt A 证明的同 sequence 条件/状态顺序问题，使 §3.2 成立 |
| **允许范围** | 仅 `internal/runtime/generic_execution.go`（+ 必要测试调整） |
| **非目标** | 不扩 model/compile/ABI；不顺手改 Guinsoo/Spellblade 语义 |
| **验证** | Energized + 相关回归（含 phantom）`go test`；bench/build/smoke |
| **停止条件** | 修复需要新 ABI 字段 / 新 type / 改 compile 公共面——停止另开合同 |

### Prompt C — Backend seed

| 字段 | 内容 |
|------|------|
| **目标** | 幂等 seed `item_3094` Energized 图；静态测试；README 最小说明 |
| **允许范围** | `lol_generic_energized_seed.sql`、`LolGenericEnergizedSeedSqlTest.java`、`server/data_manage/README.md` |
| **非目标** | 无 DELETE、无 auto publish、无 DDL/API、无其它装备 |
| **验证** | 专用测试 + 全量 `mvn test`；live dry-run → 正式 → 幂等（14/14→15/14 保持） |
| **停止条件** | `item_3094` 不存在或 reserved 缺 20211/20212/20221/20250——停止报告，不得补种 reserved |

### Prompt D — Live publish（独立确认）

| 字段 | 内容 |
|------|------|
| **目标** | publish 到 **15/15**，version `lol-generic-energized-v1-20260713` |
| **允许范围** | 既有 publish 流程与发布日志；不改 seed 合同 |
| **非目标** | 不改业务数据语义；不回滚其它 revision |
| **验证** | current/published=15/15；API 读回；version 码写入 |
| **停止条件** | version 码冲突或 revision 严重偏离且无法用 material-change 解释 |

### Prompt E — Web / browser

| 字段 | 内容 |
|------|------|
| **目标** | 现有 generic 页 Vayne+tank+3094 ≥5 AA；compile/run/release warnings=0；证据对齐 §10.3 |
| **允许范围** | 默认零改动；仅缺展示/默认验证时最小改页面/测试；按需同步 wasm artifact |
| **非目标** | 无 production adapter；页面不算伤害/充能 |
| **验证** | lint/typecheck/Vitest/build；浏览器或等价 Playwright 证据 |
| **停止条件** | 必须新 adapter/API 才能展示——停止报告 |

### Prompt F — Planning 收口（非本文会话）

| 字段 | 内容 |
|------|------|
| **目标** | 写最终测试记录；更新 `task_rules`；覆盖审计引用本批；**总体审计仍 active** |
| **允许范围** | 测试记录、`task_rules`、覆盖审计文档必要引用 |
| **非目标** | 不改 Wasm/Backend/Web 产品代码；不把覆盖审计标完成 |
| **验证** | 治理映射可读；矩阵结果可追溯 |
| **停止条件** | 矩阵未绿却标任务完成 |

**建议编码顺序：** A →（仅必要时）B → C → D → E → F。

## 12. 停止条件（全局）

满足任一条即 **停止当前编码轮次并报告**：

1. 同 sequence 无法表达「hit 前判定 → 消费 → 再 add」，且修复超出 `generic_execution.go`。
2. 证明必须改 model / ABI / compile / formula / DDL / 新 API。
3. 试图复活 legacy DPS energized 路线或补移动/射程/弹射等非目标。
4. 写入范围逸出 §6–§9（或当轮 prompt 收紧列表）。
5. live version 冲突或 revision 与 14→15 路径严重偏离且无法解释。
6. Phantom 增/耗/触发 Energized，且无法在不破坏 Guinsoo 合同下用 `copyable_on_hit=false` 闭环。

**完成定义（本批，非总体审计）：**

- §10 矩阵全绿；
- live **15/15** + version `lol-generic-energized-v1-20260713`；
- 验证记录与 `task_rules` 可追溯；
- `wasm-generic-min-validation-coverage-audit` **仍为 active**。

## 13. 设计完备性检查（编码准入）

- [x] 目标与单真实 gate（3094）及 4→5 / 消费后 25 合同
- [x] 允许 / 禁止写入（Wasm 测试优先；execution 按需；Backend；Web 最小；Planning）
- [x] 非目标与 phantom 禁区
- [x] 数据合同（稳定 key、20211/20212/20221/20250、seed 约束）
- [x] 测试矩阵（含 MR、fail closed、live 14→15、warnings=0）
- [x] 执行顺序 Cursor prompts（目标/范围/非目标/验证/停止）
- [x] 总体审计保持 active

旧 Batch N 不是本批实现真源。
