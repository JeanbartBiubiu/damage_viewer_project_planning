package compile

import (
	"math"
	"strings"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
)

func compileProviderProcesses(provider model.ProviderDefinition, path string, ctx *genericCompileContext) {
	previousSkill := ctx.currentSkillKey
	ctx.currentSkillKey = provider.SkillKey
	defer func() { ctx.currentSkillKey = previousSkill }()
	if len(provider.Processes) > 0 && (provider.Lifecycle != nil || provider.Kind == "status") {
		ctx.collector.addError(model.GenericErrUnknownRef, path+".processes", "processes require a static mounted provider without a dynamic lifecycle", provider.ProviderKey)
	}
	providerIndex, ok := findProviderIndex(ctx.session, provider.ProviderKey)
	if !ok {
		return
	}
	seen := map[string]bool{}
	for i, def := range provider.Processes {
		p := path + ".processes[" + itoa(i) + "]"
		if provider.SkillKey != "" && provider.SkillKey != def.SkillKey {
			ctx.collector.addError(model.GenericErrUnknownRef, p+".skillKey", "process skill must match its provider", def.SkillKey)
		}
		ctx.currentSkillKey = def.SkillKey
		compiled := plan.CompiledProcess{EntryKind: def.EntryKind, ProcessKey: def.ProcessKey, SkillKey: def.SkillKey, InitialAbilityIndex: -1, Path: p}
		validatePassiveProcessShape(def, provider, p, ctx)
		validateProcessKey(def.ProcessKey, p+".processKey", ctx)
		validateProcessKey(def.SkillKey, p+".skillKey", ctx)
		if seen[def.ProcessKey] {
			ctx.collector.addError(model.GenericErrUnknownRef, p+".processKey", "duplicate process key in provider", def.ProcessKey)
		}
		seen[def.ProcessKey] = true
		if len(def.Steps) == 0 {
			ctx.collector.addError(model.GenericErrMissingRequiredField, p+".steps", "process requires at least one step", def.ProcessKey)
		}
		if len(def.Steps) > 65535 {
			ctx.collector.addError(model.GenericErrUnknownRef, p+".steps", "process step count exceeds supported index range", def.ProcessKey)
		}
		stepKeys := map[string]bool{}
		for j, step := range def.Steps {
			if step.StepType == "EMPOWERED_BASIC_ATTACK" && len(def.Steps) != 1 {
				ctx.collector.addError(model.GenericErrUnknownRef, p+".steps", "empowered attack requires one complete waiting step", def.ProcessKey)
			}
			sp := p + ".steps[" + itoa(j) + "]"
			if stepKeys[step.StepKey] {
				ctx.collector.addError(model.GenericErrUnknownRef, sp+".stepKey", "duplicate process step key", step.StepKey)
			}
			stepKeys[step.StepKey] = true
			compiled.Steps = append(compiled.Steps, compileProcessStep(step, sp, j == len(def.Steps)-1, ctx))
		}
		for j, cost := range def.Costs {
			cp := p + ".costs[" + itoa(j) + "]"
			validateProcessKey(cost.ResourceKey, cp+".resourceKey", ctx)
			program, has := compileProcessFormula(&cost.Amount, cp+".amount", false, false, ctx)
			compiled.Costs = append(compiled.Costs, plan.CompiledProcessCost{ResourceKey: cost.ResourceKey, AmountProgram: program, HasAmount: has, Path: cp})
		}
		for _, step := range compiled.Steps {
			if step.MaximumRecastCount > 1 && !plan.FiniteRecastProcess(&compiled) {
				ctx.collector.addError(model.GenericErrUnknownRef, step.Path, "multiple recasts require exactly one non-occupying immediate step and one final non-occupying recast step", step.StepKey)
			}
		}
		// 成本在时点之前编译，完成/失败表达式只能读取已经声明的资源账。
		previousProcess, previousMoment := ctx.currentProcess, ctx.currentProcessMoment
		ctx.currentProcess = &compiled
		if def.Cooldown != nil {
			cp := p + ".cooldown"
			if len(compiled.Steps) == 1 && compiled.Steps[0].MaximumAttackCount > 0 && def.Cooldown.StartMoment.MomentType != "PROCESS_COMPLETE" {
				ctx.collector.addError(model.GenericErrUnknownRef, cp+".startMoment", "counted attack window cooldown starts only at PROCESS_COMPLETE", def.ProcessKey)
			}
			validateProcessMoment(def.Cooldown.StartMoment, &compiled, cp+".startMoment", ctx)
			ctx.currentProcessMoment = &def.Cooldown.StartMoment
			program, has := compileProcessFormula(&def.Cooldown.DurationMs, cp+".durationMs", !def.Cooldown.RoundPositiveMs, def.Cooldown.RoundPositiveMs, ctx)
			if def.Cooldown.RoundPositiveMs && has {
				if raw, folded := ctx.formulas.FoldInstructions(ctx.formulas.Instructions(formula.GenericProgramID(program))); folded && (!isFiniteFloat(raw) || math.Max(1, math.Round(raw)) >= 9223372036854775808.0) {
					ctx.collector.addError(model.GenericErrFormulaTypeError, cp+".durationMs", "rounded positive cooldown exceeds native time range", "")
				}
			}
			compiled.Cooldown = &plan.CompiledProcessCooldown{DurationProgram: program, HasDuration: has, StartMoment: def.Cooldown.StartMoment, RoundPositiveMs: def.Cooldown.RoundPositiveMs, Path: cp}
		}
		for j, binding := range def.MomentOperations {
			mp := p + ".momentOperations[" + itoa(j) + "]"
			validateProcessMoment(binding.Moment, &compiled, mp+".moment", ctx)
			ctx.currentProcessMoment = &binding.Moment
			moment := plan.CompiledProcessMomentOperations{Moment: binding.Moment, OperationStart: uint16(len(ctx.session.Operations)), Path: mp}
			ctx.beginOutputUnit()
			for k, op := range binding.Operations {
				opPath := mp + ".operations[" + itoa(k) + "]"
				if !processMomentOperationSupported(op.Operation) {
					ctx.collector.addError(model.GenericErrUnknownRef, opPath+".operation", "unsupported process moment operation", op.Operation)
				}
				if op.AbilityRef != "" && op.Operation != "cooldown_change" {
					ctx.collector.addError(model.GenericErrUnknownRef, opPath+".abilityRef", "process moments cannot invoke abilities", op.AbilityRef)
				}
				firstProgram := ctx.formulas.Count()
				compileOperation(op, opPath, providerIndex, ctx)
				for program := firstProgram; program < ctx.formulas.Count(); program++ {
					validateProcessFormulaContext(ctx.formulas.Instructions(formula.GenericProgramID(program)), ctx.formulas.Info(formula.GenericProgramID(program)).Key, true, ctx)
				}
				ctx.outputUnitIndex++
			}
			ctx.endOutputUnit()
			moment.OperationCount = uint16(len(ctx.session.Operations)) - moment.OperationStart
			compiled.MomentOperations = append(compiled.MomentOperations, moment)
		}
		ctx.currentProcess, ctx.currentProcessMoment = previousProcess, previousMoment
		ctx.session.Providers[providerIndex].Processes = append(ctx.session.Providers[providerIndex].Processes, compiled)
	}
	initialCounts := make([]int, len(provider.Processes))
	abilityKeys := map[string]bool{}
	for i, ability := range provider.Abilities {
		ap := path + ".abilities[" + itoa(i) + "]"
		if len(provider.Processes) > 0 && abilityKeys[ability.AbilityKey] {
			ctx.collector.addError(model.GenericErrUnknownRef, ap+".abilityKey", "process provider ability keys must be unique", ability.AbilityKey)
		}
		abilityKeys[ability.AbilityKey] = true
		control := validateProcessControl(ability, ap, uint16(providerIndex), ctx)
		if control == nil {
			continue
		}
		for ai := range ctx.session.Abilities {
			candidate := &ctx.session.Abilities[ai]
			if int(candidate.ProviderIndex) != providerIndex || candidate.AbilityKey != ability.AbilityKey {
				continue
			}
			if ability.CastCondition != nil && control.Action == "INITIAL" && !control.UseRefFromEvent {
				if conditionPath, issue := stableCastConditionIssue(*candidate, ap+".castCondition", ctx); issue != "" {
					ctx.collector.addError(model.GenericErrFormulaTypeError, conditionPath, issue, ability.AbilityKey)
				}
			}
			candidate.ProcessControl = control
			if control.Action == "INITIAL" && control.ProcessIndex >= 0 {
				initialCounts[control.ProcessIndex]++
				process := &ctx.session.Providers[providerIndex].Processes[control.ProcessIndex]
				if initialCounts[control.ProcessIndex] == 1 {
					process.InitialAbilityIndex = ai
				} else {
					ctx.collector.addError(model.GenericErrUnknownRef, ap+".processControl", "process requires exactly one INITIAL ability", control.ProcessKey)
				}
			}
			break
		}
	}
	for i, count := range initialCounts {
		passive := provider.Processes[i].EntryKind == model.ProcessEntrySkillHitPassive
		if passive && count > 0 {
			ctx.collector.addError(model.GenericErrUnknownRef, path+".processes["+itoa(i)+"]", "passive process cannot have an INITIAL control", provider.Processes[i].ProcessKey)
		} else if !passive && count == 0 {
			ctx.collector.addError(model.GenericErrMissingRequiredField, path+".processes["+itoa(i)+"]", "process requires exactly one INITIAL ability", provider.Processes[i].ProcessKey)
		}
	}
}

func compileProcessStep(def model.ProcessStepDefinition, path string, last bool, ctx *genericCompileContext) plan.CompiledProcessStep {
	compiled := plan.CompiledProcessStep{StepKey: def.StepKey, StepType: def.StepType, Path: path}
	customWindow := def.StepType == "CHANNEL" && def.FirstExecution != nil && *def.FirstExecution == "CUSTOM_WINDOW"
	if def.OccupiesAction != nil {
		compiled.HasActionOccupancy, compiled.OccupiesAction = true, *def.OccupiesAction
	}
	validateProcessKey(def.StepKey, path+".stepKey", ctx)
	if (def.StepType == "CHARGE" || def.StepType == "RECAST") && !last {
		ctx.collector.addError(model.GenericErrUnknownRef, path+".stepType", "CHARGE or RECAST must be the final step", def.StepType)
	}
	fields := []struct {
		name    string
		present bool
		allowed bool
	}{
		{"delayMs", def.DelayMs != nil, def.StepType == "DELAY"},
		{"minimumChargeMs", def.MinimumChargeMs != nil, def.StepType == "CHARGE"},
		{"maximumChargeMs", def.MaximumChargeMs != nil, def.StepType == "CHARGE"},
		{"releaseAtMaximum", def.ReleaseAtMaximum != nil, def.StepType == "CHARGE"},
		{"windowMs", def.WindowMs != nil, def.StepType == "RECAST" || def.StepType == "EMPOWERED_BASIC_ATTACK"},
		{"maximumRecastCount", def.MaximumRecastCount != nil, def.StepType == "RECAST"},
		{"consumeMoment", def.ConsumeMoment != nil, def.StepType == "EMPOWERED_BASIC_ATTACK"},
		{"repeatCount", def.RepeatCount != nil, def.StepType == "MULTI_HIT"},
		{"durationMs", def.DurationMs != nil, def.StepType == "CHANNEL"},
		{"executionCount", def.ExecutionCount != nil, def.StepType == "CHANNEL"},
		{"firstExecution", def.FirstExecution != nil, def.StepType == "CHANNEL"},
		{"firstExecutionOffsetMs", def.FirstExecutionOffsetMs != nil, customWindow},
		{"lastExecutionOffsetMs", def.LastExecutionOffsetMs != nil, customWindow},
	}
	for _, field := range fields {
		if field.present && !field.allowed {
			ctx.collector.addError(model.GenericErrUnknownRef, path+"."+field.name, "field does not belong to this process step type", def.StepType)
		}
		if field.allowed && !field.present {
			ctx.collector.addError(model.GenericErrMissingRequiredField, path+"."+field.name, "process step field must be explicit", def.StepType)
		}
	}
	if def.MaximumAttackCount != nil && def.StepType != "EMPOWERED_BASIC_ATTACK" {
		ctx.collector.addError(model.GenericErrUnknownRef, path+".maximumAttackCount", "attack count only belongs to an empowered attack window", def.StepKey)
	}
	switch def.StepType {
	case "IMMEDIATE":
	case "DELAY":
		compiled.DelayProgram, compiled.HasDelay = compileProcessFormula(def.DelayMs, path+".delayMs", true, true, ctx)
	case "CHARGE":
		compiled.MinimumChargeProgram, compiled.HasMinimumCharge = compileProcessFormula(def.MinimumChargeMs, path+".minimumChargeMs", true, false, ctx)
		compiled.MaximumChargeProgram, compiled.HasMaximumCharge = compileProcessFormula(def.MaximumChargeMs, path+".maximumChargeMs", true, true, ctx)
		if def.ReleaseAtMaximum != nil {
			compiled.ReleaseAtMaximum = *def.ReleaseAtMaximum
		}
		if compiled.HasMinimumCharge && compiled.HasMaximumCharge {
			min, minConst := ctx.formulas.FoldInstructions(ctx.formulas.Instructions(formula.GenericProgramID(compiled.MinimumChargeProgram)))
			max, maxConst := ctx.formulas.FoldInstructions(ctx.formulas.Instructions(formula.GenericProgramID(compiled.MaximumChargeProgram)))
			if minConst && maxConst && min > max {
				ctx.collector.addError(model.GenericErrFormulaTypeError, path+".minimumChargeMs", "minimum charge must not exceed maximum charge", def.StepKey)
			}
		}
	case "RECAST":
		compiled.WindowProgram, compiled.HasWindow = compileProcessFormula(def.WindowMs, path+".windowMs", true, true, ctx)
		compileRecastStaticValue(def.WindowMs, path+".windowMs", 9007199254740991, ctx)
		compiled.MaximumRecastCount = int(compileRecastStaticValue(def.MaximumRecastCount, path+".maximumRecastCount", 63, ctx))
		if def.IntervalMs != nil {
			compiled.RecastIntervalMs = compileRecastStaticValue(def.IntervalMs, path+".intervalMs", 9007199254740991, ctx)
		}
	case "EMPOWERED_BASIC_ATTACK":
		compiled.WindowProgram, compiled.HasWindow = compileProcessWindowFormula(def.WindowMs, path+".windowMs", true, ctx)
		consume := "ATTACK_HIT"
		if def.MaximumAttackCount != nil {
			consume = "ATTACK_START"
			program, valid := compileProcessFormula(def.MaximumAttackCount, path+".maximumAttackCount", true, true, ctx)
			if !valid {
				ctx.collector.addError(model.GenericErrFormulaTypeError, path+".maximumAttackCount", "empowered attack count must be a static integer in [1,64]", def.StepKey)
			} else {
				value, static := ctx.formulas.FoldStatic(program)
				if !static || math.IsNaN(value) || math.IsInf(value, 0) || math.Trunc(value) != value || value < 1 || value > 64 {
					ctx.collector.addError(model.GenericErrFormulaTypeError, path+".maximumAttackCount", "empowered attack count must be a static integer in [1,64]", def.StepKey)
				} else {
					compiled.MaximumAttackCount = int(value)
				}
			}
		}
		if !last || def.OccupiesAction == nil || *def.OccupiesAction || def.ConsumeMoment == nil || *def.ConsumeMoment != consume {
			ctx.collector.addError(model.GenericErrUnknownRef, path, "empowered attack requires its explicit final non-occupying consumption mode", def.StepKey)
		}
	case "MULTI_HIT":
		compiled.RepeatCountProgram, _ = compileProcessFormula(def.RepeatCount, path+".repeatCount", true, true, ctx)
		if def.IntervalMs != nil {
			compiled.IntervalProgram, compiled.HasInterval = compileProcessFormula(def.IntervalMs, path+".intervalMs", true, true, ctx)
		}
		validateProcessExecutionCount(def.RepeatCount, path+".repeatCount", ctx)
		if def.RepeatCount != nil && def.IntervalMs == nil {
			instructions := formula.CompileGenericFormula(*def.RepeatCount, path+".repeatCount", ctx.namedFormulas, map[string]bool{}, ctx.collector.addError)
			if count, folded := ctx.formulas.FoldInstructions(instructions); folded && count > 1 {
				ctx.collector.addError(model.GenericErrMissingRequiredField, path+".intervalMs", "multiple executions require an explicit positive interval", def.StepKey)
			}
		}
	case "CHANNEL":
		var hasDuration, hasCount bool
		if customWindow {
			compiled.DurationProgram, hasDuration = compileProcessWindowFormula(def.DurationMs, path+".durationMs", true, ctx)
		} else {
			compiled.DurationProgram, hasDuration = compileProcessFormula(def.DurationMs, path+".durationMs", true, true, ctx)
		}
		compiled.ExecutionCountProgram, hasCount = compileProcessFormula(def.ExecutionCount, path+".executionCount", true, true, ctx)
		validateProcessExecutionCount(def.ExecutionCount, path+".executionCount", ctx)
		if def.FirstExecution != nil {
			compiled.FirstExecution = *def.FirstExecution
		}
		if customWindow {
			var hasFirst, hasLast bool
			compiled.FirstExecutionOffsetProgram, hasFirst = compileProcessWindowFormula(def.FirstExecutionOffsetMs, path+".firstExecutionOffsetMs", false, ctx)
			compiled.LastExecutionOffsetProgram, hasLast = compileProcessWindowFormula(def.LastExecutionOffsetMs, path+".lastExecutionOffsetMs", false, ctx)
			if hasFirst && hasLast {
				first, firstConstant := ctx.formulas.FoldInstructions(ctx.formulas.Instructions(formula.GenericProgramID(compiled.FirstExecutionOffsetProgram)))
				last, lastConstant := ctx.formulas.FoldInstructions(ctx.formulas.Instructions(formula.GenericProgramID(compiled.LastExecutionOffsetProgram)))
				if firstConstant && lastConstant && first > last {
					ctx.collector.addError(model.GenericErrFormulaTypeError, path+".firstExecutionOffsetMs", "channel first execution must not follow its last execution", def.StepKey)
				}
				if hasDuration {
					duration, durationConstant := ctx.formulas.FoldInstructions(ctx.formulas.Instructions(formula.GenericProgramID(compiled.DurationProgram)))
					if lastConstant && durationConstant && last > duration {
						ctx.collector.addError(model.GenericErrFormulaTypeError, path+".lastExecutionOffsetMs", "channel execution window must fit its complete duration", def.StepKey)
					}
				}
				if hasCount {
					count, countConstant := ctx.formulas.FoldInstructions(ctx.formulas.Instructions(formula.GenericProgramID(compiled.ExecutionCountProgram)))
					if firstConstant && lastConstant && countConstant && (count == 1 && first != last || count > 1 && last-first < count-1) {
						ctx.collector.addError(model.GenericErrFormulaTypeError, path+".lastExecutionOffsetMs", "channel window must match its count and allow distinct integer execution times", def.StepKey)
					}
				}
			}
		} else if compiled.FirstExecution != "IMMEDIATE" && compiled.FirstExecution != "AFTER_INTERVAL" {
			ctx.collector.addError(model.GenericErrUnknownRef, path+".firstExecution", "channel first execution must be explicit", def.StepKey)
		}
	default:
		ctx.collector.addError(model.GenericErrUnknownRef, path+".stepType", "unsupported process step type", def.StepType)
	}
	if def.IntervalMs != nil && def.StepType != "MULTI_HIT" && def.StepType != "RECAST" {
		ctx.collector.addError(model.GenericErrUnknownRef, path+".intervalMs", "interval belongs only to finite multi-hit steps", def.StepKey)
	}
	return compiled
}

func compileRecastStaticValue(expr *model.GenericFormulaExpr, path string, maximum float64, ctx *genericCompileContext) int64 {
	program, present := compileProcessFormula(expr, path, true, true, ctx)
	if present {
		value, static := ctx.formulas.FoldStatic(program)
		if static && isFiniteFloat(value) && value >= 1 && value <= maximum && math.Trunc(value) == value {
			return int64(value)
		}
	}
	ctx.collector.addError(model.GenericErrFormulaTypeError, path, "recast value requires an explicit static positive safe integer within its bound", "")
	return 0
}

func compileProcessWindowFormula(expression *model.GenericFormulaExpr, path string, positive bool, ctx *genericCompileContext) (formula.GenericProgramID, bool) {
	program, present := compileProcessFormula(expression, path, true, positive, ctx)
	if present {
		if value, folded := ctx.formulas.FoldInstructions(ctx.formulas.Instructions(formula.GenericProgramID(program))); folded && value > 9007199254740991 {
			ctx.collector.addError(model.GenericErrFormulaTypeError, path, "channel window milliseconds must be safe integers", "")
		}
	}
	return program, present
}

func validateProcessExecutionCount(expression *model.GenericFormulaExpr, path string, ctx *genericCompileContext) {
	if expression == nil {
		return
	}
	instructions := formula.CompileGenericFormula(*expression, path, ctx.namedFormulas, map[string]bool{}, ctx.collector.addError)
	if count, folded := ctx.formulas.FoldInstructions(instructions); folded && (count < 1 || count > 64 || count != math.Trunc(count)) {
		ctx.collector.addError(model.GenericErrFormulaTypeError, path, "finite execution count must be an integer in [1,64]", "")
	}
}

func compileProcessFormula(expr *model.GenericFormulaExpr, path string, duration, positive bool, ctx *genericCompileContext) (formula.GenericProgramID, bool) {
	if expr == nil {
		return 0, false
	}
	instr := formula.CompileGenericFormula(*expr, path, ctx.namedFormulas, map[string]bool{}, ctx.collector.addError)
	validateProcessFormulaContext(instr, path, false, ctx)
	if value, folded := ctx.formulas.FoldInstructions(instr); folded {
		valid := isFiniteFloat(value) && value >= 0
		if duration {
			valid = valid && value == math.Trunc(value) && value < 9223372036854775808.0
		}
		if positive {
			valid = valid && value > 0
		}
		if !valid {
			ctx.collector.addError(model.GenericErrFormulaTypeError, path, "process value must be finite, nonnegative, and within the required integer time range", "")
		}
	}
	if len(instr) == 0 {
		return 0, false
	}
	return ctx.registerFormula(path, instr)
}

// 过程没有监听事件或伤害修正上下文；操作输出仅在同一时点操作单元内可读。
func validateProcessFormulaContext(instr []formula.GenericInstr, path string, allowOutput bool, ctx *genericCompileContext) {
	instr = ctx.formulas.InstructionDependencies(instr, nil)
	if allowOutput {
		validateOperationOutputReads(instr, path, ctx)
	}
	for _, item := range instr {
		if item.Op != formula.GenericOpRead {
			continue
		}
		switch item.ReadKind {
		case formula.ReadSourceAttr, formula.ReadTargetAttr, formula.ReadSourceResource, formula.ReadTargetResource,
			formula.ReadAbilityParam, formula.ReadAuthoredAbilityParameter, formula.ReadProviderState, formula.ReadProviderTargetState, formula.ReadProviderTargetStateRemainingMs, formula.ReadProcessActualCost:
		case formula.ReadOperationOutput:
			if !allowOutput {
				ctx.collector.addError(model.GenericErrFormulaTypeError, path, "process timing and costs cannot read operation outputs", item.ReadKey)
			}
		case formula.ReadUseChargeDuration:
			valid := allowOutput && ctx.currentProcess != nil && ctx.currentProcessMoment != nil && ctx.currentProcessMoment.MomentType == "STEP_EXECUTION" && ctx.currentProcessMoment.StepKey != nil
			if valid {
				step := findCompiledProcessStep(ctx.currentProcess, *ctx.currentProcessMoment.StepKey)
				valid = step != nil && step.StepType == "CHARGE"
			}
			if !valid {
				ctx.collector.addError(model.GenericErrFormulaTypeError, path, "charge duration requires its actual charge step execution", item.ReadKey)
			}
		default:
			ctx.collector.addError(model.GenericErrFormulaTypeError, path, "formula read requires an unavailable process context", item.ReadKey)
		}
	}
}

func validateProcessActualCostReads(instr []formula.GenericInstr, path string, ctx *genericCompileContext) {
	instr = ctx.formulas.InstructionDependencies(instr, nil)
	for _, item := range instr {
		if item.Op != formula.GenericOpRead || item.ReadKind != formula.ReadProcessActualCost {
			continue
		}
		if ctx.currentProcess == nil || ctx.currentProcessMoment == nil ||
			(ctx.currentProcessMoment.MomentType != "PROCESS_COMPLETE" && ctx.currentProcessMoment.MomentType != "PROCESS_FAILURE") {
			ctx.collector.addError(model.GenericErrFormulaTypeError, path, "actual process costs are only readable at their own completion or failure moment", item.ReadKey)
			continue
		}
		found := false
		for _, cost := range ctx.currentProcess.Costs {
			if cost.ResourceKey == item.ReadKey {
				found = true
				break
			}
		}
		if !found {
			ctx.collector.addError(model.GenericErrUnknownRef, path, "actual process cost resource is not declared in this process", item.ReadKey)
		}
	}
}

func validateProcessMoment(moment model.ProcessMomentDefinition, process *plan.CompiledProcess, path string, ctx *genericCompileContext) {
	stepMoment := false
	switch moment.MomentType {
	case "PROCESS_START", "PROCESS_COMPLETE", "PROCESS_FAILURE":
	case "STEP_START", "STEP_EXECUTION", "STEP_COMPLETE", "STEP_TIMEOUT":
		stepMoment = true
	default:
		ctx.collector.addError(model.GenericErrUnknownRef, path+".momentType", "unknown process moment", moment.MomentType)
	}
	if stepMoment {
		if moment.StepKey == nil || *moment.StepKey == "" {
			ctx.collector.addError(model.GenericErrMissingRequiredField, path+".stepKey", "step moment requires an explicit step key", process.ProcessKey)
		} else if step := findCompiledProcessStep(process, *moment.StepKey); step == nil {
			ctx.collector.addError(model.GenericErrUnknownRef, path+".stepKey", "unknown process step", *moment.StepKey)
		} else if moment.MomentType == "STEP_TIMEOUT" && step.StepType != "CHARGE" && step.StepType != "RECAST" {
			ctx.collector.addError(model.GenericErrUnknownRef, path+".momentType", "STEP_TIMEOUT requires CHARGE or RECAST", step.StepKey)
		}
	} else if moment.StepKey != nil {
		ctx.collector.addError(model.GenericErrUnknownRef, path+".stepKey", "process moment cannot carry a step key", *moment.StepKey)
	}
	if moment.FailureReason != nil {
		if moment.MomentType != "PROCESS_FAILURE" || !model.ValidProcessFailureReason(*moment.FailureReason) {
			ctx.collector.addError(model.GenericErrUnknownRef, path+".failureReason", "failure reason requires PROCESS_FAILURE and a known reason", *moment.FailureReason)
		}
	}
}

func validateProcessControl(ability model.AbilityDefinition, path string, providerIndex uint16, ctx *genericCompileContext) *plan.CompiledProcessControl {
	if ability.ProcessControl == nil {
		return nil
	}
	def := *ability.ProcessControl
	compiled := &plan.CompiledProcessControl{ProcessControlDefinition: def, ProcessIndex: -1}
	cp := path + ".processControl"
	validateProcessKey(ability.AbilityKey, path+".abilityKey", ctx)
	validateProcessKey(def.ProcessKey, cp+".processKey", ctx)
	isBasic := abilityIsBasicAttack(ability, ctx)
	if ability.Kind != "active" || isBasic != def.UseRefFromEvent {
		ctx.collector.addError(model.GenericErrUnknownRef, path+".kind", "process control requires an active spell driver or an explicitly event-bound basic attack", ability.Kind)
	}
	if def.UseRefFromEvent && def.Action != "INITIAL" {
		ctx.collector.addError(model.GenericErrUnknownRef, cp+".useRefFromEvent", "event-bound process control only supports INITIAL", def.Action)
	}
	if def.RequireExplicitSelfTarget != nil && (!*def.RequireExplicitSelfTarget || def.Action != "INITIAL") {
		ctx.collector.addError(model.GenericErrUnknownRef, cp+".requireExplicitSelfTarget", "explicit self-target gate must be true and only supports INITIAL", def.Action)
	}
	if ability.CastCondition != nil && (def.Action != "INITIAL" || def.UseRefFromEvent) {
		ctx.collector.addError(model.GenericErrUnknownRef, path+".castCondition", "cast condition only supports a normal INITIAL process control", ability.AbilityKey)
	}
	for _, field := range []struct {
		name    string
		present bool
	}{
		{"cost", ability.Cost != nil}, {"cooldown", ability.Cooldown != nil},
		{"operations", len(ability.Operations) > 0}, {"tickSpec", ability.TickSpec != nil},
		{"listenerSpec", ability.ListenerSpec != nil}, {"stateSchema", len(ability.StateSchema) > 0},
	} {
		if field.present {
			ctx.collector.addError(model.GenericErrUnknownRef, path+"."+field.name, "process control cannot mix another execution mechanism", ability.AbilityKey)
		}
	}
	var process *plan.CompiledProcess
	if int(providerIndex) < len(ctx.session.Providers) {
		for i := range ctx.session.Providers[providerIndex].Processes {
			candidate := &ctx.session.Providers[providerIndex].Processes[i]
			if candidate.ProcessKey == def.ProcessKey {
				compiled.ProcessIndex, process = i, candidate
				break
			}
		}
	}
	if process == nil {
		ctx.collector.addError(model.GenericErrUnknownRef, cp+".processKey", "process control must reference its own provider process", def.ProcessKey)
	} else if process.EntryKind == model.ProcessEntrySkillHitPassive {
		ctx.collector.addError(model.GenericErrUnknownRef, cp+".processKey", "passive process cannot borrow an active or basic-attack control", def.ProcessKey)
	} else if ability.SkillKey == "" || ability.SkillKey != process.SkillKey {
		ctx.collector.addError(model.GenericErrUnknownRef, path+".skillKey", "control ability must retain the process skill key", ability.SkillKey)
	}
	requiredStepType := ""
	switch def.Action {
	case "INITIAL":
	case "RECAST":
		requiredStepType = "RECAST"
	case "CHARGE_RELEASE":
		requiredStepType = "CHARGE"
	case "CANCEL":
		if def.FailureReason != "ACTIVE_CANCELLED" {
			ctx.collector.addError(model.GenericErrUnknownRef, cp+".failureReason", "CANCEL requires ACTIVE_CANCELLED", def.FailureReason)
		}
	case "INTERRUPT":
		if !model.ValidProcessFailureReason(def.FailureReason) || def.FailureReason == "ACTIVE_CANCELLED" {
			ctx.collector.addError(model.GenericErrUnknownRef, cp+".failureReason", "INTERRUPT requires an explicit non-cancellation reason", def.FailureReason)
		}
	default:
		ctx.collector.addError(model.GenericErrUnknownRef, cp+".action", "unknown process control action", def.Action)
	}
	if requiredStepType != "" {
		validateProcessKey(def.StepKey, cp+".stepKey", ctx)
		if process != nil {
			step := findCompiledProcessStep(process, def.StepKey)
			if step == nil || step.StepType != requiredStepType {
				ctx.collector.addError(model.GenericErrUnknownRef, cp+".stepKey", "control step must exist and match its action", def.StepKey)
			}
		}
	} else if def.StepKey != "" {
		ctx.collector.addError(model.GenericErrUnknownRef, cp+".stepKey", "this process control action cannot carry a step key", def.StepKey)
	}
	if def.Action != "CANCEL" && def.Action != "INTERRUPT" && def.FailureReason != "" {
		ctx.collector.addError(model.GenericErrUnknownRef, cp+".failureReason", "only cancellation or interruption can carry a failure reason", def.FailureReason)
	}
	return compiled
}

func findCompiledProcessStep(process *plan.CompiledProcess, key string) *plan.CompiledProcessStep {
	for i := range process.Steps {
		if process.Steps[i].StepKey == key {
			return &process.Steps[i]
		}
	}
	return nil
}

func validateProcessKey(key, path string, ctx *genericCompileContext) {
	if key == "" || strings.TrimSpace(key) != key {
		ctx.collector.addError(model.GenericErrMissingRequiredField, path, "process key must be explicit and have no surrounding whitespace", key)
	}
}

func processMomentOperationSupported(kind string) bool {
	switch kind {
	case "damage", "heal", "shield", "resource_change", "attribute_change", "cooldown_change", "state_change", "apply_provider", "refresh_provider", "expire_provider", "emit_event", model.OperationKindExecuteThreshold, model.OperationKindApplyAttackLink, model.OperationKindApplyHitLink:
		return true
	}
	return false
}

// validateProcessAbilityRefs 在全部控制能力和挂载索引构造后校验，避免定义顺序影响结果。
func validateProcessAbilityRefs(req model.CompileRequest, ctx *genericCompileContext) {
	consumed := map[int]bool{}
	validateListener := func(listener model.ListenerDefinition, path string, providerOwned bool) {
		for _, index := range processControlRefIndices(listener.AbilityRef, ctx) {
			ability := ctx.session.Abilities[index]
			if !ability.ProcessControl.UseRefFromEvent {
				ctx.collector.addError(model.GenericErrUnknownRef, path+".abilityRef", "driver-bound process control cannot be invoked by a listener", listener.AbilityRef)
				continue
			}
			if !providerOwned || !matcherAllContains(listener.EventMatcher, model.EventTypeBasicAttackStart) || !matcherAllContains(listener.EventMatcher, "event/source_owner") {
				ctx.collector.addError(model.GenericErrUnknownRef, path+".abilityRef", "event-bound process requires a source-owned basic_attack_start listener", listener.AbilityRef)
			}
			if len(listener.Operations) != 0 || listener.MaxTriggersPerEvent > 1 {
				ctx.collector.addError(model.GenericErrUnknownRef, path, "event-bound process listener must invoke only one INITIAL control", listener.AbilityRef)
			}
			consumed[index] = true
		}
	}
	for i, listener := range req.Rules.Listeners {
		validateListener(listener, "rules.listeners["+itoa(i)+"]", false)
	}
	for i, provider := range req.SharedProviders {
		pp := "sharedProviders[" + itoa(i) + "]"
		for j, listener := range provider.Listeners {
			validateListener(listener, pp+".listeners["+itoa(j)+"]", true)
		}
		for j, ability := range provider.Abilities {
			if ability.ListenerSpec != nil {
				validateListener(*ability.ListenerSpec, pp+".abilities["+itoa(j)+"].listenerSpec", true)
			}
		}
		for j, process := range provider.Processes {
			for k, binding := range process.MomentOperations {
				for l, op := range binding.Operations {
					if op.AbilityRef != "" {
						ctx.resolveAbilityRef(op.AbilityRef, pp+".processes["+itoa(j)+"].momentOperations["+itoa(k)+"].operations["+itoa(l)+"].abilityRef")
					}
				}
			}
		}
	}
	for i, ability := range ctx.session.Abilities {
		if ability.ProcessControl != nil && ability.ProcessControl.UseRefFromEvent && !consumed[i] {
			ctx.collector.addError(model.GenericErrUnknownRef, "abilities["+itoa(i)+"].processControl.useRefFromEvent", "event-bound process control requires a native start listener consumer", ability.AbilityKey)
		}
	}
}

func matcherAllContains(matcher model.TypeMatcher, key string) bool {
	for _, item := range matcher.All {
		if item == key {
			return true
		}
	}
	return false
}

func processControlRefIndices(ref string, ctx *genericCompileContext) []int {
	parsed, ok := plan.ParseAbilityRef(ref)
	if !ok {
		return nil
	}
	var indices []int
	for _, combatant := range ctx.session.Combatants {
		if parsed.Combatant != "self" && parsed.Combatant != "opponent" && parsed.Combatant != combatant.Key {
			continue
		}
		for _, mount := range combatant.ProviderMounts {
			if mount.ProviderRef != parsed.ProviderRef {
				continue
			}
			for index, ability := range ctx.session.Abilities {
				if ability.ProviderIndex == mount.DefinitionIndex && ability.AbilityKey == parsed.AbilityKey && ability.ProcessControl != nil {
					indices = append(indices, index)
				}
			}
		}
	}
	return indices
}
