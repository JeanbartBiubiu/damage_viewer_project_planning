package compile

import (
	"strings"
	"unicode/utf8"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
)

func (ctx *genericCompileContext) beginOutputUnit() {
	ctx.outputUnitRefs = map[string]int{}
	ctx.outputUnitIndex = 0
}

func (ctx *genericCompileContext) endOutputUnit() {
	ctx.outputUnitRefs = nil
	ctx.outputUnitIndex = 0
}

func validateOncePerUse(listener model.ListenerDefinition, path string, ownerProviderIndex int, ctx *genericCompileContext) {
	if listener.OncePerUse == nil {
		return
	}
	collector := ctx.collector
	limit := listener.OncePerUse
	if ownerProviderIndex < 0 {
		collector.addError(model.GenericErrUnknownRef, path+".oncePerUse", "oncePerUse is only allowed on mounted provider listeners", listener.ListenerKey)
	}
	if strings.TrimSpace(limit.GroupKey) == "" {
		collector.addError(model.GenericErrMissingRequiredField, path+".oncePerUse.groupKey", "oncePerUse.groupKey is required", listener.ListenerKey)
	} else if utf8.RuneCountInString(limit.GroupKey) > model.MaxOncePerUseGroupKeyLen || strings.Contains(limit.GroupKey, ".") {
		collector.addError(model.GenericErrUnknownRef, path+".oncePerUse.groupKey", "oncePerUse.groupKey must be a 1-64 character identifier without dots", limit.GroupKey)
	}
	if _, ok := model.ValidOncePerUseScope[limit.Scope]; !ok {
		collector.addError(model.GenericErrUnknownRef, path+".oncePerUse.scope", "oncePerUse.scope must be provider or provider_target", limit.Scope)
	}
	if listener.AbilityRef != "" {
		collector.addError(model.GenericErrUnknownRef, path+".abilityRef", "oncePerUse listeners cannot use abilityRef", listener.ListenerKey)
	}
	if listener.MaxTriggersPerEvent > 1 {
		collector.addError(model.GenericErrUnknownRef, path+".maxTriggersPerEvent", "oncePerUse listeners cannot set maxTriggersPerEvent>1", listener.ListenerKey)
	}
	for i, op := range listener.Operations {
		if op.Condition != nil {
			collector.addError(model.GenericErrUnknownRef, path+".operations["+itoa(i)+"].condition", "oncePerUse listeners cannot use operation.condition", listener.ListenerKey)
		}
	}
}

func compileListenerCondition(listener model.ListenerDefinition, path string, compiled *CompiledListener, ctx *genericCompileContext) {
	if listener.Condition == nil {
		return
	}
	instr := formula.CompileGenericFormula(*listener.Condition, path+".condition", ctx.namedFormulas, map[string]bool{}, ctx.collector.addError)
	if formulaReadsKind(instr, formula.ReadEventSkillHit) && formulaSkillHitReadsFirstContact(instr) {
		ctx.collector.addError(model.GenericErrFormulaTypeError, path+".condition", "listener.condition cannot encode firstContact", listener.ListenerKey)
	}
	if formulaReadsKind(instr, formula.ReadOperationOutput) {
		ctx.collector.addError(model.GenericErrFormulaTypeError, path+".condition", "listener.condition cannot read operation.output", listener.ListenerKey)
	}
	if len(instr) > 0 {
		compiled.ConditionProgram = ctx.registerFormula(path+".condition", instr)
		compiled.HasCondition = true
	}
}

func formulaSkillHitReadsFirstContact(instr []formula.GenericInstr) bool {
	for _, item := range instr {
		if item.Op == formula.GenericOpRead && item.ReadKind == formula.ReadEventSkillHit && item.ReadKey == "firstContact" {
			return true
		}
	}
	return false
}

func compileOncePerUse(listener model.ListenerDefinition, compiled *CompiledListener) {
	if listener.OncePerUse == nil {
		return
	}
	compiled.HasOncePerUse = true
	compiled.OncePerUseGroup = listener.OncePerUse.GroupKey
	compiled.OncePerUseScope = listener.OncePerUse.Scope
}

func validateOutputRef(op model.OperationDefinition, path string, ctx *genericCompileContext) {
	if op.OutputRef == "" {
		return
	}
	collector := ctx.collector
	if op.Operation != "damage" {
		collector.addError(model.GenericErrUnknownRef, path+".outputRef", "outputRef is only allowed on damage operations", op.OutputRef)
		return
	}
	if strings.Contains(op.OutputRef, ".") || strings.TrimSpace(op.OutputRef) == "" || utf8.RuneCountInString(op.OutputRef) > model.MaxOutputRefLen {
		collector.addError(model.GenericErrUnknownRef, path+".outputRef", "outputRef must be a unique identifier without dots", op.OutputRef)
		return
	}
	if ctx.outputUnitRefs == nil {
		collector.addError(model.GenericErrUnknownRef, path+".outputRef", "outputRef requires an immediate operations unit", op.OutputRef)
		return
	}
	if prev, ok := ctx.outputUnitRefs[op.OutputRef]; ok {
		collector.addError(model.GenericErrUnknownRef, path+".outputRef", "duplicate outputRef in the same operations unit", op.OutputRef+" previously index "+itoa(prev))
		return
	}
	ctx.outputUnitRefs[op.OutputRef] = ctx.outputUnitIndex
}

func validateOperationOutputReads(instr []formula.GenericInstr, path string, ctx *genericCompileContext) {
	if ctx.outputUnitRefs == nil {
		if formulaReadsKind(instr, formula.ReadOperationOutput) {
			ctx.collector.addError(model.GenericErrFormulaTypeError, path, "operation.output reads require a same-frame damage outputRef", "")
		}
		return
	}
	for _, item := range instr {
		if item.Op != formula.GenericOpRead || item.ReadKind != formula.ReadOperationOutput {
			continue
		}
		ref, _, ok := splitOutputReadKey(item.ReadKey)
		if !ok {
			ctx.collector.addError(model.GenericErrFormulaTypeError, path, "operation.output read path is invalid", item.ReadKey)
			continue
		}
		prev, exists := ctx.outputUnitRefs[ref]
		if !exists || prev >= ctx.outputUnitIndex {
			ctx.collector.addError(model.GenericErrUnknownRef, path, "operation.output cannot forward-reference or read an undefined outputRef", item.ReadKey)
		}
	}
}

func splitOutputReadKey(key string) (ref, kind string, ok bool) {
	dot := strings.IndexByte(key, '.')
	if dot <= 0 || dot == len(key)-1 {
		return "", "", false
	}
	return key[:dot], key[dot+1:], true
}

func abilityIsBasicAttack(ability model.AbilityDefinition, ctx *genericCompileContext) bool {
	if ctx == nil || ctx.session == nil {
		return false
	}
	id, ok := ctx.session.Types.Registry.Lookup(model.AbilityTypeBasicAttack)
	if !ok {
		return false
	}
	for _, key := range ability.Types {
		if typeID, found := ctx.session.Types.Registry.Lookup(key); found && typeID == id {
			return true
		}
	}
	return false
}
