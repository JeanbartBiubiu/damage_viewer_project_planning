// 资源运行时：current/max，spend/refund 带 clamp。
//
// 不变量：CanCast/canSpendActionCosts 先查再 commit；Spend 失败不得部分扣减。
package resource

import "math"

type ErrCode uint8

const (
	ErrOK ErrCode = iota
	ErrUnknownResource
	ErrInvalidAmount
	ErrInsufficient
)

type Result struct {
	Code    ErrCode
	Before  float64
	After   float64
	Delta   float64
	Current float64
	Max     float64
}

type Slot struct {
	ID      string
	Current float64
	Max     float64
}

type Store struct {
	Slots []Slot
	Index map[string]uint16
}

func NewStore(slots []Slot) Store {
	store := Store{Slots: make([]Slot, 0, len(slots)), Index: make(map[string]uint16, len(slots))}
	for _, slot := range slots {
		if slot.ID == "" {
			continue
		}
		slot.Clamp()
		store.Index[slot.ID] = uint16(len(store.Slots))
		store.Slots = append(store.Slots, slot)
	}
	return store
}

func (s *Store) Lookup(id string) (*Slot, bool) {
	idx, ok := s.Index[id]
	if !ok || int(idx) >= len(s.Slots) {
		return nil, false
	}
	return &s.Slots[idx], true
}

func (s *Store) Spend(id string, amount float64) Result {
	slot, ok := s.Lookup(id)
	if !ok {
		return Result{Code: ErrUnknownResource}
	}
	return slot.Spend(amount)
}

func (s *Store) Refund(id string, amount float64) Result {
	slot, ok := s.Lookup(id)
	if !ok {
		return Result{Code: ErrUnknownResource}
	}
	return slot.Refund(amount)
}

func (s *Store) Regen(id string, amount float64) Result {
	return s.Refund(id, amount)
}

func (s *Store) ReadResource(index uint16) (current float64, max float64, ok bool) {
	if int(index) >= len(s.Slots) {
		return 0, 0, false
	}
	slot := s.Slots[index]
	return slot.Current, slot.Max, true
}

func (s *Slot) Spend(amount float64) Result {
	before := s.Current
	if invalidAmount(amount) {
		return s.result(ErrInvalidAmount, before)
	}
	if s.Current < amount {
		return s.result(ErrInsufficient, before)
	}
	s.Current -= amount
	s.Clamp()
	return s.result(ErrOK, before)
}

func (s *Slot) Refund(amount float64) Result {
	before := s.Current
	if invalidAmount(amount) {
		return s.result(ErrInvalidAmount, before)
	}
	s.Current += amount
	s.Clamp()
	return s.result(ErrOK, before)
}

func (s *Slot) Regen(amount float64) Result {
	return s.Refund(amount)
}

func (s *Slot) Clamp() {
	if s.Max < 0 || math.IsNaN(s.Max) || math.IsInf(s.Max, 0) {
		s.Max = 0
	}
	if s.Current < 0 || math.IsNaN(s.Current) || math.IsInf(s.Current, 0) {
		s.Current = 0
	}
	if s.Current > s.Max {
		s.Current = s.Max
	}
}

func (s *Slot) CanSpend(amount float64) bool {
	return !invalidAmount(amount) && s.Current >= amount
}

func (s *Slot) result(code ErrCode, before float64) Result {
	return Result{
		Code:    code,
		Before:  before,
		After:   s.Current,
		Delta:   s.Current - before,
		Current: s.Current,
		Max:     s.Max,
	}
}

func invalidAmount(amount float64) bool {
	return amount < 0 || math.IsNaN(amount) || math.IsInf(amount, 0)
}
