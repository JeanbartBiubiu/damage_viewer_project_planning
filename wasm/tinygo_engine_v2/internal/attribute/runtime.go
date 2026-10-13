// generic run 期属性槽最小读写（不含 modifier/provider 逻辑）。
package attribute

import (
	"math"

	"tinygo_engine_v2/internal/model"
)

// ReadAttr从不可变属性表读取槽位，支持key或key.suffix（resolved/current/base/max）。
func ReadAttr(attrs Table, key string) float64 {
	slot, field, ok := resolveAttrKey(attrs, key)
	if !ok {
		return 0
	}
	switch field {
	case "resolved":
		if slot.Resolved != 0 {
			return slot.Resolved
		}
		return slot.Current
	case "current":
		return slot.Current
	case "base":
		return slot.Base
	case "max":
		return slot.Max
	default:
		if slot.Resolved != 0 {
			return slot.Resolved
		}
		return slot.Current
	}
}

// ReadHP 读取 hp.current，缺省 0。
// 必须走 "hp.current"：ReadAttr("hp") 默认优先非零 Resolved，而 damage/heal 的 SetHP
// 只改 Current；属性 refresh 还会把 Resolved 重置为 Base，导致跨 hit 读到陈旧满血。
func ReadHP(attrs Table) float64 {
	return ReadAttr(attrs, "hp.current")
}

// ReadHPMax 读取 hp.max，缺省 current。
func ReadHPMax(attrs Table) float64 {
	slot, ok := attrs.Lookup("hp")
	if !ok {
		return 0
	}
	if slot.Max > 0 {
		return slot.Max
	}
	return slot.Current
}

// SetHP 设置 hp.current 并 clamp 到 [0, max]。
func SetHP(attrs Table, value float64) Table {
	slot := attrs.At("hp")
	maxHP := slot.Max
	if maxHP <= 0 {
		maxHP = slot.Current
	}
	if maxHP <= 0 {
		maxHP = value
	}
	if value < 0 || math.IsNaN(value) || math.IsInf(value, 0) {
		value = 0
	}
	if value > maxHP {
		value = maxHP
	}
	slot.Current = value
	if slot.Max <= 0 {
		slot.Max = maxHP
	}
	return attrs.With("hp", slot)
}

// ApplyHeal 增加 hp.current，clamp 到 max，返回实际治疗量。
func ApplyHeal(attrs Table, amount float64) (Table, float64) {
	if amount <= 0 || math.IsNaN(amount) || math.IsInf(amount, 0) {
		return attrs, 0
	}
	before := ReadHP(attrs)
	after := before + amount
	maxHP := ReadHPMax(attrs)
	if after > maxHP {
		after = maxHP
	}
	attrs = SetHP(attrs, after)
	return attrs, after - before
}

func resolveAttrKey(attrs Table, key string) (model.AttributeSlotDef, string, bool) {
	for i := len(key) - 1; i >= 0; i-- {
		if key[i] != '.' {
			continue
		}
		suffix := key[i+1:]
		switch suffix {
		case "resolved", "current", "base", "max":
			attrKey := key[:i]
			slot, ok := attrs.Lookup(attrKey)
			return slot, suffix, ok
		}
	}
	slot, ok := attrs.Lookup(key)
	return slot, "", ok
}
