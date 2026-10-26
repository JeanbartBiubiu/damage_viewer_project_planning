package action

import (
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
)

type driverProgram struct {
	id      formula.GenericProgramID
	present bool
}

type driverEntry struct {
	attempts  int
	condition driverProgram
	interval  driverProgram
}

// driverState 保存驱动器的运行身份及事实，不暴露可写集合。
type driverState struct {
	entries        []driverEntry
	processFacts   map[string]model.ProcessCommandFact
	deaths         map[string]bool
	targetKilledAt int64
	targetKilled   bool
}

func (s *State) InitDriverEntries(n int) { s.drivers.entries = make([]driverEntry, n) }
func (s *State) SetDriverCondition(index int, id formula.GenericProgramID) {
	s.drivers.entries[index].condition = driverProgram{id: id, present: true}
}
func (s *State) SetDriverInterval(index int, id formula.GenericProgramID) {
	s.drivers.entries[index].interval = driverProgram{id: id, present: true}
}
func (s *State) DriverCondition(index int) (formula.GenericProgramID, bool) {
	if index < 0 || index >= len(s.drivers.entries) {
		return 0, false
	}
	p := s.drivers.entries[index].condition
	return p.id, p.present
}
func (s *State) DriverInterval(index int) (formula.GenericProgramID, bool) {
	if index < 0 || index >= len(s.drivers.entries) {
		return 0, false
	}
	p := s.drivers.entries[index].interval
	return p.id, p.present
}
func (s *State) RecordDriverAttempt(index int) { s.drivers.entries[index].attempts++ }
func (s *State) InitProcessFacts() {
	s.drivers.processFacts = make(map[string]model.ProcessCommandFact)
}
func (s *State) ProcessFact(key string) model.ProcessCommandFact {
	return s.drivers.processFacts[key]
}
func (s *State) HasProcessFact(key string) bool {
	_, ok := s.drivers.processFacts[key]
	return ok
}
func (s *State) SetProcessFact(key string, fact model.ProcessCommandFact) {
	s.drivers.processFacts[key] = fact
}
func (s *State) RemoveProcessFact(key string) { delete(s.drivers.processFacts, key) }
func (s *State) Dead(owner string) bool       { return s.drivers.deaths[owner] }
func (s *State) MarkDead(owner string) {
	if s.drivers.deaths == nil {
		s.drivers.deaths = make(map[string]bool)
	}
	s.drivers.deaths[owner] = true
}
func (s *State) RecordSkillTargetKilled(at int64) {
	if !s.drivers.targetKilled {
		s.drivers.targetKilledAt, s.drivers.targetKilled = at, true
	}
}
func (s *State) SkillTargetKilledAt() (int64, bool) {
	return s.drivers.targetKilledAt, s.drivers.targetKilled
}
