TASK_KEY: wasm-engine-v2-architecture
DOC_TYPE: 概要设计
WORKSTREAM: wasm
STATUS: tracked
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-04-26 16:45:00

# WASM TypeList 与状态动作控制概要设计

本文说明 TypeList 与状态动作控制在 TinyGo V2 整体架构中的位置。需求边界见 `文档记录/需求澄清/wasm/WASM-TypeList与状态动作控制需求澄清.md`，可编码细节见 `文档记录/详细设计/wasm/WASM-TypeList与状态动作控制详细设计.md`。

## 1. 架构位置

状态动作控制不是独立战斗系统，而是连接 TypeList、status、control、execution 和 cadence 的规则层。

```text
后端 status_action_control_rules
-> Web 发布 bundle / EngineBundleV2
-> compile: TypeCatalog + TypeSet + RuleIndex
-> runtime: CanCast / InterruptExecution
```

它处于 `WASM概要设计.md` 的 Gate 2 到 Gate 4 之间：

1. Gate 2：先有 TypeList / TypeRegistry / TypeSet / Matcher。
2. Gate 3：action 执行进入 command/resolver/pipeline 主链。
3. Gate 4：status/control/interrupt/cadence 使用这套匹配能力。

## 2. 对象边界

| 对象 | 架构角色 | 是否运行态 |
| --- | --- | --- |
| `StatusInstance` | actor 身上存在的状态事实 | 是 |
| `StatusActionControlRule` | status 对 action/phase 的静态约束 | 否 |
| `ControlDirectiveInstance` | 控制窗口、免疫、霸体、净化后的实际运行态控制效果 | 是 |
| `ExecutionInstance` | 正在执行的 cast/channel/dash/普攻前摇等动作 | 是 |
| `ActionRuntimeState` | 冷却、充能、重试、自动重排 | 是 |
| `TypeRegistry/TypeSet/Matcher` | status/action/tag/phase 的只读匹配索引 | 否 |

核心原则：status 是事实，rule 是静态约束，control directive 是运行时效果。三者不合并。

## 3. 数据流

1. 后端用 `status_action_control_rules` 保存 `forbid/interrupt` 规则。
2. Web 发布 bundle 时把规则随类型目录一起打包。
3. TinyGo `compile.Bundle` 把字符串/type id 转成短 ID、bitset 和 rule index。
4. `runtime.CanCast` 查询 forbid 规则，决定 action 是否可发起。
5. `runtime.InterruptExecution` 查询 interrupt 规则，取消已在执行中的 execution。
6. 日志记录命中的 rule id、status id、action id 和原因，便于前端解释。

## 4. 与 TypeList 的关系

TypeList 是规则可表达性的基础。状态动作控制至少依赖四类 namespace：

1. `status/*`：状态类型，如 `status/stun`、`status/silence`。
2. `action/*`：动作大类，如 `action/basic_attack`、`action/cast_skill`。
3. `skill_tag/*` 或 `action_tag/*`：动作标签，如 `skill_tag/dash`、`skill_tag/blink`。
4. `exec_phase/*`：执行阶段，如 `exec_phase/cast`、`exec_phase/channel`、`exec_phase/dash`。

同名 type 在不同 namespace 中不等价。例如 `dash` 作为动作标签和执行阶段必须分别注册。

## 5. 与现有 BlocksActions 的关系

`BlocksActions` 只是当前 TinyGo V2 的过渡字段。迁移期间：

1. 老 bundle 只有 `BlocksActions=true` 时，compile 生成一条 catch-all forbid 规则。
2. 新 bundle 提供显式 `statusActionControlRules` 时，显式规则优先。
3. 后续前端编辑器应把 `BlocksActions` 标成 legacy shorthand。

这样既保留当前 stun 测试，又能支持 silence/disarm/ground/knockdown 的细粒度语义。
