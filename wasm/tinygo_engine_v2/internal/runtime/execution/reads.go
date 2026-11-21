// 按原时点准备公式、属性、资源和事件读取；不提前冻结后续操作。
package execution

import (
	"errors"
	"math"
	"strings"
	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/runtime/actor"
	contractpkg "tinygo_engine_v2/internal/runtime/contract"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
	"tinygo_engine_v2/internal/runtime/execution/evaluation"
	"tinygo_engine_v2/internal/runtime/execution/lifecycle"
	"tinygo_engine_v2/internal/runtime/execution/operation"
)

type frozenDamageStateBefore = contractpkg.DamageStateBefore

// 同布局窄能力只运输原数值与准备阶段，不分配逐事件包装对象。
type numericStagedAttributes Frame

type numericLiveAttributes Engine

var _ operation.StagedAttributeWork = (*numericStagedAttributes)(nil)
var _ operation.LiveAttributeWork = (*numericLiveAttributes)(nil)

func (s *Engine) attributeRules() operation.AttributeRules {
	return operation.AttributeRules{Plan: &s.compiled, Formulas: &s.formulas, SessionID: s.req.SessionID}
}

func (f *Frame) attributeRules() operation.AttributeRules {
	rules := f.run.attributeRules()
	rules.AbilityRef = f.abilityRef
	return rules
}

func (f *Frame) reResolveStagedAttributesTwoPass(ability planbundle.CompiledAbility) {
	operation.RecomputeStagedAttributes(f.attributeRules(), &f.run.evaluation, f.sourceKey, f.targetKey, ability, (*numericStagedAttributes)(f))
}

func (s *Engine) reResolveLiveAttributesTwoPass(sourceKey, targetKey string) {
	operation.RecomputeLiveAttributes(s.attributeRules(), &s.evaluation, sourceKey, targetKey, (*numericLiveAttributes)(s))
}

func (r *numericStagedAttributes) AttributeNumbers(owner string) *actor.ChangeSet {
	return &(*Frame)(r).stageFor(owner).numbers
}

func (r *numericStagedAttributes) AttributeResolver(owner string) effectpkg.AttributeResolver {
	return (*Frame)(r).stageFor(owner).instances.Attributes()
}

func (r *numericStagedAttributes) AttributePair() [2]attribute.Table {
	f := (*Frame)(r)
	pair := [2]attribute.Table{f.run.combatants[model.SelectorSource].attributesView(), f.run.combatants[model.SelectorTarget].attributesView()}
	for index, owner := range [2]string{model.SelectorSource, model.SelectorTarget} {
		if staged := f.staged.Get(owner); staged != nil {
			pair[index] = staged.attributesView()
		}
	}
	return pair
}

func (r *numericStagedAttributes) AttributeContext(ability planbundle.CompiledAbility) (formula.GenericEvalContext, *model.EngineError) {
	return (*Frame)(r).evalContext(ability)
}

func (r *numericStagedAttributes) AttributeProviderContext(host, owner, provider string) pipeline.ProviderFormulaContext {
	f := (*Frame)(r)
	strict := f.strictReads || f.skillHitOccurrenceID != 0 || (f.eventCtx != nil && f.eventCtx.HasSkillHit)
	return f.readProviderFormulaContext(host, f.targetKey, strict, owner, provider)
}

func (r *numericStagedAttributes) RecordAttributeFailure(err *model.EngineError) {
	f := (*Frame)(r)
	f.fatal, f.fatalErr = true, err
}

func (r *numericStagedAttributes) AttributeFailed() bool { return (*Frame)(r).fatal }

func (r *numericLiveAttributes) LiveAttributeState(owner string) (operation.LiveAttributeState, bool) {
	c, exists := (*Engine)(r).combatants[owner]
	return operation.LiveAttributeState{Attributes: c.attributesView(), Resolver: c.instances.Attributes()}, exists
}

func (r *numericLiveAttributes) LiveAttributeContext(source, target string) formula.GenericEvalContext {
	return (*Engine)(r).evalContextForCombatants(source, target)
}

func (r *numericLiveAttributes) LiveAttributeProviderContext(host, activeTarget, owner, provider string) pipeline.ProviderFormulaContext {
	return (*Engine)(r).readLiveProviderFormulaContext(host, activeTarget, owner, provider)
}

func (r *numericLiveAttributes) PublishLiveAttributes(owner string, attrs attribute.Table) {
	s := (*Engine)(r)
	c := s.combatants[owner]
	c.setAttributes(attrs)
	s.combatants[owner] = c
}

func (r *numericLiveAttributes) RecordLiveAttributeFailure(err *model.EngineError) {
	(*Engine)(r).recordFirstProcessFailure(err)
}

func opponentCombatantKey(owner string) string { return lifecycle.OpponentKey(owner) }

func modifierMountCombatantKey(owner, target string) string {
	return lifecycle.ModifierHost(owner, target)
}

func mountProviderModifiersAcross(combatants map[string]combatantRuntime, owner string, instance effectpkg.Provider, compiled planbundle.CompiledSession) {
	source, sourcePresent := combatants[model.SelectorSource]
	target, targetPresent := combatants[model.SelectorTarget]
	executor := lifecycle.New(&compiled, nil, nil, "")
	executor.MountProvider(lifecycle.EffectMountPair{Source: &source.instances, Target: &target.instances, SourcePresent: sourcePresent, TargetPresent: targetPresent}, owner, instance)
	if sourcePresent {
		combatants[model.SelectorSource] = source
	}
	if targetPresent {
		combatants[model.SelectorTarget] = target
	}
}

func unmountProviderModifiersAcross(combatants map[string]combatantRuntime, owner, reference string) {
	source, sourcePresent := combatants[model.SelectorSource]
	target, targetPresent := combatants[model.SelectorTarget]
	lifecycle.UnmountProvider(lifecycle.EffectMountPair{Source: &source.instances, Target: &target.instances, SourcePresent: sourcePresent, TargetPresent: targetPresent}, owner, reference)
	if sourcePresent {
		combatants[model.SelectorSource] = source
	}
	if targetPresent {
		combatants[model.SelectorTarget] = target
	}
}

func (f *Frame) captureDamageStateBefore(source, target string) ([]frozenDamageStateBefore, *model.EngineError) {
	if !f.run.compiled.HasDamageStateBefore || f.copyableCollector != nil && f.copyableCollector.Phantom() {
		return nil, nil
	}
	var rows []frozenDamageStateBefore
	for index, reader := range f.run.compiled.DamageStateReaders {
		if reader.Owner != source {
			continue
		}
		inst, _, mounted := f.stageFor(source).instances.Providers().Find(reader.ProviderRef)
		if !mounted || inst.Owner != source || inst.Source != source || inst.DefinitionIndex != reader.ProviderIndex || inst.Expired(f.run.loop.TimeMs()) {
			continue
		}
		value := float64(0)
		bag := f.providerStateBagForRead(source, reader.ProviderRef, false, effectpkg.ReadOptions{})
		if bag.Present() && bag.TargetKey() == target && target != "" {
			expires := bag.TargetExpireAt().At(reader.StateKey)
			if expires <= 0 || expires > f.run.loop.TimeMs() {
				value = bag.ReadTargetValue(reader.StateKey)
			}
		}
		if !effectpkg.ValidStateInteger(value) || value < 0 {
			return nil, f.run.basicAttackErr("damage state before requires a real nonnegative safe integer", reader.StateKey)
		}
		rows = append(rows, frozenDamageStateBefore{Reader: uint16(index), Value: value})
	}
	return rows, nil
}

func (f *Frame) recordDamageStateBefore(rows []frozenDamageStateBefore, damageID uint64, target string) {
	for _, row := range rows {
		reader := f.run.compiled.DamageStateReaders[row.Reader]
		value := row.Value
		definition := f.run.compiled.Providers[reader.ProviderIndex].ProviderKey
		f.recordEvidenceLazy("damage_state_before", func() model.EvidenceItem {
			return model.EvidenceItem{TimeMs: f.run.loop.TimeMs(), Kind: "damage_state_before", Ref: reader.ProviderRef,
				Data: map[string]interface{}{"damageId": damageID, "owner": reader.Owner, "providerRef": reader.ProviderRef, "definitionRef": definition, "stateKey": reader.StateKey, "target": target, "beforeValue": value}}
		})
	}
}

func (f *Frame) damageStateBefore(key string) (float64, error) {
	if f.eventCtx == nil || f.eventCtx.EventType != eventTypeDamageInstance || f.eventCtx.DamageID == 0 || f.eventCtx.EventSourceKey != f.ownerCombatantKey || f.eventCtx.EventTargetKey == "" {
		return 0, errors.New("damage state before has no original owning damage instance")
	}
	for _, row := range f.eventCtx.DamageStateBefore {
		if int(row.Reader) >= len(f.run.compiled.DamageStateReaders) {
			return 0, errors.New("damage state before reader index is invalid")
		}
		reader := f.run.compiled.DamageStateReaders[row.Reader]
		if reader.Owner == f.ownerCombatantKey && reader.ProviderRef == f.ownerProviderRef && reader.StateKey == key {
			return row.Value, nil
		}
	}
	return 0, errors.New("damage state before is missing its declared frozen fact")
}

func (f *Frame) captureEntrySnapshots() {
	f.entrySourceAttrs, f.entrySourceResources = f.snapshotCombatantMaps(f.sourceKey)
	f.entryTargetAttrs, f.entryTargetResources = f.snapshotCombatantMaps(f.targetKey)
}

func (f *Frame) snapshotCombatantMaps(key string) (attribute.Table, model.ResourceView) {
	c, ok := f.run.combatants[key]
	if !ok {
		return attribute.Table{}, model.ResourceView{}
	}
	return c.attributesView(), c.resourceView()
}

// entryMapsForKey 按 combatant key 选择本 frame 创建时对应参与者的 entry 快照。
// 未知 key 返回空 map，避免静默改用错误参与者。
func (f *Frame) entryMapsForKey(key string) (attribute.Table, model.ResourceView) {
	switch key {
	case f.sourceKey:
		return f.entrySourceAttrs, f.entrySourceResources
	case f.targetKey:
		return f.entryTargetAttrs, f.entryTargetResources
	default:
		return attribute.Table{}, model.ResourceView{}
	}
}

func (f *Frame) evalContext(ability planbundle.CompiledAbility) (formula.GenericEvalContext, *model.EngineError) {
	if f.run.compiled.HasResourceMax || f.run.compiled.HasCooldownDuration || f.run.compiled.HasProviderDurationChange || f.run.compiled.HasStagedLinkedShield || f.run.compiled.HasModifierSnapshots {
		f.flushDynamicProviders()
	}
	if f.fatal {
		return formula.GenericEvalContext{}, f.fatalErr
	}
	source, target := f.stageFor(f.sourceKey), f.stageFor(f.targetKey)
	ctx := formula.GenericEvalContext{
		RuntimeSkillKey:       ability.SkillKey,
		ProcessActualCosts:    f.processActualCosts,
		HasProcessActualCosts: f.processCostReadable,
		SourceAttrs:           source.attributesView(),
		TargetAttrs:           target.attributesView(),
		SourceResources:       source.resourceView(),
		TargetResources:       target.resourceView(),
		AbilityParams:         model.BorrowNumericView(ability.Params),
		StrictReads:           f.strictReads || f.skillHitOccurrenceID != 0 || (f.eventCtx != nil && f.eventCtx.HasSkillHit),
	}
	if ctx.RuntimeSkillKey == "" {
		ctx.RuntimeSkillKey = f.processUseSkillKey
	}
	if p := f.pendingProcess; p != nil && p.HasEmpoweredAbility() && f.processMomentKind == "STEP_EXECUTION" && f.processUseKey == p.UseKey() && f.ownerProviderRef == p.ProviderRef() && f.providerOwnerKey() == p.Owner() && ctx.RuntimeSkillKey == p.SkillKey() {
		ctx.ProcessStartStateValues = p.StartState()
	}
	if ctx.RuntimeSkillKey == "" && f.ownerProviderRef != "" {
		if owner, ok := f.run.combatants[f.providerOwnerKey()]; ok {
			for instanceIndex, instanceValues := 0, owner.instances.Providers(); instanceIndex < instanceValues.Len(); instanceIndex++ {
				instance := instanceValues.At(instanceIndex)
				if instance.ProviderRef == f.ownerProviderRef && int(instance.DefinitionIndex) < len(f.run.compiled.Providers) {
					ctx.RuntimeSkillKey = f.run.compiled.Providers[instance.DefinitionIndex].SkillKey
					break
				}
			}
		}
	}
	if process := f.pendingProcess; process != nil && f.processMomentKind == "STEP_EXECUTION" && process.StepIndex() >= 0 && process.Definition().Steps[process.StepIndex()].StepType == "CHARGE" {
		ctx.HasUseChargeDuration, ctx.UseChargeDurationMs = true, f.run.loop.TimeMs()-process.StepStartedAtMs()
	} else if action := f.run.actions.ActionForUse(f.skillActionUseRef()); action != nil && action.HasChargeDuration() {
		ctx.HasUseChargeDuration, ctx.UseChargeDurationMs = true, action.ChargeDuration()
	}
	if f.ownerProviderRef != "" {
		ctx.HasProviderContext = true
		if f.run.compiled.HasTargetStateTimeReads {
			ctx.HasTargetStateRemainingContext = true
			ctx.TargetStateRemainingNowMs = f.run.loop.TimeMs()
		}
		bag := f.providerStateBagForRead(f.providerOwnerKey(), f.ownerProviderRef, ctx.StrictReads, effectpkg.ReadOptions{Defaults: true, TargetView: true, TargetKey: f.targetKey})
		if bag.Present() {
			ctx.ProviderStateDefaults = bag.DefaultsForFormula()
			ctx.ProviderState = bag.State()
			if bag.TargetKey() == f.targetKey {
				ctx.ProviderTargetState = bag.TargetStateForFormula()
				if ctx.HasTargetStateRemainingContext && f.targetKey != "" {
					ctx.TargetStateExpireAt = bag.TargetExpireAt()
				}
			} else {
				ctx.ProviderTargetState = model.NumericView{}
			}
		} else {
			ctx.ProviderState = model.NumericView{}
			ctx.ProviderTargetState = model.NumericView{}
		}
	}
	if f.eventCtx != nil {
		ctx.HasEventContext = true
		ctx.HasSkillUseContactCount = f.eventCtx.EventType == model.EventTypeProcessResolved && f.eventCtx.HasUseContactCount
		ctx.SkillUseContactCount = f.eventCtx.UseContactCount
		ctx.HasEventLink = f.eventCtx.HasLink
		ctx.LinkIndex = f.eventCtx.LinkIndex
		ctx.LinkCount = f.eventCtx.LinkCount
		ctx.EventEntrySourceAttrs = f.eventCtx.EntrySourceAttrs
		ctx.EventEntryTargetAttrs = f.eventCtx.EntryTargetAttrs
		ctx.EventEntrySourceResources = f.eventCtx.EntrySourceResources
		ctx.EventEntryTargetResources = f.eventCtx.EntryTargetResources
		ctx.EventSourceAttrs = f.eventCtx.SourceAttrs
		ctx.EventTargetAttrs = f.eventCtx.TargetAttrs
		ctx.EventSourceResources = f.eventCtx.SourceResources
		ctx.EventTargetResources = f.eventCtx.TargetResources
		if f.eventCtx.HasDamageSnapshot {
			ctx.HasEventDamageSnapshot = true
			ctx.EventDamage = f.eventCtx.DamageSnapshot
		}
		if f.eventCtx.HasSkillHit && f.eventCtx.SkillHit != nil && f.eventCtx.EventType == model.EventTypeSkillHit {
			ctx.HasEventSkillHit = true
			ctx.HasSkillHitBlocked = true
			ctx.SkillHitBlocked = f.eventCtx.SkillHit.Blocked
			if f.eventCtx.SkillHit.HasFirstContact {
				ctx.HasSkillHitFirstContact = true
				ctx.SkillHitFirstContact = f.eventCtx.SkillHit.FirstContact
			}
		}
	}
	if f.numeric.Outputs() != nil {
		ctx.HasOperationOutputs = true
		ctx.OperationOutputs = formula.BorrowOperationOutputs(f.numeric.Outputs())
	}
	f.populateMechanicEvalContext(&ctx, ability)
	if f.run.compiled.HasLinkedShieldReads && f.ownerProviderRef != "" {
		providerIndex := int(ability.ProviderIndex)
		if instance, _, found := f.stageFor(f.providerOwnerKey()).instances.Providers().Find(f.ownerProviderRef); found {
			providerIndex = int(instance.DefinitionIndex)
		}
		if providerIndex < len(f.run.compiled.Providers) {
			ctx.Facts = f.prepareFormulaFacts(f.run.compiled.Providers[providerIndex].FormulaLinkedReads)
		}
	}
	return ctx, nil
}

// providerOwnerKey returns the combatant that owns mounted provider state for this frame.
func (f *Frame) providerOwnerKey() string {
	if f.ownerCombatantKey != "" {
		return f.ownerCombatantKey
	}
	return f.sourceKey
}

func (f *Frame) providerStateBag(combatantKey, providerRef string, create bool) effectpkg.BagChange {
	if providerRef == "" {
		return effectpkg.BagChange{}
	}
	sc := f.stageFor(combatantKey)

	bag := sc.providerState.Edit(providerRef, create)
	if !bag.Present() {
		return effectpkg.BagChange{}
	}
	bag.BindFieldDefs(f.resolveProviderStateFieldDefs(combatantKey, providerRef))
	bag.LazyExpireProviderState(f.run.loop.TimeMs())
	return bag
}

// 公式只读已准备的包；默认值或到期准备会改变包时，才取得独占头。
func (f *Frame) providerStateBagForRead(combatantKey, providerRef string, create bool, options effectpkg.ReadOptions) effectpkg.BagView {
	if providerRef == "" {
		return effectpkg.BagView{}
	}
	sc := f.stageFor(combatantKey)
	options.Cooldowns = sc.readonlyCooldowns().View()
	options.OwnerKey = combatantKey

	return sc.providerState.PrepareRead(providerRef, create,
		f.resolveProviderStateFieldDefs(combatantKey, providerRef), f.run.loop.TimeMs(), options)
}

func (f *Frame) resolveProviderStateFieldDefs(combatantKey, providerRef string) *effectpkg.FieldMetadata {
	if f.run == nil {
		return nil
	}
	return f.run.resolveProviderStateFieldDefs(combatantKey, providerRef, f.stageFor(combatantKey).instances.Providers())
}

// providerFormulaContextFunc returns H2a per-modifier provider overlay.
// Cross-combatant mounts pass OwnerCombatantKey so provider.state / target_state read the
// owner bag. For provider_target visibility: same-combatant mounts use the cast target;
// mounts hosted on another combatant use that mount host as the pair-state target key.
// Callback only sets HasProviderContext / ProviderState / ProviderTargetState.
func (f *Frame) providerFormulaContextFunc(combatantKey string) pipeline.ProviderFormulaContextFunc {
	strict := f.strictReads || f.skillHitOccurrenceID != 0 || (f.eventCtx != nil && f.eventCtx.HasSkillHit)
	return f.providerFormulaContextForTarget(combatantKey, f.targetKey, strict)
}

func (f *Frame) providerFormulaContextForTarget(combatantKey, targetKey string, strict bool) pipeline.ProviderFormulaContextFunc {
	return func(ownerCombatantKey, providerRef string) pipeline.ProviderFormulaContext {
		return f.readProviderFormulaContext(combatantKey, targetKey, strict, ownerCombatantKey, providerRef)
	}
}

func (f *Frame) readProviderFormulaContext(combatantKey, targetKey string, strict bool, ownerCombatantKey, providerRef string) pipeline.ProviderFormulaContext {
	bagOwner := ownerCombatantKey
	if bagOwner == "" {
		bagOwner = combatantKey
	}
	activeTarget := providerTargetActiveKey(combatantKey, ownerCombatantKey, targetKey)
	bag := f.providerStateBagForRead(bagOwner, providerRef, strict, effectpkg.ReadOptions{ExpireTarget: true, Defaults: true, TargetView: activeTarget != "", TargetKey: activeTarget})
	ctx := providerFormulaContextFromBag(bag, activeTarget)
	if f.run.compiled.HasProviderElapsedReads || f.run.compiled.HasFiniteModifierExpiry {
		ctx = withProviderElapsed(ctx, f.stageFor(bagOwner).instances.Providers(), providerRef, f.run.loop.TimeMs(), f.run.compiled.Providers)
	}
	return ctx
}

func (f *Frame) resolveAttributesFor(combatantKey string, attrs attribute.Table, evalCtx formula.GenericEvalContext) attribute.Table {
	return operation.ResolveStagedAttributes(f.attributeRules(), &f.run.evaluation, combatantKey, attrs, evalCtx, (*numericStagedAttributes)(f))
}

func (f *Frame) evalAmount(programID formula.GenericProgramID, ability planbundle.CompiledAbility) (float64, *model.EngineError) {
	ctx, err := f.evalContext(ability)
	if err != nil {
		return 0, err
	}
	return f.evalAmountWithContext(programID, &ctx)
}

func (f *Frame) evalAmountWithContext(programID formula.GenericProgramID, ctx *formula.GenericEvalContext) (float64, *model.EngineError) {
	value, err := f.run.formulas.Evaluation.EvalContext(programID, ctx)
	if err != nil {
		msg := err.Error()
		out := engineErrorPtr(model.GenericPhaseRun, model.GenericErrFormulaTypeError, msg, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		if f.skillHitOccurrenceID != 0 && int(programID) < f.run.formulas.Metadata.Count() {
			out.Path = f.run.formulas.Metadata.Info(formula.GenericProgramID(programID)).Key
			out.Ref = f.abilityRef
		}
		if strings.HasPrefix(msg, "event.skill_hit.") {
			out.Path = msg
			out.Ref = f.abilityRef
		}
		return 0, f.preserveFormulaIssue(err, out)
	}
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return 0, engineErrorPtr(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "non-finite formula result", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	return value, nil
}

// 初始属性与派生重算使用同一真实实例期限，恢复时刻等于期限即不再参与。
func materializedProviderFormulaContext(actors map[string]combatantRuntime, compiled planbundle.CompiledSession, actorKey, castProxy string, at int64) pipeline.ProviderFormulaContextFunc {
	return func(ownerKey, providerRef string) pipeline.ProviderFormulaContext {
		bagOwner := ownerKey
		if bagOwner == "" {
			bagOwner = actorKey
		}
		activeTarget := providerTargetActiveKey(actorKey, ownerKey, castProxy)
		owner, found := actors[bagOwner]
		if !found {
			return providerFormulaContextFromBag(effectpkg.BagView{}, activeTarget)
		}
		bag := owner.providerState.Lookup(providerRef)
		if bag.Present() {
			change := owner.providerState.Edit(providerRef, false)
			change.BindFieldDefs(compiledStateFieldsForProvider(compiled, bagOwner, providerRef, owner.instances.Providers()))
			bag = change.View()
		}
		context := providerFormulaContextFromBag(bag, activeTarget)
		if compiled.HasProviderElapsedReads || compiled.HasFiniteModifierExpiry {
			context = withProviderElapsed(context, owner.instances.Providers(), providerRef, at, compiled.Providers)
		}
		return context
	}
}

func withProviderElapsed(context pipeline.ProviderFormulaContext, instances effectpkg.ProviderList, reference string, now int64, definitions []planbundle.CompiledProvider) pipeline.ProviderFormulaContext {
	return lifecycle.WithElapsed(context, instances, reference, now, definitions)
}

func actualProviderElapsed(instance effectpkg.Provider, now int64) (int64, bool) {
	return lifecycle.ActualElapsed(instance, now)
}

func validateProviderElapsedSnapshot(snapshot model.Snapshot, compiled planbundle.CompiledSession, sessionID string) *model.EngineError {
	return lifecycle.ValidateElapsedSnapshot(snapshot, compiled, sessionID)
}

func preserveFormulaIssue(err error, fallback *model.EngineError) *model.EngineError {
	return evaluation.PreserveFormulaIssue(err, fallback, "")
}

func (f *Frame) preserveFormulaIssue(err error, fallback *model.EngineError) *model.EngineError {
	return evaluation.PreserveFormulaIssue(err, fallback, f.abilityRef)
}

func (s *Engine) evalFormulaError(id formula.GenericProgramID, err error, ref string) *model.EngineError {
	path := "formula"
	if int(id) < s.formulas.Metadata.Count() {
		path = s.formulas.Metadata.Info(formula.GenericProgramID(id)).Key
	}
	return preserveFormulaIssue(err, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, err.Error(), path, ref, s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID))
}
