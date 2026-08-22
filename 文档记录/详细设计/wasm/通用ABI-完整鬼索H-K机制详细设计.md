TASK_KEY: wasm-generic-guinsoo-hk
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-15

# 通用 ABI — 完整鬼索 H-K 机制详细设计

测试记录：[通用 ABI 完整鬼索 H-K 机制验证记录-2026-07-13](../../测试记录/wasm/最小验证剩余阻塞项汇总-2026-07-19.md)

可直接编码的详细设计。写作真源已由主代理审计；实现以本文合同为准。

## 1. 目标

在通用 ABI / 通用引擎上完整落地 Guinsoo's Rageblade（`item_3124`）的 **H–K** 机制，并与已有 **30 magic on-hit** 共存：

| 能力 | 合同摘要 |
|------|----------|
| H 层数 | 每次真实 `basic_attack_hit` 增加 `guinsoos_seething_strike`；最多 **4** 层；持续 **3000ms**；真实命中刷新；到期归零 |
| H 攻速 | 每层 **+8%** `attack_speed`，影响**下一次**普攻间隔；到期恢复 |
| K 幻影 | 满 **4** 层后，仅每第 **3** 次后续真实命中在**全部原始 listener 完成**后做一次 phantom replay；连续攻击为第 **7/10/13…** 次 |
| K 复制范围 | 只复制本事件显式 `copyable_on_hit=true` 的 **damage** |
| 已有能力 | `item_3124` 已有 30 magic on-hit，保持不变并参与正常 on-hit 顺序 |

实现须覆盖 **Wasm 通用合同 → Backend schema/API/seed → Web combatData 投影与真实 loader 链路**，使 live 组合（Guinsoo + BotRK + Kraken + Nashor 等）可编译、可运行、可验证。

## 2. 核心机制合同（H–K）

### 2.1 层数与刷新（H）

1. 触发条件：每次**真实** `basic_attack_hit`（非 phantom）。
2. State key：`guinsoos_seething_strike`。
3. 行为：
   - 每次真实命中 **+1**，上限 **4**。
   - 持续 **3000ms**；每次真实命中 **refresh-on-write**（刷新 `expireAt`）。
   - 到期：**value → 0**（lazy expire）。
4. 属性：每层使 `attack_speed` **+8%**（相对乘区按现有 attr 公式约定）；层变化或到期须使相关属性 **dirty**，从而影响**下一次**普攻 `DriverRepeat` 间隔。

### 2.2 Phantom replay（K）

1. 前置：本次命中前 `guinsoos_seething_strike=4`；第 4 次攻击只完成满层，不计入 phantom cadence。
2. Cadence state：`guinsoos_phantom_hit_counter`，`max=3`、`duration=3000ms`、`refresh-on-write`；满层后的真实命中才推进，达到 3 后触发并重置为 0。
3. 连续攻击序列：1–4 建层，5–6 推进 cadence，第 7 次首次 phantom；后续第 10/13… 次各一次。
4. 时机：该次真实 `basic_attack_hit` 的 **所有原始 listener / operation 全部完成之后**，再执行 **deferred replay** 一次。
5. 复制集合：仅本事件过程中显式标记 `copyable_on_hit=true` 的 **damage** 条目。
6. 复制保留：
   - 原 `provider` / `step`
   - 原 `source` / `target`
   - 原 **entry snapshot**（抗性与伤害结算以 snapshot 为准）
   - 证据增补：`phantom`、`repeatTag`、`replayedFrom`
7. Phantom **禁止**：
   - 增加普攻次数 / cast 次数
   - `emit basic_attack_hit` / 运行 listener / **递归** phantom
   - 推进 every-N、stack、energized、next-attack
   - 复制 retaliation / DoT / modifier / state 写入
8. 跨 provider：可复制已标记的 BotRK / Nashor / Terminus / Guinsoo 等 on-hit damage；**默认不复制** Kraken every-N、Vayne W 等依赖状态推进的伤害。
9. 顺序（单次真实普攻命中）：

```
基础普攻伤害
  → emit basic_attack_hit
  → 全部原始 listener / operation（满层时 cadence+1、加层/刷新、普通 on-hit、可标记 damage 收集）
  → deferred phantom replay（仅 cadence 达 3 且有 copyable 集合）
  → 若已触发则 cadence reset=0
  → 结束
```

### 2.3 与现有 30 magic on-hit 的关系

- Guinsoo 自带的 30 magic on-hit 走普通 listener 路径。
- 若该 damage 标记 `copyableOnHit=true`，则可被满层 phantom 复制一次；否则不进复制集合。
- 加层 operation 与普通 on-hit 均在原始阶段完成，**早于** deferred replay。

## 3. Wasm 通用合同

### 3.1 Provider state field

- State field 元数据支持：`max`、`duration`、`refresh-on-write`。
- State bag 保存：`value`、`expireAt`。
- **Lazy expire**：读取/使用时若已过期则归零，并使相关属性 **dirty**。
- 写路径：按 `max` 封顶；若 `refresh-on-write` 则更新 `expireAt = now + duration`。

### 3.2 Modifier 与 provider.state

- Modifier 按 **mounted `providerRef`** 带独立 `provider.state` context。
- 公式可读：`provider.state.<key>`（例如层数参与攻速加成）。
- 层/到期变化 → dirty → 属性重算 → 下一击 cadence 更新。

### 3.3 DriverRepeat：`intervalFormula`

- 新增可选字段 **`intervalFormula`**，与 **`intervalMs` 互斥**。
- 每次 cast 后用**最新** source attr 求下一间隔。
- Basic attack 约定公式：`1000 / source.attr.attack_speed.resolved`。
- 编译期：正数校验、互斥校验。

### 3.4 Damage `copyableOnHit` 与 `repeat` operation

**Damage operation**

- 新增布尔：`copyableOnHit`（序列化/JSON 侧与后端字段对齐；运行时事件局部收集）。

**新增 `repeat` operation**

| 字段 | 合同 |
|------|------|
| `repeatScope` | `copyable_on_hit` |
| `repeatCount` | `1`（本机制固定一次） |
| `repeatTag` | 证据标记，写入 phantom evidence |
| `triggerStateKey` | `guinsoos_seething_strike`（repeat 仍以满层为门） |
| `threshold` | `4` |

**运行时**

- **Event-local collector**：原始 listener 执行期间，凡 `copyableOnHit=true` 的 damage 入集。
- **Cadence gate**：满层前不推进 `guinsoos_phantom_hit_counter`；满层后每次真实命中 `+1`，达到 3 才允许 repeat，并在 repeat 后 reset。
- **Deferred replay**：全部原始 listener 完成后，若满层门与 cadence 门同时成立，按 collector 回放 damage；不再 emit、不再跑 listener、不再二次收集。

### 3.5 Compile（collect-all）校验

须校验：

1. `intervalMs` / `intervalFormula` **互斥**；若用 formula，求值语义合法。
2. State 引用存在；`max` / `duration` 为正数（若出现）。
3. `repeatScope` 仅允许合同枚举（本机制：`copyable_on_hit`）。
4. `copyableOnHit` **仅允许出现在 damage**；`repeat` 合同字段完整（scope/count/tag/trigger/threshold）。
5. 相关正数约束（`repeatCount`、`threshold`、duration 等）。

### 3.6 Damage evidence 与 summary

- Evidence 区分 **`original` / `phantom`**（及 `repeatTag`、`replayedFrom`）。
- Summary 的 **attack / cast 计数不因 phantom 增加**。

## 4. Backend 合同

全链路必须明确落地（缺一不可）：

1. **`schema.sql` + 兼容 migration**
2. **triggers / partition / log**
3. **mapper / service / API**
4. 测试覆盖唯一性与幂等升级路径

### 4.1 数据与规范化

| 主题 | 要求 |
|------|------|
| State field 元数据 | `max`、`duration`、`refresh`（refresh-on-write） |
| Damage | `copyable` / `copyable_on_hit` 布尔落库并可 API 读写 |
| Repeat | **规范化 repeat detail**（scope/count/tag/triggerStateKey/threshold） |
| Modifier | 与 state / per-stack 关联可表达（供每层 8% 攻速） |
| Reserved ID | 实现时从**空闲区**分配，并测**唯一性** |

### 4.2 Seed：`provider_item_3124_guinsoos`

- **幂等升级**；**单事务**。
- 使用 **candidate revision**、**material-change** 判定。
- **无 DELETE**；**不 publish**（保持既有发布流程边界）。
- 内容须表达：30 magic on-hit（既有）+ 层 state + 攻速 modifier + 满层 `repeat(copyable_on_hit)`；相关可复制 on-hit damage 打标策略与 Canonical 一致。

## 5. Web 合同

1. 同步类型与组装：
   - `combatData` 类型 / client / assembler / detail
   - `genericEngine` 相关类型（若 repeat / copyable / intervalFormula / state 元数据需投影）
2. Basic attack driver 投影 **`intervalFormula`**（`1000/source.attr.attack_speed.resolved`），与 `intervalMs` 互斥。
3. **页面不计算** stack / phantom；只展示引擎证据与 summary。
4. 真实链路：`loader → assembler → worker/bridge → compile/run/release`。

## 6. 分模块文件范围（已知入口）

实现时按下列入口改动；**reserved ID 与空闲区探测在编码期完成**，本文不预分配具体数字。

### 6.1 Wasm

| 区域 | 路径 |
|------|------|
| 模型 | `internal/model/generic_compile.go` |
| 编译 | `internal/compile/generic*.go` |
| 运行时执行 | `internal/runtime/generic_execution.go` |
| Provider state | `internal/runtime/generic_provider_state.go` |
| Provider | `internal/runtime/generic_provider.go` |
| Run 入口 | `internal/runtime/generic_run.go` |
| 属性 | `internal/pipeline/attribute_resolver.go` |
| 测试 | `internal/…/generic_guinsoo_hk_test.go`（新建，覆盖 H–K Canonical） |

### 6.2 Backend

| 区域 | 路径 |
|------|------|
| DB | `db/game_manage` 下 `schema` / `migrations` / `triggers` / `seeds` |
| 应用 | `mapper` / `service` / API 层及对应 **tests** |

须覆盖：state 元数据、damage copyable、repeat detail 规范化、modifier↔state 关联、seed 幂等升级、ID 唯一性。

### 6.3 Web

| 区域 | 路径 |
|------|------|
| 类型 | `types/combatData.ts`、`types/genericEngine.ts` |
| 客户端/组装 | `combatDataClient.ts`、`combatDataAssembler.ts` |
| 页面/测试 | 相关 `tests` / page（只消费证据，不算层/phantom） |

## 7. 实现步骤

### 步骤 A — Wasm 合同落地

1. State field：`guinsoos_seething_strike(max=4)` 与 `guinsoos_phantom_hit_counter(max=3)` 均为 3000ms refresh-on-write；bag：`value`/`expireAt`；lazy expire + dirty。
2. Modifier：`provider.state.<key>` 可读；攻速每层 +8%。
3. `DriverRepeat.intervalFormula` 与 `intervalMs` 互斥；普攻用 `1000/source.attr.attack_speed.resolved`。
4. Damage `copyableOnHit`；event-local collector。
5. `repeat` operation：`copyable_on_hit` + 满层门 + every-third cadence 门；listener 完成后 deferred replay，随后 counter reset。
6. Evidence：`original`/`phantom`/`repeatTag`/`replayedFrom`；summary 不增加 attack/cast。
7. Compile collect-all 校验全集。
8. 单测 `generic_guinsoo_hk_test.go` 覆盖第 9 节 Canonical。

### 步骤 B — Backend 全链路

1. `schema.sql` + 兼容 migration + triggers/partition/log。
2. Mapper/service/API：state 元数据、copyable、repeat detail、modifier 关联。
3. Reserved ID 从空闲区分配并测唯一性。
4. Seed `provider_item_3124_guinsoos`：单事务、candidate revision、material-change、无 DELETE、不 publish。

### 步骤 C — Web 投影与真实跑通

1. 同步 `combatData` / `genericEngine` 类型与 client/assembler/detail。
2. Basic attack driver 投影 `intervalFormula`。
3. 页面只展示、不算 stack/phantom。
4. 真实 loader→assembler→worker/bridge→compile/run/release。

### 步骤 D — Live 组合验收

1. Guinsoo + BotRK + Kraken + Nashor（及设计所需 Terminus 等标记伤害）。
2. 记录 **revision / version / wasm hash**。
3. 跑完 G0–G9；验证记录见本文首部链接。

## 8. 非目标

- 不复活旧 DPS DTO。
- 不让整个常驻装备 provider 过期（仅 stack state 到期归零）。
- 不复制非 damage（retaliation / DoT / modifier / state 等）。
- 不实现 spellblade / energized / execute / crit（本任务范围外）。

## 9. Canonical 验收要点

编码与单测必须以下列命题为准：

1. **层数与 cadence**：真实命中 1→2→3→4；第 4 击只满层；第 5/6 击 counter=1/2，第 7 击首次 phantom 并 reset；连续攻击后续为 10/13…；超过 3000ms 的 gap 同时清空层数与 cadence progress。
2. **攻速**：每层 +8%；影响**下一击** cadence；到期恢复。
3. **跨 provider**：复制集合跨 provider，且与 listener **挂载顺序无关**（只依赖本事件 copyable 收集结果）。
4. **不递归**：phantom 不再 emit / 不再跑 listener / 不再二次 phantom。
5. **不推进**：Hullbreaker / Kraken every-N / Vayne W 等状态机默认不因 phantom 推进。
6. **不消费** next-attack 类充能。
7. **不复制** retaliation。
8. **抗性与 entry snapshot**：phantom damage 使用原 entry snapshot。
9. **Live 组合**：Guinsoo + BotRK + Kraken + Nashor；记录 revision / version / wasm hash。

## 10. G0–G9 验证门禁

| Gate | 验证内容 | 通过标准 |
|------|----------|----------|
| **G0** | 合同与编译边界 | `intervalMs`∩`intervalFormula` 互斥；`copyableOnHit` 仅 damage；`repeat` 字段与 scope 合法；非法配置 compile 失败 |
| **G1** | State 写入/封顶 | `seething` 连续真实命中层数 1..4、`max=4`；满层后的 cadence counter 1..3、`max=3` |
| **G2** | 刷新与到期 | 两个 state 均随合格真实命中刷新；3000ms 无命中后 lazy expire → 0，旧 cadence progress 不得跨 gap 触发 |
| **G3** | 攻速与 cadence | 每层 +8% 反映到 `attack_speed.resolved`；`DriverRepeat` 下一间隔 = `1000/resolved`；到期恢复间隔 |
| **G4** | 原始 on-hit 顺序 | 基础伤害 → emit → 全部原始 listener（cadence+1 / 加层与 30 magic）→ cadence=3 时 replay → reset；未满层或 counter<3 无 replay |
| **G5** | Phantom 复制集合 | 仅 `copyable_on_hit=true` 的 damage；跨 provider；顺序无关；BotRK/Nashor/Terminus/Guinsoo 标记项可入集 |
| **G6** | Phantom 禁区 | 不增加 attack/cast；不 emit；不跑 listener；不递归；不推进 every-N/stack/energized/next-attack；不复制 retaliation/DoT/modifier/state |
| **G7** | Evidence / summary | damage evidence 含 original vs phantom，且含 repeatTag/replayedFrom；summary attack/cast 不因 phantom +1 |
| **G8** | Backend+Seed+Web | schema/migration/API 可读回；seed 幂等升级成功；Web assembler 投影 intervalFormula/copyable/repeat/state；页面不算层 |
| **G9** | Live 组合 | Guinsoo+BotRK+Kraken+Nashor 真实 compile/run；Kraken/Vayne 类默认不因 phantom 推进；产出并保留 revision/version/wasm hash |

## 11. 实现约束备忘

- Phantom 是 **deferred damage replay**，不是第二次 `basic_attack_hit`。
- Collector 生命周期 = **单次真实命中事件**；事件结束清空。
- Snapshot：phantom 使用收集当时的 entry snapshot，避免 replay 时抗性/修饰被后续逻辑污染。
- Seed / API **不 publish**；发布流程保持原边界。
- 本文 STATUS=`done`；验收事实见验证记录。
