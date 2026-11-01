package execution

import (
	"math"
	"strings"
	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

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

func (f *Frame) evalContext(ability planbundle.CompiledAbility) formula.GenericEvalContext {
	if f.run.compiled.HasResourceMax || f.run.compiled.HasCooldownDuration || f.run.compiled.HasProviderDurationChange || f.run.compiled.HasStagedLinkedShield || f.run.compiled.HasModifierSnapshots {
		f.flushDynamicProviders()
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
		AbilityParams:         ability.Params,
		StrictReads:           f.strictReads || f.skillHitOccurrenceID != 0 || (f.eventCtx != nil && f.eventCtx.hasSkillHit),
	}
	if f.run.compiled.HasLinkedShieldReads {
		ctx.LinkedShieldReader = f
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
		ctx.HasSkillUseContactCount = f.eventCtx.eventType == model.EventTypeProcessResolved && f.eventCtx.hasUseContactCount
		ctx.SkillUseContactCount = f.eventCtx.useContactCount
		ctx.HasEventLink = f.eventCtx.hasLink
		ctx.LinkIndex = f.eventCtx.linkIndex
		ctx.LinkCount = f.eventCtx.linkCount
		ctx.EventEntrySourceAttrs = f.eventCtx.entrySourceAttrs
		ctx.EventEntryTargetAttrs = f.eventCtx.entryTargetAttrs
		ctx.EventEntrySourceResources = f.eventCtx.entrySourceResources
		ctx.EventEntryTargetResources = f.eventCtx.entryTargetResources
		ctx.EventSourceAttrs = f.eventCtx.sourceAttrs
		ctx.EventTargetAttrs = f.eventCtx.targetAttrs
		ctx.EventSourceResources = f.eventCtx.sourceResources
		ctx.EventTargetResources = f.eventCtx.targetResources
		if f.eventCtx.hasDamageSnapshot {
			ctx.HasEventDamageSnapshot = true
			ctx.EventDamage = f.eventCtx.damageSnapshot
		}
		if f.eventCtx.hasSkillHit && f.eventCtx.skillHit != nil && f.eventCtx.eventType == model.EventTypeSkillHit {
			ctx.HasEventSkillHit = true
			ctx.HasSkillHitBlocked = true
			ctx.SkillHitBlocked = f.eventCtx.skillHit.blocked
			if f.eventCtx.skillHit.hasFirstContact {
				ctx.HasSkillHitFirstContact = true
				ctx.SkillHitFirstContact = f.eventCtx.skillHit.firstContact
			}
		}
	}
	if f.operationOutputs != nil {
		ctx.HasOperationOutputs = true
		ctx.OperationOutputs = f.operationOutputs
	}
	f.populateMechanicEvalContext(&ctx, ability)
	return ctx
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
	strict := f.strictReads || f.skillHitOccurrenceID != 0 || (f.eventCtx != nil && f.eventCtx.hasSkillHit)
	return f.providerFormulaContextForTarget(combatantKey, f.targetKey, strict)
}

func (f *Frame) providerFormulaContextForTarget(combatantKey, targetKey string, strict bool) pipeline.ProviderFormulaContextFunc {
	return func(ownerCombatantKey, providerRef string) pipeline.ProviderFormulaContext {
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
}

func (f *Frame) resolveAttributesFor(combatantKey string, attrs attribute.Table, evalCtx formula.GenericEvalContext) attribute.Table {
	sc := f.stageFor(combatantKey)
	resolved, err := f.run.evaluation.ResolveOrdinary(f.run.formulas, combatantKey,
		attrs,
		sc.instances.Attributes(),
		evalCtx,
		f.providerFormulaContextFunc(combatantKey),
	)
	if err != nil {
		f.fatal = true
		f.fatalErr = f.preserveFormulaIssue(err, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, err.Error(), "combatants."+combatantKey+".attributes", "", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID))
		return attrs
	}
	if len(f.run.compiled.AttributeDerivations) == 0 {
		return resolved
	}
	sourceAttrs, targetAttrs := f.run.combatants["source"].attributesView(), f.run.combatants["target"].attributesView()
	if staged := f.staged.Get("source"); staged != nil {
		sourceAttrs = staged.attributesView()
	}
	if staged := f.staged.Get("target"); staged != nil {
		targetAttrs = staged.attributesView()
	}
	ordinary := map[string]attribute.Table{"source": sourceAttrs, "target": targetAttrs}
	for _, owner := range []string{"source", "target"} {
		host := f.stageFor(owner)
		dependencyContext := evalCtx
		dependencyContext.SourceAttrs, dependencyContext.TargetAttrs = sourceAttrs, targetAttrs
		ordinary[owner], err = f.run.evaluation.ResolveOrdinary(f.run.formulas, owner, ordinary[owner], host.instances.Attributes(), dependencyContext, f.providerFormulaContextFunc(owner))
		if err != nil {
			f.fatal = true
			f.fatalErr = f.preserveFormulaIssue(err, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, err.Error(), "combatants."+owner+".attributes", "", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID))
			return attrs
		}
	}
	ordinary[combatantKey] = resolved
	resolved, err = f.run.evaluation.ResolveDerived(f.run.compiled.AttributeDerivations, f.run.formulas, combatantKey, resolved, sc.instances.Attributes(), ordinary["source"], ordinary["target"], f.providerFormulaContextFunc(combatantKey))
	if err != nil {
		f.fatal = true
		f.fatalErr = f.preserveFormulaIssue(err, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, err.Error(), "combatants."+combatantKey+".attributes", "", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID))
		return attrs
	}
	return resolved
}

func (f *Frame) evalAmount(programID formula.GenericProgramID, ability planbundle.CompiledAbility) (float64, *model.EngineError) {
	ctx := f.evalContext(ability)
	return f.evalAmountWithContext(programID, &ctx)
}

func (f *Frame) evalAmountWithContext(programID formula.GenericProgramID, ctx *formula.GenericEvalContext) (float64, *model.EngineError) {
	value, err := f.run.formulas.EvalContext(programID, ctx)
	if err != nil {
		msg := err.Error()
		out := engineErrorPtr(model.GenericPhaseRun, model.GenericErrFormulaTypeError, msg, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		if f.skillHitOccurrenceID != 0 && int(programID) < len(f.run.formulas.Programs) {
			out.Path = f.run.formulas.Programs[programID].Key
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
