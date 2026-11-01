package admission

import (
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

// ValidateEquipmentHitListenerHeader 核对引擎事件种类、拥有者关系和完整监听形状。
func ValidateEquipmentHitListenerHeader(input Input, listener planbundle.CompiledListener) *model.EngineError {
	qualified := false
	types := input.Compiled.RuntimeTypes
	for _, event := range []struct{ kind, relation planbundle.DeclaredType }{
		{types.BasicAttackStart, types.SourceOwner}, {types.BasicAttackHit, types.SourceOwner},
		{types.SkillHit, types.SourceOwner},
		{types.ProcessResolved, types.SourceOwner},
		{types.AttackLinkApplied, types.SourceOwner}, {types.HitLinkApplied, types.SourceOwner},
		{types.BasicAttackReceived, types.TargetOwner}, {types.DamageTaken, types.TargetOwner},
		{types.DamageInstance, types.SourceOwner},
		{types.AbilityStarted, types.SourceOwner},
	} {
		kind, kindDeclared := event.kind.Lookup()
		relation, relationDeclared := event.relation.Lookup()
		qualified = qualified || kindDeclared && relationDeclared && listener.EventMatcher.RequiresAllType(kind) && listener.EventMatcher.RequiresAllType(relation)
	}
	if !qualified || listener.OwnerCombatantKey == "" || listener.OwnerProviderRef == "" || listener.HasAbilityRef || listener.PerCastThrottleMs != 0 || listener.OperationCount == 0 || listener.MaxTriggersPerEvent != 1 {
		return fail(input, "source requires a complete owner-start/hit/link or receiver-only engine event listener", "listeners."+listener.ListenerKey)
	}
	return nil
}
