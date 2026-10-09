package model

import "encoding/json"

func (definition ProviderStateFieldSchema) MarshalJSON() ([]byte, error) {
	type plain ProviderStateFieldSchema
	if definition.DefaultValue == nil {
		definition.DefaultValue = 0
	}
	if definition.MaxValue == nil {
		definition.MaxValue = 0
	}
	if definition.DurationMs == nil {
		definition.DurationMs = 0
	}
	if definition.StateKind != ProviderStateKindAmmo {
		return json.Marshal(plain(definition))
	}
	var duration any
	zero := false
	switch value := definition.DurationMs.(type) {
	case int:
		zero = value == 0
	case int64:
		zero = value == 0
	case float64:
		zero = value == 0
	}
	if !zero {
		duration = definition.DurationMs
	}
	return json.Marshal(struct {
		plain
		DurationMs any `json:"durationMs,omitempty"`
	}{plain: plain(definition), DurationMs: duration})
}
