// 属性运行时：base/current/max/resolved + dirty 惰性 Resolve。
//
// 不变量：公式通过 ReadAttr 读 resolved；modifier 过期在 ResolveAll 前处理；
// runtime 改属性应经 Store API，避免直接改 Slot 破坏 Dirty 语义。
package attribute

import (
	"math"

	"tinygo_engine_v2/internal/model"
)

type ModifierKind uint8

const (
	ModifierFlat ModifierKind = iota + 1
	ModifierPercent
	ModifierOverride
)

type ModifierTarget uint8

const (
	TargetValue ModifierTarget = iota + 1
	TargetMax
)

type AttributeDefinition struct {
	ID      string
	Base    float64
	Max     float64
	Current float64
}

type Modifier struct {
	ID       string
	Kind     ModifierKind
	Target   ModifierTarget
	Value    float64
	ExpireAt int64
}

type Slot struct {
	Definition AttributeDefinition
	Base       float64
	Current    float64
	Max        float64
	Resolved   float64
	Dirty      bool
	Modifiers  []Modifier
}

// Store 按 compile 后 AttrIndex 顺序持有 Slot；Index 仅用于按字符串 id 查找。
type Store struct {
	Slots []Slot
	Index map[string]uint16
}

func NewStore(defs []AttributeDefinition) Store {
	store := Store{Slots: make([]Slot, 0, len(defs)), Index: make(map[string]uint16, len(defs))}
	for _, def := range defs {
		if def.ID == "" {
			continue
		}
		store.Index[def.ID] = uint16(len(store.Slots))
		store.Slots = append(store.Slots, NewSlot(def))
	}
	return store
}

func NewSlot(def AttributeDefinition) Slot {
	base := def.Base
	maxValue := def.Max
	if maxValue <= 0 {
		maxValue = base
	}
	current := def.Current
	if current <= 0 {
		current = maxValue
	}
	if current > maxValue {
		current = maxValue
	}
	return Slot{
		Definition: def,
		Base:       base,
		Current:    current,
		Max:        maxValue,
		Resolved:   base,
		Dirty:      true,
	}
}

func (s *Store) Lookup(id string) (*Slot, bool) {
	idx, ok := s.Index[id]
	if !ok || int(idx) >= len(s.Slots) {
		return nil, false
	}
	return &s.Slots[idx], true
}

func (s *Store) ResolveAll(nowMs int64) {
	for i := range s.Slots {
		s.Slots[i].Expire(nowMs)
		s.Slots[i].Resolve()
	}
}

func (s *Slot) SetCurrent(value float64) {
	s.Current = value
	s.ClampCurrent()
	s.Dirty = true
}

func (s *Slot) SetBase(value float64) {
	s.Base = value
	s.Dirty = true
}

func (s *Slot) AddModifier(mod Modifier) {
	if mod.Target == 0 {
		mod.Target = TargetValue
	}
	s.Modifiers = append(s.Modifiers, mod)
	s.Dirty = true
}

func (s *Slot) RemoveModifier(id string) bool {
	for i := range s.Modifiers {
		if s.Modifiers[i].ID != id {
			continue
		}
		copy(s.Modifiers[i:], s.Modifiers[i+1:])
		s.Modifiers = s.Modifiers[:len(s.Modifiers)-1]
		s.Dirty = true
		return true
	}
	return false
}

func (s *Slot) Expire(nowMs int64) bool {
	kept := s.Modifiers[:0]
	changed := false
	for _, mod := range s.Modifiers {
		if mod.ExpireAt > 0 && mod.ExpireAt <= nowMs {
			changed = true
			continue
		}
		kept = append(kept, mod)
	}
	s.Modifiers = kept
	if changed {
		s.Dirty = true
	}
	return changed
}

func (s *Slot) Resolve() {
	if !s.Dirty {
		return
	}
	s.Resolved = resolveValue(s.Base, s.Modifiers, TargetValue)
	nextMax := resolveValue(s.definitionMax(), s.Modifiers, TargetMax)
	if nextMax < 0 || math.IsNaN(nextMax) || math.IsInf(nextMax, 0) {
		nextMax = 0
	}
	s.Max = nextMax
	s.ClampCurrent()
	s.Dirty = false
}

func (s *Slot) ClampCurrent() {
	if s.Current < 0 || math.IsNaN(s.Current) || math.IsInf(s.Current, 0) {
		s.Current = 0
	}
	if s.Current > s.Max {
		s.Current = s.Max
	}
}

func (s *Store) ReadAttr(index uint16, kind model.AttributeReadKind) (float64, bool) {
	if int(index) >= len(s.Slots) {
		return 0, false
	}
	slot := &s.Slots[index]
	slot.Resolve()
	switch kind {
	case "", model.AttrReadResolved:
		return slot.Resolved, true
	case model.AttrReadBase:
		return slot.Base, true
	case model.AttrReadCurrent:
		return slot.Current, true
	case model.AttrReadMax:
		return slot.Max, true
	default:
		return 0, false
	}
}

func (s *Slot) definitionMax() float64 {
	if s.Definition.Max > 0 {
		return s.Definition.Max
	}
	return s.Base
}

func resolveValue(base float64, modifiers []Modifier, target ModifierTarget) float64 {
	value := base
	percent := 0.0
	override := 0.0
	hasOverride := false
	for _, mod := range modifiers {
		if mod.Target != target {
			continue
		}
		switch mod.Kind {
		case ModifierFlat:
			value += mod.Value
		case ModifierPercent:
			percent += mod.Value
		case ModifierOverride:
			override = mod.Value
			hasOverride = true
		}
	}
	value *= 1 + percent
	if hasOverride {
		value = override
	}
	return value
}
