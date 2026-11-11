package hit

import (
	"tinygo_engine_v2/internal/base/typeset"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

// prepareInput 在原合格接触登记后借用当前帧求值，生成本次待派发命中上下文。
type prepareInput struct {
	Facts
	Ability    planbundle.CompiledAbility
	Plan       *planbundle.CompiledSkillHit
	AbilityRef string
	EntryKey   string
	Identity   Identity
}

// PrepareHost 只读取当前真实盾与强化等待，不能提交或当场派发。
type PrepareHost interface {
	SelectionHost
	// HitSpellShields 返回实际命中目标当前仍活动的法术盾，不应用或移除盾。
	HitSpellShields(target string) effectpkg.ProviderList
	// FreezeHitEmpoweredWaits 仅在原生普攻命中入口冻结当前合格等待身份。
	FreezeHitEmpoweredWaits(owner string) []EmpoweredWait
}

// prepare 在原尝试边界冻结候选、判盾和规则组，不执行子帧或监听。
func prepare(state *State, input prepareInput, host PrepareHost) (*Context, *model.EngineError) {
	facts := input.Facts
	selected, err := SelectCandidates(input.Plan, input.Ability, facts.SourceKey, facts.HasFirstContact, facts.FirstContact, host)
	if err != nil {
		return nil, err
	}
	unit, hasUnit, err := FormBlockUnit(input.Plan, selected, facts.OccurrenceID, facts.UseRef, input.Identity)
	if err != nil {
		return nil, err
	}
	hasBlockable := HasBlockable(input.Plan, selected)
	if facts.UseRef != "" && hasBlockable {
		if existing, found := state.BlockUnit(facts.UseRef); found && existing.Scope == model.SpellShieldScopeSkill &&
			CoversCandidates(existing, input.Plan, selected, facts.OccurrenceID, facts.UseRef) {
			facts.Blocked, facts.ReusedSkillUnit = 1, true
			unit, hasUnit = existing, true
		}
	}
	var shield effectpkg.Provider
	hasShield := false
	if !facts.ReusedSkillUnit && hasBlockable {
		if hasUnit && unit.Scope == model.SpellShieldScopeSkill && facts.UseRef == "" {
			return nil, host.HitExecutionError(model.GenericErrMissingRequiredField, "SKILL block scope requires a qualified useRef", "skillHitFacts["+input.EntryKey+"].useRef", input.EntryKey)
		}
		shields := host.HitSpellShields(facts.TargetKey)
		switch shields.Len() {
		case 0:
			facts.Blocked = 0
		case 1:
			facts.Blocked, shield, hasShield = 1, shields.At(0), true
		default:
			return nil, host.HitExecutionError(model.GenericErrRuntimeInvariantFailed, "multiple active spell_shield instances have no nominated priority", "combatants["+facts.TargetKey+"].providers", facts.TargetKey)
		}
	}
	var waits []EmpoweredWait
	if input.Ability.IsBasicAttack {
		waits = host.FreezeHitEmpoweredWaits(facts.SourceKey)
	}
	if hasUnit {
		facts.UnitScope, facts.EffectOccurrenceKey, facts.ResultKey, facts.CandidateKey = unit.Scope, unit.EffectOccurrenceKey, unit.ResultKey, unit.CandidateKey
	}
	if hasShield {
		facts.ShieldOwner, facts.ShieldProviderRef, facts.ShieldDefinitionRef, facts.ShieldSource = shield.Owner, shield.ProviderRef, shield.DefinitionRef, shield.Source
	} else if facts.ReusedSkillUnit && hasUnit {
		facts.ShieldOwner, facts.ShieldProviderRef, facts.ShieldDefinitionRef, facts.ShieldSource = unit.ShieldOwner, unit.ShieldProviderRef, unit.ShieldDefinitionRef, unit.ShieldSource
	}
	if facts.Blocked == 1 && !facts.ReusedSkillUnit && facts.UnitScope == model.SpellShieldScopeSkill && facts.UseRef != "" && !input.Ability.IsBasicAttack {
		stored := BlockUnit{Scope: facts.UnitScope, OccurrenceID: facts.OccurrenceID, UseRef: facts.UseRef,
			EffectOccurrenceKey: facts.EffectOccurrenceKey, ResultKey: facts.ResultKey, CandidateKey: facts.CandidateKey,
			ShieldOwner: facts.ShieldOwner, ShieldProviderRef: facts.ShieldProviderRef, ShieldDefinitionRef: facts.ShieldDefinitionRef, ShieldSource: facts.ShieldSource}
		if err := state.StoreBlockUnit(facts.UseRef, stored, input.Identity); err != nil {
			return nil, err
		}
	}
	context := NewContext(ContextSeed{Facts: facts, Ability: input.Ability, Plan: input.Plan, AbilityRef: input.AbilityRef, EmpoweredWaits: waits})
	if err := context.FreezeCandidates(selected, host); err != nil {
		return nil, err
	}
	return context, nil
}

// ActiveSpellShields 保留实际拥有者的活动实例原序，不为多个盾选择新优先级。
func ActiveSpellShields(instances effectpkg.ProviderList, definitions []planbundle.CompiledProvider, typeID typeset.TypeID, declared bool, nowMs int64) effectpkg.ProviderList {
	var out effectpkg.ProviderList
	if !declared {
		return out
	}
	active := instances.Active(nowMs)
	for index := 0; index < active.Len(); index++ {
		instance := active.At(index)
		if int(instance.DefinitionIndex) < len(definitions) && definitions[instance.DefinitionIndex].TypeSet.Contains(typeID) {
			out = out.Append(instance)
		}
	}
	return out
}

// FreezeEmpoweredWaits 只冻结命中入口仍处于等待且挂载有效的非计数窗口。
func FreezeEmpoweredWaits(owner string, nowMs int64, host CountedWindowHost) []EmpoweredWait {
	var waits []EmpoweredWait
	for index := 0; index < host.EmpoweredWindowCount(); index++ {
		p := host.EmpoweredWindowAt(index)
		if !p.HasEmpoweredWindow() && p.Owner() == owner && p.Status() == "active" && p.StepExecutionIndex() == 0 &&
			p.HasExpiry() && nowMs < p.Expiry() && host.EmpoweredMountLive(owner, p.ProviderRef(), p.Ability().ProviderIndex) {
			waits = append(waits, EmpoweredWait{p, p.UseKey(), p.StepVersion(), p.Expiry()})
		}
	}
	return waits
}
