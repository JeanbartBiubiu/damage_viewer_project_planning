package model

import (
	"encoding/json"
	"errors"
)

// 原生代码直接构造的槽明确供给全部字段；JSON槽只认实际出现的数字字段。
func (s AttributeSlotDef) HasBase() bool     { return !s.jsonDecoded || s.present&1 != 0 }
func (s AttributeSlotDef) HasCurrent() bool  { return !s.jsonDecoded || s.present&2 != 0 }
func (s AttributeSlotDef) HasMax() bool      { return !s.jsonDecoded || s.present&4 != 0 }
func (s AttributeSlotDef) HasResolved() bool { return !s.jsonDecoded || s.present&8 != 0 }

func (s *AttributeSlotDef) UnmarshalJSON(data []byte) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	if fields == nil {
		return errors.New("attribute slot must be an object")
	}
	decoded := AttributeSlotDef{jsonDecoded: true}
	for i, key := range []string{"base", "current", "max", "resolved"} {
		raw, exists := fields[key]
		if !exists {
			continue
		}
		var number float64
		if string(raw) == "null" {
			return errors.New("attribute slot." + key + " must be a number")
		}
		if err := json.Unmarshal(raw, &number); err != nil {
			return errors.New("attribute slot." + key + " must be a number")
		}
		decoded.present |= 1 << uint(i)
		switch key {
		case "base":
			decoded.Base = number
		case "current":
			decoded.Current = number
		case "max":
			decoded.Max = number
		case "resolved":
			decoded.Resolved = number
		}
	}
	*s = decoded
	return nil
}

// 往返运输不把缺字段补成0；值复制同时保留私有存在标记。
func (s AttributeSlotDef) MarshalJSON() ([]byte, error) {
	fields := make(map[string]float64, 4)
	if s.HasBase() {
		fields["base"] = s.Base
	}
	if s.HasCurrent() {
		fields["current"] = s.Current
	}
	if s.HasMax() {
		fields["max"] = s.Max
	}
	if s.HasResolved() {
		fields["resolved"] = s.Resolved
	}
	return json.Marshal(fields)
}
