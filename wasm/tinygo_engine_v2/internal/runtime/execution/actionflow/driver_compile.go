package actionflow

import (
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func (s SkillActionExecutor) CompileDriverConditions(entries []model.DriverEntry, registry *formula.Builder, refsByAbility map[string]planbundle.CompiledAbilityRef) *model.EngineError {
	n := len(entries)
	s.actions.InitDriverEntries(n)
	var compileErrors []model.EngineError
	addError := func(code model.GenericErrCode, path, message, ref string) {
		err := model.NewEngineError(model.GenericPhaseRun, code, message)
		err.Path = path
		err.Ref = ref
		err.SchemaHash = s.identity.SchemaHash
		err.RulesHash = s.identity.RulesHash
		err.SessionID = s.identity.SessionID
		compileErrors = append(compileErrors, err)
	}
	for i, entry := range entries {
		refs := registry.DeclaredReferences()
		skill := ""
		source, _ := ResolveDriverCombatant(entry.Source, model.SelectorSource)
		target, _ := ResolveDriverCombatant(entry.Target, source)
		if ref, ok := refsByAbility[NormalizeAbilityRef(entry.AbilityRef, source, target)]; ok {
			skill = s.abilities[ref.AbilityIndex].SkillKey
		}
		if entry.Condition != nil {
			path := "driverPlan.entries[" + entry.EntryKey + "].condition"
			instr := formula.CompileGenericFormula(*entry.Condition, path, refs, map[string]bool{}, addError)
			if !registry.ValidDeclaredScope(instr, skill) {
				addError(model.GenericErrUnknownRef, path, "driver common formula requires its actual ability skill", entry.AbilityRef)
				continue
			}
			for _, in := range registry.InstructionDependencies(instr, nil) {
				if in.ReadKind == formula.ReadEventProviderTargetStateBefore {
					addError(model.GenericErrFormulaTypeError, path, "damage state before is unavailable in driver conditions", in.ReadKey)
				}
				if in.ReadKind == formula.ReadProviderTargetStateRemainingMs {
					addError(model.GenericErrFormulaTypeError, path, "target state remaining time is unavailable in a driver condition", in.ReadKey)
				}
				if in.ReadKind == formula.ReadReceivedLinkedShieldAbsorbed {
					addError(model.GenericErrFormulaTypeError, path, "linked shield absorption is unavailable in a driver condition", in.ReadKey)
				}
				if in.ReadKind == formula.ReadAuthoredRuntimeParameter || in.ReadKind == formula.ReadAuthoredAbilityParameter || in.ReadKind == formula.ReadUseChargeDuration || in.ReadKind == formula.ReadProcessStartState {
					addError(model.GenericErrFormulaTypeError, path, "runtime parameters unavailable in driver condition", in.ReadKey)
				}
				if in.ReadKind == formula.ReadProcessActualCost {
					addError(model.GenericErrFormulaTypeError, path, "process actual costs are unavailable in a driver condition", in.ReadKey)
				}
				if in.ReadKind == formula.ReadUseAmmoBefore {
					addError(model.GenericErrFormulaTypeError, path, "use.ammo.before is unavailable before native attack admission", "use.ammo.before")
				}
			}
			if len(instr) > 0 {
				key := "run:" + path
				id, err := registry.Register(formula.GenericProgram{Key: key, Instr: instr})
				if err != nil {
					addError(model.GenericErrFormulaTypeError, path, err.Error(), key)
				} else {
					s.actions.SetDriverCondition(i, id)
				}
			}
		}
		if entry.Repeat == nil {
			continue
		}
		repeatPath := "driverPlan.entries[" + entry.EntryKey + "].repeat"
		hasFixed := entry.Repeat.IntervalMs > 0
		hasFormula := entry.Repeat.IntervalFormula != nil
		switch {
		case hasFixed && hasFormula:
			addError(model.GenericErrFormulaTypeError, repeatPath, "repeat must have exactly one of intervalMs or intervalFormula", entry.AbilityRef)
		case !hasFixed && !hasFormula:
			addError(model.GenericErrMissingRequiredField, repeatPath, "repeat requires intervalMs or intervalFormula", entry.AbilityRef)
		case hasFormula:
			path := repeatPath + ".intervalFormula"
			instr := formula.CompileGenericFormula(*entry.Repeat.IntervalFormula, path, refs, map[string]bool{}, addError)
			if !registry.ValidDeclaredScope(instr, skill) {
				addError(model.GenericErrUnknownRef, path, "driver common formula requires its actual ability skill", entry.AbilityRef)
				continue
			}
			for _, in := range registry.InstructionDependencies(instr, nil) {
				if in.ReadKind == formula.ReadEventProviderTargetStateBefore {
					addError(model.GenericErrFormulaTypeError, path, "damage state before is unavailable in driver repeat", in.ReadKey)
				}
				if in.ReadKind == formula.ReadProviderTargetStateRemainingMs {
					addError(model.GenericErrFormulaTypeError, path, "target state remaining time is unavailable in a driver repeat", in.ReadKey)
				}
				if in.ReadKind == formula.ReadReceivedLinkedShieldAbsorbed {
					addError(model.GenericErrFormulaTypeError, path, "linked shield absorption is unavailable in a driver repeat", in.ReadKey)
				}
				if in.ReadKind == formula.ReadAuthoredRuntimeParameter || in.ReadKind == formula.ReadAuthoredAbilityParameter || in.ReadKind == formula.ReadUseChargeDuration || in.ReadKind == formula.ReadProcessStartState {
					addError(model.GenericErrFormulaTypeError, path, "runtime parameters unavailable in driver repeat", in.ReadKey)
				}
				if in.ReadKind == formula.ReadProcessActualCost {
					addError(model.GenericErrFormulaTypeError, path, "process actual costs are unavailable in a driver repeat", in.ReadKey)
				}
				if in.ReadKind == formula.ReadUseAmmoBefore {
					addError(model.GenericErrFormulaTypeError, path, "use.ammo.before is unavailable in a driver repeat", "use.ammo.before")
				}
			}
			if len(instr) == 0 {
				continue
			}
			key := "run:" + path
			id, err := registry.Register(formula.GenericProgram{Key: key, Instr: instr})
			if err != nil {
				addError(model.GenericErrFormulaTypeError, path, err.Error(), key)
			} else {
				s.actions.SetDriverInterval(i, id)
			}
		}
	}
	if len(compileErrors) > 0 {
		return &compileErrors[0]
	}
	return nil
}
