package model

import "encoding/json"

func (definition ProviderStateFieldSchema) MarshalJSON() ([]byte, error) {
	type plain ProviderStateFieldSchema
	if definition.StateKind != ProviderStateKindAmmo {
		return json.Marshal(plain(definition))
	}
	var duration *int64
	if definition.DurationMs != 0 {
		duration = &definition.DurationMs
	}
	return json.Marshal(struct {
		plain
		DurationMs *int64 `json:"durationMs,omitempty"`
	}{plain: plain(definition), DurationMs: duration})
}
