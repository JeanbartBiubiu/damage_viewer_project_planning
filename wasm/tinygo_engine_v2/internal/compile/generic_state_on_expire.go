package compile

import (
	"bytes"
	"encoding/json"
	"sort"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
)

// 到期操作复用普通操作表及已有状态期限，不创建周期能力。
func compileStateOnExpire(req model.CompileRequest, ctx *genericCompileContext) {
	seen := make(map[string]bool)
	for pi, provider := range req.SharedProviders {
		index, compiled := ctx.providerKeyIndex[provider.ProviderKey]
		if !compiled || seen[provider.ProviderKey] {
			continue
		}
		seen[provider.ProviderKey] = true
		ctx.currentSkillKey = provider.SkillKey
		keys := make([]string, 0, len(provider.InitialStateSchema))
		for key := range provider.InitialStateSchema {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			object, ok := provider.InitialStateSchema[key].(map[string]interface{})
			if !ok {
				continue
			}
			raw, present := object["onExpire"]
			if !present {
				continue
			}
			path := "sharedProviders[" + itoa(pi) + "].initialStateSchema." + key + ".onExpire"
			fail := func(message string) { ctx.collector.addError(model.GenericErrFormulaTypeError, path, message, key) }
			field, exists := ctx.session.Providers[index].StateFields[key]
			if !exists || (provider.Kind != "character" && provider.Kind != "build") || provider.Lifecycle != nil || len(provider.Processes) != 0 || field.StateKind != "" || field.ValueType != model.ProviderStateValueInteger || field.DefaultValue != 0 || !field.HasCap || field.MaxValue != 1 || field.DurationMs <= 0 || field.RefreshPolicy != model.ProviderStateRefreshOnWrite {
				fail("onExpire requires a permanent own integer 0..1 refresh-on-write timed field")
				continue
			}
			data, err := json.Marshal(raw)
			var operations []model.OperationDefinition
			decoder := json.NewDecoder(bytes.NewReader(data))
			decoder.DisallowUnknownFields()
			if err != nil || raw == nil || decoder.Decode(&operations) != nil || len(operations) != 1 {
				fail("onExpire requires one complete self linked-shield operation")
				continue
			}
			field.OnExpireStart = uint16(len(ctx.session.Operations))
			for i, operation := range operations {
				compileOperation(operation, path+"["+itoa(i)+"]", int(index), ctx)
			}
			field.OnExpireCount = uint16(len(ctx.session.Operations)) - field.OnExpireStart
			ctx.session.Providers[index].StateFields[key] = field
			ctx.session.Providers[index].HasStateOnExpire, ctx.session.HasStateOnExpire = true, true
		}
	}
	ctx.currentSkillKey = ""
}

func finalizeStateOnExpire(ctx *genericCompileContext) {
	for pi, provider := range ctx.session.Providers {
		if !provider.HasStateOnExpire {
			continue
		}
		mounted := false
		for _, actor := range ctx.session.Combatants {
			for _, mount := range actor.ProviderMounts {
				mounted = mounted || int(mount.DefinitionIndex) == pi
			}
		}
		if !mounted {
			ctx.collector.addError(model.GenericErrFormulaTypeError, "sharedProviders["+itoa(pi)+"]", "state expiry source requires a real initial owner mount", provider.ProviderKey)
		}
		initialized, declared := ctx.session.RuntimeTypes.SourceInitialized.Lookup()
		ownerType, ownerDeclared := ctx.session.RuntimeTypes.SourceOwner.Lookup()
		initializers := 0
		for _, listener := range provider.Listeners {
			if declared && ownerDeclared && listener.EventMatcher.RequiresAllType(initialized) && listener.EventMatcher.RequiresAllType(ownerType) {
				initializers++
				if listener.HasCondition || listener.HasAbilityRef || listener.HasOncePerUse || listener.PerCastThrottleMs != 0 || listener.MaxTriggersPerEvent != 1 || listener.OperationCount != 1 {
					ctx.collector.addError(model.GenericErrFormulaTypeError, "sharedProviders["+itoa(pi)+"].listeners", "state expiry initialization requires one unconditional complete own linked shield", provider.ProviderKey)
				}
				if listener.OperationCount == 1 {
					initial := ctx.session.Operations[listener.OperationStart]
					matched := true
					for _, field := range provider.StateFields {
						if field.OnExpireCount != 1 {
							continue
						}
						expiry := ctx.session.Operations[field.OnExpireStart]
						if !(initial.Operation == "shield" && initial.Target == "self" && initial.HasAmount && initial.HasShieldLifecycleProvider && !initial.HasCondition && !initial.HasShieldDuration && initial.ShieldRef == expiry.ShieldRef && initial.ShieldLifecycleProviderIndex == expiry.ShieldLifecycleProviderIndex && sameExpiryAmount(initial.AmountProgram, expiry.AmountProgram, ctx)) {
							matched = false
						}
					}
					if !matched {
						ctx.collector.addError(model.GenericErrFormulaTypeError, initial.Path, "initialization and onExpire must apply the same complete own shield", provider.ProviderKey)
					}
				}
			}
		}
		if initializers != 1 {
			ctx.collector.addError(model.GenericErrFormulaTypeError, "sharedProviders["+itoa(pi)+"].listeners", "state expiry source requires its unique actual owner initialization", provider.ProviderKey)
		}
		for key, field := range provider.StateFields {
			if field.OnExpireCount == 0 {
				continue
			}
			for _, operation := range ctx.session.Operations[int(field.OnExpireStart) : int(field.OnExpireStart)+int(field.OnExpireCount)] {
				valid := operation.Operation == "shield" && operation.Target == "self" && operation.HasAmount && operation.HasShieldLifecycleProvider && !operation.HasCondition && !operation.HasShieldDuration
				for _, read := range ctx.session.Formulas.ReadDependencies(operation.AmountProgram) {
					valid = valid && read.ReadKind == formula.ReadSourceAttr && read.ReadKey == "hp.max"
				}
				if !valid {
					ctx.collector.addError(model.GenericErrFormulaTypeError, operation.Path, "onExpire only admits its complete self linked shield with owned maximum-health or static amount", key)
				}
			}
		}
		for _, operation := range ctx.session.Operations {
			if operation.ProviderDefinitionRef == provider.ProviderKey {
				ctx.collector.addError(model.GenericErrFormulaTypeError, operation.Path, "state expiry source cannot be dynamically applied", provider.ProviderKey)
			}
			if operation.OwnerProviderIndex != pi {
				continue
			}
			if field, exists := provider.StateFields[operation.Ref]; exists && field.OnExpireCount > 0 && operation.Operation == "state_change" && (operation.StateScope != "state_scope/provider" || (operation.Target != "self" && operation.Target != "source")) {
				ctx.collector.addError(model.GenericErrFormulaTypeError, operation.Path, "onExpire state can only be written in its own provider scope", operation.Ref)
			}
			if field := provider.StateFields[operation.Ref]; field.OnExpireCount > 0 && operation.Operation == model.OperationKindStateDurationChange {
				ctx.collector.addError(model.GenericErrFormulaTypeError, operation.Path, "onExpire field only admits full write-and-refresh, not duration mutation", operation.Ref)
			}
		}
	}
}

func sameExpiryAmount(a, b formula.GenericProgramID, ctx *genericCompileContext) bool {
	left, right := ctx.session.Formulas.Programs[a].Instr, ctx.session.Formulas.Programs[b].Instr
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}
