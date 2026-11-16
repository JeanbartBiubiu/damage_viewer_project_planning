package operation

import (
	"math"
	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/runtime/actor"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
	"tinygo_engine_v2/internal/runtime/execution/evaluation"
)

// AttributeRules 只借用本场固定规则及公式；不持有当前帧或角色状态。
type AttributeRules struct {
	Plan       *planbundle.CompiledSession
	Formulas   *formula.Library
	SessionID  string
	AbilityRef string
}

// StagedAttributeWork 提供原时点的暂存借用和效果准备；算法不取得根帧或发布权。
type StagedAttributeWork interface {
	// AttributeNumbers 借用指定角色的真实数值变更，仅在本次同步调用内使用。
	AttributeNumbers(owner string) *actor.ChangeSet
	// AttributeResolver 返回指定角色当前效果修正的只读解析器。
	AttributeResolver(owner string) effectpkg.AttributeResolver
	// AttributePair 返回同一读取点的全局双方视图，沿原暂存优先规则回退到已发布值。
	AttributePair() [2]attribute.Table
	// AttributeContext 在原调用点准备能力上下文，准备可能改变所属效果投影。
	AttributeContext(ability planbundle.CompiledAbility) formula.GenericEvalContext
	// AttributeProviderContext 在原探测点提供实际挂载事实，不创建捕获上下文的回调。
	AttributeProviderContext(host, owner, provider string) pipeline.ProviderFormulaContext
	// RecordAttributeFailure 立即保存原失败事实，不回滚或提前终止两遍循环。
	RecordAttributeFailure(err *model.EngineError)
	// AttributeFailed 查询当前真实失败状态，仅决定是否保存成功缓存。
	AttributeFailed() bool
}

// LiveAttributeState 是当前数值与效果修正的有限只读运输值，不包含其他所属状态。
type LiveAttributeState struct {
	Attributes attribute.Table
	Resolver   effectpkg.AttributeResolver
}

// LiveAttributeWork 在原位置准备live事实；发布只替换数值，必须重新取得真实角色。
type LiveAttributeWork interface {
	// LiveAttributeState 返回当前角色存在性、数值和修正，不创建缺失角色。
	LiveAttributeState(owner string) (LiveAttributeState, bool)
	// LiveAttributeContext 在原读取点准备给定方向的上下文。
	LiveAttributeContext(source, target string) formula.GenericEvalContext
	// LiveAttributeProviderContext 保留指定宿主及原目标代理下的单次效果准备，不保存回调。
	LiveAttributeProviderContext(host, activeTarget, owner, provider string) pipeline.ProviderFormulaContext
	// PublishLiveAttributes 重新取得实际角色后只替换数值，不覆盖回调产生的其他所属事实。
	PublishLiveAttributes(owner string, attrs attribute.Table)
	// RecordLiveAttributeFailure 保存原延后错误，后续原循环继续执行。
	RecordLiveAttributeFailure(err *model.EngineError)
}

// InitialAttributeWork 只在恢复和挂载完成后借用，未成功的初始状态不会对外登记。
type InitialAttributeWork interface {
	// InitialAttributeOrder 在每个原无序遍历阶段分别取得当时角色顺序，不排序或跨阶段复用。
	InitialAttributeOrder() []string
	// InitialAttributeState 返回已恢复的数值与修正，不执行数值求解。
	InitialAttributeState(owner string) (LiveAttributeState, bool)
	// InitialAttributeProviders 提供原恢复时刻及目标代理下的效果读取。
	InitialAttributeProviders(owner, castProxy string) pipeline.ProviderFormulaContextFunc
	// PublishInitialAttributes 只替换尚未公开的初始数值，不发布战斗事件。
	PublishInitialAttributes(owner string, attrs attribute.Table)
}

// SyncHPResolved 保留生命当前值的位级语义，仅同步已存在的解析槽，不改变基础值和上限。
func SyncHPResolved(attrs attribute.Table) attribute.Table {
	slot, ok := attrs.Lookup("hp")
	if !ok || math.Float64bits(slot.Resolved) == math.Float64bits(slot.Current) {
		return attrs
	}
	slot.Resolved = slot.Current
	return attrs.With("hp", slot)
}

// RecomputeStagedAttributes 完整消费原整轮缓存和两遍求解；失败按原位置记录后继续原循环。
func RecomputeStagedAttributes(rules AttributeRules, cache *evaluation.State, source, target string, ability planbundle.CompiledAbility, work StagedAttributeWork) {
	context := work.AttributeContext(ability)
	memos, inputs, unchanged := stagedAttributeMemo(rules, cache, source, target, context, work)
	keys := [2]string{source, target}
	if unchanged {
		for _, key := range keys {
			numbers := work.AttributeNumbers(key)
			numbers.SetAttributes(SyncHPResolved(numbers.Attributes()))
		}
		return
	}
	for pass := 0; pass < 2; pass++ {
		for _, key := range keys {
			if key == "" {
				continue
			}
			numbers := work.AttributeNumbers(key)
			context := work.AttributeContext(ability)
			numbers.SetAttributes(ResolveStagedAttributes(rules, cache, key, numbers.Attributes(), context, work))
			numbers.SetAttributes(SyncHPResolved(numbers.Attributes()))
		}
	}
	for index, memo := range memos {
		if memo != nil && !work.AttributeFailed() {
			output := work.AttributeNumbers(keys[index]).Attributes()
			strict := work.AttributeContext(ability).StrictReads
			memo.Remember(inputs[index], output, strict)
		}
	}
}

func stagedAttributeMemo(rules AttributeRules, cache *evaluation.State, source, target string, context formula.GenericEvalContext, work StagedAttributeWork) ([2]*evaluation.Memo, [2]attribute.Table, bool) {
	var memos [2]*evaluation.Memo
	var inputs [2]attribute.Table
	if source != model.SelectorSource || target != model.SelectorTarget {
		return memos, inputs, false
	}
	matched := true
	for index, owner := range [2]string{source, target} {
		numbers := work.AttributeNumbers(owner)
		inputs[index] = numbers.Attributes()
		memo := cache.Memo(rules.Plan.AttributeDerivations, *rules.Formulas, owner, true, true, [2]string{source, target}, work.AttributeResolver(owner), numbers.Attributes())
		memos[index] = memo
		providers := func(providerOwner, provider string) pipeline.ProviderFormulaContext {
			return work.AttributeProviderContext(owner, providerOwner, provider)
		}
		if !memo.Probe(numbers.Attributes(), &context, providers) {
			matched = false
		}
		if !memo.OutputsMatch(numbers.Attributes()) {
			matched = false
		}
	}
	return memos, inputs, matched
}

// ResolveStagedAttributes 完整求解指定暂存角色；派生补算使用原全局双方事实，不替换能力方向。
func ResolveStagedAttributes(rules AttributeRules, cache *evaluation.State, owner string, attrs attribute.Table, context formula.GenericEvalContext, work StagedAttributeWork) attribute.Table {
	work.AttributeNumbers(owner)
	// 原供值回调只在本次具体求值期间借用，不从接口返回捕获函数。
	providers := func(providerOwner, provider string) pipeline.ProviderFormulaContext {
		return work.AttributeProviderContext(owner, providerOwner, provider)
	}
	resolved, err := cache.ResolveOrdinary(rules.Plan.AttributeDerivations, *rules.Formulas, owner, attrs, work.AttributeResolver(owner), context, providers)
	if err != nil {
		work.RecordAttributeFailure(attributeFailure(rules, owner, err, false))
		return attrs
	}
	if len(rules.Plan.AttributeDerivations) == 0 {
		return resolved
	}
	pair := work.AttributePair()
	ordinary := map[string]attribute.Table{model.SelectorSource: pair[0], model.SelectorTarget: pair[1]}
	for _, dependency := range [2]string{model.SelectorSource, model.SelectorTarget} {
		work.AttributeNumbers(dependency)
		dependencyContext := context
		dependencyContext.SourceAttrs, dependencyContext.TargetAttrs = pair[0], pair[1]
		dependencyProviders := func(providerOwner, provider string) pipeline.ProviderFormulaContext {
			return work.AttributeProviderContext(dependency, providerOwner, provider)
		}
		ordinary[dependency], err = cache.ResolveOrdinary(rules.Plan.AttributeDerivations, *rules.Formulas, dependency, ordinary[dependency], work.AttributeResolver(dependency), dependencyContext, dependencyProviders)
		if err != nil {
			work.RecordAttributeFailure(attributeFailure(rules, dependency, err, false))
			return attrs
		}
	}
	ordinary[owner] = resolved
	resolved, err = cache.ResolveDerived(rules.Plan.AttributeDerivations, *rules.Formulas, owner, resolved, work.AttributeResolver(owner), ordinary[model.SelectorSource], ordinary[model.SelectorTarget], providers)
	if err != nil {
		work.RecordAttributeFailure(attributeFailure(rules, owner, err, false))
		return attrs
	}
	return resolved
}

// ResolveLiveAttributes 在指定原上下文求解当前角色，错误沿延后通道保存且返回原输入。
func ResolveLiveAttributes(rules AttributeRules, cache *evaluation.State, owner string, attrs attribute.Table, context formula.GenericEvalContext, activeTarget string, work LiveAttributeWork) attribute.Table {
	state, exists := work.LiveAttributeState(owner)
	if !exists {
		return attrs
	}
	providers := func(providerOwner, provider string) pipeline.ProviderFormulaContext {
		return work.LiveAttributeProviderContext(owner, activeTarget, providerOwner, provider)
	}
	resolved, err := cache.ResolveOrdinary(rules.Plan.AttributeDerivations, *rules.Formulas, owner, attrs, state.Resolver, context, providers)
	if err != nil {
		work.RecordLiveAttributeFailure(attributeFailure(rules, owner, err, false))
		return attrs
	}
	if len(rules.Plan.AttributeDerivations) > 0 {
		ordinary := map[string]attribute.Table{}
		for _, dependency := range [2]string{model.SelectorSource, model.SelectorTarget} {
			input, _ := work.LiveAttributeState(dependency)
			dependencyProviders := func(providerOwner, provider string) pipeline.ProviderFormulaContext {
				return work.LiveAttributeProviderContext(dependency, activeTarget, providerOwner, provider)
			}
			ordinary[dependency], err = cache.ResolveOrdinary(rules.Plan.AttributeDerivations, *rules.Formulas, dependency, input.Attributes, input.Resolver, context, dependencyProviders)
			if err != nil {
				work.RecordLiveAttributeFailure(attributeFailure(rules, dependency, err, false))
				return attrs
			}
		}
		ordinary[owner] = resolved
		resolved, err = cache.ResolveDerived(rules.Plan.AttributeDerivations, *rules.Formulas, owner, resolved, state.Resolver, ordinary[model.SelectorSource], ordinary[model.SelectorTarget], providers)
		if err != nil {
			work.RecordLiveAttributeFailure(attributeFailure(rules, owner, err, false))
			return attrs
		}
	}
	if rules.Plan.HasResourceMax {
		resolved = SyncHPResolved(resolved)
	}
	return resolved
}

// RecomputeLiveAttributes 执行指定方向的原两遍；每次求解后只发布数值，保留同步回调的实际效果事实。
func RecomputeLiveAttributes(rules AttributeRules, cache *evaluation.State, source, target string, work LiveAttributeWork) {
	for pass := 0; pass < 2; pass++ {
		for _, owner := range [2]string{source, target} {
			if owner == "" {
				continue
			}
			state, exists := work.LiveAttributeState(owner)
			if !exists {
				continue
			}
			context := work.LiveAttributeContext(source, target)
			resolved := ResolveLiveAttributes(rules, cache, owner, state.Attributes, context, target, work)
			work.PublishLiveAttributes(owner, SyncHPResolved(resolved))
		}
	}
}

// ResolveRelatedLiveAttributes 保留效果变化后的owner→opponent单遍，不升级为两遍或改变给定上下文。
func ResolveRelatedLiveAttributes(rules AttributeRules, cache *evaluation.State, owner, opponent string, context formula.GenericEvalContext, work LiveAttributeWork) {
	state, _ := work.LiveAttributeState(owner)
	resolved := ResolveLiveAttributes(rules, cache, owner, state.Attributes, context, "", work)
	work.PublishLiveAttributes(owner, resolved)
	if opponent != "" {
		if state, exists := work.LiveAttributeState(opponent); exists {
			resolved := ResolveLiveAttributes(rules, cache, opponent, state.Attributes, context, "", work)
			work.PublishLiveAttributes(opponent, resolved)
		}
	}
}

// PrepareInitialAttributes 完整执行同角色普通、冻结双方普通和原方向派生三个初始阶段，不借运行缓存。
func PrepareInitialAttributes(rules AttributeRules, work InitialAttributeWork) *model.EngineError {
	for _, owner := range work.InitialAttributeOrder() {
		state, _ := work.InitialAttributeState(owner)
		context := formula.GenericEvalContext{SourceAttrs: state.Attributes, TargetAttrs: state.Attributes}
		resolved, err := state.Resolver.ResolveAttributesBeforeDerived(rules.Plan.AttributeDerivations, owner, state.Attributes, context, *rules.Formulas, work.InitialAttributeProviders(owner, ""))
		if err != nil {
			return attributeFailure(rules, owner, err, true)
		}
		work.PublishInitialAttributes(owner, resolved)
	}
	source, _ := work.InitialAttributeState(model.SelectorSource)
	target, _ := work.InitialAttributeState(model.SelectorTarget)
	for _, owner := range work.InitialAttributeOrder() {
		state, _ := work.InitialAttributeState(owner)
		context := formula.GenericEvalContext{SourceAttrs: source.Attributes, TargetAttrs: target.Attributes}
		resolved, err := state.Resolver.ResolveAttributesBeforeDerived(rules.Plan.AttributeDerivations, owner, state.Attributes, context, *rules.Formulas, work.InitialAttributeProviders(owner, model.SelectorTarget))
		if err != nil {
			return attributeFailure(rules, owner, err, true)
		}
		work.PublishInitialAttributes(owner, resolved)
	}
	for _, owner := range [2]string{model.SelectorSource, model.SelectorTarget} {
		state, exists := work.InitialAttributeState(owner)
		if !exists {
			continue
		}
		var providers pipeline.ProviderFormulaContextFunc
		if rules.Plan.HasProviderElapsedReads || rules.Plan.HasFiniteModifierExpiry {
			providers = work.InitialAttributeProviders(owner, model.SelectorTarget)
		}
		source, _ := work.InitialAttributeState(model.SelectorSource)
		target, _ := work.InitialAttributeState(model.SelectorTarget)
		resolved, err := evaluation.ResolveDerivedAttributes(rules.Plan.AttributeDerivations, *rules.Formulas, owner, state.Attributes, state.Resolver, source.Attributes, target.Attributes, providers)
		if err != nil {
			return attributeFailure(rules, owner, err, true)
		}
		work.PublishInitialAttributes(owner, resolved)
	}
	return nil
}

func attributeFailure(rules AttributeRules, owner string, err error, initial bool) *model.EngineError {
	path := "combatants." + owner + ".attributes"
	if initial {
		path = "initialSnapshot." + path
	}
	return evaluation.PreserveFormulaIssue(err, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, err.Error(), path, "", rules.Plan.SchemaHash, rules.Plan.RulesHash, rules.SessionID), rules.AbilityRef)
}
