TASK_KEY: wasm-generic-crit-modifier-infinity-edge
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: active
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-13

# 通用 ABI — Crit / Attribute Modifier（无尽之刃）机制详细设计

对应总体审计：`wasm-generic-min-validation-coverage-audit`。本批关闭审计链最后的 **crit / modifier** 切片：Infinity Edge（`item_3031`）确定性 `expected` 暴击结算 + 显式 `crit_eligible` 数据，并以既有鬼索 owner-side 无条件属性 modifier 作为 modifier 代表。总体审计在 feature 实现并验证完成前继续保持 **开发中 / active**。

本批是机制迁移最小闭环，**不冒充完整 LoL 暴击语义**（无 RNG、无 run-input 策略切换、无兰顿 `critOnly` incoming reduction）。

## 1. 目标与固定样本

| 项 | 合同 |
| --- | --- |
| 代表装备（crit） | Infinity Edge `item_3031` |
| 静态属性（不变） | `ad=75`、`crit_chance=0.25`、`crit_damage=0.3` |
| 六个 ADC 英雄基线 | base `crit_chance=0`、`crit_damage=2` |
| Web 聚合后（IE） | `crit_chance=0.25`、`crit_damage=2.3`（英雄 + 装备直接相加） |
| Canonical 标量 | `1 + 0.25 * (2.3 - 1) = 1.325` |
| P0 策略 | 固定确定性 `expected`；**无 RNG**、**无 run-input 选项** |
| Modifier 代表 | 既有 Guinsoo owner-side 无条件 provider modifier（`attack_speed` + `percent_add`） |
| 数据锚点 | 在既有 `damage_effect_details` / `_log` 增加 `crit_eligible`；**不**新建 detail family / endpoint |

六个 ADC 基础普攻 damage step（seed 精确更新对象，命名以 live 既有 `step_hero_<id>_basic_attack_damage` 为准）：

`hero_vayne`、`hero_teemo`、`hero_varus`、`hero_kaisa`、`hero_twitch`、`hero_kogmaw`。

## 2. 非目标

1. 不把 Infinity Edge 静态 `crit_chance` / `crit_damage` 迁入 provider modifier。
2. 不实现条件属性 modifier（`condition_formula_key` 驱动的条件开关）为 P0 完成声明。
3. 不实现 provider modifier 的跨战斗单位 target/opponent 语义。
4. 不把 pipeline modifier 从“编译保留、不执行”升级为可执行完整能力；本批不得宣称其完成。
5. 不实现 Randuin / `critOnly` incoming damage reduction（独立后续切片）。
6. 不新增 detail family、Admin/Public 新 endpoint、新 operation kind。
7. 不改 legacy DPS lane、公共导出 ABI 函数集合。
8. 不新增页面暴击策略控件（策略固定 `expected`）。
9. Seed **无 DELETE**、**无 DROP/CASCADE**、**不自动 publish**；仅 material change 推 candidate revision。
10. 不因本批设计完成而收口总体审计；feature 任务仅在实现 + live publish + 浏览器 E2E + 验证记录后标完成。

## 3. 所有权拆分

| 面 | 职责 |
| --- | --- |
| Backend | `crit_eligible` DDL/兼容迁移/triggers·partition·log；damage detail mapper/service/publish-copy；幂等 crit seed；README 执行说明；测试 |
| Wasm | model/compile 投影 `critEligible`；generic runtime 在抗性前做 expected crit；evidence；Canonical 测试；**不**动 legacy DPS / 公共导出函数集 |
| Web | combatData / generic operation 类型；assembler 投影与测试；最终 wasm artifact 同步；**无**新页面控件 |
| Live DB | migration → seed（18/17）→ 幂等复核 → 显式 publish `lol-generic-crit-modifier-v1-20260713`（18/18） |
| Browser E2E | `#/wasm-validation-generic`：同 Vayne/dummy 无装备 vs `item_3031`；尽量含 Guinsoo modifier 回归断言；compile/run/release，warnings=0 |

## 4. 核心机制合同

### 4.1 `crit_eligible` 数据合同

在既有表增加列（无新表）：

```sql
crit_eligible boolean NOT NULL DEFAULT false
```

覆盖：

- `damage_effect_details`
- `damage_effect_details_log`

语义：

| 行集合 | `crit_eligible` |
| --- | --- |
| 六个 ADC **基础普攻** damage detail | `true`（本批 seed 显式写入） |
| 全部 on-hit / listener child / linked child / phantom-replay 相关 damage | 保持默认 `false`（本批不改） |
| 其它既有 damage detail | 默认 `false` |

API / DTO / publish-copy 字段名：`critEligible`（JSON）↔ `crit_eligible`（SQL）。不得另开 detail family 或 endpoint。

### 4.2 P0 Expected Crit 结算（抗性之前）

仅当该 damage operation `critEligible=true` 时进入结算；否则跳过整段，`baseRaw` 直接进入抗性管线。

固定公式（无 RNG、无 run-input）：

```text
chanceRaw        = source.resolved.crit_chance
chanceEffective  = clamp(chanceRaw, 0, 1)
multiplier       = max(source.resolved.crit_damage, 1)
normalPart       = baseRaw * (1 - chanceEffective)
critPart         = baseRaw * chanceEffective * multiplier
critAdjustedRaw  = normalPart + critPart
```

然后进入既有管线：

```text
critAdjustedRaw → resistance → shield → HP
```

Canonical（IE 装载、ADC 基线）：

| 量 | 值 |
| --- | --- |
| `chanceEffective` | `0.25` |
| `multiplier` | `2.3` |
| 标量 | `1.325` |
| `critAdjustedRaw` | `baseRaw * 1.325` |

等价恒等式：`1 + chanceEffective * (multiplier - 1) = 1.325`。

### 4.3 Evidence / Provenance

暴击证据留在既有 **`damage` evidence kind**（不新建 kind）。至少记录：

| 字段 | 含义 |
| --- | --- |
| `policy` | 固定 `"expected"` |
| `eligible` | 本 operation 是否 `critEligible` |
| `chanceRaw` | 结算前 raw crit_chance |
| `chanceEffective` | clamp 后 |
| `multiplier` | `max(crit_damage, 1)` |
| `baseRawAmount` | 公式求出的、暴击前 raw |
| `normalPart` / `critPart` | expected 拆分 |
| `critAdjustedRawAmount` | 交给抗性的 post-crit raw |

既有字段语义收口：

- `rawAmount` = **post-crit**、交给抗性的 raw（即 `critAdjustedRawAmount`；非 eligible 时等于 `baseRawAmount`）
- `mitigatedAmount` = 抗性后、护盾前（既有合同保持）

非 eligible damage：仍可在 evidence 中写 `eligible=false` 与 `policy=expected`（或等价省略 parts）；不得伪造成功暴击拆分。

### 4.4 Phantom replay 禁区

Phantom replay **冻结**真实命中已结算的 raw 与 provenance：

1. **不得**二次执行 expected crit 结算。
2. **不得**额外 emit 事件。
3. **crit settlement 不额外增加 command budget**；existing phantom damage command 仍按既有合同计费（不得声称 phantom 本身无成本）。
4. 复制的 damage 携带已冻结的 post-crit raw 与 crit 证据字段；`crit_eligible` 默认仍为 false 的 on-hit 复制路径保持不结算。

### 4.5 Attribute Modifier 代表（回归，不扩语义）

代表对象：既有 Guinsoo（`item_3124` / `provider_item_3124_guinsoos`）**owner-side 无条件** `attack_speed` + `value_policy/percent_add` provider modifier。

本批要求：

- 保留既有行为；**回归证明** `attack_speed.resolved` 仍随层数/挂载变化。
- **禁止**把 IE 静态暴击属性改写成 provider modifier。
- 明确不宣称：条件 modifier、跨 combatant target/opponent modifier、pipeline modifier 执行完成。

## 5. 数据 / ABI / 运行时合同摘要

| 层 | 合同 |
| --- | --- |
| DB | `crit_eligible boolean NOT NULL DEFAULT false` on details + log；兼容 migration；triggers/partition 覆盖若需要 |
| API | 既有 damage detail 读写/publish-copy 透传 `critEligible` |
| Seed | 幂等更新**恰好**六个 ADC 基础普攻 damage detail → `true`；仅 material change 推 revision |
| Wasm model/compile | 投影 `critEligible`；非法面不得静默丢字段 |
| Wasm runtime | eligible 时在抗性前 expected 结算；证据字段齐全；phantom 不重算 |
| Web | 类型 + assembler 投影；无 UI 策略控件 |
| 版本码 | `lol-generic-crit-modifier-v1-20260713`（编码前核对未占用） |

## 6. Backend 写入范围

### 6.1 允许路径（实现 Gate 内）

| 区域 | 路径 / 产物 |
| --- | --- |
| Schema | `db/game_manage/schema.sql` |
| Migration | `db/game_manage/migrations/compatibility/*crit_eligible*`（命名实现时定） |
| Triggers / partitions | `db/game_manage/triggers.sql` 等既有覆盖面，若列变更需要 |
| Seed | `db/game_manage/seeds/lol_generic_crit_modifier_seed.sql`（或等价单一幂等 seed） |
| Mapper / service | `CombatDamageEffectDetailsMapper`（Java + XML）、effect combat-data service、publish-copy |
| Tests | 对应 mapper/service/seed 静态与幂等测试 |
| README | `server/data_manage/README.md` 执行说明（migration → seed → 幂等 → 显式 publish） |

### 6.2 Seed 合同

1. 前置：`item_3031` 静态属性已存在（Batch C）；六个 ADC 基础普攻 damage detail 行已存在。
2. 仅 upsert 六个 ADC 基础普攻 damage detail 的 `crit_eligible=true`（及其它列保持原值）。
3. material-change 判定：仅当 `crit_eligible`（或合同相关列）实际变化时推进 candidate revision。
4. 幂等重跑：无额外 revision 推进。
5. **禁止** DELETE / DROP / CASCADE / auto-publish。

### 6.3 Live revision 路径（基线仍为 17/17 时）

| 阶段 | 预期 |
| --- | --- |
| 基线 | **17/17**（linked effects 闭环后） |
| migration + seed 后 | **18/17** |
| 幂等重跑 | 仍 **18/17** |
| 显式 publish `lol-generic-crit-modifier-v1-20260713` | **18/18** |

若 live 基线已漂移，以 material-change 可解释的实际数字为准并回写验证记录；不得跳过幂等复核。

### 6.4 Backend 停止条件

1. 必须新建 detail family / endpoint 才能表达 `crit_eligible`。
2. 必须 DELETE/DROP/CASCADE 才能完成 seed。
3. publish-copy / mapper 无法在既有 damage detail 合同内透传字段。

## 7. Wasm 写入范围

### 7.1 建议最小文件

| 路径 | 角色 |
| --- | --- |
| `wasm/tinygo_engine_v2/internal/model/generic_compile.go`（及邻近 model） | `critEligible` 字段 |
| `wasm/tinygo_engine_v2/internal/compile/generic*.go` | 投影 / collect-all（若需） |
| `wasm/tinygo_engine_v2/internal/runtime/generic_execution.go` | 抗性前 expected crit；evidence |
| `wasm/tinygo_engine_v2/internal/crit/crit.go` | 复用 `ExpectedParts` / clamp 语义（generic 调用，**不**改 legacy DPS 行为合同） |
| `wasm/tinygo_engine_v2/internal/runtime/generic_crit_modifier_test.go` | **新建** Canonical 矩阵 |
| `wasm/tinygo_engine_v2/dist/tinygo_engine_v2.wasm` | 构建产物 |
| README | 若需补充 generic crit 说明 |

### 7.2 禁止

- 修改 legacy DPS lane 行为作为本批交付面（可复用 `internal/crit` 纯函数，但不得把本批验收绑到 DPS lane）。
- 变更公共导出函数集合。
- 新增 operation kind。
- 为 phantom 二次结算或额外 emit。

### 7.3 运行时顺序

```text
evaluate damage amount formula → baseRaw
  → if critEligible: expected crit → critAdjustedRaw
  → else: critAdjustedRaw = baseRaw
  → resistance → mitigated
  → shield → HP
```

## 8. Web 写入范围

| 区域 | 要求 |
| --- | --- |
| Types | `combatData` / generic operation 增加 `critEligible?: boolean`（或合同等价必填默认 false） |
| Assembler | 从 damage detail 投影到 compile request；缺省 false |
| Tests | assembler / 类型投影覆盖 true/false |
| Artifact | 同步最终 wasm 到既有 Web 位置 |
| UI | **无**新暴击策略控件 |
| 工程门禁 | lint / typecheck / Vitest / build |

## 9. 验证矩阵（必须）

### 9.1 Runtime / Wasm

| # | 命题 | 通过标准 |
| --- | --- | --- |
| W1 | chance=0 | `critAdjustedRaw = baseRaw`；parts 一致 |
| W2 | chance=0.25 + IE multiplier 2.3 | 标量 **1.325**；`critAdjustedRaw = baseRaw * 1.325` |
| W3 | chance=1 | `normalPart=0`；`critPart=baseRaw*multiplier` |
| W4 | chance 越界 | `chanceRaw` 原样记录；`chanceEffective` clamp 到 `[0,1]` |
| W5 | multiplier 下限 | `crit_damage < 1` 时 `multiplier=1` |
| W6 | 非 eligible | 不结算；`rawAmount=baseRaw`；on-hit/listener/linked 默认 false |
| W7 | 抗性顺序 | crit 后的 raw 再进 armor/MR；mitigated 基于 post-crit raw |
| W8 | Phantom | 不二次结算；无额外 event；crit settlement 不额外增加 command budget；existing phantom damage command 仍按既有合同计费 |
| W9 | 确定性 | 同输入同输出（无 RNG） |
| W10 | Modifier 回归 | Guinsoo owner-side `attack_speed` percent_add 仍改变 `resolved` |
| W11 | Evidence | damage kind 含 policy/eligible/chance*/multiplier/baseRaw/parts/critAdjustedRaw；`rawAmount`=post-crit |
| W12 | IE 静态属性 | `ad/crit_chance/crit_damage` 仍为静态聚合，未迁入 modifier |

工程门禁：targeted runtime tests → `go test ./...` → bench → wasm build → Node smoke。

### 9.2 Backend

| # | 命题 | 通过标准 |
| --- | --- | --- |
| B1 | DDL | details + log 均有 `crit_eligible NOT NULL DEFAULT false` |
| B2 | 兼容迁移 | 可重复执行；既有行默认 false |
| B3 | mapper/service/publish-copy | 读写与 log 拷贝含字段 |
| B4 | seed | 恰好六个 ADC 基础普攻 detail = true；其它默认 false |
| B5 | 安全 | 无 DELETE/DROP/CASCADE；无 auto publish；幂等 |
| B6 | revision | 17/17→18/17→（幂等）18/17→ publish 18/18 |
| B7 | version | `lol-generic-crit-modifier-v1-20260713` |

工程门禁：targeted SQL/static tests + 全量 Maven。

### 9.3 Web / Live / Browser

| # | 命题 | 通过标准 |
| --- | --- | --- |
| F1 | Web 工程 | lint / typecheck / Vitest / build |
| F2 | Artifact | wasm hash 与构建一致 |
| F3 | Live | migration/seed/幂等/显式 publish 路径成立 |
| F4 | Browser | `#/wasm-validation-generic`：同 Vayne/dummy 无装备 vs `item_3031`；尽量含 Guinsoo modifier 断言；compile/run/release；warnings=0 |

无装备：`crit_chance=0` → 普攻 raw 不被 1.325 放大。装 IE：证据/数值体现 1.325 期望结算（在既有抗性设定下可核对）。

## 10. 分 Gate 开发顺序（Cursor Gates）

### Gate A — Backend DDL + mapper/service

**目标**：`crit_eligible` 列、兼容迁移、triggers/partition（若需）、mapper/service/publish-copy 与测试。

**允许文件**：§6.1 中 schema/migration/triggers/mapper/service/tests（不含 live 写入）。

**验证**：

```powershell
# 仓库内既有 Backend 测试入口（以 README / 模块惯例为准）
mvn test
```

**停止**：必须新 detail family/endpoint；或 migration 无法在兼容路径完成。

### Gate B — Crit seed + README

**目标**：幂等 seed 更新六个 ADC 基础普攻 `crit_eligible=true`；README 执行说明。

**允许文件**：seed SQL、seed 静态测试、`server/data_manage/README.md`。

**验证**：seed 静态/幂等测试 + Maven 相关用例。

**停止**：无法在无 DELETE 前提下定位六个 step；或会误改 on-hit rows。

### Gate C — Wasm model/runtime/tests

**目标**：`critEligible` 投影；抗性前 expected 结算；evidence；Canonical 矩阵；wasm 构建。

**允许文件**：§7.1。

**验证**：

```powershell
go test ./internal/runtime -run "GenericCrit|CritModifier|Phantom|Guinsoo" -count=1
go test ./...
# 既有 wasm build / Node smoke 脚本
```

**停止**：必须改公共导出函数集、复活/改写 legacy DPS 作为交付面、或 phantom 无法避免二次结算。

### Gate D — Web 投影 + artifact

**目标**：类型与 assembler 投影；测试；同步 wasm artifact。

**允许文件**：`web/src` 下 combatData/generic 类型、assembler、相关 tests、既有 wasm 产物同步路径。

**验证**：lint / typecheck / Vitest / build。

**停止**：需要新页面控件才能表达固定 `expected` 策略。

### Gate E — Live DB

**目标**：migration → seed → 幂等 → 显式 publish。

**验证**：candidate/published 计数符合 §6.3；Public API 回读六个 ADC detail `critEligible=true`。

**停止**：基线非预期且无法用 material-change 解释；或 publish 会牵连无关 DROP。

### Gate F — Browser E2E

**目标**：`#/wasm-validation-generic` 对比无装备 vs `item_3031`；尽量断言 Guinsoo modifier；compile/run/release；warnings=0。

**停止**：真实链路无法投影 `critEligible` 且超出 Gate D 允许修复面。

### Gate G — Governance closeout

**目标**：新增验证记录；feature 任务标 **已完成**；**总体审计仍开发中**，仅在本 feature 已闭环后才可评估总体审计是否可收口。

**允许文件**：

- `文档记录/测试记录/wasm/通用ABI-CritModifier无尽之刃机制验证记录-2026-07-13.md`（新建）
- `db/task_doc_governance/task_rules.json`（本 feature → 已完成 + 挂验证记录；总体审计状态评估另议）
- 经 `node tools/task-governance/cli.mjs rebuild` 生成的 sqlite

## 11. 与总体审计关系 / 收口规则

- Feature 任务：`wasm-generic-crit-modifier-infinity-edge`（本文；Gate G 收口后标 **已完成**）。
- 总体任务：`wasm-generic-min-validation-coverage-audit` **必须继续保持开发中**——G8 的 242 candidates 全量重分类与覆盖率汇总尚未执行；本 feature 闭环 **不等于** 总体审计可收口。
- `wasm-min-validation-data-spec` **不得**因本批收口改为完成。
- 本设计文档本身的完成 **不等于** feature 完成；feature 完成以实现 + live publish + 浏览器 E2E + 验证记录 + 治理映射为准。

## 12. 停止条件（全局）

若出现以下任一情况，**停止并报告**，不得自行扩范围：

1. task_rules / 治理 schema 无法表达本 feature 任务。
2. 完成本设计或实现必须改写需求澄清 / 概要设计文档。
3. 必须新建 detail family、新 endpoint 或新 operation kind。
4. 必须引入 RNG / run-input crit 策略才能通过验收。
5. 必须实现条件 modifier、跨 combatant modifier 或可执行 pipeline modifier 才能宣称本批完成。
6. 必须改 legacy DPS lane 或公共导出函数集。
7. Phantom 无法在不破坏 Guinsoo 合同下避免二次 crit 结算。
