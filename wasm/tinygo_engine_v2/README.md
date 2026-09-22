# TinyGo Engine V2

`wasm/tinygo_engine_v2` 是 Damage Viewer 的 TinyGo Wasm 计算引擎正式落点。

当前 canonical 路径是 generic compile / session / run / release：

```text
CompileRequest -> engine_compile -> CompiledSession (sessionId + rulesHash)
RunRequest + sessionId/expectedRulesHash -> engine_run -> DoneResult
ReleaseSessionRequest -> engine_release_session -> release_result
```

更细的模块依赖与时序见 [`ARCHITECTURE.md`](ARCHITECTURE.md)。协作规则见 [`AGENTS.md`](AGENTS.md)。

## Review 顺序

| 阶段 | 阅读目标 | 关键文件 |
| --- | --- | --- |
| 1. 契约与 ABI | generic DTO、frame kind `200..214`、错误码、outbox 优先级 | `internal/model/generic*.go`、`internal/abi/frame.go`、`internal/abi/outbox.go` |
| 2. Wasm 入口 | 导出是否只做装配；session 是否唯一状态持有者 | `cmd/engine_wasm/main.go` |
| 3. 生命周期 | compile → registry → run → release | `internal/runtime/session.go` |
| 4. 编译层 | `CompileGeneric` → `CompiledSession`，collect-all | `internal/compile/generic.go`、`generic_validate.go` |
| 5. 运行主循环 | `RunGeneric`、gate、provider、execution、scheduler | `internal/runtime/generic_run.go`、`generic_execution.go`、`generic_gate.go`、`generic_provider*.go` |
| 6. 公式 / 类型集 / pipeline | 只读编译结果的消费边界 | `internal/formula/generic*.go`、`internal/typeset/generic.go`、`internal/pipeline/**` |
| 7. 验证契约 | canonical fixture + Node/Go bench | `internal/testkit/fixtures/generic_p0_basic_damage.json`、`scripts/smoke-node.mjs`、`cmd/bench` |

历史说明：旧 `engine_init` / `engine_begin_run` / `engine_step` 与 `dps_*.go` 单攻 DPS 曾作为 compat lane；现已从本模块源码与导出中移除。当前唯一业务 ABI 是 compile/run/release。

## 模块职责

```text
cmd/engine_wasm/          TinyGo 导出：alloc/dealloc + engine_compile/run/release_session + outbox_*
cmd/bench/                原生 Go benchmark（generic|generic-run；不支持/未知参数非零退出）
internal/abi/             frame header、outbox、内存桥接
internal/model/           generic*.go 为 canonical DTO；types.go 仅保留仍被引用的共享基础类型
internal/compile/         CompileGeneric → CompiledSession
internal/runtime/         Session registry + RunGeneric / generic execution
internal/scheduler/       generic 稳定事件堆
internal/formula/         generic formula compile/eval
internal/typeset/         flat type catalog/matcher
internal/pipeline/        数值变更统一 resolver
internal/{attribute,resource,command,status,shield,...}/  支撑子系统
internal/testkit/         fixture、ABI helper（含 generic_p0_*）
scripts/                  构建、generic ABI smoke、Node benchmark
targets/wasm-256m.json    256 MiB TinyGo wasm target
```

## 核心数据流

```text
宿主 alloc → 写入 compile frame (kind=200, CompileRequest JSON)
  → engine_compile → CompileGeneric → register session
  → outbox: compile_result{ok, sessionId, schemaHash, rulesHash} | error

宿主写入 run frame (kind=201, RunRequest: sessionId + expectedRulesHash + snapshot/driver/stop/sampling)
  → engine_run → hash/session 校验 → RunGeneric
  → outbox: generic done{summary, finalSnapshot, series, evidence...} | error

宿主写入 release frame (kind=202, sessionId + expectedRulesHash?)
  → engine_release_session → 删除 registry 项
  → outbox: release_result{ok, sessionId, released:true} | error

宿主 engine_outbox_ptr/len → 读帧 → engine_outbox_clear
```

## 当前已接入能力

普通减速与取强治疗的`source_target`（按来源与承受者）实例恢复必须提供真实来源、当前承受者、非空实例标识、单层与正到期时间；缺失不按自身或默认层数补齐。同一归属不能恢复两份实例，新生成标识不复用恢复过的标识。已到期记录允许输入但不贡献有效强度，再次施加建立新生命周期；期限必须为可表示的正整数毫秒。

| 区域 | 状态 | 说明 |
| --- | --- | --- |
| Generic ABI / frame / outbox | 已接入 | kind `200..214`；优先帧保留 |
| Session registry + hash 校验 | 已接入 | `session.go` Compile/Run/Release |
| `CompileGeneric` | 已接入 | collect-all；输出 `CompiledSession` |
| `RunGeneric` | 已接入 | driver plan、gate、damage/heal/resource、provider tick |
| 通用吸血 | 已接入 | 游戏规则与伤害例外；普通、复制伤害共用末尾吸血结算；治疗修正与逐次证据 |
| 跨来源状态合并与重施 | 已接入 | `source_target` 单层重施、普通减速取强快照、`effectiveStatuses`、治疗组 `ratio_max` |
| 命中供值与法术护盾 | 已接入 | `resolve_skill_hit` 单次 driver、`skillUses`/`skillHitFacts`、四档阻挡与 `event/spell_shield_blocked` |
| 同次使用、固定时间窗与普攻原生事件 | 已接入 | `listener.condition` 冻结、`oncePerUse` 专用账本、`start_on_first_write`、`operation.outputRef`、`event/basic_attack_*` |
| Canonical fixture | 已接入 | `generic_p0_basic_damage.json`（targetFinalHp=900） |
| Node smoke | 已接入 | 真实 compile/run/release round-trip |
| Node / Go bench | 已接入 | `--mode generic-run` / `go run ./cmd/bench` 默认 generic |

## 常用命令

在 `wasm/tinygo_engine_v2/` 目录执行：

```powershell
go test -count=1 ./...
go run ./cmd/bench
powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1
node .\scripts\smoke-node.mjs
node .\scripts\bench-node.mjs --mode generic-run --iterations 10 --warmup 2
```

TinyGo 不在 `PATH` 时：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1 -TinyGo "C:\path\to\tinygo.exe"
```

### TinyGo 工具链定位

`Get-Command tinygo` 或 `where.exe tinygo` 未命中只表示当前终端的 `PATH` 没有 TinyGo，不代表机器上未安装。当前项目级 TinyGo 0.40.1 位于：

```text
C:\project\tinygo0.40.1\tinygo\bin\tinygo.exe
C:\project\tinygo0.40.1\tinygo\targets\wasm_exec.js
```

可直接复核版本：

```powershell
& 'C:\project\tinygo0.40.1\tinygo\bin\tinygo.exe' version
```

`build-wasm.ps1` 会先解析传入值或 `PATH` 中的 `tinygo`；默认值未命中时，再依次查找仓库级 `.tools\tinygo0.40.1\tinygo\bin\tinygo.exe` 和项目级 `C:\project\tinygo0.40.1\tinygo\bin\tinygo.exe`。因此在当前项目布局中无需修改全局 `PATH`，直接运行默认构建命令即可。工具移动到其它位置时再显式传入 `-TinyGo`。

Node 宿主必须加载与编译器同版本的 `wasm_exec.js`；仓库脚本同样会查找上述工具目录，也可用 `TINYGO_WASM_EXEC` 显式指定。

## 构建

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1
```

等价于：

```powershell
tinygo build -scheduler=none -no-debug -opt=z -target .\targets\wasm-256m.json -o .\dist\tinygo_engine_v2.wasm .\cmd\engine_wasm
```

## ABI 摘要（canonical）

```text
alloc(size) -> ptr
dealloc(ptr, size)
engine_compile(ptr, size) -> 0/-1
engine_run(ptr, size) -> 0/-1
engine_release_session(ptr, size) -> 0/-1
engine_outbox_ptr() -> ptr
engine_outbox_len() -> len
engine_outbox_clear()
```

## 约束

- `targets/wasm-256m.json` 固定 256 MiB initial/max memory。
- 构建默认 `-scheduler=none -no-debug -opt=z`。
- 网络、缓存、版本协商、文件加载留在 JS/Worker；TinyGo 只接收准备好的 frame payload。
- 勿修改或复制 canonical fixture；smoke/bench 直接复用。

## Generic runtime 精度契约（事件快照 / 抗性 / expected crit）

### Event snapshot formula reads

Listener / child ability 公式可读：

- `event.entry_source|entry_target.attr.<key>[.base|.current|.max|.resolved]`
- `event.entry_source|entry_target.resource.<key>[.current|.max]`
- `event.source|target.attr.<key>[.base|.current|.max|.resolved]`
- `event.source|target.resource.<key>[.current|.max]`

语义：`entry_*` 为父 execution frame 创建时（cost/CD/ops 前）深拷贝；`event.source/target` 为 `emit_event` 当点 staged 深拷贝。参与者始终是原始 emittedEvent source/target，不随 owner-relative listener 重映射。无 event context（driver cast / provider tick）读取 `event.*` 返回结构化 formula error。

Resource 路径（含 `source/target/event`）支持 `.current`/`.max`；无 suffix 默认 current。

### Damage resistance

Pipeline：`raw → (optional expected crit) → target resistance（含 source penetration）→ shields → HP clipping`。

- `physical` / `damage/physical` → `armor.resolved`
- `magic` / `damage/magic` / `magical` / `damage/magical` → `magic_resist.resolved`
- `true` / `damage/true` → 跳过抗性与穿透

Source-side 穿透（读 source `*.resolved`，first finite wins）：

- physical percent：`armor_pen_percent` → `armor_pen_pct` → `physical_pen_percent` → `physical_pen_pct`
- physical flat：`armor_pen_flat` → `physical_pen` → `physical_pen_flat` → `lethality`
- magic percent：`magic_pen_percent` → `magic_pen_pct`
- magic flat：`magic_pen_flat` → `magic_pen`

顺序与钳制：percent clamp 到 `[0,1]`，忽略负 flat；先 percent 后 flat。正基础抗性穿透后 floor 到 `0`；非正基础抗性不应用穿透，沿用既有负抗性公式。`MitigateRawDamage` / `ResolveCommand` 仍为无 source 兼容包装；generic 真实伤害与 phantom replay 走 source-aware 路径（phantom 使用冻结的 event-entry source attrs + entry target 抗性）。旧 `single_attacker_dps` 抗性路径已随 legacy lane 删除。

公式：`R>=0: amount*100/(100+R)`；`R<0: amount*(2-100/(100-R))`（R 为穿透后有效抗性）。未知 damage type 在 compile collect-all 拒绝。`Result.Amount` / summary `damageDealt` 使用 mitigated（抗性后、护盾前）；HP clipping 不反向改 summary。成功 settlement 的 damage evidence 额外暴露 `resistanceBeforePenetration` / `penetrationPercent` / `penetrationFlat` / `effectiveResistance` / `resistanceFactor`（true/zero 为稳定 0 / factor 1）；fail-closed 与 phantom 省略。

### Expected crit（`critEligible`）

仅当 damage operation 显式 `critEligible=true` 时，在抗性前做固定确定性 `expected` 结算（无 RNG、无 run-input 策略）：

```text
chanceEffective = clamp(source.attr.crit_chance.resolved, 0, 1)
multiplier      = max(source.attr.crit_damage.resolved, 1)
critAdjustedRaw = baseRaw*(1-chanceEffective) + baseRaw*chanceEffective*multiplier
```

缺省 / 非 finite 的 `crit_chance` / `crit_damage` 结构化失败，不静默造值。非 eligible damage 跳过整段。Canonical Infinity Edge：chance `0.25`、multiplier `2.3`、标量 `1.325`。

Evidence kind 仍为 `damage`：eligible 行含 `policy=expected`、chance*/multiplier、base/parts/`critAdjustedRawAmount`；`rawAmount` = post-crit raw。Phantom replay 冻结真实命中的 post-crit raw 与 crit 证据，不二次结算、不额外 emit、不增加 crit 专用 command budget。

### Provider tick / TickSpec（含 target-state-anchored）

Tick ability 的 `TickSpec`：

- `intervalMs` / `onTick` / 可选 `startDelayMs`（非锚定且省略时默认 = `intervalMs`）。
- 可选成对 `anchorScope` + `anchorStateKey`：同省略 = 既有 mount/run provider tick；同存在 = target-state-anchored（当前仅 `state_scope/provider_target`）；半对 collect-all 拒绝。
- 锚定配对校验在 start-delay 默认化**之前**；锚定要求 `startDelayMs` 省略或 0（不默认成 interval）。
- 锚定不在 mount/seed 启动；首次合格 `provider_target` 写入启动；触顶钳制 refresh 重启 cadence。
- 调度类别 `GenericCategoryAnchoredTick` 在 expire cleanup 之前；活跃绑定使用 `bag.targetKey`。
- inclusive-at-expiry：仅在公式/pipeline 求值窗口内保持可见；不改全局 expiry 语义。

### Cast origin / cast instance / per-cast throttle

ABI（向后兼容，字段均可省略）：

- Ability `castOrigin`：可选枚举 `champion|item|pet|innate`（非空非法值 collect-all 拒绝）。
- Listener `perCastThrottleMs`：可选非负整数；省略/`0` 保持旧行为。`>0` 时要求 `eventMatcher.all` 含 `event/damage_instance`（需要 cast-instance 事件上下文）。
- Operation `repeatDelayMs`：可选非负整数毫秒；仅 `operation=repeat` 允许非零。省略/`0` 保持即时 phantom replay；`>0` 时在原事件时刻冻结合格 provenance，并入队 `GenericCategoryTriggeredContinuation` 事件于 `nowMs+repeatDelayMs`（独立 `MaxCommandsPerEvent` 计数，不继承原 hit collector 余额）。

运行时：

- 每次成功顶层 cast（driver / TickSpec / Listener `AbilityRef` 完整 child ability）mint 单调 `uint64` cast instance ID（从 1 起）；同 cast 多 op / listener Operations 子伤害继承 ID+origin。
- Event TypeSet 附加恰好一个已知 `cast_origin/<origin>`；damage evidence / emitted event data 暴露 `castInstanceId`（float64）与 `castOrigin`（非公式输入）。
- Pipeline damage context 可读：`damage.cast_origin.<key>`、`damage.ability_type.<key>`（catalog 校验；未知 compile 拒绝；运行时不匹配返回 0）。casting ability TypeSet 在 pipeline 前可用。
- 延迟 repeat：listener flush 先完成全部 delay=0 即时回放；再评估正延迟触发并 enqueue。continuation handler 消费 run-local payload、按冻结 raw/crit/entry 抗性施加 phantom，不重收集、不二次 repeat。超出 duration 或原 hit 已 death-stop 时不执行；堆 push 失败为 run error。

Per-cast throttle 安全边界：

- 表键：`listenerIndex + ownerCombatantKey + ownerProviderRef + castInstanceId → lastTriggerMs`；缺表项或 `now-last >= PerCastThrottleMs` 允许触发；重叠 cast 独立。
- 容量 `min(4096, max(256, MaxEvents))`。溢出按最小 `castInstanceId` 驱逐（并列 listenerIndex → combatantKey → providerRef）；每次 run 至多一条 `per_cast_throttle_overflow` 警告。表在 run 结束丢弃。

### 通用吸血与治疗修正

方案唯一来源为规划工作树的《管理页面与共性机制迭代计划》第3项。本模块负责通用编译与结算，不承担任意管理技能的完整装配。

- `rules.vampRules`（游戏吸血规则）每种类型至多一条，类型顺序为生命偷取、全能吸血、物理吸血、法术吸血。比例读取规则指定的来源属性，不由伤害操作重复保存。
- `targetMatcher`、`abilityMatcher`、`damageMatcher`（目标、能力、伤害匹配器）分别只引用 `combatant`、`ability`、`damage_trait` 类型域，三者同时成立。必须有正向约束；类型来自 `Types`，不使用 `Tags`。
- 有规则时，伤害必须声明 `vampQualification=RESOLVED`（已核定）；`UNRESOLVED`（未核定）拒绝编译。伤害产生方式与来源性质各声明一个类型，所属能力和两侧对象也必须明确分类。未使用吸血的原通用请求保持原样。
- `vampOverrides`（技能例外）支持 `DISABLED`（禁止，不带数值）或 `OVERRIDE`（覆盖，必须有明确基数及通用效率公式）；例外要求对应游戏规则。覆盖可以越过默认能力、伤害资格，但不能越过目标范围和死亡、自身伤害保护。
- 吸血比例与效率在每次扣血后读取；严格读取保留有效属性的真实零值，缺少属性或参数、负效率和非有限结果报具体路径。复制伤害保留原能力分类和例外，比例仍读取本次有效值。
- 每次伤害的贡献求和后治疗一次。现有 `kind=pipeline, command=heal` 修正新增 `healDirection=DONE/RECEIVED`（造成/受到）、`healCategory=ANY/VAMP/DIRECT`（全部/吸血/直接治疗）及 `healGroupKey`（乘区标识），数值策略为 `add_percent`（有符号比例）。同区比例加总后乘 `max(0,1+净比例)`，各区按既有修正排序的首次出现顺序相乘；先造成再受到，最后裁剪生命上限。伤害修正已有的 `channel/stage/bucket` 不用于治疗。
- 普通与复制伤害的末尾共同结算吸血，不监听伤害事件补治疗。来源死亡、自身伤害和目标受击前已死均不吸血；击杀仍能吸血。治疗与单独斩杀不产生吸血。

`done.evidence.items` 中的 `vamp`（吸血明细）通过 `damageId` 关联 `damage`（伤害明细）。逐次保存防御后伤害、护盾吸收、实际扣血、过量伤害，各种吸血的基数/比例/效率/贡献，以及 `healingBeforeModifiers`（修正前）、`healingAfterDone`（造成修正后）、`healingAfterModifiers`（全部修正后）、`actualHealing`（实际回复）、`overheal`（过量回复）。已核定但禁止或不匹配的伤害仍保存明确零值及跳过原因。

专项验证使用独立构造的 `internal/testkit/fixtures/generic_vamp_damage.json`，不修改或复制原基准样例。最终构建后运行：

```powershell
go test -count=1 ./internal/compile ./internal/runtime -run '^TestVamp'
node .\scripts\vamp-smoke-node.mjs
```

该样例明确提供两侧英雄、100原始伤害、100护甲、20护盾及20剩余生命等运行输入。原生与Node结果证明通用机制；实库来源、管理适配及浏览器Worker验证由相应模块独立提供证据。

### 跨来源状态合并与重伤取强

方案唯一来源为规划工作树的《管理页面与共性机制迭代计划》第7项。本模块负责通用编译与结算，不实现移速软上限、几何、控制抗性或按英雄名分支。

- `ProviderLifecycle.instanceScope=source_target` 仅在显式 `maxStacks=1`、`refreshPolicy=replace` 且有正期限时进入按 `definitionRef+source+owner` 复用实例；未指定范围仍每次新建。
- `statusContributions` 在 apply/refresh 当时用真实来源/目标、能力参数求值并保存快照；强度有限且在 `[0,1]`，JSON 0 与缺失分开；失败不挂实例。
- 最终 `effectiveStatuses` 只读输出普通减速有效 max 及全部有效贡献；弱实例保留并独立到期。到期守卫使用实例 `ExpireAt>nowMs`，不使用 `expectedExpireAt`。
- `healGroupCalculationMode=ratio_max` 对同组 received+`add_percent` 取最小带符号比例，组间仍按 `max(0,1+ratio)` 连乘；非法值报错不夹取。同组模式冲突 collect-all 列出双方路径。

专项验证使用独立构造的 `internal/testkit/fixtures/generic_status_merge_slow.json` 与 `generic_heal_ratio_max.json`，不修改或复制原基准样例。最终构建后运行：

```powershell
go test -count=1 ./internal/compile ./internal/runtime -run 'Status|HealRatioMax|Slow'
node .\scripts\status-merge-smoke-node.mjs
```

原生与 Node 结果证明通用机制；浏览器 Worker 真实验证由主负责人独立提供，不能拿 Node 代替。

### 命中供值与法术护盾

方案唯一来源为规划工作树的《管理页面与共性机制迭代计划》第5项 `authoring-p5-r2`。本模块负责通用编译与结算，不实现完整过程、弹道、tick，也不按英雄或装备名分支。

- `resolve_skill_hit` 只能作为一次 active 命中能力的唯一操作；运行时要求单次 driver 事实，禁止 Repeat/WhileReady。
- `skillUses` / `skillHitFacts` 在 run 入口做严格校验：完整历史、同刻堆序（时间→类别→priority→entries 下标），缺值、重复事实和非法来源报明确路径。
- 每次实际 resolve 铸造独立发生身份；首次接触与阻挡在当时冻结。四档范围为 `SKILL` / `EFFECT` / `RESULT` / `DAMAGE_INSTANCE`；null 永不连带，首个非 null 单元不能被后项放大。
- 首次接触核对全部已确认合格历史，包含场外单位，不按当前目标重算。只有 null 候选的后续命中不会复用技能级阻挡标记；只有被挡的实际护盾实例接收其所属格挡监听。命中数值读取缺失会明确失败，不补零。
- 本期候选没有经过验证的状态移除、伤害/治疗修正、伤害免疫和生命下限操作映射，编译会拒绝这些候选；不能用这些名称包住普通伤害来绕过阻挡资格。护盾成功后的显式生命周期移除仍由对应实例事件监听执行。
- `provider/spell_shield` 是类型身份；普通数值护盾操作不参与。控制按封闭 `provider/status_*` 身份，第7项普通减速复用既有贡献。
- 候选在父成本/CD commit 后分发，逐候选 commit 再派派生事件，最后才发 `event/spell_shield_blocked`。`emit_event` 不能伪造引擎事件。
- `providerRefFromEvent` 仅所属 listener、`eventMatcher.all` 含 `event/spell_shield_blocked`、target=self；锁冻结 owner/ref/definition，缺失或不符硬错误。自疗 self 是监听 owner。动态实例必须实际 bind/unbind，不能只靠静态挂载。

专项验证使用独立构造的 `internal/testkit/fixtures/generic_skill_hit.json`，不修改或复制原基准样例。最终构建后运行：

```powershell
go test -count=1 ./internal/compile ./internal/runtime ./internal/formula ./internal/model -run 'SkillHit'
node .\scripts\skill-hit-smoke-node.mjs
```

原生与 Node 结果证明通用机制；Web 复制最终 dist 与浏览器 Worker 验证由父任务或后续 Web 负责。

### 同次使用限制、固定时间窗与前序伤害供值

方案唯一来源为规划工作树的《管理页面与共性机制迭代计划》第6项 `authoring-p6-r3`。本模块不实现 DELAY/EMPOWERED 过程执行器，也不按英雄或装备名分支。

- 分发任何监听动作前，先按 `nowMs` 惰性到期相关状态，再用 owner-relative 上下文和原事件快照冻结全部匹配规则的 `listener.condition`。
- `oncePerUse` 只接受 `skill_hit` / `basic_attack_hit` / `basic_attack_start` 三种真实 use 事件；组键含 owner、provider、group、useSource、useKey 及可选 target，全组共享，不含 listenerIndex。
- `Snapshot.useTriggerLedger` 是专用额度账本，与第5项 SKILL 账本和 `MaxEvents` 分开；空起始快照不继承上次 run。
- `start_on_first_write` 只在默认值变为非默认且无活动期限时开窗，后续写含封顶不续期；快照逐键保存 `expireAt`。
- `operation.outputRef` 只导出同帧真实 `pipeline.DamageOutcome` 的 `POST_DEFENSE_DAMAGE` / `SHIELD_ABSORBED` / `ACTUAL_HP_LOSS`。
- 普通攻击 `resolve_skill_hit` 只发 `event/basic_attack_hit`；空 operations 的 `attackStartFacts` 开始 driver 只发 `event/basic_attack_start`。`emit_event` 不能伪造这两种原生事件。

入口中的 `source`、`target` 是实际快照角色标识，只有 `self`、`opponent` 按来源解释；操作中的目标仍按当前执行帧解释。反向施法的资源门禁、命中和原生攻击开始与使用记录保持同一实际来源。恢复状态先检查原始对象和数值，不能丢弃非法字段后当默认值；额度账本核对来源、目标并按完整身份稳定排序。动态供值器不支持同次使用限制，不能静默忽略。内联被动能力的操作与直接监听操作遵守相同的冻结条件限制，施放门禁及其他非操作位置不能借用尚未生成的伤害输出。

专项验证使用独立构造的 `internal/testkit/fixtures/generic_p6.json`，不修改或复制原基准样例。最终构建后运行：

```powershell
go test -count=1 ./internal/compile ./internal/runtime ./internal/formula ./internal/model -run 'P6|OncePerUse|BasicAttack|OutputRef|StartOnFirstWrite'
node .\scripts\p6-smoke-node.mjs
```

原生与 Node 结果证明通用机制；浏览器 Worker 真实验证由父任务结合最终产物提供，不能拿 Node 代替。
