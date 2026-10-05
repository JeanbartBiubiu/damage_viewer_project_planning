package compile

import (
	"encoding/json"
	"sort"
	"strings"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
)

type CompiledAmmoRecovery struct {
	IntervalProgram formula.GenericProgramID
	Path            string
}

type CompiledAmmoBinding struct {
	StateKey            string
	InitialAbilityIndex int
	ProcessIndex        int
	ConsumptionPath     string
}

func compileAmmoStateFields(schema map[string]interface{}, fields map[string]CompiledProviderStateField, path string, ctx *genericCompileContext) {
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
			if property != "intervalMs" && property != "mode" && property != "startCondition" {
				ctx.collector.addError(model.GenericErrUnknownRef, fieldPath+".ammoRecovery."+property, "unsupported ammo recovery field", key)
			}
		}
		if json.Unmarshal(encoded, &declaration) != nil {
			ctx.collector.addError(model.GenericErrFormulaTypeError, fieldPath+".ammoRecovery", "invalid ammo recovery declaration", key)
			continue
		}
		if declaration.Mode != model.AmmoRecoveryAllAtOnce {
			ctx.collector.addError(model.GenericErrUnknownRef, fieldPath+".ammoRecovery.mode", "only all_at_once recovery is supported", declaration.Mode)
		}
		if declaration.StartCondition != model.AmmoRecoveryWhenEmpty {
			ctx.collector.addError(model.GenericErrUnknownRef, fieldPath+".ammoRecovery.startCondition", "only when_empty recovery is supported", declaration.StartCondition)
		}
		formulaPath := fieldPath + ".ammoRecovery.intervalMs"
		instructions := formula.CompileGenericFormula(declaration.IntervalMs, formulaPath, ctx.namedFormulas, map[string]bool{}, ctx.collector.addError)
		if value, constant := formula.TryFoldConst(instructions); constant && (!formula.ValidPositiveInt64DurationMs(value) || value > 9007199254740991) {
			ctx.collector.addError(model.GenericErrFormulaTypeError, formulaPath, "ammo recovery interval must be a positive safe integer in milliseconds", key)
		}
		for _, instruction := range instructions {
			if instruction.Op == formula.GenericOpRead && instruction.ReadKind != formula.ReadSourceAttr && instruction.ReadKind != formula.ReadTargetAttr && instruction.ReadKind != formula.ReadAbilityParam && instruction.ReadKind != formula.ReadProviderState {
				ctx.collector.addError(model.GenericErrFormulaTypeError, formulaPath, "ammo recovery cannot depend on transient event or use values", instruction.ReadKey)
			}
		}
		if len(instructions) > 0 {
			field.StateKind = model.ProviderStateKindAmmo
			field.AmmoRecovery = &CompiledAmmoRecovery{IntervalProgram: ctx.registerFormula(formulaPath, instructions), Path: fieldPath + ".ammoRecovery"}
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
		var binding *CompiledAmmoBinding
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
						value, constant = formula.TryFoldConst(ctx.session.Formulas.Programs[operation.AmountProgram].Instr)
					}
					if binding != nil || moment.Moment.MomentType != "PROCESS_START" || !initial.IsBasicAttack || initial.ProcessControl == nil || !initial.ProcessControl.UseRefFromEvent || operation.HasCondition || operation.StateScope != "state_scope/provider" || (operation.Target != model.SelectorSource && operation.Target != model.SelectorSelf) || operation.ValuePolicy != "add" || !constant || value != -1 {
						ctx.collector.addError(model.GenericErrRuntimeInvariantFailed, operation.Path, "ammo consumption requires one unconditional native attack-start add(-1) operation", stateKey)
						continue
					}
					binding = &CompiledAmmoBinding{StateKey: stateKey, InitialAbilityIndex: process.InitialAbilityIndex, ProcessIndex: processIndex, ConsumptionPath: operation.Path}
				}
			}
		}
		if binding == nil {
			ctx.collector.addError(model.GenericErrMissingRequiredField, "providers."+provider.ProviderKey+".processes", "ammo has no unique native attack-start consumption", stateKey)
			continue
		}
		for _, operation := range ctx.session.Operations {
			if operation.OwnerProviderIndex == providerIndex && operation.Ref == stateKey && (operation.Operation == "state_change" || operation.Operation == model.OperationKindStateDurationChange) && operation.Path != binding.ConsumptionPath {
				ctx.collector.addError(model.GenericErrRuntimeInvariantFailed, operation.Path, "ammo may only be consumed by its unique native attack-start operation", stateKey)
			}
		}
		provider.AmmoBinding = binding
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
					parsed, valid := ParseAbilityRef(listener.AbilityRef)
					if valid && parsed.Combatant == "self" {
						parsed.Combatant = listener.OwnerCombatantKey
					}
					if !valid || parsed.Combatant+".provider["+parsed.ProviderRef+"].ability["+parsed.AbilityKey+"]" != initialRef {
						continue
					}
					listeners++
					startType, startDeclared := ctx.session.Types.Registry.Lookup(model.EventTypeBasicAttackStart)
					ownerType, ownerDeclared := ctx.session.Types.Registry.Lookup("event/source_owner")
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
	for _, key := range ctx.catalog.Registry.Keys {
		identifier, _ := ctx.catalog.Registry.Lookup(key)
		if ctx.catalog.Domains[identifier] != "status" {
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
	for index, program := range ctx.session.Formulas.Programs {
		_, named := ctx.namedFormulas[program.Key]
		for _, instruction := range program.Instr {
			if instruction.Op != formula.GenericOpRead {
				continue
			}
			if instruction.ReadKind == formula.ReadUseAmmoBefore || instruction.ReadKind == formula.ReadSourceStatusPresent || instruction.ReadKind == formula.ReadTargetStatusPresent {
				ctx.session.HasMechanicReads = true
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
