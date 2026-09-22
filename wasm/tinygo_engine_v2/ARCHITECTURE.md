# TinyGo Engine V2 当前架构图

按当前 generic ABI 实现生成，用于快速 review 边界。使用基础 `graph TD/LR`，避免部分预览器不识别复杂 Mermaid 语法。

## 模块依赖图

```mermaid
graph TD
    Host["浏览器 Worker / Node smoke"]
    Exports["cmd/engine_wasm 导出"]
    ABI["internal/abi frame memory outbox"]
    Session["runtime.Session registry"]
    Model["internal/model generic DTO"]
    Compile["compile.CompileGeneric"]
    Compiled["CompiledSession"]
    Run["runtime.RunGeneric"]
    Exec["generic_execution / gate / provider"]
    Scheduler["scheduler.GenericHeap"]
    Formula["formula generic"]
    Typeset["typeset generic"]
    Pipeline["pipeline resolver"]
    Testkit["testkit fixtures + ABI helpers"]

    Host --> Exports
    Exports --> ABI
    Exports --> Session
    Session --> ABI
    Session --> Model
    Session --> Compile
    Compile --> Compiled
    Session --> Compiled
    Session --> Run
    Run --> Exec
    Run --> Scheduler
    Run --> Formula
    Run --> Typeset
    Run --> Pipeline
    Testkit --> Session
    Testkit --> Model
```

## 控制流时序图

```mermaid
graph TD
    A["宿主写入 compile frame kind=200"]
    B["engine_compile"]
    C["CompileGeneric"]
    D{"compile OK?"}
    E["register sessionId"]
    F["outbox compile_result"]
    G["outbox error / ok=false"]
    H["宿主写入 run frame kind=201"]
    I["engine_run"]
    J{"session + hash OK?"}
    K["RunGeneric"]
    L["outbox generic done"]
    M["outbox EngineError"]
    N["宿主写入 release frame kind=202"]
    O["engine_release_session"]
    P["outbox release_result"]
    Q["宿主读 outbox_ptr/len 并 clear"]

    A --> B --> C --> D
    D -->|是| E --> F --> Q
    D -->|否| G --> Q
    F --> H --> I --> J
    J -->|是| K --> L --> Q
    J -->|否| M --> Q
    L --> N --> O --> P --> Q
```

## 数据形态转换图

```mermaid
graph LR
    A["frame.Payload JSON"]
    B["CompileRequest"]
    C["CompiledSession"]
    D["RunRequest"]
    E["DoneResult"]
    F["ReleaseSessionRequest"]
    G["release_result"]

    A -->|compile| B
    B -->|CompileGeneric| C
    A -->|run| D
    C -->|RunGeneric| E
    D -->|RunGeneric| E
    A -->|release| F
    F -->|registry delete| G
```

## CompiledSession 职责（glance）

| 对象 | 职责 |
| --- | --- |
| `CompiledSession` | 只读规则快照：schema/rules hash、combatants、providers、abilities、operations、formulas、settings、abilityRefIndex |
| `CompiledCombatant` | combatant 模板与 provider mounts |
| `CompiledProvider` / `CompiledAbility` | capability 与 ability 定义；含 `instanceScope`、`statusContributions` 与治疗组计算方式 |
| `CompiledOperation` | 执行期 operation IR；`resolve_skill_hit` 携带编译后的命中计划 |
| `CompiledSkillHit` | 命中候选、阻挡范围、供值条件与候选 operations 切片 |
| `formula.GenericRegistry` | 已编译公式程序 |
| `typeset.CatalogResult` | flat type key / matcher 输入 |

## 运行时状态（glance）

```mermaid
graph TD
    Session["Session: genericSessions + outbox"]
    Entry["genericSessionEntry: sessionId hashes CompiledSession"]
    State["genericRunState: combatants heap budget skillUses/skillHitFacts ledger"]
    Outbox["abi.Outbox priority frames"]

    Session --> Entry
    Session --> Outbox
    Entry --> State
```

## Review 建议

1. 先看 `internal/model/generic*.go` 与 `ARCHITECTURE` 本图，确认 ABI 边界。
2. 再看 `compile/generic.go` → `session.go` → `RunGeneric`，确认 call chain。
3. 新机制落在 provider/ability/operation + gate/execution；legacy step-loop/DPS 源码与导出已删除。
4. 验证契约：`generic_p0_basic_damage.json` + `smoke-node.mjs` + `go run ./cmd/bench`。
