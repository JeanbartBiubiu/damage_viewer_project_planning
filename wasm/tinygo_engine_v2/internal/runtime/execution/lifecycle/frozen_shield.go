package lifecycle

import (
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/runtime/contract"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

// FrozenShieldRemoval 只借用原事件、监听身份和实际live效果事实，不取得暂存或发布能力。
type FrozenShieldRemoval struct {
	Event                                  *contract.EventSnapshot
	AbilityRef, ListenerOwner, ListenerRef string
	Source                                 string
	OwnerPresent                           bool
	Providers                              effectpkg.ProviderList
	SchemaHash, RulesHash, SessionID       string
}

// PrepareFrozenShieldRemoval 按原优先级验证冻结盾并交出同一严格移除命令，成功前不取得暂存。
func PrepareFrozenShieldRemoval(input FrozenShieldRemoval) (Mutation, *model.EngineError) {
	if input.Event == nil || input.Event.SkillHit == nil || input.Event.EventType != model.EventTypeSpellShieldBlocked {
		return Mutation{}, frozenShieldError(input, model.GenericErrMissingRequiredField, "providerRefFromEvent requires event/spell_shield_blocked context", input.AbilityRef, "")
	}
	frozen := input.Event.SkillHit
	if frozen.ShieldProviderRef == "" || frozen.ShieldOwner == "" {
		return Mutation{}, frozenShieldError(input, model.GenericErrMissingRequiredField, "spell shield freeze is missing owner/providerRef", model.EventTypeSpellShieldBlocked, "")
	}
	if input.ListenerOwner != "" && input.ListenerOwner != frozen.ShieldOwner {
		return Mutation{}, frozenShieldError(input, model.GenericErrRuntimeInvariantFailed, "listener owner must equal the frozen spell shield bearer", input.ListenerRef, input.ListenerOwner)
	}
	if !input.OwnerPresent {
		return Mutation{}, frozenShieldError(input, model.GenericErrUnknownRef, "frozen spell shield owner is missing", "combatants", frozen.ShieldOwner)
	}
	instance, _, found := input.Providers.Find(frozen.ShieldProviderRef)
	if !found {
		return Mutation{}, frozenShieldError(input, model.GenericErrUnknownRef, "frozen spell shield instance is missing", "providers", frozen.ShieldProviderRef)
	}
	if frozen.ShieldDefinitionRef != "" && instance.DefinitionRef != frozen.ShieldDefinitionRef {
		return Mutation{}, frozenShieldError(input, model.GenericErrUnknownRef, "frozen spell shield definitionRef mismatch", frozen.ShieldProviderRef, instance.DefinitionRef)
	}
	if input.ListenerRef != "" && input.ListenerRef != frozen.ShieldProviderRef {
		return Mutation{}, frozenShieldError(input, model.GenericErrRuntimeInvariantFailed, "listener providerRef must equal the frozen shield instance", input.ListenerRef, frozen.ShieldProviderRef)
	}
	return Mutation{Kind: "expire", ProviderRef: frozen.ShieldProviderRef, DefinitionRef: frozen.ShieldDefinitionRef,
		TargetKey: frozen.ShieldOwner, SourceKey: input.Source, Strict: true}, nil
}

func frozenShieldError(input FrozenShieldRemoval, code model.GenericErrCode, message, path, ref string) *model.EngineError {
	err := model.NewEngineError(model.GenericPhaseRun, code, message)
	err.Path, err.Ref = path, ref
	err.SchemaHash, err.RulesHash, err.SessionID = input.SchemaHash, input.RulesHash, input.SessionID
	return &err
}
