TASK_KEY: wasm-engine-v2-architecture
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: tracked
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-05-10

# WASM TypeList 与状态动作控制详细设计

本文是给实现 agent 使用的编码设计。只描述怎么实现，不重复解释为什么要做；需求见 `文档记录/需求澄清/wasm/WASM-TypeList与状态动作控制需求澄清.md`，架构位置见 `文档记录/概要设计/wasm/WASM-TypeList与状态动作控制概要设计.md`。

## 1. 写入范围

默认写入：

1. `wasm/tinygo_engine_v2/internal/model/**`
2. `wasm/tinygo_engine_v2/internal/typeset/**`
3. `wasm/tinygo_engine_v2/internal/compile/**`
4. `wasm/tinygo_engine_v2/internal/runtime/**`
5. `wasm/tinygo_engine_v2/internal/control/**`
6. `wasm/tinygo_engine_v2/internal/testkit/**`

只读参考：

1. `db/game_manage/schema.sql`（状态动作控制基线段；历史曾为独立 `status_control_schema.sql`）
2. `db/game_manage/seeds/lol_status_action_control_rules_seed.sql`
3. `web/src/types/api.ts`

## 2. Model DTO

在 `internal/model/types.go` 增加：

```go
type TypeListV2 []string

type ClassifierV2 struct {
    Types TypeListV2 `json:"types,omitempty"`
    Tags  TypeListV2 `json:"tags,omitempty"`
}

type TypeMatcherV2 struct {
    Any  TypeListV2 `json:"any,omitempty"`
    All  TypeListV2 `json:"all,omitempty"`
    None TypeListV2 `json:"none,omitempty"`
}

type StatusActionControlRuleV2 struct {
    ID                  string        `json:"id"`
    StatusTypes         TypeMatcherV2 `json:"statusTypes"`
    RuleKind            string        `json:"ruleKind"` // forbid / interrupt
    ActionTypes         TypeMatcherV2 `json:"actionTypes"`
    ActionMatchTypes    TypeMatcherV2 `json:"actionMatchTypes,omitempty"`
    InterruptPhaseTypes TypeMatcherV2 `json:"interruptPhaseTypes,omitempty"`
    Priority            int           `json:"priority,omitempty"`
    RetryOnRelease      bool          `json:"retryOnRelease,omitempty"`
}
```

扩展现有 DTO：

```go
type EngineBundleV2 struct {
    // existing fields...
    StatusActionControlRules []StatusActionControlRuleV2 `json:"statusActionControlRules,omitempty"`
}

type ActionTemplateV2 struct {
    // existing fields...
    Classifier ClassifierV2 `json:"classifier,omitempty"`
}

type StatusTemplateV2 struct {
    // existing fields...
    Classifier ClassifierV2 `json:"classifier,omitempty"`
}
```

保留 `BlocksActions` / `RetryOnRelease` 字段用于兼容旧 fixture。

## 3. internal/typeset

新增包 `internal/typeset`。

### 3.1 类型

```go
type TypeID uint16

type TypeSet struct {
    Words [4]uint64 // P0 支持 256 个 type；溢出由 compile 报错
}

type Registry struct {
    IDs map[string]TypeID
    Keys []string
}

type Matcher struct {
    Any  TypeSet
    All  TypeSet
    None TypeSet
    HasAny  bool
    HasAll  bool
    HasNone bool
}
```

### 3.2 方法

必须实现：

```go
func NewRegistry() Registry
func (r *Registry) Intern(key string) (TypeID, bool)
func (r Registry) Lookup(key string) (TypeID, bool)

func (s *TypeSet) Add(id TypeID)
func (s TypeSet) Contains(id TypeID) bool
func (s TypeSet) Intersects(other TypeSet) bool
func (s TypeSet) ContainsAll(other TypeSet) bool
func (s TypeSet) Empty() bool

func CompileMatcher(input model.TypeMatcherV2, registry Registry) (Matcher, []string)
func (m Matcher) Match(set TypeSet) bool
```

`Matcher.Match` 规则：

1. `HasAny` 时，目标 set 必须与 `Any` 有交集。
2. `HasAll` 时，目标 set 必须包含 `All` 全部 bit。
3. `HasNone` 时，目标 set 不得与 `None` 有交集。

## 4. Compile 产物

在 `internal/compile/compile.go` 扩展：

```go
type CompiledBundle struct {
    // existing fields...
    Types        typeset.Registry
    ControlRules ControlRuleIndex
}

type CompiledAction struct {
    // existing fields...
    TypeSet typeset.TypeSet
}

type CompiledStatus struct {
    // existing fields...
    TypeSet typeset.TypeSet
}

type ControlRuleKind uint8

const (
    ControlRuleForbid ControlRuleKind = iota + 1
    ControlRuleInterrupt
)

type CompiledStatusActionControlRule struct {
    ID                  string
    Kind                ControlRuleKind
    StatusMatcher       typeset.Matcher
    ActionMatcher       typeset.Matcher
    ActionTagMatcher    typeset.Matcher
    PhaseMatcher        typeset.Matcher
    Priority            int16
    RetryOnRelease      bool
}

type ControlRuleIndex struct {
    Rules []CompiledStatusActionControlRule
}
```

P0 可先线性扫描 `ControlRuleIndex.Rules`，不做倒排索引；TypeList 底座完成后再补 `ForbidByStatusType` / `InterruptByStatusType` 优化。

## 5. Compile 流程

在 `Bundle(input model.EngineBundle)` 中增加以下阶段：

1. 初始化 `cb.Types = typeset.NewRegistry()`。
2. 编译 action/status 前，注册所有 `Classifier.Types` 和 `Classifier.Tags`。
3. 编译 action 时填充 `CompiledAction.TypeSet`。
4. 编译 status 时填充 `CompiledStatus.TypeSet`。
5. 编译 `StatusActionControlRules`：
   - `ruleKind` 只能是 `forbid` 或 `interrupt`。
   - `ID` 不能为空且不能重复。
   - `forbid` 不允许声明 `InterruptPhaseTypes`。
   - `interrupt` 必须声明 `InterruptPhaseTypes`。
   - matcher 中出现未知 type key 必须进入 `Problems`。
6. 如果没有显式 `StatusActionControlRules`，且某个 status `BlocksActions=true`，为该 status 生成隐式 catch-all forbid 规则。

隐式规则：

```text
id = "legacy_" + status.ID + "_block_all"
kind = forbid
statusTypes.any = status classifier types; 若为空，使用自动生成 key "status/" + status.ID
actionTypes.any = action/basic_attack, action/cast_skill, action/cast_item, action/move
retryOnRelease = status.RetryOnRelease
```

若 status 没有 classifier，compile 必须自动给它加入 `status/<status.ID>`。

## 6. Runtime CanCast

在 `internal/runtime` 增加：

```go
type CastBlockCode uint8

const (
    CastOK CastBlockCode = iota
    CastUnknownAction
    CastNotOwned
    CastBlockedByStatus
    CastMarkMissing
    CastInsufficientResource
    CastCooldown
)

type CastGateResult struct {
    Code      CastBlockCode
    RuleID    string
    StatusID  uint16
    RetryAtMs int64
}
```

新增方法：

```go
func (ctx *RunContext) CanCast(actor uint8, action uint16, nowMs int64) CastGateResult
func (ctx *RunContext) actorOwnsAction(actor uint8, action uint16) bool
func (ctx *RunContext) blockedByStatus(actor uint8, action uint16, nowMs int64) CastGateResult
```

`CanCast` 顺序固定：

1. `actorOwnsAction`
2. `blockedByStatus`
3. mark gate
4. resource cost
5. cooldown/charge

当前 `CanCast` 已接入 resource cost 与 cooldown gate；后续 TODO 只保留 charge/recharge 等更细的冷却扩展，不得绕过 `CanCast` 入口。

替换 `onCastIntent` 开头的 `isActionBlocked`：

```go
gate := ctx.CanCast(ev.Source, ev.Action, ctx.NowMs)
if gate.Code != CastOK {
    ctx.handleCastBlocked(ev, gate)
    return model.ErrOK
}
```

`handleCastBlocked`：

1. 若 `gate.Code == CastBlockedByStatus` 且命中规则 `RetryOnRelease=true`，写入 `PendingIntent`。
2. 否则只写 `action_dropped` log。
3. log message 包含 rule id。

## 7. Interrupt 预留

P0 可以只编译 interrupt 规则并测试 matcher，不接 runtime execution。接口先落：

```go
func (ctx *RunContext) InterruptExecutions(actor uint8, status uint16, nowMs int64) model.ErrCode
```

P0 实现为空扫描，返回 `ErrOK`。引入 `ExecutionInstance` 后补：

1. 遍历 actor 当前 execution。
2. 用 execution phase TypeSet 匹配 `PhaseMatcher`。
3. 命中后递增 execution generation，使后续 scheduler event lazy drop。
4. 输出 `execution_interrupted` log。

## 8. 测试

新增或扩展测试：

1. `internal/typeset`：
   - `TestMatcherAnyAllNone`
   - `TestTypeSetContainsAllAndIntersects`
2. `internal/compile`：
   - `TestCompileStatusActionControlRule`
   - `TestCompileRejectsInvalidRuleKind`
   - `TestLegacyBlocksActionsGeneratesForbidRule`
3. `internal/runtime`：
   - `TestSilenceBlocksCastSkillButAllowsBasicAttack`
   - `TestDisarmBlocksBasicAttackButAllowsSkill`
   - `TestGroundBlocksDashTaggedAction`
   - `TestStunLegacyRetryOnReleaseStillWorks`

最小验证命令：

```powershell
cd wasm/tinygo_engine_v2
go test ./...
go run ./cmd/bench
```

## 9. 完成定义

1. `go test ./...` 通过。
2. `go run ./cmd/bench` 通过。
3. `BlocksActions` 旧 fixture 仍通过。
4. 新 status-action control fixture 能区分 silence/disarm/ground。
5. `onCastIntent` 不再直接调用 `isActionBlocked`。
6. `StatusActionControlRuleV2` 不依赖数据库 ID 热路径。
