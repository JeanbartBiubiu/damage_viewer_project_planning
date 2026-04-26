// 本文件定义 EventPhase trigger 索引骨架，用于按 phase、owner 和作用域匹配机制触发器。
package trigger

import "tinygo_engine_v2/internal/model"

type OwnerScope uint8

const (
	OwnerAny OwnerScope = iota
	OwnerSource
	OwnerTarget
	OwnerActor
	OwnerAction
	OwnerStatus
	OwnerItem
)

type Binding struct {
	ID                 string
	Phase              model.EventPhase
	OwnerScope         OwnerScope
	OwnerID            string
	RequiresDamage     bool
	OncePerEvent       bool
	InternalCooldownMs int64
	CommandStart       uint16
	CommandCount       uint16
}

type Index struct {
	ByPhase map[model.EventPhase][]uint16
	Items   []Binding
}

func NewIndex(bindings []Binding) Index {
	idx := Index{ByPhase: make(map[model.EventPhase][]uint16), Items: append([]Binding(nil), bindings...)}
	for i, binding := range bindings {
		idx.ByPhase[binding.Phase] = append(idx.ByPhase[binding.Phase], uint16(i))
	}
	return idx
}

func (idx Index) Lookup(phase model.EventPhase) []uint16 {
	return idx.ByPhase[phase]
}
