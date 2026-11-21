package compile

import (
	"encoding/json"
	"math"
	"sort"
	"strings"

	"tinygo_engine_v2/internal/base/typeset"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
)

func compileAmmoStateFields(schema map[string]interface{}, fields map[string]plan.CompiledProviderStateField, path string, ctx *genericCompileContext) {
	keys := make([]string, 0, len(schema))
	for key := range schema {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		object, structured := schema[key].(map[string]interface{})
		if !structured {
			continue
		}
		kind, declared := object["stateKind"]
		recovery, hasRecovery := object["ammoRecovery"]
		if !declared && !hasRecovery {
			continue
		}
		fieldPath := path + "." + key
		if kind != model.ProviderStateKindAmmo {
			ctx.collector.addError(model.GenericErrUnknownRef, fieldPath+".stateKind", "ammoRecovery requires stateKind ammo", key)
			continue
		}
		for property := range object {
			if property != "stateKind" && property != "valueType" && property != "defaultValue" && property != "maxValue" && property != "ammoRecovery" {
				ctx.collector.addError(model.GenericErrUnknownRef, fieldPath+"."+property, "unsupported ammo state field", key)
			}
		}
		field, valid := fields[key]
		if !valid {
			continue
		}
		if field.ValueType != model.ProviderStateValueInteger || !field.HasCap || field.MaxValue < 1 {
			ctx.collector.addError(model.GenericErrFormulaTypeError, fieldPath, "ammo requires explicit integer values and capacity at least one", key)
		}
		if !hasRecovery {
			ctx.collector.addError(model.GenericErrMissingRequiredField, fieldPath+".ammoRecovery", "ammo recovery declaration is required", key)
			continue
		}
		encoded, encodeError := json.Marshal(recovery)
		var declaration model.AmmoRecoverySchema
		var shape map[string]json.RawMessage
		if encodeError != nil || json.Unmarshal(encoded, &shape) != nil || shape == nil {
			ctx.collector.addError(model.GenericErrFormulaTypeError, fieldPath+".ammoRecovery", "ammoRecovery must be an object", key)
			continue
		}
		for _, property := range []string{"intervalMs", "mode", "startCondition"} {
			value, present := shape[property]
			if !present || string(value) == "null" {
				ctx.collector.addError(model.GenericErrMissingRequiredField, fieldPath+".ammoRecovery."+property, "explicit ammo recovery field is required", key)
			}
		}
		for property := range shape {
			if property != "intervalMs" && property != "mode" && property != "startCondition" && property != "initialRemainingMs" {
				ctx.collector.addError(model.GenericErrUnknownRef, fieldPath+".ammoRecovery."+property, "unsupported ammo recovery field", key)
			}
		}
		if json.Unmarshal(encoded, &declaration) != nil {
			ctx.collector.addError(model.GenericErrFormulaTypeError, fieldPath+".ammoRecovery", "invalid ammo recovery declaration", key)
			continue
		}
		oneByOne := declaration.Mode == model.AmmoRecoveryOneByOne && declaration.StartCondition == model.AmmoRecoveryAfterConsume
		if !oneByOne && (declaration.Mode != model.AmmoRecoveryAllAtOnce || declaration.StartCondition != model.AmmoRecoveryWhenEmpty) {
			ctx.collector.addError(model.GenericErrUnknownRef, fieldPath+".ammoRecovery.mode", "ammo recovery requires all_at_once/when_empty or one_by_one/after_consume", declaration.Mode)
		}
		_, hasRemaining := shape["initialRemainingMs"]
		remaining := float64(0)
		if hasRemaining {
			if !oneByOne || field.DefaultValue == field.MaxValue {
				ctx.collector.addError(model.GenericErrUnknownRef, fieldPath+".ammoRecovery.initialRemainingMs", "initial remaining time is only admitted for an incomplete one-by-one inventory", key)
			}
			var valid bool
			remaining, valid = ctx.freezeStatic(declaration.InitialRemainingMs, fieldPath+".ammoRecovery.initialRemainingMs", false)
			if valid && (math.IsNaN(remaining) || math.IsInf(remaining, 0) || remaining < 0 || remaining > 9007199254740991 || math.Trunc(remaining) != remaining) {
				ctx.collector.addError(model.GenericErrFormulaTypeError, fieldPath+".ammoRecovery.initialRemainingMs", "initial remaining time must be a non-negative safe integer in milliseconds", key)
			}
		} else if oneByOne && field.DefaultValue < field.MaxValue {
			ctx.collector.addError(model.GenericErrMissingRequiredField, fieldPath+".ammoRecovery.initialRemainingMs", "an incomplete one-by-one inventory requires explicit initial remaining time", key)
		}
		formulaPath := fieldPath + ".ammoRecovery.intervalMs"
		instructions := formula.CompileGenericFormula(declaration.IntervalMs, formulaPath, ctx.namedFormulas, map[string]bool{}, ctx.collector.addError)
		if value, constant := ctx.formulas.FoldInstructions(instructions); constant && (!formula.ValidPositiveInt64DurationMs(value) || value > 9007199254740991) {
			ctx.collector.addError(model.GenericErrFormulaTypeError, formulaPath, "ammo recovery interval must be a positive safe integer in milliseconds", key)
		}
		if value, constant := ctx.formulas.FoldInstructions(instructions); constant && hasRemaining && remaining > value {
			ctx.collector.addError(model.GenericErrFormulaTypeError, fieldPath+".ammoRecovery.initialRemainingMs", "initial remaining time cannot exceed the complete recovery interval", key)
		}
		for _, instruction := range ctx.formulas.InstructionDependencies(instructions, nil) {
			if instruction.Op == formula.GenericOpRead && instruction.ReadKind != formula.ReadSourceAttr && instruction.ReadKind != formula.ReadTargetAttr && instruction.ReadKind != formula.ReadAbilityParam && instruction.ReadKind != formula.ReadProviderState {
				ctx.collector.addError(model.GenericErrFormulaTypeError, formulaPath, "ammo recovery cannot depend on transient event or use values", instruction.ReadKey)
			}
		}
		if len(instructions) > 0 {
			field.StateKind = model.ProviderStateKindAmmo
			program, registered := ctx.registerFormula(formulaPath, instructions)
			if registered {
				field.AmmoRecovery = &plan.CompiledAmmoRecovery{IntervalProgram: program, Path: fieldPath + ".ammoRecovery", OneByOne: oneByOne,
					HasInitialRemaining: hasRemaining, InitialRemainingMs: int64(remaining)}
			}
			fields[key] = field
		}
	}
}

func compileAmmoBindings(ctx *genericCompileContext) {
	for providerIndex := range ctx.session.Providers {
		provider := &ctx.session.Providers[providerIndex]
		stateKey := ""
		for key, field := range provider.StateFields {
			if field.StateKind != model.ProviderStateKindAmmo {
				continue
			}
			if stateKey != "" {
				ctx.collector.addError(model.GenericErrRuntimeInvariantFailed, "providers."+provider.ProviderKey+".initialStateSchema", "a basic-attack provider requires exactly one ammo state", provider.ProviderKey)
			}
			stateKey = key
		}
		if stateKey == "" {
			continue
		}
		var binding *plan.CompiledAmmoBinding
		for processIndex, process := range provider.Processes {
			for _, moment := range process.MomentOperations {
				for _, operation := range ctx.session.Operations[int(moment.OperationStart) : int(moment.OperationStart)+int(moment.OperationCount)] {
					if operation.Operation != "state_change" || operation.Ref != stateKey {
						continue
					}
					if process.InitialAbilityIndex < 0 || process.InitialAbilityIndex >= len(ctx.session.Abilities) {
						ctx.collector.addError(model.GenericErrUnknownRef, process.Path, "ammo requires an actual initial control ability", stateKey)
						continue
					}
					initial := ctx.session.Abilities[process.InitialAbilityIndex]
					value, constant := float64(0), false
					if operation.HasAmount {
						value, constant = ctx.formulas.FoldInstructions(ctx.formulas.Instructions(formula.GenericProgramID(operation.AmountProgram)))
					}
					validInitial := initial.ProcessControl != nil && initial.ProcessControl.Action == "INITIAL" &&
						(initial.IsBasicAttack && initial.ProcessControl.UseRefFromEvent || !initial.IsBasicAttack && initial.Kind == "active" && !initial.ProcessControl.UseRefFromEvent && hasAmmoSkillActionBinding(ctx, providerIndex, process.InitialAbilityIndex))
					if binding != nil || moment.Moment.MomentType != "PROCESS_START" || !validInitial || operation.HasCondition || operation.StateScope != "state_scope/provider" || (operation.Target != model.SelectorSource && operation.Target != model.SelectorSelf) || operation.ValuePolicy != "add" || !constant || value != -1 {
						ctx.collector.addError(model.GenericErrRuntimeInvariantFailed, operation.Path, "ammo consumption requires one unconditional bound initial PROCESS_START add(-1) operation", stateKey)
						continue
					}
					binding = &plan.CompiledAmmoBinding{StateKey: stateKey, InitialAbilityIndex: process.InitialAbilityIndex, ProcessIndex: processIndex, ConsumptionPath: operation.Path}
				}
			}
		}
		if binding == nil {
			ctx.collector.addError(model.GenericErrMissingRequiredField, "providers."+provider.ProviderKey+".processes", "ammo has no unique native attack-start consumption", stateKey)
			continue
		}
		for _, operation := range ctx.session.Operations {
			if operation.OwnerProviderIndex == providerIndex && operation.Ref == stateKey && (operation.Operation == "state_change" || operation.Operation == model.OperationKindStateDurationChange) && operation.Path != binding.ConsumptionPath {
				if operation.Operation == model.OperationKindStateDurationChange && provider.StateFields[stateKey].AmmoRecovery != nil && provider.StateFields[stateKey].AmmoRecovery.OneByOne && operation.StateScope == "state_scope/provider" {
					continue
				}
				ctx.collector.addError(model.GenericErrRuntimeInvariantFailed, operation.Path, "ammo may only be consumed by its unique native attack-start operation", stateKey)
			}
		}
		provider.AmmoBinding = binding
		if !ctx.session.Abilities[binding.InitialAbilityIndex].IsBasicAttack {
			// Active ammo is driven only by its immutable real INITIAL binding, never a listener alias.
			for _, listener := range ctx.session.Listeners {
				if !listener.HasAbilityRef {
					continue
				}
				parsed, valid := plan.ParseAbilityRef(listener.AbilityRef)
				if valid && parsed.Combatant == "self" {
					parsed.Combatant = listener.OwnerCombatantKey
				}
				if valid {
					ref := parsed.Combatant + ".provider[" + parsed.ProviderRef + "].ability[" + parsed.AbilityKey + "]"
					if indexed, found := ctx.session.AbilityRefIndex[ref]; found && int(indexed.ProviderIndex) == providerIndex && int(indexed.AbilityIndex) == binding.InitialAbilityIndex {
						ctx.collector.addError(model.GenericErrRuntimeInvariantFailed, ref, "active ammo INITIAL must not be invoked by a listener", stateKey)
					}
				}
			}
			continue
		}
		for _, actor := range ctx.session.Combatants {
			for _, mount := range actor.ProviderMounts {
				if int(mount.DefinitionIndex) != providerIndex {
					continue
				}
				initialRef := actor.Key + ".provider[" + mount.ProviderRef + "].ability[" + ctx.session.Abilities[binding.InitialAbilityIndex].AbilityKey + "]"
				listeners := 0
				for _, listener := range ctx.session.Listeners {
					if !listener.HasAbilityRef {
						continue
					}
					parsed, valid := plan.ParseAbilityRef(listener.AbilityRef)
					if valid && parsed.Combatant == "self" {
						parsed.Combatant = listener.OwnerCombatantKey
					}
					if !valid || parsed.Combatant+".provider["+parsed.ProviderRef+"].ability["+parsed.AbilityKey+"]" != initialRef {
						continue
					}
					listeners++
					startType, startDeclared := ctx.session.Types.Registry.LookupDomain("event", model.EventTypeBasicAttackStart)
					ownerType, ownerDeclared := ctx.session.Types.Registry.LookupDomain("event", "event/source_owner")
					if listener.OwnerCombatantKey != actor.Key || listener.OwnerProviderRef != mount.ProviderRef || !startDeclared || !ownerDeclared || !listener.EventMatcher.RequiresAllType(startType) || !listener.EventMatcher.RequiresAllType(ownerType) || listener.HasCondition || listener.HasOncePerUse || listener.PerCastThrottleMs != 0 || listener.MaxTriggersPerEvent != 1 || listener.OperationCount != 0 {
						ctx.collector.addError(model.GenericErrRuntimeInvariantFailed, initialRef, "ammo start chain requires an unconditional owned native-start listener", stateKey)
					}
				}
				if listeners != 1 {
					ctx.collector.addError(model.GenericErrRuntimeInvariantFailed, initialRef, "ammo start chain must invoke its initial control exactly once", stateKey)
				}
			}
		}
	}
}

func hasAmmoSkillActionBinding(ctx *genericCompileContext, providerIndex, initialIndex int) bool {
	for _, binding := range ctx.session.SkillActionBindings {
		if int(binding.InitialAbilityIndex) == initialIndex && binding.ProviderDefinitionRef == ctx.session.Providers[providerIndex].ProviderKey {
			return true
		}
	}
	return false
}

func validMechanicStatusKey(key string) bool {
	if len(key) == 0 || len(key) > 64 || key[0] < 'a' || key[0] > 'z' {
		return false
	}
	for _, character := range key {
		if character != '_' && !(character >= 'a' && character <= 'z') && !(character >= '0' && character <= '9') {
			return false
		}
	}
	return true
}

func validateMechanicFormulaContexts(ctx *genericCompileContext) {
	allowedAmmo := map[formula.GenericProgramID]bool{}
	statusKeys := map[string]bool{}
	for identifier, key := range ctx.catalog.Registry.Keys {
		if ctx.catalog.Domains[typeset.TypeID(identifier)] != "status" {
			continue
		}
		statusKey := strings.TrimPrefix(key, "status/")
		if !validMechanicStatusKey(statusKey) {
			ctx.collector.addError(model.GenericErrUnknownTypeKey, "typeCatalog.types", "status declaration requires a valid status key", key)
			continue
		}
		statusKeys[statusKey] = true
		ctx.session.StatusKeys = append(ctx.session.StatusKeys, statusKey)
	}
	for _, provider := range ctx.session.Providers {
		if provider.AmmoBinding == nil {
			continue
		}
		for _, ability := range ctx.session.Abilities[int(provider.AbilityStart) : int(provider.AbilityStart)+int(provider.AbilityCount)] {
			if !ability.IsBasicAttack || !ability.HasSkillHit || ability.SkillKey != provider.Processes[provider.AmmoBinding.ProcessIndex].SkillKey {
				continue
			}
			for _, operation := range ctx.session.Operations[int(ability.OperationStart) : int(ability.OperationStart)+int(ability.OperationCount)] {
				if operation.SkillHit == nil {
					continue
				}
				for _, candidate := range operation.SkillHit.Candidates {
					if candidate.HasParticipation {
						allowedAmmo[candidate.ParticipationProgram] = true
					}
					for _, result := range ctx.session.Operations[int(candidate.OperationStart) : int(candidate.OperationStart)+int(candidate.OperationCount)] {
						if result.HasCondition {
							allowedAmmo[result.ConditionProgram] = true
						}
					}
				}
			}
		}
	}
	for index := 0; index < ctx.formulas.Count(); index++ {
		program := ctx.formulas.Info(formula.GenericProgramID(index))
		_, named := ctx.namedFormulas[program.Key]
		for _, instruction := range ctx.formulas.ReadDependencies(formula.GenericProgramID(index)) {
			if instruction.Op != formula.GenericOpRead {
				continue
			}
			if instruction.ReadKind == formula.ReadUseAmmoBefore || instruction.ReadKind == formula.ReadSourceStatusPresent || instruction.ReadKind == formula.ReadTargetStatusPresent {
				ctx.session.Features |= plan.FeatureMechanicReads
			}
			if instruction.ReadKind == formula.ReadUseAmmoBefore && !allowedAmmo[formula.GenericProgramID(index)] && !named {
				ctx.collector.addError(model.GenericErrFormulaTypeError, program.Key, "use.ammo.before is restricted to the owning ammo attack's result conditions", "use.ammo.before")
			}
			if (instruction.ReadKind == formula.ReadSourceStatusPresent || instruction.ReadKind == formula.ReadTargetStatusPresent) && !statusKeys[instruction.ReadKey] {
				ctx.collector.addError(model.GenericErrUnknownRef, program.Key, "status presence key is not declared by the actual status catalog", instruction.ReadKey)
			}
		}
	}
}
