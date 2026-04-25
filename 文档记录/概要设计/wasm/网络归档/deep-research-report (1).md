                    transform(ev)
                for next in derivedEvents:
                    schedule(next)
        handled++

    flushDeferredTriggers(rt)
    maybeEmitSample(rt)

    if stopReached(rt):
        emitDone(rt)
        return DONE

    if queue not empty:
        return MORE
    emitDone(rt)
    return DONE
```

这个 step 设计有三个直接收益。第一，**取消**天然变成“停止继续调用 `engine_step` 或显式 `engine_abort_run`”；第二，**streaming** 变成“每个 step 结束后读取 outbox”；第三，**浏览器与 Wasmtime 行为一致**，因为两边都不需要在 guest 执行中做异步抢占。fileciteturn29file0L1-L1

### 子系统执行细则

#### 状态与控制

`StatusInstance` 只负责“目标当前处于什么状态”；`ControlDirective` 只负责“目标被强制做什么”；`Execution` 只负责“当前技能实例处于哪个阶段”。动作能否执行时，判断顺序固定为：

1. 读取 actor active status tag mask。  
2. 读取 active directive。  
3. 读取 action 自身 `castPermission` / `abilityTags`。  
4. 依次应用 `ActionBlockRule`、`ActionModifyRule`、`InterruptRule`、`ImmunityRule`、`CleanseRule`。  
5. 若本次动作被挡且声明 `retry_on_release`，写入 `PendingIntent`；若只是临时性冲突，写 `intent_recheck`；若是硬性冲突，直接 drop。fileciteturn17file0L1-L1

#### 伤害、治疗、护盾与 HP 变动

四通道里最关键的是 **Damage → HpChange** 主链路。执行顺序固定为：

1. `rawAmount` 成形。  
2. 解析 crit 资格与倍率。  
3. 应用 `source_outgoing` / `target_incoming` / `post_mitigation` / `final` 等阶段乘区。  
4. 依据 damage type 应用抗性/穿透。  
5. 检查 `force_damage_to_zero` / `invulnerable` / `stasis`。  
6. 检查 shield interaction。  
7. 消耗护盾实例。  
8. 剩余数值落到 HP。  
9. 派生 `on_damage_dealt / on_damage_taken / on_shield_break / on_death_candidate`。fileciteturn18file0L1-L1 fileciteturn19file0L1-L1

#### 历史窗口、Counter 与 Pair 状态

历史窗口不挂在全局事件流之外，而是作为 actor/pair 的附属对象。推荐固定三类查询能力：

| 能力 | 接口 | 典型用途 |
|---|---|---|
| 点查快照 | `AtOrBefore(t)` | 艾克 R、位置/HP 回溯 |
| 窗口累计 | `Sum(now, window)` | 瑟提 W、灰血、最近受控时长 |
| 窗口遍历 | `Range(now, window)` | 复合技能或调试输出 |

`Counter` 只负责数值和阈值，`PairState` 负责 mark 和 per-target lockout。这样布隆被动、阿卡丽 E、亚索 E、竞技场“最近 N 秒受控超过 M 秒给霸体”都能落到同一内核里，不需要新顶层结构。fileciteturn16file0L1-L1 fileciteturn22file0L1-L1 fileciteturn23file0L1-L1

## 内存并发错误与性能设计

TinyGo 在 WebAssembly 上最需要正视的约束有四个：**浏览器与 WASI 目标分离、协作式调度、`recover` 不可用作稳态恢复、`encoding/json`/`reflect` 受限**。因此，本文把核心实现收束为“无 goroutine、无 channel、无 lock、无热路径反射、无 panic 控制流”，并要求所有运行时错误都落到显式错误码与 outbox `error` 消息。([tinygo.org](https://tinygo.org/docs/guides/compatibility/)) ([tinygo.org](https://tinygo.org/docs/guides/webassembly/wasm/))

### 内存与生命周期管理策略

首期推荐采用**固定上限 + arena + generation handle**，而不是在热路径做临时 slice 扩容或大量 map 分配。

| 对象 | 存储方式 | 默认上限 | 生命周期策略 |
|---|---|---:|---|
| `Execution` | `ExecutionArena` | 32 | 创建于 cast/channel 开始，结束时回收 |
| `StatusInstance` | `StatusArena` | 128 | 过期/净化后回收 |
| `ControlDirective` | `DirectiveArena` | 32 | 状态联动或独立过期后回收 |
| `ShieldInstance` | `ShieldArena` | 64 | 打破/过期/移除后回收 |
| `Dot/Hot` | `DotArena` | 64 | tick 结束后回收 |
| `Mark` | `MarkArena` | 32 | consume/expire 后回收 |
| `HistoryWindow` | 固定 ring | 每窗口 64~128 slot | 覆写最旧条目 |
| `Outbox` | 字节环形缓冲 | 256 KB | host 读取后清空 |

推荐规则如下：

| 规则 | 设计要求 |
|---|---|
| handle 校验 | 所有事件只保存 handle，不保存裸指针；出队时校验 generation |
| 惰性删除 | 队列中的失效事件不做堆内扫描；出队时发现 generation 不匹配则直接丢弃 |
| 字符串处理 | 运行期只保留 ID；诊断/输出再用字典反查字符串 |
| 公式表示 | 编译后使用 bytecode / postfix program，不保留递归 AST 节点链 |
| 大对象复用 | `[]byte` 暂存、采样 scratch、packet scratch 必须复用，不重新分配 |
| 内存增长 | host 每次读 `outbox_ptr/len` 后重新获取视图，不缓存旧 `buffer` |

最后一条尤其重要：WebAssembly 线性内存增长后，宿主侧原来的 `ArrayBuffer`/view 可能失效；浏览器端必须在每次交互后重新获取内存视图。([developer.mozilla.org](https://developer.mozilla.org/docs/WebAssembly/Reference/JavaScript_interface/Memory))

### 并发与同步策略

核心设计明确为**单线程、无锁、无 channel**。这不是功能妥协，而是工程收敛：

| 层次 | 是否允许 goroutine | 是否允许锁 | 说明 |
|---|---|---|---|
| `core` | 否 | 否 | 完全事件驱动，`-scheduler=none` |
| `browser adapter` | 否 | 否 | Worker 驱动 `engine_step`，由 JS 事件循环调度 |
| `wasi/wasmtime adapter` | 否 | 否 | host 侧 while-loop 调用 `engine_step` |
| 将来扩展 | 可选 | 尽量否 | 若引入复杂异步宿主，仅放在 adapter，不进入 core |

TinyGo 的调度选项允许在 WebAssembly 上使用不同 scheduler，但核心引擎这里推荐固定 `-scheduler=none`，因为我们不需要 goroutine 与 channel；相应地，热路径也不使用 `time.Sleep`、`select` 或基于 channel 的回压。([tinygo.org](https://tinygo.org/docs/reference/usage/important-options/))

回压策略建议如下：

| 通道 | 容量 | 超限策略 |
|---|---:|---|
| EventHeap | 8192 | 直接报 `E_QUEUE_OVERFLOW`，终止 run |
| Outbox 日志 | 256 KB | 丢弃 debug/log/sample，保留 `error/done` |
| PendingIntent | 每 actor 1 条主槽 + 1 条候补 | 新请求若 `supersedeKey` 更高则覆盖，否则丢弃 |
| Trigger 派生动作 | 每事件最多 64 条 | 超出报 `E_TRIGGER_FANOUT` |
| HistoryWindow | 固定 64 或 128 slot | 覆写最旧数据 |

### 错误处理与 fail-fast 约定

仓库文档对 fail-fast 的方向已经很明确；本文把它具体化为“**编译期 collect-all、运行期 fail-fast**”。fileciteturn13file0L1-L1 fileciteturn14file0L1-L1

| 错误码 | 发生阶段 | 含义 | 处理 |
|---|---|---|---|
| `E_BAD_MAGIC` | init/run blob 解析 | envelope 头非法 | 立即返回 |
| `E_SCHEMA_MISMATCH` | 编译期 | schemaVersion 不兼容 | 立即返回 |
| `E_UNKNOWN_ATTR` | 编译期 | 属性 key 不存在 | 进入校验报告 |
| `E_UNKNOWN_FORMULA` | 编译期 | 公式引用缺失 | 进入校验报告 |
| `E_RULE_CONFLICT` | 编译期 | 规则冲突、派生环 | 进入校验报告 |
| `E_QUEUE_OVERFLOW` | 运行期 | 事件暴涨超限 | 终止 run |
| `E_ARENA_FULL` | 运行期 | 状态池/护盾池已满 | 终止 run |
| `E_STALE_HANDLE` | 运行期 | 出队时 handle 失效 | 非错误，直接 drop |
| `E_NUMERIC` | 运行期 | `NaN`/`Inf`/除零 | 终止 run |
| `E_UNSUPPORTED` | 运行期 | 当前目标未实现的能力被命中 | 终止 run |

实现要求：

1. **禁止**依赖 `panic/recover` 做业务恢复。  
2. `engine_init` 失败时把结构化错误写到 `response`。  
3. `engine_step` 失败时写 `error` record 到 outbox，并把 `Runtime.Phase` 置为 `failed`。  
4. 浏览器 worker 和 Wasmtime host 都只看统一错误 record，不解析 TinyGo panic 文本。([tinygo.org](https://tinygo.org/docs/guides/compatibility/))

### 构建配置与依赖建议

首期尽量做到**核心零第三方依赖**。必须依赖仅包括 TinyGo、匹配版本的浏览器 shim、WASI/Wasmtime 运行环境。

| 依赖 | 建议版本/模式 | 用途 | 选择原因 |
|---|---|---|---|
| TinyGo | `0.41.x` | 编译器 | 官方最新稳定版，继续强化 WebAssembly/WASI 支持与调试能力 |
| `wasm_exec.js` | 与 TinyGo 构建版本一致 | 浏览器运行时 shim | 官方要求与编译版本配套 |
| WASI 目标 | `wasip1` 首期，保留 `wasip2` 路径 | Wasmtime 构建目标 | 官方同时支持，首期以兼容性最好者为基线 |
| Wasmtime | `45.x` 测试基线 | CI/服务端运行时 | 官方 `Linker`/`Store<T>` 模型成熟 |
| 第三方库 | 无强依赖 | — | 降低 TinyGo 兼容性与体积风险 |

([tinygo.org](https://tinygo.org/docs/guides/webassembly/wasm/)) ([tinygo.org](https://tinygo.org/docs/guides/webassembly/wasi/))

推荐三组构建模式：

| 模式 | 编译参数 | 用途 |
|---|---|---|
| 开发调试 | `-scheduler=none -opt=1` | 便于定位逻辑问题 |
| 体积发布 | `-scheduler=none -no-debug -opt=z` | 浏览器正式包 |
| 分配/体积审计 | `-scheduler=none -no-debug -size=full -print-allocs=.` | CI 性能审计 |

TinyGo 官方文档提供了 `-size=full` 与 `-print-allocs` 等工具来追踪体积与分配来源；这应该进入 CI，而不是只在本地临时使用。([tinygo.org](https://tinygo.org/docs/reference/usage/important-options/)) ([tinygo.org](https://tinygo.org/docs/guides/optimizing-binaries/))

### TinyGo 核心路径示例代码

#### 事件接收与 ABI 入口

```go
package main

import "myengine/abi"

var session abi.Session

//export alloc
func alloc(size uint32) uint32 {
	return abi.Alloc(size)
}

//export dealloc
func dealloc(ptr uint32, size uint32) {
	abi.Dealloc(ptr, size)
}

//export engine_begin_run
func engine_begin_run(ptr uint32, size uint32) int32 {
	blob := abi.Bytes(ptr, size)
	code := session.BeginRun(blob)
	return int32(code)
}

//export engine_step
func engine_step(maxEvents uint32) int32 {
	return int32(session.Step(maxEvents))
}
```

#### 二进制反序列化

```go
package codec

func u16le(b []byte, off int) uint16 {
	return uint16(b[off]) | uint16(b[off+1])<<8
}

func u32le(b []byte, off int) uint32 {
	return uint32(b[off]) |
		uint32(b[off+1])<<8 |
		uint32(b[off+2])<<16 |
		uint32(b[off+3])<<24
}

func decodeHeader(b []byte) (magic uint32, schema uint16, kind uint16, size uint32, ok bool) {
	if len(b) < 12 {
		return 0, 0, 0, 0, false
	}
	return u32le(b, 0), u16le(b, 4), u16le(b, 6), u32le(b, 8), true
}
```

#### 路由与处理

```go
package event

func Dispatch(rt *Runtime, ev *Event) ErrCode {
	switch ev.Kind {
	case EvCastIntent:
		return onCastIntent(rt, ev)
	case EvExecutionPhaseEnter:
		return onExecutionPhaseEnter(rt, ev)
	case EvDamageApply:
		return onDamageApply(rt, ev)
	case EvStatusExpire:
		return onStatusExpire(rt, ev)
	case EvIntentRecheck:
		return onIntentRecheck(rt, ev)
	default:
		return ErrUnsupported
	}
}
```

#### 输出写入 outbox

```go
package abi

func WriteTick(rt *Runtime, sample SamplePayload) ErrCode {
	payload := encodeSample(sample)
	return rt.Outbox.Write(RecordTick, rt.NowMS, payload)
}

func WriteDone(rt *Runtime, result DonePayload) ErrCode {
	payload := encodeDone(result)
	return rt.Outbox.Write(RecordDone, rt.NowMS, payload)
}
```

这些代码片段刻意保持 TinyGo 友好：不用反射、不用泛型、不用 channel、不用 goroutine，只使用固定结构、显式编码与普通函数调用。

## 测试计划与开发任务清单

仓库现有差距分析已经表明，完整 V2 蓝图远大于“把一个 MVP 稍微扩展一下”；但另一方面，Java demo 与概要设计也已经证明**只要先打通事件内核、四通道、状态/控制、历史窗口、Counter/Mark 这些主干，架构就能被真正验证**。因此，测试与任务计划采用“首期运行内核可落地、二期机制补全”的组织方式。fileciteturn24file0L1-L1 fileciteturn25file0L1-L1 fileciteturn26file0L1-L1

### 测试计划

| 用例 ID | 类型 | 场景 | 预期结果 | 判定标准 |
|---|---|---|---|---|
| `UT-heap-order` | 单元 | `(tMs, priority, seq)` 混合入堆 | 出堆顺序稳定 | 1000 组随机输入顺序完全一致 |
| `UT-stale-handle-drop` | 单元 | 事件引用已回收 status handle | 事件被静默丢弃 | 无 panic，无状态污染 |
| `UT-history-sum` | 单元 | 4 秒窗口累计受伤 | 返回窗口内总和 | 与手工计算误差 < `1e-9` |
| `UT-history-snapshot` | 单元 | 查询过去时间点快照 | 返回 `<= target` 最近值 | 边界点与空窗口行为可复现 |
| `UT-shield-interaction` | 单元 | 物理伤害打魔法盾 | bypass | 护盾值不变，HP 正确扣减 |
| `UT-control-pending-intent` | 单元 | 眩晕期施法，解除后重试 | `PendingIntent` 被消费，动作执行 | 只执行一次，不重复 |
| `UT-formula-bytecode` | 单元 | 同一公式 AST 与 bytecode | 结果一致 | 100% 一致 |
| `IT-thornmail` | 集成 | 受击触发反伤 | 反向伤害走统一管线 | 日志顺序与结果正确 |
| `IT-sett-w` | 集成 | 最近承伤转护盾+伤害 | 历史窗口、护盾、伤害三者联通 | 输出与样例基线一致 |
| `IT-akali-e` | 集成 | E1 挂 mark，E2 需 gate | 无 mark 时 E2 不可放；有 mark 时可放并消费 | 状态迁移正确 |
| `IT-control-budget-window` | 集成 | 最近 N 秒受控 > M 秒给霸体 | `history + counter + defensive window` 串通 | 新控制被免疫 |
| `IT-browser-wasi-parity` | 集成 | 同一 bundle/run/seed 在 browser 与 Wasmtime | 结果一致 | `done.result` 与关键 sample 相同 |
| `PT-step-throughput` | 性能 | `10k` 事件 run | 吞吐合格 | 本地基线记录，P95 不能退化 > 10% |
| `PT-allocation-audit` | 性能 | 典型 run | 热路径无新增堆分配 | `-print-allocs` 白名单外为 0 |
| `PT-size-budget` | 性能 | 浏览器发布包 | 体积受控 | `.wasm` 大小不超过设定预算 |
| `FT-bad-blob` | 异常 | magic/schema 错误 | init 失败 | 返回结构化错误码 |
| `FT-queue-overflow` | 异常 | 构造 trigger fanout 爆炸 | run 终止 | `error` record + 无死循环 |
| `FT-outbox-overflow` | 异常 | 高频 log/samples | 丢弃可丢记录但保留 `done/error` | 最终结果不丢失 |

### 开发任务清单

下表按实际可开发顺序给出首期任务。估时采用**粗略人日**，假设 1 名熟悉 Go/TinyGo/WASM 的开发者全职推进。

| 优先级 | 任务 | 交付物 | 估时 |
|---|---|---|---:|
| P0 | 建立 `core + browser + wasi` 三层工程骨架 | 目录、构建脚本、双目标编译 | 2 |
| P0 | 设计并实现 binary envelope / outbox record | `codec`、schema 常量、host 编码器 | 4 |
| P0 | 实现 `engine_init / begin_run / step / outbox` ABI | `abi` 模块、基础 session | 3 |
| P0 | 实现 `CompiledBundle` 与编译期校验器 | symbol table、ID 化、error report | 4 |
| P0 | 实现 `EventHeap`、同刻批处理和 lazy invalidation | `event` 模块 | 3 |
| P0 | 实现 `Runtime`、arena 和 generation handle | `runtime` 模块 | 4 |
| P0 | 实现公式 bytecode 编译与求值 | `formula` 模块 | 4 |
| P0 | 实现 `Damage / Heal / Shield / HpChange` 主链路 | `pipeline` 模块 | 5 |
| P0 | 实现 `TriggerIndex + conditions + actions` 最小集 | `trigger` 模块 | 4 |
| P0 | 实现 `Status / Directive / PendingIntent / Interrupt` | `status` 模块 | 5 |
| P0 | 实现 `HistoryWindow + Counter + PairState/Mark` | `history/counter/mark` 模块 | 4 |
| P0 | 完成 browser worker 与 Wasmtime host 适配 | demo adapter、集成测试脚手架 | 3 |
| P0 | 建立单元/集成/性能测试与 CI | `tinygo test`、Wasmtime parity、size/alloc audit | 5 |
| P1 | 接入基础暴击策略与 packet crit lane | `crit` 子模块 | 3 |
| P1 | 接入 move speed 基础派生刷新 | `derive` 子模块 | 3 |
| P1 | 预留 `Augment / DamagePolicy` 扩展点 | `augment` 占位实现 | 2 |
| P1 | 补齐 compile-time rule conflict / derived DAG 检查 | 校验器增强 | 2 |

**首期总计建议预算：约 41 人日。** 这个数字明显小于仓库差距盘点里“完整覆盖 P0/P1/P2”的总量，因为本文故意把范围收束到事件管线与对象化数据流核心，不在首期硬吞全部高级机制。fileciteturn24file0L1-L1 fileciteturn25file0L1-L1

### 首期验收门槛

| 门槛 | 要求 |
|---|---|
| 行为一致性 | browser/js 与 Wasmtime/WASI 同输入同输出 |
| 可取消性 | `engine_abort_run` 在 step 边界生效 |
| 可流式输出 | 每个 step 后可读取 tick/log/done/error |
| 内存稳定性 | 典型 run 期间无热路径新增分配 |
| 模块边界 | 核心无 goroutine、无 lock、无热路径字符串查找 |
| 代表机制 | 反甲、瑟提 W、阿卡丽 E、受控阈值给霸体四个样例全部打通 |

## 优先参考来源

### 官方资料

- TinyGo 发布说明与版本基线（推荐锁定 `0.41.x`） ([tinygo.org](https://tinygo.org/docs/guides/compatibility/))
- TinyGo 浏览器 WebAssembly 指南（`js/wasm`、`wasm_exec.js`） ([tinygo.org](https://tinygo.org/docs/guides/webassembly/wasm/))
- TinyGo WASI 指南（`wasip1/wasip2` 构建目标） ([tinygo.org](https://tinygo.org/docs/guides/webassembly/wasi/))
- TinyGo 重要编译选项（`-scheduler`、`-size=full`、`-print-allocs` 等） ([tinygo.org](https://tinygo.org/docs/reference/usage/important-options/))
- TinyGo 二进制体积优化指南 ([tinygo.org](https://tinygo.org/docs/guides/optimizing-binaries/))
- entity["organization","Mozilla","browser software company"] MDN 对 WebAssembly Memory 的说明（little-endian、memory grow 后的视图注意事项） ([developer.mozilla.org](https://developer.mozilla.org/docs/WebAssembly/Reference/JavaScript_interface/Memory))
- entity["organization","Bytecode Alliance","wasm consortium"] 的 Wasmtime 官方文档（`Linker`、`Store<T>`、WASI/宿主集成基线） ([docs.wasmtime.dev](https://docs.wasmtime.dev/))

### 仓库内优先文档

- 核心基线：《概要设计-TinyGo事件管线与对象化数据流.md》 fileciteturn11file0L1-L1
- 事件流主线：《概要设计-WASM内部事件流.md》 fileciteturn12file0L1-L1
- 总体架构：《概要设计-通用战斗引擎V2架构.md》 fileciteturn13file0L1-L1
- 对象化边界：《概要设计-通用战斗引擎V2对象化建模适配.md》 fileciteturn14file0L1-L1
- 协议基线：《引擎协议与数据结构.md》 fileciteturn29file0L1-L1
- 历史窗口：《概要设计-历史值追踪与时间窗口机制.md》 fileciteturn16file0L1-L1
- 控制与打断：《概要设计-控制与打断状态机制.md》 fileciteturn17file0L1-L1
- 护盾与 HP 管线：《概要设计-护盾机制与跨游戏规则.md》 fileciteturn18file0L1-L1
- 暴击专项：《概要设计-暴击与效果加成机制.md》 fileciteturn19file0L1-L1
- 移动速度与派生属性：《概要设计-移动速度机制.md》 fileciteturn20file0L1-L1
- 模式强化扩展：《概要设计-模式强化与海克斯规则.md》 fileciteturn21file0L1-L1
- 结构与差距补充：《运行时状态结构草案》《补充专题-历史窗口与控制效果锁窗》《查漏补缺》《盘点报告》 fileciteturn22file0L1-L1 fileciteturn23file0L1-L1 fileciteturn24file0L1-L1 fileciteturn25file0L1-L1