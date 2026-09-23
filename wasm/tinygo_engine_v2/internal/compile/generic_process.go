package compile

import (
	"math"
	"strings"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
)

// CompiledProcess 保存有序步骤和作者顺序的时点操作，不持有运行实例。
type CompiledProcess struct {
	ProcessKey          string
	SkillKey            string
	Steps               []CompiledProcessStep
	Costs               []CompiledProcessCost
	Cooldown            *CompiledProcessCooldown
	MomentOperations    []CompiledProcessMomentOperations
	InitialAbilityIndex int
	Path                string
}

type CompiledProcessStep struct {
	StepKey              string
	StepType             string
	DelayProgram         formula.GenericProgramID
	MinimumChargeProgram formula.GenericProgramID
	MaximumChargeProgram formula.GenericProgramID
	WindowProgram        formula.GenericProgramID
	HasDelay             bool
	HasMinimumCharge     bool
	HasMaximumCharge     bool
	HasWindow            bool
	ReleaseAtMaximum     bool
	Path                 string
}

type CompiledProcessCost struct {
	ResourceKey   string
	AmountProgram formula.GenericProgramID
	HasAmount     bool
	Path          string
}

type CompiledProcessCooldown struct {
	DurationProgram formula.GenericProgramID
	HasDuration     bool
	StartMoment     model.ProcessMomentDefinition
	Path            string
}

type CompiledProcessMomentOperations struct {
	Moment         model.ProcessMomentDefinition
	OperationStart uint16
	OperationCount uint16
	Path           string
}

type CompiledProcessControl struct {
	model.ProcessControlDefinition
	ProcessIndex int
}

func compileProviderProcesses(provider model.ProviderDefinition, path string, ctx *genericCompileContext) {
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
		compiled := CompiledProcess{ProcessKey: def.ProcessKey, SkillKey: def.SkillKey, InitialAbilityIndex: -1, Path: p}
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
			compiled.Costs = append(compiled.Costs, CompiledProcessCost{ResourceKey: cost.ResourceKey, AmountProgram: program, HasAmount: has, Path: cp})
		}
		// 成本在时点之前编译，完成/失败表达式只能读取已经声明的资源账。
		previousProcess, previousMoment := ctx.currentProcess, ctx.currentProcessMoment
		ctx.currentProcess = &compiled
		if def.Cooldown != nil {
			cp := p + ".cooldown"
			validateProcessMoment(def.Cooldown.StartMoment, &compiled, cp+".startMoment", ctx)
			ctx.currentProcessMoment = &def.Cooldown.StartMoment
			program, has := compileProcessFormula(&def.Cooldown.DurationMs, cp+".durationMs", true, false, ctx)
			compiled.Cooldown = &CompiledProcessCooldown{DurationProgram: program, HasDuration: has, StartMoment: def.Cooldown.StartMoment, Path: cp}
		}
		for j, binding := range def.MomentOperations {
			mp := p + ".momentOperations[" + itoa(j) + "]"
			validateProcessMoment(binding.Moment, &compiled, mp+".moment", ctx)
			ctx.currentProcessMoment = &binding.Moment
			moment := CompiledProcessMomentOperations{Moment: binding.Moment, OperationStart: uint16(len(ctx.session.Operations)), Path: mp}
			ctx.beginOutputUnit()
			for k, op := range binding.Operations {
				opPath := mp + ".operations[" + itoa(k) + "]"
				if !processMomentOperationSupported(op.Operation) {
					ctx.collector.addError(model.GenericErrUnknownRef, opPath+".operation", "unsupported process moment operation", op.Operation)
				}
				if op.AbilityRef != "" && op.Operation != "cooldown_change" {
					ctx.collector.addError(model.GenericErrUnknownRef, opPath+".abilityRef", "process moments cannot invoke abilities", op.AbilityRef)
				}
				firstProgram := len(ctx.session.Formulas.Programs)
				compileOperation(op, opPath, providerIndex, ctx)
				for _, program := range ctx.session.Formulas.Programs[firstProgram:] {
					validateProcessFormulaContext(program.Instr, program.Key, true, ctx)
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
		if count == 0 {
			ctx.collector.addError(model.GenericErrMissingRequiredField, path+".processes["+itoa(i)+"]", "process requires exactly one INITIAL ability", provider.Processes[i].ProcessKey)
		}
	}
}

func compileProcessStep(def model.ProcessStepDefinition, path string, last bool, ctx *genericCompileContext) CompiledProcessStep {
	compiled := CompiledProcessStep{StepKey: def.StepKey, StepType: def.StepType, Path: path}
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
		{"windowMs", def.WindowMs != nil, def.StepType == "RECAST"},
	}
	for _, field := range fields {
		if field.present && !field.allowed {
			ctx.collector.addError(model.GenericErrUnknownRef, path+"."+field.name, "field does not belong to this process step type", def.StepType)
		}
		if field.allowed && !field.present {
			ctx.collector.addError(model.GenericErrMissingRequiredField, path+"."+field.name, "process step field must be explicit", def.StepType)
		}
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
			min, minConst := formula.TryFoldConst(ctx.session.Formulas.Programs[compiled.MinimumChargeProgram].Instr)
			max, maxConst := formula.TryFoldConst(ctx.session.Formulas.Programs[compiled.MaximumChargeProgram].Instr)
			if minConst && maxConst && min > max {
				ctx.collector.addError(model.GenericErrFormulaTypeError, path+".minimumChargeMs", "minimum charge must not exceed maximum charge", def.StepKey)
			}
		}
	case "RECAST":
		compiled.WindowProgram, compiled.HasWindow = compileProcessFormula(def.WindowMs, path+".windowMs", true, true, ctx)
	default:
		ctx.collector.addError(model.GenericErrUnknownRef, path+".stepType", "unsupported process step type", def.StepType)
	}
	return compiled
}

func compileProcessFormula(expr *model.GenericFormulaExpr, path string, duration, positive bool, ctx *genericCompileContext) (formula.GenericProgramID, bool) {
	if expr == nil {
		return 0, false
	}
	instr := formula.CompileGenericFormula(*expr, path, ctx.namedFormulas, map[string]bool{}, ctx.collector.addError)
	validateProcessFormulaContext(instr, path, false, ctx)
	if value, folded := formula.TryFoldConst(instr); folded {
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
	return ctx.registerFormula(path, instr), true
}

// 过程没有监听事件或伤害修正上下文；操作输出仅在同一时点操作单元内可读。
func validateProcessFormulaContext(instr []formula.GenericInstr, path string, allowOutput bool, ctx *genericCompileContext) {
	if allowOutput {
		validateOperationOutputReads(instr, path, ctx)
	}
	for _, item := range instr {
		if item.Op != formula.GenericOpRead {
			continue
		}
		switch item.ReadKind {
		case formula.ReadSourceAttr, formula.ReadTargetAttr, formula.ReadSourceResource, formula.ReadTargetResource,
			formula.ReadAbilityParam, formula.ReadProviderState, formula.ReadProviderTargetState, formula.ReadProcessActualCost:
		case formula.ReadOperationOutput:
			if !allowOutput {
				ctx.collector.addError(model.GenericErrFormulaTypeError, path, "process timing and costs cannot read operation outputs", item.ReadKey)
			}
		default:
			ctx.collector.addError(model.GenericErrFormulaTypeError, path, "formula read requires an unavailable process context", item.ReadKey)
		}
	}
}

func validateProcessActualCostReads(instr []formula.GenericInstr, path string, ctx *genericCompileContext) {
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

func validateProcessMoment(moment model.ProcessMomentDefinition, process *CompiledProcess, path string, ctx *genericCompileContext) {
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

func validateProcessControl(ability model.AbilityDefinition, path string, providerIndex uint16, ctx *genericCompileContext) *CompiledProcessControl {
	if ability.ProcessControl == nil {
		return nil
	}
	def := *ability.ProcessControl
	compiled := &CompiledProcessControl{ProcessControlDefinition: def, ProcessIndex: -1}
	cp := path + ".processControl"
	validateProcessKey(ability.AbilityKey, path+".abilityKey", ctx)
	validateProcessKey(def.ProcessKey, cp+".processKey", ctx)
	if ability.Kind != "active" || abilityIsBasicAttack(ability, ctx) {
		ctx.collector.addError(model.GenericErrUnknownRef, path+".kind", "process control requires an active non-basic-attack ability", ability.Kind)
	}
	for _, field := range []struct {
		name    string
		present bool
	}{
		{"cost", ability.Cost != nil}, {"cooldown", ability.Cooldown != nil}, {"castCondition", ability.CastCondition != nil},
		{"operations", len(ability.Operations) > 0}, {"tickSpec", ability.TickSpec != nil},
		{"listenerSpec", ability.ListenerSpec != nil}, {"stateSchema", len(ability.StateSchema) > 0},
	} {
		if field.present {
			ctx.collector.addError(model.GenericErrUnknownRef, path+"."+field.name, "process control cannot mix another execution mechanism", ability.AbilityKey)
		}
	}
	var process *CompiledProcess
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

func findCompiledProcessStep(process *CompiledProcess, key string) *CompiledProcessStep {
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
	case "damage", "heal", "shield", "resource_change", "attribute_change", "cooldown_change", "apply_provider", "refresh_provider", "expire_provider", "emit_event", model.OperationKindExecuteThreshold:
		return true
	}
	return false
}

// validateProcessAbilityRefs 在全部控制能力和挂载索引构造后校验，避免定义顺序影响结果。
func validateProcessAbilityRefs(req model.CompileRequest, ctx *genericCompileContext) {
	validateListener := func(listener model.ListenerDefinition, path string) {
		if listener.AbilityRef != "" && processControlRefExists(listener.AbilityRef, ctx) {
			ctx.collector.addError(model.GenericErrUnknownRef, path+".abilityRef", "process control requires an explicit single driver fact and cannot be invoked by a listener", listener.AbilityRef)
		}
	}
	for i, listener := range req.Rules.Listeners {
		validateListener(listener, "rules.listeners["+itoa(i)+"]")
	}
	for i, provider := range req.SharedProviders {
		pp := "sharedProviders[" + itoa(i) + "]"
		for j, listener := range provider.Listeners {
			validateListener(listener, pp+".listeners["+itoa(j)+"]")
		}
		for j, ability := range provider.Abilities {
			if ability.ListenerSpec != nil {
				validateListener(*ability.ListenerSpec, pp+".abilities["+itoa(j)+"].listenerSpec")
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
}

func processControlRefExists(ref string, ctx *genericCompileContext) bool {
	parsed, ok := ParseAbilityRef(ref)
	if !ok {
		return false
	}
	for _, combatant := range ctx.session.Combatants {
		if parsed.Combatant != "self" && parsed.Combatant != "opponent" && parsed.Combatant != combatant.Key {
			continue
		}
		for _, mount := range combatant.ProviderMounts {
			if mount.ProviderRef != parsed.ProviderRef {
				continue
			}
			for _, ability := range ctx.session.Abilities {
				if ability.ProviderIndex == mount.DefinitionIndex && ability.AbilityKey == parsed.AbilityKey && ability.ProcessControl != nil {
					return true
				}
			}
		}
	}
	return false
}
