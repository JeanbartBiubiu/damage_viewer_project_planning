package model

import (
	"encoding/json"
	"errors"
)

// FormulaParameter保存场景已经选择的原参数值，计算时输入不允许默认值。
type FormulaParameter struct {
	ParameterKey  string                `json:"parameterKey"`
	ValueMode     string                `json:"valueMode"`
	ValueType     string                `json:"valueType"`
	Value         *float64              `json:"value,omitempty"`
	RuntimeSource *FormulaRuntimeSource `json:"runtimeSource,omitempty"`
}

type FormulaRuntimeSource struct {
	Kind        string   `json:"kind"`
	ResourceKey string   `json:"resourceKey,omitempty"`
	StateKey    string   `json:"stateKey,omitempty"`
	Value       *float64 `json:"value,omitempty"`
}

func (v *NamedFormula) UnmarshalJSON(data []byte) error {
	if err := processJSONShape(data, "NamedFormula", "key scope skillKey expression parameters", "key scope expression parameters"); err != nil {
		return err
	}
	var shape map[string]json.RawMessage
	if err := json.Unmarshal(data, &shape); err != nil {
		return err
	}
	if string(shape["parameters"]) == "null" {
		return errors.New("NamedFormula parameters must be an array")
	}
	type plain NamedFormula
	var decoded plain
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	if decoded.Scope == "game" {
		if _, declared := shape["skillKey"]; declared || len(decoded.Parameters) != 0 {
			return errors.New("game formula cannot declare a skill or parameters")
		}
	} else if decoded.Scope == "skill" {
		if _, declared := shape["skillKey"]; !declared {
			return errors.New("skill formula must declare its owning skill")
		}
	} else {
		return errors.New("NamedFormula scope must be skill or game")
	}
	*v = NamedFormula(decoded)
	return nil
}

func (v *FormulaParameter) UnmarshalJSON(data []byte) error {
	if err := processJSONShape(data, "FormulaParameter", "parameterKey valueMode valueType value runtimeSource", "parameterKey valueMode valueType"); err != nil {
		return err
	}
	var shape map[string]json.RawMessage
	if err := json.Unmarshal(data, &shape); err != nil {
		return err
	}
	if string(shape["value"]) == "null" || string(shape["runtimeSource"]) == "null" {
		return errors.New("FormulaParameter optional fields must not be null")
	}
	type plain FormulaParameter
	var decoded plain
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	*v = FormulaParameter(decoded)
	return nil
}

func (v *FormulaRuntimeSource) UnmarshalJSON(data []byte) error {
	if err := processJSONShape(data, "FormulaRuntimeSource", "kind resourceKey stateKey value", "kind"); err != nil {
		return err
	}
	type plain FormulaRuntimeSource
	var decoded plain
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	var shape map[string]json.RawMessage
	if err := json.Unmarshal(data, &shape); err != nil {
		return err
	}
	_, hasResource := shape["resourceKey"]
	_, hasValue := shape["value"]
	_, hasState := shape["stateKey"]
	if decoded.Kind == "process_start_state" {
		if !hasState || decoded.StateKey == "" || hasResource || hasValue {
			return errors.New("process_start_state requires stateKey and forbids resourceKey/value")
		}
	} else if hasState {
		return errors.New(decoded.Kind + " forbids stateKey")
	}
	if decoded.Kind == "scene_parameter" {
		if hasResource || !hasValue || decoded.Value == nil {
			return errors.New("scene_parameter requires value and forbids resourceKey")
		}
	} else if hasValue {
		return errors.New(decoded.Kind + " forbids value")
	}
	if (decoded.Kind == "use_charge_duration" || decoded.Kind == "ability_parameter") && hasResource {
		return errors.New(decoded.Kind + " forbids resourceKey")
	}
	if decoded.Kind == "process_actual_cost" && (!hasResource || decoded.ResourceKey == "") {
		return errors.New("process_actual_cost requires resourceKey")
	}
	*v = FormulaRuntimeSource(decoded)
	return nil
}
