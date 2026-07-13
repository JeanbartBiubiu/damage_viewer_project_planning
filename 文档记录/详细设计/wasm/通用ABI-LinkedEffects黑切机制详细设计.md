TASK_KEY: wasm-generic-linked-effects-black-cleaver
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: active
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-13

# 通用 ABI — Linked Effects（黑色切割者）机制详细设计

对应总体审计：`wasm-generic-min-validation-coverage-audit`。本批只关闭 **linked effects 首批**（黑切 Carve 最小闭环）；总体审计继续保持 **开发中 / active**，后续顺序为 crit / modifier。

本批是机制迁移最小闭环，**不冒充完整 LoL 语义**（无 6 秒持续、刷新、掉层）。

## 1. 目标与固定样本

| 项 | 合同 |
| --- | --- |
| 代表装备 | Black Cleaver `item_3071` |
| Provider | `provider_item_3071_black_cleaver_carve` |
| 旧机制忠迁 | attacker-owned；真实伤害；`on_damage_dealt + physical + real_basic_attack_only` |
| 效果 | 每次合格物理普攻伤害后，目标 armor **-4**，`carve_stacks` **+1**；最多 **5** 层（100→80）；第 6 次不变 |
| 持续 | **run 内永久**；明确非正式 6s / refresh / drop |

## 2. 非目标

1. 不实现正式 LoL Carve 的 6 秒持续、刷新、掉层。
2. 不实现 retaliation / DoT / spell damage / multi-target / any-damage linked effects。
3. 不创建 provider modifier（无法把 attacker provider modifier 跨角色施加到 opponent）。
4. 不创建 `provider_state_fields` cap（当前 cap/expiry 只适用于 provider state，**不适用于** `provider_target` 的 targetValues；层数上限用 condition 表达）。
5. **不新增** Backend DDL、detail family、Admin/Public API、新 operation kind。
6. 不改 legacy DPS lane、公共 ABI DTO。
7. 默认不改 TypeScript；仅真实验证发现 assembler 缺口时另开修复 Gate。
8. Seed **无 DELETE**、**不自动 publish**；仅 material change 推 candidate revision。
9. 不因本批完成而收口总体审计任务。

## 3. 核心机制合同

### 3.1 自动合成 `event/damage_dealt`

在顶层 `chainDepth=0` 的 `ability/basic_attack` frame 中，若存在**至少一个**同时满足下列条件的 `damage/physical` operation，则在 **frame commit 之后**、**listener dispatch 之前**（或等价地插入现有 pending event 有序队列并随该队列派发），**恰好自动合成一次** `event/damage_dealt`：

| 条件 | 要求 |
| --- | --- |
| 真实 | 非 phantom replay |
| 非 phantom | `phantom=false` |
| 抗性后 amount | mitigated / post-mitigation amount **> 0** |
| damage type | catalog 分类为 `damage/physical` |

同 frame 多个合格物理 damage operation → **仍只合成一次**。

**不合成**（任一成立即跳过）：

- phantom replay
- `chainDepth > 0`（含 listener child ability / listener operations frame）
- ability TypeSet **不含** `ability/basic_attack`
- 无合格物理 damage（含全 0 mitigated、仅 magic/true）
- catalog 缺少合成所需分类 type（见 §3.2）→ **fail closed**，不得凭 ability key 字符串猜测

时序保证：第一击按**原 armor**结算；linked listener 只影响**后续**伤害。

### 3.2 自动事件 types 与 catalog fail-closed

自动 emitted event 的 **base types** 至少包含：

| type_key | 建议 reserved id | 说明 |
| --- | --- | --- |
| `event/damage_dealt` | **20200**（既有） | 根事件 |
| `event/damage_dealt/physical` | **20214**（本批新增） | event-domain qualifier |
| `event/damage_dealt/basic_attack` | **20215**（本批新增） | event-domain qualifier |

`event/source_owner` **不**写入 base event types；由既有 **owner-relative runtime augmentation** 在 matcher 求值时加入。

Compile / runtime 若 catalog 缺少上述任一分类 type（含 `ability/basic_attack`、`damage/physical`、三件 event vocabulary）：**fail closed**，禁止 abilityKey / 字符串启发式。

### 3.3 Listener 合同

| 项 | 合同 |
| --- | --- |
| Provider | `provider_item_3071_black_cleaver_carve`，mount → `item_3071` |
| Matcher | `match_mode/all`：`event/damage_dealt` + `event/damage_dealt/physical` + `event/damage_dealt/basic_attack` + `event/source_owner` |
| Sequence | 固定两步，顺序不可调换 |

**Step 1 — `attribute_change`**

| 字段 | 值 |
| --- | --- |
| operation | `attribute_change` |
| target | `target` |
| attributeKey | `armor` |
| valuePolicy | `add` |
| amount formula | 常量 `-4` |
| condition | `provider.target_state.carve_stacks < 5` |

**Step 2 — `state_change`**

| 字段 | 值 |
| --- | --- |
| operation | `state_change` |
| target | `self` |
| types / scope | `state_scope/provider_target` |
| ref / state_key | `carve_stacks` |
| valuePolicy | `add` |
| amount formula | 常量 `1` |
| condition | 与 Step 1 **相同**：`provider.target_state.carve_stacks < 5` |

层数可见性：`finalSnapshot.providerState` 的 **targetState**（或合同等价路径）中可读 `carve_stacks`。

### 3.4 叠层与数值表（Canonical）

初始目标 armor=100、`carve_stacks=0`。每次合格真实普攻物理伤害后：

| 击序 | 本击结算 armor | 击后 armor | 击后 stacks |
| --- | --- | --- | --- |
| 1 | **100** | 96 | 1 |
| 2 | 96 | 92 | 2 |
| 3 | 92 | 88 | 3 |
| 4 | 88 | 84 | 4 |
| 5 | 84 | **80** | **5** |
| 6 | **80**（不变） | 80 | 5 |

### 3.5 防递归与禁区

| 场景 | 合同 |
| --- | --- |
| Phantom replay | 不自动合成 `damage_dealt`；不叠层；不改 armor |
| Listener child damage | 不递归合成 `damage_dealt` |
| Magic / 非 basic physical | 不触发 listener |
| Mitigated amount = 0 | 不合成事件 → 不叠层 |
| Target-owned 同名 matcher | 不得误匹配 attacker-owned 黑切 listener（依赖 `event/source_owner`） |
| `MaxCommandsPerEvent=1` | linked listener 两 commands → **fatal**；正常预算通过 |

### 3.6 Evidence / Provenance

每次自动 `emitted_event` 至少记录：

- `source` / `target` / `eventType`
- `damageType`（物理）
- `abilityRef`
- `operationRef`（同 frame 多 physical damage 时可稳定聚合或列出）
- `rawAmount` / `mitigatedAmount`
- `phantom=false`

原 damage evidence 合同保持不变。`finalSnapshot` 必须能证明 armor 与 `carve_stacks`。

## 4. Backend / Data 合同

### 4.1 范围边界

| 动作 | 本批 |
| --- | --- |
| 新 DDL / detail family | **否** |
| 新 Backend API | **否** |
| `reserved_types_seed.sql` | **是**：增加 20214 / 20215 及 event group relation（parent **10019**） |
| 新幂等 seed | **是**：`db/game_manage/seeds/lol_generic_linked_effects_seed.sql` |
| 数据图复用 | 既有 `attribute_effect_details`、`state_effect_details`、effect step condition formula、listener matcher |

Seed 只投影：所需 reserved types、provider / mount / formulas / listener / sequence / steps / details。**无 DELETE**、**不自动 publish**；仅 material change 推 candidate revision。

### 4.2 Live revision 路径

| 阶段 | 预期 |
| --- | --- |
| 基线 | **16/16**（execute 闭环后） |
| seed 后 | **17/16** |
| 幂等重跑 | 仍 **17/16** |
| 显式 publish `lol-generic-linked-effects-v1-20260713` | **17/17** |

编码前核对 version 码未占用；若 live 基线已漂移，以 material-change 可解释的实际数字为准并回写验证记录。

### 4.3 依赖既有 vocabulary（实施前核对）

须已存在（来自既有闭环；本批不新造，缺则 **停止报告**）：

- `event/damage_dealt`（20200）
- `event/source_owner`（owner-relative augmentation）
- `ability/basic_attack`（game-local TypeSet 分类，Spellblade 批起）
- `damage/physical`（20220）
- `state_scope/provider_target`（薇恩闭环起）
- `attribute_change` / `state_change` / condition formula 投影路径
- `item_3071` 静态度实体（Batch C）；本批只补 Carve provider 图

本批**仅新增** reserved：`event/damage_dealt/physical` **20214**、`event/damage_dealt/basic_attack` **20215**。

## 5. Wasm 写入范围

### 5.1 建议最小文件

| 路径 | 角色 |
| --- | --- |
| `wasm/tinygo_engine_v2/internal/runtime/generic_execution.go` | 顶层 basic_attack frame 自动合成 `damage_dealt`（commit 后 / pending 队列内）；证据字段 |
| `wasm/tinygo_engine_v2/internal/runtime/generic_linked_effects_test.go` | **新建** Canonical 矩阵 |
| 同目录测试辅助 | **仅当**夹具确有必要时最小修改 |

### 5.2 禁止

- legacy DPS lane / dispatcher
- 公共 ABI DTO
- 新增 operation kind
- 默认可避免的 model / compile / pipeline 面扩张；若阻塞 → **停止并报告**，另开合同

### 5.3 派发点合同

在 `castAbilityAt(..., chainDepth=0)`：原 frame operations 执行并 **commit** → 判定是否合成自动 `damage_dealt` 并进入 pending 有序队列 → `dispatchPendingEvents` / listener dispatch。listener 内 child damage **不得**再次自动合成。

## 6. Web 写入范围

- 现有 assembler 理论上已支持 attribute/state detail、condition formula、event matcher → **默认零 TypeScript 改动**。
- Wasm 构建成功后同步最终 wasm artifact 到 Web 既有位置。
- 跑 lint / typecheck / Vitest / build。
- 仅真实验证发现缺口时另开修复 Gate（不在本设计会话写入）。

## 7. 测试矩阵（必须）

### 7.1 Runtime / Wasm

| # | 命题 | 通过标准 |
| --- | --- | --- |
| W1 | 第 1 击 | 按 100 armor 结算；随后 armor=96、stacks=1 |
| W2 | 第 5 击后 | armor=80、stacks=5 |
| W3 | 第 6 击 | armor/stacks 不变 |
| W4 | Magic | 不触发 |
| W5 | 非 basic physical | 不触发 |
| W6 | mitigated=0 | 不合成 / 不叠层 |
| W7 | 同 frame 多 physical damage | 只叠 1 层、只合成 1 次事件 |
| W8 | Phantom | 不合成、不叠层 |
| W9 | Listener child damage | 不递归合成 |
| W10 | Target-owned listener | 不误匹配 |
| W11 | Catalog qualifier 缺失 | fail closed |
| W12 | `MaxCommandsPerEvent=1` | linked 两 commands fatal；正常预算通过 |
| W13 | Evidence | emitted_event provenance 稳定；damage evidence 原合同保持 |
| W14 | Snapshot | finalSnapshot 可证明 armor 与 carve_stacks |

工程门禁：targeted runtime tests → `go test ./...` → bench → wasm build → Node smoke。

### 7.2 Backend

| # | 命题 | 通过标准 |
| --- | --- | --- |
| B1 | reserved | 20214/20215 + event group relation 静态可证 |
| B2 | seed 图 | provider/mount/listener/sequence/steps/details/formulas 合同键稳定 |
| B3 | 安全 | 无 DELETE；无 auto publish；幂等 |
| B4 | revision | 16/16→17/16→（幂等）17/16→ publish 17/17 |
| B5 | version | `lol-generic-linked-effects-v1-20260713` |

工程门禁：targeted SQL static tests + 全量 Maven。

### 7.3 Web / Live / Browser

| # | 命题 | 通过标准 |
| --- | --- | --- |
| F1 | Web 工程 | lint / typecheck / Vitest / build |
| F2 | Artifact | wasm hash 与构建一致 |
| F3 | Live | 幂等与显式 publish 路径成立 |
| F4 | Browser | Generic validation：compile / run / release；黑切叠层证据与 snapshot |

## 8. 分 Gate 开发顺序

### Gate A — Reserved + Seed（Backend）

目标：补种 20214/20215；新增 `lol_generic_linked_effects_seed.sql` + 静态测试；不碰 live 直至显式确认。

验证：targeted SQL tests + `mvn test`。

停止：缺既有 vocabulary / `item_3071` 无法挂载且无法在允许范围内修复 → 报告。

### Gate B — Wasm

目标：自动 `damage_dealt` 合成 + Canonical linked effects 测试矩阵。

验证：§7.1 命令集。

停止：必须新增 operation / 改公共 ABI / 复活 legacy DPS → 报告。

### Gate C — Web

目标：默认同步 wasm artifact；工程门禁通过。缺口另开 Gate。

### Gate D — Live publish + Browser E2E

顺序：reserved → linked seed → 幂等核对 → 显式 publish → browser compile/run/release。

### Gate E — Governance

新增验证记录；将本 feature 任务标完成；**总体审计仍开发中**。

## 9. 与总体审计关系

- Feature 任务：`wasm-generic-linked-effects-black-cleaver`（本文）。
- 总体任务：`wasm-generic-min-validation-coverage-audit` 保持 **开发中**。
- 后续：crit / modifier。

## 10. 停止条件（全局）

若出现以下任一情况，**停止并报告**，不得自行扩范围：

1. 必须新增 Backend DDL / detail family / API 才能表达本合同。
2. 必须新增 operation kind 或修改公共 ABI DTO。
3. 既有 `attribute_change` / `state_change` / `provider_target` / condition / ALL matcher 无法表达两步序列。
4. catalog 无法以 type vocabulary 区分 basic_attack / physical，只能靠 abilityKey 猜测。
5. task_rules / 治理 schema 无法映射本 feature 任务（本设计会话已验证可映射则不适用）。
