TASK_KEY: wasm-generic-spellblade
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: active
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-13

# 通用 ABI — Spellblade（三相之力）机制详细设计

可直接编码的详细设计。旧 Batch L/M 与 legacy DPS DTO/bundle 仅作参考，**禁止复活**。实现以本文合同为准。

对应任务：`wasm-generic-spellblade`（feature：`generic_spellblade`）。覆盖审计总任务 `wasm-generic-min-validation-coverage-audit` 中 Spellblade 子批段应引用本文。

## 1. 目标

在通用 ABI / 通用引擎上落地 **三相之力（`item_3078`）** 单真实 gate 的 Spellblade：

| 环节 | 合同摘要 |
|------|----------|
| Cast 入口 | 成功的顶层、非 `ability/basic_attack` 的 active ability cast |
| 自动事件 | 自动合成 `event/ability_cast` |
| 武装 | 三相 provider listener：在 ICD=0 时 set `spellblade_ready=1` 且 `spellblade_icd=1` |
| 消费 | 下一次**独立真实** `basic_attack_hit` 造成 `2 * event.entry_source.attr.ad.base` 物理伤害，再消费 ready |
| Live 验证技能 | Vayne Q / Tumble **仅作可施放 + ability_cast 入口** |

实现须覆盖 **Wasm 运行时自动事件 → Backend 幂等 seed（含最小 Tumble）→ Web 双 driver entry 真实 compile/run/release**。

## 2. 非目标

1. 不实现 energized / execute / linked effects / crit / modifier。
2. 不覆盖多 Spellblade 唯一组；不做巫妖（3100）/ 夺萃（3508）/ 耀光（3057，当前不存在）/ 冰脉 / 黄昏与黎明 / 黯影阔剑。
3. 不做法力回复 / 治疗 / 减速 / 可见性。
4. 不做完整技能 rotation / editor。
5. **不覆盖** Ezreal Q 类「同一 ability 帧内 arm 后立即 on-hit 消费」的同帧 phase ordering（另批）。
6. **不宣称完整 Vayne Q**：本批不实现位移、Q 强化普攻伤害、翻滚语义；只保证可施放与成功 cast 后发出 `ability_cast`。
7. 不改 model / ABI / compile / formula，除非实现证据证明必需——若必需，**先停止并报告**，不得静默扩展。
8. 优先零 DDL / 零新 API；不新增专用 Spellblade reserved/table；不为 `provider_state_fields` 增 `default_value`（initial 默认 0，由真实 cast 自然武装）。
9. Seed **无 DELETE**、**不自动 publish**；仅 material change 才推 revision。

## 3. 核心机制合同

### 3.1 唯一真实 gate

- 只做 **`item_3078` 三相之力** 一条闭环。
- `item_3100` / `item_3508` 已存在、`item_3057` 不存在：均**非本批**。

### 3.2 完整链路（编码真源）

```
成功顶层 active cast（TypeSet 不含 ability/basic_attack，chainDepth=0）
  → 运行时自动 emit event/ability_cast
  → 三相 ability_cast listener（ICD==0）
       → set spellblade_ready = 1（duration 10000ms，refresh_on_write）
       → set spellblade_icd   = 1（duration 1500ms，refresh_on_write）
  → 之后某次独立真实 basic_attack_hit（ready >= 1）
       → damage physical = 2 * event.entry_source.attr.ad.base
         （copyable_on_hit = false）
       → set/consume spellblade_ready = 0
  → 同 ready 窗口内第二次普攻命中：不再触发
```

### 3.3 自动 `event/ability_cast` 合成条件

仅在 **同时** 满足时合成并发出：

| 条件 | 要求 |
|------|------|
| Cast 结果 | **成功**（gate / cost / cooldown 失败 → **不发**） |
| 调用深度 | `chainDepth == 0`（driver 顶层 cast） |
| Ability 分类 | ability 的 TypeSet **不含** `ability/basic_attack` |
| Listener 子 ability | listener 触发的 child ability cast（`chainDepth > 0`）→ **不发**，避免递归武装 |

不满足任一条 → 不发 `ability_cast` → 不武装。

**阻塞写入（编码前必须核对，不得猜测）：**

- 当前 generic ability classifier 必须能可靠区分「带 `ability/basic_attack`」与「普通 active」。
- 若实现期发现 TypeSet / types 投影无法可靠区分，**停止编码并回写阻塞到本文/任务**，不得用 abilityKey 字符串启发式硬猜。

### 3.4 Provider state

| State key | max | duration | refresh | 语义 |
|-----------|-----|----------|---------|------|
| `spellblade_ready` | 1 | **10000ms** | refresh_on_write | 咒刃就绪；到期 lazy → 0，不再触发 |
| `spellblade_icd` | 1 | **1500ms** | refresh_on_write | 内置冷却；ICD 内再次 cast **不重武装、不刷新 ready** |

`ability_cast` listener 行为：

1. 仅当 `spellblade_icd == 0`（含未写 / 已到期）时：
   - `spellblade_ready = 1`（写路径 refresh `expireAt`）
   - `spellblade_icd = 1`（写路径 refresh `expireAt`）
2. ICD 仍有效时再次 `ability_cast`：无状态写入、不刷新 ready。

### 3.5 `basic_attack_hit` 消费

1. 仅当 `spellblade_ready >= 1`（且未到期）时执行。
2. **先**造成三相物理伤害，**再** set/consume `spellblade_ready = 0`。
3. 第二刀（ready 已 0）不再触发。
4. Damage 标记 **`copyable_on_hit = false`**。

### 3.6 Phantom 禁区（与 Guinsoo 组合）

Guinsoo phantom **不得**：

- 复制 Spellblade damage（因 `copyable_on_hit=false`）
- 触发 Spellblade listener
- 推进 / 消费 `spellblade_ready` 或 `spellblade_icd`

组合回归证据：phantom 证据中 **不含** Spellblade `operationRef`。

### 3.7 数值与属性边界

| 规则 | 合同 |
|------|------|
| 伤害公式 | `2 * event.entry_source.attr.ad.base`（物理） |
| 装备 AD | **不污染** `ad.base`；三相静态度 `ad` 进入 bonus/resolved，不改变 base 口径 |
| 无 cast | 不触发 |
| ready 到期 | 不触发 |
| 本批时序 | **仅**「cast → 之后独立普攻」；同帧 arm+on-hit 另批 |

### 3.8 Vayne Q / Tumble（live 最小入口）

- 为 `hero_vayne` 增最小 **Tumble active ability** 数据，只服务：可施放、成功 cast、自动 `ability_cast`。
- **明确不宣称**：位移、翻滚、Q 强化下一次普攻伤害、或完整英雄技能语义。
- 用户允许效果不必百分百还原；文档与验证记录不得写成「完整 Vayne Q」。

## 4. 当前 DB / live 事实（设计基线）

编码前以 live 再确认；本文冻结规划时事实：

| 事实 | 值 |
|------|-----|
| live | lol **13/13**，version `lol-guinsoo-hk-v1-20260713` |
| `item_3078` | 已存在（Batch C 静态属性），**无** Spellblade provider mount |
| Spellblade 数据行 | provider / listener / state / formula **为 0** |
| `item_3100` / `item_3508` | 已存在，非本批；`item_3057` 不存在 |
| reserved / schema | 优先足够；不新增专用 Spellblade reserved / table |
| `event/ability_cast` | **规划时未在 reserved seed 中确认存在** |
| `ability/basic_attack` | 既有 generic / reserved 合同中已使用 |

若 `event/ability_cast`（或投影所需 type）缺失：

- **仅允许** reserved seed / type 投影补齐既有概念 `event/ability_cast`；
- **禁止**发明新事件名或新机制概念。

建议发布 version（执行前检查未占用）：`lol-generic-spellblade-v1-20260713`。

预计 revision 路径：seed 后 **13/13 → 14/13**（幂等保持），再 publish 到 **14/14**。

## 5. 数据合同（Backend seed）

### 5.1 Seed 约束

- 新增幂等 generic Spellblade seed + 静态测试 + README。
- **单事务**；candidate revision；**material-change** 才推进 `current_revision`。
- **无 DELETE**；**不自动 publish**。
- 优先 **零 DDL / 零 API**；复用现有 state / listener / effect / schema / reserved。
- `provider_state_fields`：**不写 default_value**；初始 0。

### 5.2 `item_3078` provider 图（逻辑）

建议稳定 key（编码可微调，但须幂等稳定）：

| 对象 | 建议 key / 合同 |
|------|-----------------|
| Provider | `provider_item_3078_spellblade`（passive，mount 到 `item_3078`） |
| State | `spellblade_ready`、`spellblade_icd`（见 §3.4） |
| Listener A | ALL-match `event/ability_cast`（+ 既有 source_owner 约定若项目统一要求）→ condition ICD=0 → set ready + set ICD |
| Listener B | ALL-match `event/basic_attack_hit`（+ source_owner）→ condition ready≥1 → damage → consume ready |
| Formula | `2 * event.entry_source.attr.ad.base`（物理）；damage `copyable_on_hit=false` |

Listener / effect / step 细节对齐既有 Guinsoo / 公式 on-hit seed 风格（condition + state write + damage detail）。

### 5.3 `hero_vayne` 最小 Tumble

- 最小 active ability：可被 driver 引用、可过 gate/cost/cooldown（本批可用零成本/零 CD 或显式可过配置，以 seed 测试合同为准）。
- TypeSet：**不得**含 `ability/basic_attack`。
- 可不含位移/强化伤害 operation；成功 cast 即可触发运行时自动 `ability_cast`。

### 5.4 读回与发布

- API 读回：provider state / listener / effect / ability（Tumble + 三相）。
- 正式 publish 后保留完整发布日志；version 建议见 §4。

## 6. Wasm 精确范围

### 6.1 允许写入

| 区域 | 路径 |
|------|------|
| 运行时 | `wasm/tinygo_engine_v2/internal/runtime/generic_execution.go` |
| 测试 | `wasm/tinygo_engine_v2/internal/runtime/generic_spellblade_test.go`（**新建**） |

### 6.2 默认禁止改动（除非阻塞报告后另批）

- `internal/model/**`
- `internal/compile/**`
- `internal/pipeline/**` formula
- ABI / schema 序列化面

### 6.3 运行时行为（编码要点）

在 **顶层成功** `castAbilityAt(..., chainDepth=0)` 完成 commit / 既有 pending 派发之后（或合同等价的成功点）：

1. 若 ability TypeSet 含 `ability/basic_attack` → 不合成 `ability_cast`。
2. 否则自动合成并 `dispatchListeners`：`event/ability_cast`（source/target 与本次 cast 一致）。
3. gate/cost/cooldown 在成功路径之前失败 → 整次 cast 失败 → **不** `abilityCastCount++`、**不**发事件。
4. listener child ability：`castAbilityAt(..., chainDepth>0)` → 不自动发 `ability_cast`。

State 读写复用既有 provider state（max / duration / refresh_on_write / lazy expire），与 Guinsoo 同路径。

Damage evidence 须可审计：`operationRef`、`ad.base` 贡献、ready 消费前后（`finalSnapshot.providerState`）。

### 6.4 Wasm 验证命令

- `go test -count=1 ./...`
- bench
- TinyGo build
- smoke
- node bench

## 7. Backend 精确范围

### 7.1 允许写入（优先）

| 区域 | 内容 |
|------|------|
| Seed | 新增幂等 Spellblade seed（含 `item_3078` provider 图 + `hero_vayne` 最小 Tumble） |
| 测试 | 静态合同 / 幂等 / 无 DELETE / 不 auto-publish |
| README | `server/data_manage/README.md` 执行顺序与依赖说明 |
| Reserved（仅若缺失） | 投影补齐 `event/ability_cast`（及分类所需既有 type） |

### 7.2 默认禁止

- 直接改 SQLite / 手改 live 行绕过 seed
- 新 DDL、新专用表、新 API（除非阻塞）
- 自动 publish
- 给 state field 写非 0 default_value

### 7.3 Backend / live 验证

1. Seed 静态合同、幂等、no DELETE / no auto publish。
2. Revision：预计 13/13 → 14/13（再跑幂等保持），publish → 14/14。
3. Version：`lol-generic-spellblade-v1-20260713`（执行前确认未占用）。
4. API 读回 provider state / listener / effect / ability。
5. 发布日志完整。

## 8. Web 精确范围

### 8.1 允许写入

| 区域 | 要求 |
|------|------|
| `web/src/pages/WasmValidationGenericPage.tsx` | 支持 **两条** driver entry：① 预施法技能单次 entry；② `basic_attack` 动态 `intervalFormula` entry |
| 同目录纯 helper / test | 必要时 |

### 8.2 默认禁止顺手修改

- `combatDataAssembler` / `types`：**已支持多 entry**，本批不应顺手改
- 页面不得本地计算 Spellblade 伤害 / ready；只展示引擎证据与 summary

### 8.3 Browser / live 场景合同

- Route：`#/wasm-validation-generic`
- 组合：Vayne + Trinity（`item_3078`）+ tank dummy
- Driver：
  - Tumble：`firstAtMs = 0`（单次）
  - Basic attack：更晚的 `firstAtMs` + 动态 cadence（`intervalFormula`）
- 证据必须含：emitted `ability_cast`、Spellblade damage `operationRef`、`ad.base` 贡献、ready consumed、第二次攻击无重复、`warnings=0`
- 加 Guinsoo 组合回归：phantom **不含** Spellblade `operationRef`

### 8.4 Web 验证命令

- lint / typecheck / Vitest / build

## 9. Planning 范围

本批详细设计即本文。后续验证记录与 `task_rules` 映射由治理会话维护；**本文编写会话禁止改其他文件**。

## 10. 测试矩阵

### 10.1 Wasm（`generic_spellblade_test.go` Canonical）

| # | 命题 | 通过标准 |
|---|------|----------|
| W1 | 顶层非普攻 active cast | 发出 `event/ability_cast`；`spellblade_ready=1` 且 `spellblade_icd=1` |
| W2 | 普攻 cast | **不**发 `ability_cast`；不武装 |
| W3 | gate / cost / cooldown skip | **不**武装 |
| W4 | listener child ability | **不**武装（防递归） |
| W5 | 首次真实 `basic_attack_hit` | 物理伤害 = `2 * ad.base`；随后 ready=0 |
| W6 | 第二次命中 | 不再触发 Spellblade |
| W7 | ready 10s 到期 | 到期后命中不触发 |
| W8 | ICD 1.5s | 窗口内再次 cast 不刷新 ready / 不重武装 |
| W9 | Phantom 禁区 | 不复制 / 不触发 / 不消费；`finalSnapshot.providerState` 有证据 |
| W10 | 工程门禁 | `go test -count=1 ./...`、bench、build、smoke、node bench |

### 10.2 Backend / live

| # | 命题 | 通过标准 |
|---|------|----------|
| B1 | 静态合同 | seed SQL 测试断言 provider/state/listener/effect/ability 键与公式 |
| B2 | 幂等 | 二次执行不无意义推 revision |
| B3 | 安全边界 | no DELETE；no auto publish |
| B4 | Revision | 13/13→14/13→（publish）14/14 |
| B5 | Version | 建议码未占用且写入发布记录 |
| B6 | API 读回 | state/listener/effect/ability（含 Tumble）可见 |
| B7 | 发布日志 | 完整可追溯 |

### 10.3 Web / browser

| # | 命题 | 通过标准 |
|---|------|----------|
| F1 | 工程门禁 | lint / typecheck / Vitest / build |
| F2 | 双 entry driver | 预施法 Tumble@0ms + 延后 basic_attack 动态 cadence |
| F3 | compile/run/release | 成功；warnings=0 |
| F4 | 证据链 | ability_cast、Spellblade operationRef、base AD、ready 消费、第二刀无重复 |
| F5 | Guinsoo 回归 | phantom 证据无 Spellblade operationRef |

## 11. 实现步骤（建议编码顺序）

1. **核对阻塞**：`ability/basic_attack` TypeSet 可区分性；`event/ability_cast` reserved/type 是否存在；缺失则仅投影补齐。
2. **Wasm**：在 `generic_execution.go` 成功顶层 cast 路径合成 `ability_cast`；补 `generic_spellblade_test.go`（§10.1）。
3. **Backend seed**：三相 provider 图 + 最小 Tumble；静态测试 + README；dry-run → 正式 → 幂等；**不**自动 publish。
4. **Publish**（独立确认）：推到 14/14，version `lol-generic-spellblade-v1-20260713`（若未占用）。
5. **Web**：`WasmValidationGenericPage` 双 entry；真实 loader→assemble→compile/run/release；Guinsoo 组合回归。
6. **验证记录**（另文档）：记录 revision / version / wasm hash / 证据；不在本文标完成。

## 12. 停止条件

满足任一条即 **停止当前编码轮次并报告**，不得扩大范围硬闯：

1. generic ability classifier **无法可靠**区分 `ability/basic_attack`（见 §3.3 阻塞）。
2. 证明必须改 model / ABI / compile / formula / DDL / 新 API 才能闭环（先停，另开合同）。
3. 发现需覆盖同帧 arm+on-hit（Ezreal Q 类）才能通过本批验收——本批合同明确排除，应降级验收或拆批，不得偷偷实现。
4. 试图复活 legacy DPS DTO / Batch L scenarioStates 预置咒刃路线。
5. 写入范围逸出 §6–§8（或用户当轮显式收紧的允许文件列表）。
6. live version 码冲突或 revision 与预期严重偏离且无法用幂等/material-change 解释。
7. Phantom 与 Spellblade 交互出现复制/消费，且无法在不改 Guinsoo 合同的前提下用 `copyable_on_hit=false` 修闭环。

**完成定义（供后续验证记录，本文不标 done）：**

- §10 矩阵全绿；
- live 可读回与发布证据齐全；
- 文档明确「Vayne Q 非完整技能」；
- 治理任务可据此将 `wasm-generic-spellblade` 收口。

## 13. 设计完备性检查（编码准入）

本文已包含独立 Cursor 轮次直接编码所需要素：

- [x] 目标与单真实 gate（3078）
- [x] 允许 / 禁止写入范围（Wasm / Backend / Web / Planning）
- [x] 非目标与 phantom 禁区
- [x] 数据合同（state / listener / damage / Tumble / seed 约束）
- [x] 自动 `ability_cast` 条件与 classifier 阻塞条款
- [x] 测试矩阵与验证命令
- [x] 停止条件

旧 Batch L（scenarioStates 预置）与 Batch M **不是**本批实现真源。
