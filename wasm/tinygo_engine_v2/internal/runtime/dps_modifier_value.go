// DPS modifier valueSpec resolution for coefficient bucket candidates.
package runtime

import (
	"math"
	"strings"

	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
)

func resolvedDPSOperationPriority(op model.DPSPassiveOperationV2) int {
	return op.Priority
}

func resolveDPSModifierValue(
	bundle compilebundle.CompiledBundle,
	op model.DPSPassiveOperationV2,
	gate dpsModifierGateContext,
) (float64, bool, string) {
	spec := op.ValueSpec
	kind := strings.TrimSpace(spec.Kind)
	if kind == "" {
		if math.IsNaN(op.Value) || math.IsInf(op.Value, 0) {
			return 0, false, "passive damage_modifier has invalid value"
		}
		return op.Value, true, ""
	}
	switch kind {
	case "literal":
		if math.IsNaN(spec.Value) || math.IsInf(spec.Value, 0) {
			return 0, false, "passive damage_modifier valueSpec literal has invalid value"
		}
		return clampDPSModifierValue(spec.Value, spec), true, ""
	case "attr_ratio":
		role := strings.TrimSpace(spec.OwnerRole)
		if role == "" {
			role = dpsRoleAttacker
		}
		readKind := spec.AttrRead
		if readKind == "" {
			readKind = model.AttrReadResolved
		}
		attrValue, ok := dpsModifierAttrValueWithReadKind(role, spec.AttrKey, readKind, gate)
		if !ok {
			return 0, false, "passive damage_modifier valueSpec attr_ratio could not resolve attr"
		}
		result := attrValue * spec.Ratio
		if math.IsNaN(result) || math.IsInf(result, 0) {
			return 0, false, "passive damage_modifier valueSpec attr_ratio resolved invalid value"
		}
		return clampDPSModifierValue(result, spec), true, ""
	case "hp_ratio":
		role := strings.TrimSpace(spec.OwnerRole)
		if role == "" {
			role = dpsRoleTarget
		}
		meter := strings.TrimSpace(spec.HPMeter)
		if meter == "" {
			meter = "current"
		}
		value, ok := dpsModifierHPMeterValue(role, meter, gate)
		if !ok {
			return 0, false, "passive damage_modifier valueSpec hp_ratio could not resolve hp meter"
		}
		result := value * spec.Ratio
		if math.IsNaN(result) || math.IsInf(result, 0) {
			return 0, false, "passive damage_modifier valueSpec hp_ratio resolved invalid value"
		}
		return clampDPSModifierValue(result, spec), true, ""
	case "hp_diff_ratio":
		subjectRole := strings.TrimSpace(spec.OwnerRole)
		if subjectRole == "" {
			subjectRole = dpsRoleAttacker
		}
		compareRole := strings.TrimSpace(spec.CompareRole)
		if compareRole == "" {
			compareRole = dpsRoleTarget
		}
		subjectMax, ok := dpsModifierHPMetricValue(subjectRole, "max_hp", gate)
		if !ok {
			return 0, false, "passive damage_modifier valueSpec hp_diff_ratio could not resolve subject max hp"
		}
		compareMax, ok := dpsModifierHPMetricValue(compareRole, "max_hp", gate)
		if !ok {
			return 0, false, "passive damage_modifier valueSpec hp_diff_ratio could not resolve compare max hp"
		}
		diff := compareMax - subjectMax
		if diff < 0 {
			diff = 0
		}
		result := diff * spec.Ratio
		if math.IsNaN(result) || math.IsInf(result, 0) {
			return 0, false, "passive damage_modifier valueSpec hp_diff_ratio resolved invalid value"
		}
		return clampDPSModifierValue(result, spec), true, ""
	case "formula":
		return resolveDPSModifierFormulaValue(bundle, spec, gate)
	default:
		return 0, false, "passive damage_modifier valueSpec has unsupported kind " + kind
	}
}

func resolveDPSModifierFormulaValue(
	bundle compilebundle.CompiledBundle,
	spec model.DPSModifierValueSpecV2,
	gate dpsModifierGateContext,
) (float64, bool, string) {
	formulaID := strings.TrimSpace(spec.FormulaID)
	if formulaID == "" {
		return 0, false, "passive damage_modifier valueSpec formula requires formulaId"
	}
	programID, ok := bundle.Formulas.Lookup(formulaID)
	if !ok {
		return 0, false, "passive damage_modifier valueSpec formula references unknown formula " + formulaID
	}
	if int(programID) >= len(bundle.Formulas.Programs) {
		return 0, false, "passive damage_modifier valueSpec formula references invalid formula " + formulaID
	}
	program := bundle.Formulas.Programs[programID]
	if formulaProgramUsesUnsupportedDPSModifierReaders(program) {
		return 0, false, "passive damage_modifier valueSpec formula requires unsupported runtime readers"
	}
	evalCtx := buildDPSModifierFormulaEvalContext(bundle, gate)
	value, err := bundle.Formulas.Eval(programID, evalCtx)
	if err != nil {
		return 0, false, "passive damage_modifier valueSpec formula could not evaluate " + formulaID + ": " + err.Error()
	}
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return 0, false, "passive damage_modifier valueSpec formula resolved invalid value"
	}
	return clampDPSModifierValue(value, spec), true, ""
}

func formulaProgramUsesUnsupportedDPSModifierReaders(program formula.Program) bool {
	for _, instr := range program.Instr {
		switch instr.Op {
		case formula.OpResource, formula.OpCounter:
			return true
		}
	}
	return false
}

type dpsModifierFormulaAttrReader struct {
	bundle compilebundle.CompiledBundle
	attrs  map[string]float64
	views  map[string]model.AttributeSnapshotV2
}

func (r dpsModifierFormulaAttrReader) ReadAttr(index uint16, kind model.AttributeReadKind) (float64, bool) {
	if int(index) >= len(r.bundle.Attrs) {
		return 0, false
	}
	attrKey := strings.TrimSpace(r.bundle.Attrs[index].ID)
	if attrKey == "" {
		return 0, false
	}
	return readDPSModifierAttr(r.attrs, r.views, attrKey, kind)
}

func buildDPSModifierFormulaEvalContext(bundle compilebundle.CompiledBundle, gate dpsModifierGateContext) formula.EvalContext {
	return formula.EvalContext{
		SourceAttrs: dpsModifierFormulaAttrReader{
			bundle: bundle,
			attrs:  gate.AttackerAttrs,
			views:  gate.AttackerViews,
		},
		TargetAttrs: dpsModifierFormulaAttrReader{
			bundle: bundle,
			attrs:  gate.TargetAttrs,
			views:  nil,
		},
	}
}

func dpsModifierHPMeterValue(role string, meter string, gate dpsModifierGateContext) (float64, bool) {
	switch meter {
	case "current":
		if role == dpsRoleAttacker {
			return gate.AttackerHP, gate.AttackerMaxHP > 0
		}
		return gate.TargetHP, gate.TargetMaxHP > 0
	case "max":
		return dpsModifierHPMetricValue(role, "max_hp", gate)
	case "missing":
		current, maxHP := gate.TargetHP, gate.TargetMaxHP
		if role == dpsRoleAttacker {
			current, maxHP = gate.AttackerHP, gate.AttackerMaxHP
		}
		if maxHP <= 0 {
			return 0, false
		}
		missing := maxHP - current
		if missing < 0 {
			missing = 0
		}
		return missing, true
	case "current_pct":
		return dpsModifierHPMetricValue(role, "current_hp_pct", gate)
	case "missing_pct":
		return dpsModifierHPMetricValue(role, "missing_hp_pct", gate)
	default:
		return 0, false
	}
}

func clampDPSModifierValue(value float64, spec model.DPSModifierValueSpecV2) float64 {
	if spec.HasClampMin && value < spec.ClampMin {
		value = spec.ClampMin
	}
	if spec.HasClampMax && value > spec.ClampMax {
		value = spec.ClampMax
	}
	return value
}
