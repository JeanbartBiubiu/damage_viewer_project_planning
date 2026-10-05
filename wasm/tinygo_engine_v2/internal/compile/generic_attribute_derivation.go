package compile

import (
	"strings"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
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
		if definition.AttributeKey != "attack_speed" && definition.AttributeKey != "attack_damage" {
			collector.addError(model.GenericErrUnknownRef, path+".attributeKey", "only attack_speed and attack_damage derivations are supported", definition.AttributeKey)
		}
		if (definition.AttributeKey == "attack_damage" && definition.ValuePolicy != "multiply") || (definition.AttributeKey == "attack_speed" && definition.ValuePolicy != "") {
			collector.addError(model.GenericErrFormulaTypeError, path+".valuePolicy", "attack_damage requires multiply; attack_speed requires its absolute value policy", definition.ValuePolicy)
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
		for _, instruction := range instructions {
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
			attributeKey, field, hasField := strings.Cut(instruction.ReadKey, ".")
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
			continue
		}
		program := ctx.registerFormula(path+".value", instructions)
		ctx.session.AttributeDerivations = append(ctx.session.AttributeDerivations, CompiledAttributeDerivation{
			CombatantKey: definition.CombatantKey, AttributeKey: definition.AttributeKey, ValuePolicy: definition.ValuePolicy, ValueProgram: program, Path: path,
		})
	}
}
