package compile

import (
	"strings"
	"unsafe"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
)

func compileAttributeDerivations(definitions []model.AttributeDerivationDefinition, ctx *genericCompileContext) {
	collector := ctx.collector
	if len(definitions) > 4 {
		collector.addError(model.GenericErrRuntimeInvariantFailed, "rules.attributeDerivations", "at most four attribute derivations are supported", "")
		return
	}
	attributes := map[string]map[string]model.AttributeSlotDef{}
	for _, actor := range ctx.session.Combatants {
		attributes[actor.Key] = actor.Attributes
	}
	derived := map[string]bool{}
	seenOutputs := map[string]bool{}
	for index, definition := range definitions {
		path := "rules.attributeDerivations[" + itoa(index) + "]"
		if definition.AttributeKey == "" || definition.AttributeKey == "hp" {
			collector.addError(model.GenericErrUnknownRef, path+".attributeKey", "derivation requires an explicit non-HP attribute", definition.AttributeKey)
		}
		if definition.ValuePolicy != "set" && definition.ValuePolicy != "multiply" {
			collector.addError(model.GenericErrFormulaTypeError, path+".valuePolicy", "derivation requires an explicit set or multiply policy", definition.ValuePolicy)
		}
		if definition.ValueType != "DECIMAL" && definition.ValueType != "INTEGER" {
			collector.addError(model.GenericErrFormulaTypeError, path+".valueType", "derivation requires its explicit numeric output type", definition.ValueType)
		}
		if definition.CombatantKey != "source" && definition.CombatantKey != "target" {
			collector.addError(model.GenericErrUnknownRef, path+".combatantKey", "unknown derivation combatant", definition.CombatantKey)
		}
		output := definition.CombatantKey + "." + definition.AttributeKey
		if seenOutputs[output] {
			collector.addError(model.GenericErrRuntimeInvariantFailed, path, "each combatant's derived output must be unique", output)
		}
		seenOutputs[output] = true
		if _, exists := attributes[definition.CombatantKey][definition.AttributeKey]; !exists {
			collector.addError(model.GenericErrUnknownRef, path+".attributeKey", "derived attribute slot is missing", definition.AttributeKey)
		}
		derived[definition.CombatantKey+"."+definition.AttributeKey] = true
	}
	for index, definition := range definitions {
		path := "rules.attributeDerivations[" + itoa(index) + "]"
		instructions := formula.CompileGenericFormula(definition.Value, path+".value", ctx.namedFormulas, map[string]bool{}, collector.addError)
		previousSkill := ctx.currentSkillKey
		ctx.currentSkillKey = definition.SkillKey
		for _, instruction := range ctx.session.Formulas.InstructionDependencies(instructions, nil) {
			if instruction.Op != formula.GenericOpRead {
				continue
			}
			owner := ""
			switch instruction.ReadKind {
			case formula.ReadSourceAttr:
				owner = "source"
			case formula.ReadTargetAttr:
				owner = "target"
			default:
				collector.addError(model.GenericErrFormulaTypeError, path+".value", "derivations may read only ordinary attributes and frozen attribute bases", instruction.ReadKey)
				continue
			}
			if instruction.AuthoredRead && definition.CombatantKey == "target" {
				if owner == "source" {
					owner = "target"
				} else {
					owner = "source"
				}
			}
			fieldAt := strings.LastIndex(instruction.ReadKey, ".")
			attributeKey, field, hasField := instruction.ReadKey, "", fieldAt > 0
			if hasField {
				attributeKey, field = instruction.ReadKey[:fieldAt], instruction.ReadKey[fieldAt+1:]
			}
			if !hasField || (field != "base" && field != "current" && field != "max" && field != "resolved") {
				collector.addError(model.GenericErrFormulaTypeError, path+".value", "derivation requires an explicit attribute slot field", instruction.ReadKey)
			}
			if _, exists := attributes[owner][attributeKey]; !exists {
				collector.addError(model.GenericErrUnknownRef, path+".value", "derivation dependency slot is missing", instruction.ReadKey)
			}
			if derived[owner+"."+attributeKey] && field != "base" {
				collector.addError(model.GenericErrFormulaTypeError, path+".value", "derived targets may be read only through their frozen base", instruction.ReadKey)
			}
		}
		if len(instructions) == 0 {
			ctx.currentSkillKey = previousSkill
			continue
		}
		bytes := uint64(unsafe.Sizeof(plan.CompiledAttributeDerivation{})) + uint64(len(definition.SkillKey)+len(definition.CombatantKey)+len(definition.AttributeKey)+len(definition.ValuePolicy)+len(definition.ValueType)+len(path))
		program, registered := ctx.registerFormula(path+".value", instructions, bytes)
		ctx.currentSkillKey = previousSkill
		if !registered {
			continue
		}
		ctx.session.AttributeDerivations = append(ctx.session.AttributeDerivations, plan.CompiledAttributeDerivation{
			SkillKey: definition.SkillKey, CombatantKey: definition.CombatantKey, AttributeKey: definition.AttributeKey, ValuePolicy: definition.ValuePolicy, ValueType: definition.ValueType, ValueProgram: program, Path: path,
		})
	}
}
