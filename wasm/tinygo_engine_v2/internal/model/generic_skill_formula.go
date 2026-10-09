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
	Kind        string `json:"kind"`
	ResourceKey string `json:"resourceKey,omitempty"`
}

func (v *NamedFormula) UnmarshalJSON(data []byte) error {
	if err := processJSONShape(data, "NamedFormula", "key skillKey expression parameters", "key skillKey expression parameters"); err != nil {
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
	if err := processJSONShape(data, "FormulaRuntimeSource", "kind resourceKey", "kind"); err != nil {
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
	if decoded.Kind == "use_charge_duration" && hasResource {
		return errors.New("use_charge_duration forbids resourceKey")
	}
	if decoded.Kind == "process_actual_cost" && (!hasResource || decoded.ResourceKey == "") {
		return errors.New("process_actual_cost requires resourceKey")
	}
	*v = FormulaRuntimeSource(decoded)
	return nil
}
