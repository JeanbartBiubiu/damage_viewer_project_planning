package action

import "tinygo_engine_v2/internal/runtime/contract"

type UseSeed struct {
	UseKey, Source, SkillKey, HistoryState string
	CastID                                 uint64
	ProcessRef                             contract.ProcessRef
	ActionRef                              contract.ActionRef
	EmpoweredRef                           contract.ProcessRef
	EmpoweredConsumption                   int
}

// UseView 保存行动使用的身份；接触历史和命中冻结仍由执行层维护。
type UseView struct{ data UseSeed }

func (s *State) NewUse(seed UseSeed) *UseView {
	value := &UseView{data: seed}
	if s.uses == nil {
		s.uses = make(map[string]*UseView)
	}
	s.uses[seed.UseKey] = value
	return value
}
func (s *State) Use(key string) *UseView                   { return s.uses[key] }
func (u *UseView) Seed() UseSeed                           { return u.data }
func (u *UseView) UseKey() string                          { return u.data.UseKey }
func (u *UseView) Source() string                          { return u.data.Source }
func (u *UseView) SkillKey() string                        { return u.data.SkillKey }
func (u *UseView) HistoryState() string                    { return u.data.HistoryState }
func (u *UseView) CastID() uint64                          { return u.data.CastID }
func (u *UseView) ProcessReference() contract.ProcessRef   { return u.data.ProcessRef }
func (u *UseView) ActionReference() contract.ActionRef     { return u.data.ActionRef }
func (u *UseView) EmpoweredReference() contract.ProcessRef { return u.data.EmpoweredRef }
func (u *UseView) EmpoweredConsumption() int               { return u.data.EmpoweredConsumption }
func (s *State) ReserveUseEmpowerment(u *UseView, process contract.ProcessRef, index int) {
	u.data.EmpoweredRef, u.data.EmpoweredConsumption = process, index
}
