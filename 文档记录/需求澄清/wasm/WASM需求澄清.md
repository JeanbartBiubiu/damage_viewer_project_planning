TASK_KEY: wasm-engine-v2-architecture
DOC_TYPE: 需求澄清
WORKSTREAM: wasm
STATUS: tracked
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: 2026-04-25 16:20:09

# WASM 需求澄清

本文是 Wasm 计算引擎的当前需求入口。旧的 Rust MVP 代码已删除；V1 草案、Java demo 与 deep research 资料只作为设计输入。当前正式实现路线以 `wasm/tinygo_engine_v2` 为准。

## 1. 当前结论

1. 正式计算引擎路线采用 TinyGo，落点为 `wasm/tinygo_engine_v2`。
2. 旧 Rust/Katarina crate 已删除，不再作为历史 ABI、行为或性能基线目录；后续对照以文档记录和 TinyGo V2 验证样例为准。
3. 浏览器 Worker 是正式宿主；Node 只保留为本地/CI instantiate、ABI smoke 和 benchmark 工具。
4. 首期优化目标是 1v1 战斗，不提前为多单位战斗支付热路径复杂度。
5. TinyGo 初始和最大内存默认固定为 256 MiB，后续只有在 benchmark 证明安全后再下探。
6. TinyGo 核心只接收准备好的输入，不负责网络请求、缓存、版本协商或文件加载。

## 2. 用户真正要解决的问题

当前产品需要一个可复现、可解释、可扩展的浏览器端战斗计算内核，用来支持：

1. 英雄、装备、符文、海克斯等静态数据进入统一 bundle。
2. 动作、状态、护盾、资源、冷却、历史窗口、计数器、标记等机制在同一条确定性事件流里运行。
3. 前端可以流式读取日志、快照、数值 trace、done/error，并派生页面展示。
4. 后续机制扩展不需要把英雄、装备或模式规则硬编码进引擎。
5. 同输入、同版本、同 seed 必须得到同结果。

## 3. 范围

### 3.1 P0 范围

1. ABI：`alloc/dealloc/init/begin_run/step/abort/outbox_*`。
2. 协议：二进制 frame header + JSON payload。
3. 输入：`EngineBundleV2`、`EngineRunInputV2`。
4. 输出：ready、log、sample、done、error、snapshot、value trace。
5. 编译层：字符串 ID 到短 ID、索引表、公式 bytecode、trigger/modifier/pipeline binding 校验。
6. runtime：`EngineSession -> CompiledBundle -> RunContext`。
7. scheduler：`(time, priority, seq)` 稳定事件堆、取消边界、过期句柄 lazy drop。
8. 属性/资源：属性 `base/current/max/resolved`，资源 `current/max`。
9. 机制主干：action gate、execution、trigger command 回流、damage/heal/shield/resource/attribute 四通道。
10. 验收样例：Thornmail、Sett W、Akali E、控制阈值给霸体、Counter Proc、Attack Speed Buff。

### 3.2 P1 范围

1. 更完整的 item、augment、rune、mode rule 接入。
2. 更高效的二进制 payload codec。
3. WASI/Wasmtime parity 测试路径。
4. 多单位战斗拓扑。
5. 更严格的体积、分配和 P95 性能门禁。

### 3.3 非目标

1. 不在 TinyGo 内部发起网络请求。
2. 不使用 goroutine、channel、lock、panic/recover 作为业务控制流。
3. 不把日志作为机制状态来源。
4. 不让 action、item、status 直接修改 HP；数值落地必须走 resolver/pipeline/mutation。
5. 不把每个英雄机制写成引擎代码分支。

## 4. 核心需求澄清

### 4.1 为什么需要编译层

反序列化只负责 `JSON -> DTO`。编译层负责：

1. 字符串 ID 转短 ID。
2. 生成数组索引和反向索引。
3. 校验未知引用、非法枚举、规则冲突、schema mismatch。
4. 公式 DTO 转 bytecode。
5. trigger、modifier、pipeline binding 预处理。
6. 生成只读 `CompiledBundle`，供多次 run 复用。

因此该层应叫 compile 或 rulecompile，不应叫 deserialize。

### 4.2 为什么需要 TypeList 网络

一个 action 可能触发 B type 的 action，也可能触发 C type 的 action；B/C type 下可能包含相同 action。引擎必须支持：

1. 从 type 找到实体集合。
2. 多个 type 合并时去重。
3. 判断某个 action/item/status/effect 是否属于某些 type。
4. trigger matcher 使用 any/all/none 条件。

这不是 Bloom filter。Bloom filter 有假阳性，不适合战斗机制。这里需要精确 bitset。

### 4.3 属性读取不止四种业务概念

当前基础读取视图包括：

1. `base`
2. `current`
3. `max`
4. `resolved`

但业务概念还包括：

1. `missing`
2. `current_ratio`
3. `missing_ratio`
4. `bonus`

这些应作为属性系统和公式 opcode 的公共能力补齐，不能要求每个公式手写 `max-current`。其中 `bonus` 的基准必须由属性定义明确声明，例如 `base`、`base_max`、`initial_max` 或 `champion_base`。

### 4.4 augment 的定位

augment 是 run 级或模式级规则改写层，不是状态实例，也不是直接效果。它用于启用：

1. 固定攻速。
2. 攻速溢出转 AD。
3. 技能或 DoT 可暴击。
4. 后续治疗/护盾暴击、全伤害转换等策略。

augment 应编译成 active policy，接入 attribute、crit、pipeline，不改变核心事件类型。

## 5. 浏览器宿主需求

1. Worker 负责加载 TinyGo wasm 和匹配版本 `wasm_exec.js`。
2. Worker 负责构造 frame、复制输入、循环 `engine_step`、读取 outbox、处理 cancel。
3. UI 主线程只收结构化进度、日志、结果和错误。
4. cancel 在 step boundary 生效，不要求打断正在执行的单个事件。
5. same input + same seed + same wasm version 必须 replay 一致。

## 6. Review 入口

当前只看三份主文档：

1. `文档记录/需求澄清/wasm/WASM需求澄清.md`
2. `文档记录/概要设计/wasm/WASM概要设计.md`
3. `文档记录/详细设计/wasm/WASM详细设计.md`

旧的 `概要设计-*.md` 根文档已合并进主文档，不再作为 review 入口。
