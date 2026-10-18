package compile

import (
	"math"
	"strings"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
)

func compileSkillActionBindings(bindings []model.SkillActionBinding, ctx *genericCompileContext) {
	seen := map[string]bool{}
	seenOrigins := map[string]bool{}
	if len(bindings) > 16 {
		ctx.collector.addError(model.GenericErrUnknownRef, "rules.skillActionBindings", "at most 16 skill bindings are admitted", "")
	}
	for index, binding := range bindings {
		path := "rules.skillActionBindings[" + itoa(index) + "]"
		fail := func(message string) {
			ctx.collector.addError(model.GenericErrUnknownRef, path, message, binding.BindingKey)
		}
		if strings.TrimSpace(binding.BindingKey) == "" || strings.TrimSpace(binding.SkillKey) == "" || binding.Source != model.SelectorSource || seen[binding.BindingKey] || seenOrigins[binding.ProviderRef] {
			fail("binding requires a unique source identity and skill")
			continue
		}
		seen[binding.BindingKey], seenOrigins[binding.ProviderRef] = true, true
		if len(binding.Controls) < 1 || len(binding.Controls) > 4 || binding.Controls[0].Action != "INITIAL" || len(binding.HitBindings) > 64 {
			fail("planned binding requires an initial control and finite same-process controls and releases")
			continue
		}
		control := binding.Controls[0]
		parsed, valid := plan.ParseAbilityRef(control.AbilityRef)
		ref, found := ctx.session.AbilityRefIndex[control.AbilityRef]
		if !valid || !found || parsed.Combatant != binding.Source || parsed.ProviderRef != binding.ProviderRef {
			fail("control must belong to the actual source mount")
			continue
		}
		provider := ctx.session.Providers[ref.ProviderIndex]
		ability := ctx.session.Abilities[ref.AbilityIndex]
		if provider.ProviderKey != binding.ProviderDefinitionRef || ability.Kind != "active" || ability.IsBasicAttack || ability.SkillKey != binding.SkillKey || ability.ProcessControl == nil || ability.ProcessControl.Action != "INITIAL" || ability.ProcessControl.ProcessKey != control.ProcessKey || ability.ProcessControl.UseRefFromEvent {
			fail("binding must match a non-basic INITIAL process and definition")
			continue
		}
		if ability.ProcessControl.ProcessIndex < 0 || ability.ProcessControl.ProcessIndex >= len(provider.Processes) {
			fail("binding control requires its declared compiled process")
			continue
		}
		process := provider.Processes[ability.ProcessControl.ProcessIndex]
		if process.SkillKey != binding.SkillKey || len(process.Steps) < 1 || len(process.Steps) > 64 {
			fail("planned cast requires one declared finite process with at most 64 steps")
			continue
		}
		invalid := false
		complexStep := ""
		empowered := len(process.Steps) == 1 && process.Steps[0].StepType == "EMPOWERED_BASIC_ATTACK"
		var empoweredAbility uint16
		if empowered && (len(binding.Controls) != 1 || len(binding.HitBindings) != 1) {
			fail("empowered attack requires its initial control and one complete result binding")
			invalid = true
		}
		if empowered {
			for _, moment := range process.MomentOperations {
				if moment.Moment.MomentType == "STEP_EXECUTION" && moment.OperationCount != 0 {
					fail("empowered execution results must use their one ordered payload, not separate moment operations")
					invalid = true
				}
			}
		}
		for stepIndex, step := range process.Steps {
			if !step.HasActionOccupancy {
				fail("every planned skill step requires an explicit occupiesAction boolean")
				invalid = true
			}
			if step.StepType == "MULTI_HIT" || step.StepType == "CHANNEL" || step.StepType == "CHARGE" || step.StepType == "RECAST" || step.StepType == "EMPOWERED_BASIC_ATTACK" {
				if complexStep != "" || stepIndex != len(process.Steps)-1 {
					fail("planned complex process admits only one final complex step")
					invalid = true
				}
				complexStep = step.StepKey
			}
		}
		if _, exists := ctx.session.Types.Registry.LookupDomain("event", "event/ability_started"); !exists {
			fail("single cast requires its real successful-use event catalog")
			continue
		}
		controls := map[string]uint16{"INITIAL": ref.AbilityIndex}
		for _, selected := range binding.Controls[1:] {
			selectedRef, exists := ctx.session.AbilityRefIndex[selected.AbilityRef]
			selectedMount, valid := plan.ParseAbilityRef(selected.AbilityRef)
			_, duplicate := controls[selected.Action]
			if duplicate || !exists || !valid || selectedMount.Combatant != binding.Source || selectedMount.ProviderRef != binding.ProviderRef || selected.ProcessKey != control.ProcessKey || (selected.Action != "RECAST" && selected.Action != "CHARGE_RELEASE" && selected.Action != "CANCEL") || selectedRef.ProviderIndex != ref.ProviderIndex {
				fail("control must name a unique declared phase on the original source process")
				invalid = true
				continue
			}
			selectedAbility := ctx.session.Abilities[selectedRef.AbilityIndex]
			if selectedAbility.Kind != "active" || selectedAbility.IsBasicAttack || selectedAbility.SkillKey != binding.SkillKey || selectedAbility.ProcessControl == nil || selectedAbility.ProcessControl.Action != selected.Action || selectedAbility.ProcessControl.ProcessKey != control.ProcessKey || selectedAbility.ProcessControl.UseRefFromEvent {
				fail("control must match the actual stage ability without another initial use")
				invalid = true
				continue
			}
			controls[selected.Action] = selectedRef.AbilityIndex
		}
		seenHits, seenMoments := map[string]bool{}, map[string]bool{}
		for _, hit := range binding.HitBindings {
			parsedHit, validHit := plan.ParseAbilityRef(hit.HitAbilityRef)
			hitRef, foundHit := ctx.session.AbilityRefIndex[hit.HitAbilityRef]
			momentKey := hit.Moment.MomentType
			validMoment := complexStep == "" && hit.Moment.MomentType == "PROCESS_COMPLETE" && hit.Moment.StepKey == nil
			if hit.Moment.MomentType == "STEP_EXECUTION" && hit.Moment.StepKey != nil {
				validMoment = complexStep != "" && *hit.Moment.StepKey == complexStep
				momentKey += "|" + *hit.Moment.StepKey
			}
			if !validHit || !foundHit || parsedHit.Combatant != binding.Source || parsedHit.ProviderRef != binding.ProviderRef || strings.TrimSpace(hit.HitBindingKey) == "" || seenHits[hit.HitBindingKey] || seenMoments[momentKey] || hit.ProcessKey != control.ProcessKey || !validMoment || hit.Moment.FailureReason != nil {
				fail("hit binding must uniquely name this process real execution or successful completion")
				invalid = true
				continue
			}
			seenHits[hit.HitBindingKey], seenMoments[momentKey] = true, true
			hitAbility := ctx.session.Abilities[hitRef.AbilityIndex]
			if hitRef.ProviderIndex != ref.ProviderIndex || !hitAbility.HasSkillHit || hitAbility.IsBasicAttack || hitAbility.SkillKey != binding.SkillKey || hitAbility.Kind != "active" || hitAbility.Cost != nil || hitAbility.Cooldown != nil || hitAbility.ProcessControl != nil {
				fail("release must resolve the same skill with no independent cost or cooldown")
				invalid = true
				continue
			}
			if empowered {
				if hitAbility.HasCastCondition || hitAbility.TickSpec != nil || hitAbility.OperationCount != 1 || ctx.session.Operations[hitAbility.OperationStart].Operation != model.OperationKindResolveSkillHit {
					fail("empowered result must contain only its complete own native hit plan")
					invalid = true
				}
				empoweredAbility = hitRef.AbilityIndex
			}
		}
		if !invalid {
			compiled := plan.CompiledSkillActionBinding{SkillActionBinding: binding, InitialAbilityIndex: ref.AbilityIndex, ControlAbilityIndices: controls}
			compiled.HasEmpoweredAttack, compiled.EmpoweredAbilityIndex = empowered, empoweredAbility
			compiled.AutomaticIneligiblePath, compiled.AutomaticIneligibleReason = automaticSkillAdmission(binding, process, ability, path, ctx)
			compiled.AutomaticEligible = compiled.AutomaticIneligibleReason == ""
			ctx.session.SkillActionBindings = append(ctx.session.SkillActionBindings, compiled)
		}
	}
}

// 同一绑定可用于有限手动计划；自动准入单独保存，避免拒绝合法手动控制。
func automaticSkillAdmission(binding model.SkillActionBinding, process plan.CompiledProcess, ability plan.CompiledAbility, path string, ctx *genericCompileContext) (string, string) {
	if len(binding.Controls) != 1 || binding.Controls[0].Action != "INITIAL" {
		return path + ".controls", "automatic skills admit only the initial control"
	}
	if len(process.Steps) != 1 {
		return process.Path + ".steps", "automatic skills require one immediate, finite delay, channel or empowered step"
	}
	for _, step := range process.Steps {
		if step.StepType != "IMMEDIATE" && step.StepType != "DELAY" && step.StepType != "CHANNEL" && step.StepType != "EMPOWERED_BASIC_ATTACK" {
			return step.Path + ".stepType", "automatic skills admit only immediate, finite delay, channel or empowered steps"
		}
	}
	if process.Cooldown == nil || !process.Cooldown.HasDuration || int(process.Cooldown.DurationProgram) >= len(ctx.session.Formulas.Programs) {
		return process.Path + ".cooldown", "automatic skills require an authored positive process cooldown"
	}
	cd := process.Cooldown
	if cd.StartMoment.MomentType == "PROCESS_FAILURE" {
		return cd.Path + ".startMoment", "automatic skills require cooldown on a successful process path"
	}
	program := ctx.session.Formulas.Programs[cd.DurationProgram]
	if value, constant := ctx.session.Formulas.FoldInstructions(program.Instr); constant {
		if cd.RoundPositiveMs && value > 0 {
			value = math.Max(1, math.Round(value))
		}
		if !formula.ValidPositiveInt64DurationMs(value) || value > 9007199254740991 {
			return cd.Path + ".durationMs", "automatic skills require a positive safe integer cooldown"
		}
	}
	// 实际开始条件只读取本次稳定状态；事件或同次使用字段没有自动候选上下文。
	if ability.HasCastCondition {
		conditionPath := path + ".controls[0].abilityRef"
		if int(ability.CastConditionProgram) < len(ctx.session.Formulas.Programs) {
			conditionPath = ctx.session.Formulas.Programs[ability.CastConditionProgram].Key
		}
		for _, instruction := range ctx.session.Formulas.ReadDependencies(ability.CastConditionProgram) {
			switch instruction.ReadKind {
			case formula.ReadSourceAttr, formula.ReadTargetAttr, formula.ReadSourceResource, formula.ReadTargetResource,
				formula.ReadAbilityParam, formula.ReadProviderState, formula.ReadProviderTargetState,
				formula.ReadSourceStatusPresent, formula.ReadTargetStatusPresent:
			default:
				return conditionPath, "automatic cast conditions require a stable candidate context"
			}
		}
	}
	return "", ""
}
