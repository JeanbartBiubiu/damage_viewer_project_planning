package actionflow

import (
	"math"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
)

// AmmoConsumption 提供一次真实使用、过程与实际扣弹结果的有限核验输入。
type AmmoConsumption struct {
	Ammo           *actionpkg.AmmoView
	Process        *actionpkg.ProcessView
	Use            *actionpkg.UseView
	UseKey         string
	UseCaptured    bool
	PendingCapture bool
	ProcessIsNew   bool
	Before, After  float64
}

// ValidBasicAmmoProvider 判断原普攻来源的状态集合是否属于受支持的库存形态。
func ValidBasicAmmoProvider(provider planbundle.CompiledProvider) bool {
	if provider.AmmoBinding == nil {
		return len(provider.StateFields) == 0
	}
	return ValidBoundAmmoFields(provider)
}

// ValidBoundAmmoFields 核对唯一实际弹药绑定及允许的普通整数状态。
func ValidBoundAmmoFields(provider planbundle.CompiledProvider) bool {
	if provider.AmmoBinding == nil {
		return false
	}
	field, exists := provider.StateFields[provider.AmmoBinding.StateKey]
	if !exists || field.StateKind != model.ProviderStateKindAmmo || field.AmmoRecovery == nil {
		return false
	}
	for key, extra := range provider.StateFields {
		if key != provider.AmmoBinding.StateKey && (extra.StateKind != "" || extra.ValueType != model.ProviderStateValueInteger) {
			return false
		}
	}
	return true
}

func (s SkillActionExecutor) PlannedAmmoReady(owner, providerRef string, ability planbundle.CompiledAbility, work AmmoWork) (bool, int64, *model.EngineError) {
	provider := s.providers[ability.ProviderIndex]
	if provider.AmmoBinding == nil {
		return true, 0, nil
	}
	ammo := s.FindAmmo(owner, providerRef, provider.AmmoBinding.StateKey)
	if ammo == nil {
		return false, 0, s.error("active ammo requires its selected actual source", provider.ProviderKey)
	}
	value, err := work.ReadAmmoInventory(ammo)
	if err != nil || value > 0 {
		return value > 0, 0, err
	}
	wait := work.ReadAmmoWait(ammo)
	if !wait.Active {
		return false, 0, s.error("empty active ammo has no recovery wait", provider.ProviderKey)
	}
	return false, wait.ReadyAt, nil
}

func (s SkillActionExecutor) BasicAmmoReady(ammo *actionpkg.AmmoView, now int64, work AmmoWork) (bool, bool, *model.EngineError) {
	value, err := work.ReadAmmoInventory(ammo)
	if err != nil {
		return false, false, err
	}
	if value > 0 {
		if ammo.Wait().Active && !ammo.Definition().StateFields[ammo.Binding().StateKey].AmmoRecovery.OneByOne {
			return false, false, s.error("a recovering all-at-once inventory cannot contain usable ammo", ammo.Binding().StateKey)
		}
		return true, false, nil
	}
	if ammo.Wait().Active {
		if ammo.Wait().ReadyAt <= now {
			return false, false, s.error("ammo recovery must settle before attack admission", ammo.Binding().StateKey)
		}
		return false, false, nil
	}
	if err := work.ConsumeAmmoCommand(); err != nil {
		return false, false, err
	}
	if err := s.PrepareAmmoRecovery(ammo, ammo.Ability(), -1, now, work); err != nil {
		return false, false, err
	}
	return false, true, nil
}

func (s SkillActionExecutor) ValidateAmmoConsumption(input AmmoConsumption, operation planbundle.CompiledOperation, ability planbundle.CompiledAbility, work AmmoWork) *model.EngineError {
	ammo, process := input.Ammo, input.Process
	if ammo == nil || operation.Path != ammo.Binding().ConsumptionPath || process == nil || process.AbilityRef() != ammo.AbilityRef() ||
		process.Owner() != ammo.Owner() || process.ProviderRef() != ammo.ProviderRef() || process.SkillKey() != ability.SkillKey ||
		input.PendingCapture || input.Before < 1 || input.After != input.Before-1 {
		return s.error("ammo consumption does not match its unique owner/provider/state/use binding", operation.Path)
	}
	newActive := input.ProcessIsNew && !ability.IsBasicAttack && s.actions.ActionForUse(input.UseKey) != nil && input.Use == nil
	if !newActive && (input.Use == nil || input.Use.Source() != ammo.Owner() || input.Use.SkillKey() != ability.SkillKey || input.UseCaptured) {
		return s.error("ammo consumption requires its original committed use or staged INITIAL use", operation.Path)
	}
	if work.ReadAmmoWait(ammo).Active && !ammo.Definition().StateFields[ammo.Binding().StateKey].AmmoRecovery.OneByOne {
		return s.error("all-at-once ammo cannot be consumed during recovery", operation.Path)
	}
	return nil
}

func (s SkillActionExecutor) SubtractAmmoDuration(ammo *actionpkg.AmmoView, operation planbundle.CompiledOperation, ability planbundle.CompiledAbility, now int64, work AmmoWork) *model.EngineError {
	if ammo == nil || !ammo.Definition().StateFields[operation.Ref].AmmoRecovery.OneByOne || operation.StateScope != "state_scope/provider" {
		return s.error("ammo duration change requires its driven one-by-one provider state", operation.Path)
	}
	wait := work.ReadAmmoWait(ammo)
	if !wait.Active {
		return nil
	}
	amount, err := work.AmmoAmount(operation.AmountProgram, ability, false)
	if err != nil {
		return err
	}
	if math.IsNaN(amount) || math.IsInf(amount, 0) || amount < 0 || amount > float64(maxJSONSafeInteger) {
		err := s.error("ammo duration subtract must be finite, non-negative and safe", operation.Path+".amount")
		err.Code, err.Ref = model.GenericErrFormulaTypeError, operation.Ref
		return err
	}
	ready := wait.ReadyAt - int64(math.Round(amount))
	if ready < now {
		ready = now
	}
	if ready == wait.ReadyAt {
		return nil
	}
	if wait.Generation == ^uint64(0) {
		return s.error("ammo generation overflow", operation.Path)
	}
	wait.ReadyAt, wait.Generation = ready, wait.Generation+1
	work.WriteAmmoWait(ammo, wait)
	return nil
}
