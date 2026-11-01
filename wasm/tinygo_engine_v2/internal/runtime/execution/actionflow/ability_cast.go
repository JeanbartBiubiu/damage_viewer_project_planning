package actionflow

import (
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
)

// AbilityCastRequest 是一项实际独立施放需要的有限来源、目标和驱动身份。
type AbilityCastRequest struct{ Source, Target, AbilityRef, EntryKey string }

// AbilityCastDefinitions 只借用施放查找、操作范围和真实静态拥有者定义。
type AbilityCastDefinitions struct {
	References map[string]planbundle.CompiledAbilityRef
	Combatants []planbundle.CompiledCombatant
	Operations []planbundle.CompiledOperation
}

// AbilityCastKind 区分原冷却跳过、普通能力帧和真实事件绑定过程三项有限决定。
type AbilityCastKind uint8

const (
	AbilityCastSkipped AbilityCastKind = iota
	AbilityCastFrame
	AbilityCastNativeProcess
)

// PreparedAbility 是已按原门禁核对的有限施放决定；仅普通能力帧携带原操作切片。
type PreparedAbility struct {
	Kind               AbilityCastKind
	Request            AbilityCastRequest
	Ability            planbundle.CompiledAbility
	Operations         []planbundle.CompiledOperation
	Owner, ProviderRef string
}

// AbilityCastReads 只读取本次施放在原位置的实际冷却，不持有同步执行参数。
type AbilityCastReads interface {
	// AbilityCastCooldown 查询原能力的实际普通冷却，不提前消费成本。
	AbilityCastCooldown(owner, ref string) bool
}

// AbilityFrameWork 只借用一个独立能力帧内的生命周期、真实身份与操作交接。
type AbilityFrameWork interface {
	// StageAbilityLifecycle 在原位置暂存成本及冷却，失败不分配施放编号。
	StageAbilityLifecycle(ability planbundle.CompiledAbility, source string) *model.EngineError
	// KnownAbilityUse 仅返回当前真实驱动命中事实对应的已登记使用。
	KnownAbilityUse(entry string) *actionpkg.UseView
	// NextAbilityCast 在原成功门禁之后分配施放编号。
	NextAbilityCast() uint64
	// BindAbilityCast 绑定该帧真实施放身份、来源类别和原计数标志。
	BindAbilityCast(id uint64, origin string, count bool)
	// ExecuteAbilityOperations 在同一原帧同步执行已核定的有限操作，不另建子帧。
	ExecuteAbilityOperations(ability planbundle.CompiledAbility, operations []planbundle.CompiledOperation) *model.EngineError
}

func (s SkillActionExecutor) PrepareCast(request AbilityCastRequest, definitions AbilityCastDefinitions, reads AbilityCastReads) (PreparedAbility, *model.EngineError) {
	ref := NormalizeAbilityRef(request.AbilityRef, request.Source, request.Target)
	bound, exists := definitions.References[ref]
	if !exists {
		return PreparedAbility{}, s.castError(model.GenericErrUnknownRef, "unknown abilityRef")
	}
	ability := s.abilities[bound.AbilityIndex]
	provider := s.providers[ability.ProviderIndex]
	if ability.TargetExpirySpec != nil || len(provider.TargetTimings) > 0 {
		return PreparedAbility{}, s.error("target timing source abilities require their actual hit, damage, or timer callback", "abilityRef")
	}
	if provider.PermanentCharacterPeriod {
		return PreparedAbility{}, s.error("permanent character ticks can execute only through their actual scheduled tick", "abilityRef")
	}
	if provider.HasStateOnExpire {
		return PreparedAbility{}, s.error("state expiry source abilities require their actual initialization or received-damage listener", "abilityRef")
	}
	if reads.AbilityCastCooldown(request.Source, ref) {
		return PreparedAbility{}, nil
	}
	if ability.ProcessControl != nil {
		if ability.ProcessControl.UseRefFromEvent {
			request.AbilityRef = ref
			return PreparedAbility{Kind: AbilityCastNativeProcess, Request: request, Ability: ability}, nil
		}
		err := s.error("process control can only execute through its single-shot driver fact", "abilityRef")
		err.Ref = ref
		return PreparedAbility{}, err
	}
	start, end := ability.OperationStart, ability.OperationStart+ability.OperationCount
	if int(end) > len(definitions.Operations) {
		return PreparedAbility{}, s.castError(model.GenericErrRuntimeInvariantFailed, "operation range out of bounds")
	}
	request.AbilityRef = ref
	prepared := PreparedAbility{Kind: AbilityCastFrame, Request: request, Ability: ability, Operations: definitions.Operations[start:end]}
	if int(bound.CombatantIndex) < len(definitions.Combatants) {
		prepared.Owner = definitions.Combatants[bound.CombatantIndex].Key
	}
	if parsed, valid := planbundle.ParseAbilityRef(ref); valid {
		prepared.ProviderRef = parsed.ProviderRef
		if prepared.Owner == "" {
			prepared.Owner = parsed.Combatant
		}
	}
	return prepared, nil
}

func (s SkillActionExecutor) ExecuteAbilityFrame(prepared PreparedAbility, work AbilityFrameWork) *model.EngineError {
	if err := work.StageAbilityLifecycle(prepared.Ability, prepared.Request.Source); err != nil {
		return err
	}
	cast := uint64(0)
	if s.actions.ManualCount() > 0 || s.actions.HasAutomatic() {
		if use := work.KnownAbilityUse(prepared.Request.EntryKey); use != nil && use.ProcessReference().Present {
			cast = use.CastID()
		}
	}
	if cast == 0 {
		cast = work.NextAbilityCast()
	}
	work.BindAbilityCast(cast, prepared.Ability.CastOrigin, !IsNativeHitFollowUp(prepared.Request.EntryKey))
	return work.ExecuteAbilityOperations(prepared.Ability, prepared.Operations)
}

func (s SkillActionExecutor) castError(code model.GenericErrCode, message string) *model.EngineError {
	err := s.error(message, "")
	err.Code = code
	return err
}
