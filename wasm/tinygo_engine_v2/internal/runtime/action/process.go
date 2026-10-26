package action

import (
	"math"
	"sort"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/runtime/contract"
)

// ProcessView 不提供可写过程；执行层按身份读取，变更只保存在独占暂存中。
type ProcessView struct{ data *processData }

type processData struct {
	snapshot                                    model.ProcessInstanceSnapshot
	slot                                        int
	definition                                  *planbundle.CompiledProcess
	ability                                     planbundle.CompiledAbility
	abilityRef, mountKey, stableKey, castUseKey string
	stepIndex                                   int
	castID                                      uint64
	startStateValues                            []formula.ProcessStartStateValue
	empoweredAbilityIndex                       uint16
	hasEmpoweredAbility, replacesPrimary        bool
	primaryReplacementBinding                   uint16
	empoweredResolvedPublished                  bool
}

type ProcessSeed struct {
	Snapshot   model.ProcessInstanceSnapshot
	Definition *planbundle.CompiledProcess
	Ability    planbundle.CompiledAbility
	AbilityRef string
	StepIndex  int
	CastID     uint64
	CastUseKey string
}

type ProcessChangeSet struct{ view ProcessView }

func NewProcess(seed ProcessSeed) *ProcessView {
	p := &ProcessView{data: &processData{snapshot: cloneProcessSnapshot(seed.Snapshot), slot: -1, definition: seed.Definition, ability: seed.Ability, abilityRef: seed.AbilityRef, stepIndex: seed.StepIndex, castID: seed.CastID, castUseKey: seed.CastUseKey}}
	p.data.stableKey = p.Owner() + "\x00" + p.ProviderRef() + "\x00" + p.ProcessKey() + "\x00" + p.UseKey()
	p.data.mountKey = p.Owner() + "\x00" + p.ProviderRef() + "\x00" + p.ProcessKey()
	return p
}

func StageProcess(original *ProcessView) *ProcessChangeSet {
	data := *original.data
	data.snapshot = cloneProcessSnapshot(original.data.snapshot)
	return &ProcessChangeSet{view: ProcessView{data: &data}}
}

func (c *ProcessChangeSet) View() *ProcessView { return &c.view }

func (c *ProcessChangeSet) Publish(original *ProcessView) {
	slot := original.data.slot
	*original.data = *c.view.data
	original.data.slot = slot
}
func (p *ProcessView) Freeze() *ProcessView { return StageProcess(p).View() }
func (p *ProcessView) WithTarget(target string) *ProcessView {
	copy := *p.data
	copy.snapshot.Target = target
	return &ProcessView{data: &copy}
}

func cloneOptional[T any](value *T) *T {
	if value == nil {
		return nil
	}
	copied := *value
	return &copied
}

func cloneProcessSnapshot(row model.ProcessInstanceSnapshot) model.ProcessInstanceSnapshot {
	row.LastExecutionAtMs = cloneOptional(row.LastExecutionAtMs)
	row.StepCompletedAtMs = cloneOptional(row.StepCompletedAtMs)
	row.ExpiresAtMs = cloneOptional(row.ExpiresAtMs)
	row.FailureReason = cloneOptional(row.FailureReason)
	row.FinishedAtMs = cloneOptional(row.FinishedAtMs)
	row.EmpoweredPredecessorUseRef = cloneOptional(row.EmpoweredPredecessorUseRef)
	row.ActualCosts = cloneCosts(row.ActualCosts)
	row.ActionOccupancies = append([]model.ProcessActionOccupancy{}, row.ActionOccupancies...)
	for index := range row.ActionOccupancies {
		row.ActionOccupancies[index].FinishedAtMs = cloneOptional(row.ActionOccupancies[index].FinishedAtMs)
	}
	if row.Repeat != nil {
		repeat := *row.Repeat
		repeat.NextExecutionAtMs = cloneOptional(repeat.NextExecutionAtMs)
		row.Repeat = &repeat
	}
	if row.SkillHitStages != nil {
		rows := append([]model.ProcessSkillHitStage{}, (*row.SkillHitStages)...)
		row.SkillHitStages = &rows
	}
	if row.EmpoweredAttack != nil {
		value := *row.EmpoweredAttack
		value.ReplacedPrimary = cloneOptional(value.ReplacedPrimary)
		row.EmpoweredAttack = &value
	}
	if row.EmpoweredAttackWindow != nil {
		window := *row.EmpoweredAttackWindow
		window.Consumptions = append(make([]model.ProcessAttackConsumption, 0, window.MaximumAttackCount), window.Consumptions...)
		for index := range window.Consumptions {
			item := &window.Consumptions[index]
			item.HitRef = cloneOptional(item.HitRef)
			item.HitSequence = cloneOptional(item.HitSequence)
			item.ResolvedAtMs = cloneOptional(item.ResolvedAtMs)
		}
		row.EmpoweredAttackWindow = &window
	}
	return row
}

func cloneCosts(values map[string]float64) map[string]float64 {
	out := make(map[string]float64, len(values))
	for key, value := range values {
		out[key] = value
	}
	return out
}

func (p *ProcessView) Snapshot() model.ProcessInstanceSnapshot {
	return cloneProcessSnapshot(p.data.snapshot)
}
func (p *ProcessView) Reference() contract.ProcessRef {
	if p == nil {
		return contract.ProcessRef{}
	}
	return contract.ProcessRef{Slot: p.data.slot, Present: true}
}
func (p *ProcessView) Slot() int                               { return p.data.slot }
func (p *ProcessView) Definition() *planbundle.CompiledProcess { return p.data.definition }
func (p *ProcessView) Ability() planbundle.CompiledAbility     { return p.data.ability }
func (p *ProcessView) AbilityRef() string                      { return p.data.abilityRef }
func (p *ProcessView) StepIndex() int                          { return p.data.stepIndex }
func (p *ProcessView) CastID() uint64                          { return p.data.castID }
func (p *ProcessView) CastUseKey() string                      { return p.data.castUseKey }
func (p *ProcessView) MountKey() string                        { return p.data.mountKey }
func (p *ProcessView) StableKey() string                       { return p.data.stableKey }
func (p *ProcessView) HasEmpoweredAbility() bool               { return p.data.hasEmpoweredAbility }
func (p *ProcessView) EmpoweredAbilityIndex() uint16           { return p.data.empoweredAbilityIndex }
func (p *ProcessView) ReplacesPrimary() bool                   { return p.data.replacesPrimary }
func (p *ProcessView) PrimaryReplacementBinding() uint16       { return p.data.primaryReplacementBinding }
func (p *ProcessView) EmpoweredResolvedPublished() bool        { return p.data.empoweredResolvedPublished }
func (p *ProcessView) StartStateValues() []formula.ProcessStartStateValue {
	return append([]formula.ProcessStartStateValue(nil), p.data.startStateValues...)
}
func (p *ProcessView) StartState() formula.ProcessStartStateView {
	return formula.BorrowProcessStartState(p.data.startStateValues)
}
func (p *ProcessView) Owner() string           { return p.data.snapshot.Owner }
func (p *ProcessView) ProviderRef() string     { return p.data.snapshot.ProviderRef }
func (p *ProcessView) ProcessKey() string      { return p.data.snapshot.ProcessKey }
func (p *ProcessView) SkillKey() string        { return p.data.snapshot.SkillKey }
func (p *ProcessView) UseKey() string          { return p.data.snapshot.UseKey }
func (p *ProcessView) Target() string          { return p.data.snapshot.Target }
func (p *ProcessView) StepKey() string         { return p.data.snapshot.StepKey }
func (p *ProcessView) StepVersion() int        { return p.data.snapshot.StepVersion }
func (p *ProcessView) StepExecutionIndex() int { return p.data.snapshot.StepExecutionIndex }
func (p *ProcessView) StartedAtMs() int64      { return p.data.snapshot.StartedAtMs }
func (p *ProcessView) StepStartedAtMs() int64  { return p.data.snapshot.StepStartedAtMs }
func (p *ProcessView) AdvanceAtMs() int64      { return p.data.snapshot.AdvanceAtMs }
func (p *ProcessView) CooldownStarted() bool   { return p.data.snapshot.CooldownStarted }
func (p *ProcessView) Status() string          { return p.data.snapshot.Status }
func (p *ProcessView) LastExecutionAtMs() *int64 {
	return cloneOptional(p.data.snapshot.LastExecutionAtMs)
}
func (p *ProcessView) StepCompletedAtMs() *int64 {
	return cloneOptional(p.data.snapshot.StepCompletedAtMs)
}
func (p *ProcessView) ExpiresAtMs() *int64    { return cloneOptional(p.data.snapshot.ExpiresAtMs) }
func (p *ProcessView) FinishedAtMs() *int64   { return cloneOptional(p.data.snapshot.FinishedAtMs) }
func (p *ProcessView) FailureReason() *string { return cloneOptional(p.data.snapshot.FailureReason) }
func (p *ProcessView) EmpoweredPredecessorUseRef() *string {
	return cloneOptional(p.data.snapshot.EmpoweredPredecessorUseRef)
}
func (p *ProcessView) ActualCosts() map[string]float64 {
	return cloneCosts(p.data.snapshot.ActualCosts)
}
func (p *ProcessView) HasExpiry() bool         { return p.data.snapshot.ExpiresAtMs != nil }
func (p *ProcessView) Expiry() int64           { return *p.data.snapshot.ExpiresAtMs }
func (p *ProcessView) HasLastExecution() bool  { return p.data.snapshot.LastExecutionAtMs != nil }
func (p *ProcessView) LastExecution() int64    { return *p.data.snapshot.LastExecutionAtMs }
func (p *ProcessView) HasStepCompletion() bool { return p.data.snapshot.StepCompletedAtMs != nil }
func (p *ProcessView) StepCompletion() int64   { return *p.data.snapshot.StepCompletedAtMs }
func (p *ProcessView) HasFinished() bool       { return p.data.snapshot.FinishedAtMs != nil }
func (p *ProcessView) FinishedAt() int64       { return *p.data.snapshot.FinishedAtMs }
func (p *ProcessView) HasRepeat() bool         { return p.data.snapshot.Repeat != nil }
func (p *ProcessView) HasNextExecution() bool {
	return p.data.snapshot.Repeat != nil && p.data.snapshot.Repeat.NextExecutionAtMs != nil
}
func (p *ProcessView) NextExecutionAt() int64   { return *p.data.snapshot.Repeat.NextExecutionAtMs }
func (p *ProcessView) RepeatIndex() int         { return p.data.snapshot.Repeat.ExecutionIndex }
func (p *ProcessView) HasEmpoweredWindow() bool { return p.data.snapshot.EmpoweredAttackWindow != nil }
func (p *ProcessView) WindowMaximum() int {
	return p.data.snapshot.EmpoweredAttackWindow.MaximumAttackCount
}
func (p *ProcessView) WindowConsumed() int {
	return p.data.snapshot.EmpoweredAttackWindow.ConsumptionCount
}
func (p *ProcessView) WindowPending() int {
	return p.data.snapshot.EmpoweredAttackWindow.PendingHitCount
}
func (p *ProcessView) ConsumptionCount() int {
	return len(p.data.snapshot.EmpoweredAttackWindow.Consumptions)
}
func (p *ProcessView) Consumption(index int) model.ProcessAttackConsumption {
	value := p.data.snapshot.EmpoweredAttackWindow.Consumptions[index]
	value.HitRef = cloneOptional(value.HitRef)
	value.HitSequence = cloneOptional(value.HitSequence)
	value.ResolvedAtMs = cloneOptional(value.ResolvedAtMs)
	return value
}
func (p *ProcessView) HasSkillHitStages() bool { return p.data.snapshot.SkillHitStages != nil }
func (p *ProcessView) OccupancyCount() int     { return len(p.data.snapshot.ActionOccupancies) }
func (p *ProcessView) HasOccupancies() bool    { return p.data.snapshot.ActionOccupancies != nil }
func (p *ProcessView) OccupancyAt(index int) model.ProcessActionOccupancy {
	value := p.data.snapshot.ActionOccupancies[index]
	value.FinishedAtMs = cloneOptional(value.FinishedAtMs)
	return value
}
func (p *ProcessView) Costs() model.NumericView {
	return model.BorrowNumericView(p.data.snapshot.ActualCosts)
}
func (p *ProcessView) Repeat() *model.ProcessRepeatSnapshot {
	r := p.data.snapshot.Repeat
	if r == nil {
		return nil
	}
	out := *r
	out.NextExecutionAtMs = cloneOptional(out.NextExecutionAtMs)
	return &out
}
func (p *ProcessView) ActionOccupancies() []model.ProcessActionOccupancy {
	out := append([]model.ProcessActionOccupancy{}, p.data.snapshot.ActionOccupancies...)
	for index := range out {
		out[index].FinishedAtMs = cloneOptional(out[index].FinishedAtMs)
	}
	return out
}
func (p *ProcessView) SkillHitStages() *[]model.ProcessSkillHitStage {
	if p.data.snapshot.SkillHitStages == nil {
		return nil
	}
	out := append([]model.ProcessSkillHitStage{}, (*p.data.snapshot.SkillHitStages)...)
	return &out
}
func (p *ProcessView) EmpoweredAttack() *model.ProcessEmpoweredAttack {
	if p.data.snapshot.EmpoweredAttack == nil {
		return nil
	}
	out := *p.data.snapshot.EmpoweredAttack
	out.ReplacedPrimary = cloneOptional(out.ReplacedPrimary)
	return &out
}
func (p *ProcessView) EmpoweredAttackWindow() *model.ProcessEmpoweredAttackWindow {
	if p.data.snapshot.EmpoweredAttackWindow == nil {
		return nil
	}
	row := cloneProcessSnapshot(model.ProcessInstanceSnapshot{EmpoweredAttackWindow: p.data.snapshot.EmpoweredAttackWindow})
	return row.EmpoweredAttackWindow
}

func (c *ProcessChangeSet) SetCast(id uint64, use string) {
	c.view.data.castID, c.view.data.castUseKey = id, use
}
func (c *ProcessChangeSet) SetCooldownStarted() { c.view.data.snapshot.CooldownStarted = true }
func (c *ProcessChangeSet) SetActualCost(key string, value float64) {
	c.view.data.snapshot.ActualCosts[key] = value
}
func (c *ProcessChangeSet) SetStartStateValues(values []formula.ProcessStartStateValue) {
	c.view.data.startStateValues = append([]formula.ProcessStartStateValue(nil), values...)
}
func (c *ProcessChangeSet) BindEmpowered(index uint16, replaces bool, binding uint16) {
	c.view.data.hasEmpoweredAbility = true
	c.view.data.empoweredAbilityIndex = index
	c.view.data.replacesPrimary = replaces
	c.view.data.primaryReplacementBinding = binding
}
func (c *ProcessChangeSet) EnterStep(index int, step planbundle.CompiledProcessStep, now int64) {
	d := c.view.data
	d.stepIndex = index
	r := &d.snapshot
	r.StepVersion = index + 1
	r.StepKey = step.StepKey
	r.StepStartedAtMs = now
	r.AdvanceAtMs = now
	r.ExpiresAtMs = nil
	r.Repeat = nil
	r.StepExecutionIndex = 0
	r.LastExecutionAtMs = nil
	r.StepCompletedAtMs = nil
}
func (c *ProcessChangeSet) SetTiming(advance int64, expires *int64) {
	c.view.data.snapshot.AdvanceAtMs = advance
	c.view.data.snapshot.ExpiresAtMs = cloneOptional(expires)
}
func (c *ProcessChangeSet) SetRepeat(repeat *model.ProcessRepeatSnapshot) {
	if repeat == nil {
		c.view.data.snapshot.Repeat = nil
		return
	}
	copy := *repeat
	copy.NextExecutionAtMs = cloneOptional(copy.NextExecutionAtMs)
	c.view.data.snapshot.Repeat = &copy
}
func (c *ProcessChangeSet) ExecuteStep(now int64, alreadyCommitted bool) bool {
	r := &c.view.data.snapshot
	if r.StepCompletedAtMs != nil || !alreadyCommitted && r.Repeat == nil && r.StepExecutionIndex > 0 {
		return false
	}
	if !alreadyCommitted {
		r.StepExecutionIndex++
		r.LastExecutionAtMs = cloneOptional(&now)
	}
	return true
}
func (c *ProcessChangeSet) CompleteStep(now int64) bool {
	r := &c.view.data.snapshot
	if r.StepCompletedAtMs != nil {
		return false
	}
	r.StepCompletedAtMs = cloneOptional(&now)
	return true
}
func (c *ProcessChangeSet) Finish(status, reason string, now int64) {
	r := &c.view.data.snapshot
	r.Status = status
	r.FinishedAtMs = cloneOptional(&now)
	r.FailureReason = nil
	if status == "failed" {
		r.FailureReason = cloneOptional(&reason)
	}
	if r.Repeat != nil {
		r.Repeat.NextExecutionAtMs = nil
	}
}
func (c *ProcessChangeSet) AcceptRecast(advance, now int64, castID uint64, use string) {
	r := &c.view.data.snapshot
	r.StepExecutionIndex++
	r.LastExecutionAtMs = cloneOptional(&now)
	r.AdvanceAtMs = advance
	c.SetCast(castID, use)
}

func (p *ProcessView) OccupiesAction(owner string) bool {
	return p != nil && p.Owner() == owner && p.Status() == "active" && p.StepIndex() >= 0 && p.StepIndex() < len(p.Definition().Steps) && p.Definition().Steps[p.StepIndex()].OccupiesAction
}
func (p *ProcessView) ActionDeadline() int64 {
	if at := p.data.snapshot.ExpiresAtMs; at != nil {
		return *at
	}
	return p.AdvanceAtMs()
}
func (p *ProcessView) TimerAt() int64 {
	r := &p.data.snapshot
	if r.StepVersion == 0 {
		return r.StartedAtMs
	}
	if r.StepCompletedAtMs != nil {
		return *r.StepCompletedAtMs
	}
	if r.Repeat == nil && r.StepExecutionIndex > 0 && r.LastExecutionAtMs != nil && p.Definition().Steps[p.StepIndex()].StepType != "RECAST" {
		return *r.LastExecutionAtMs
	}
	if r.Repeat != nil && r.Repeat.NextExecutionAtMs != nil {
		return *r.Repeat.NextExecutionAtMs
	}
	if r.ExpiresAtMs != nil {
		return *r.ExpiresAtMs
	}
	return r.AdvanceAtMs
}
func (p *ProcessView) RepeatOffset(index int) int64 {
	repeat := p.data.snapshot.Repeat
	step := p.Definition().Steps[p.StepIndex()]
	if step.StepType == "MULTI_HIT" {
		return int64(index) * repeat.IntervalMs
	}
	if step.FirstExecution == "CUSTOM_WINDOW" {
		if repeat.ExecutionCount == 1 {
			return repeat.FirstExecutionOffsetMs
		}
		return repeat.FirstExecutionOffsetMs + ((repeat.LastExecutionOffsetMs-repeat.FirstExecutionOffsetMs)*int64(index)+int64(repeat.ExecutionCount-1)/2)/int64(repeat.ExecutionCount-1)
	}
	slot := index
	if step.FirstExecution == "AFTER_INTERVAL" {
		slot++
	}
	return int64(math.Round(float64(*p.data.snapshot.ExpiresAtMs-p.StepStartedAtMs()) * float64(slot) / float64(repeat.ExecutionCount)))
}
func (p *ProcessView) NextRepeatAt() int64 {
	return p.StepStartedAtMs() + p.RepeatOffset(p.RepeatIndex())
}
func ProcessLess(a, b *ProcessView) bool {
	if a.MountKey() != b.MountKey() {
		return a.MountKey() < b.MountKey()
	}
	return a.UseKey() < b.UseKey()
}

// State 持有运行中的行动身份；不把集合或可写过程返回给执行层。
type State struct {
	processes              []*ProcessView
	empoweredWaits         []*ProcessView
	manualActions          []*SkillActionView
	actionRegistry         []*SkillActionView
	actionsByUse           map[string]*SkillActionView
	currentAction          *SkillActionView
	automatic              *automaticSkillData
	uses                   map[string]*UseView
	basicAttack            *BasicAttackView
	ammo                   []*AmmoView
	basicAttackEventActive bool
	drivers                driverState
}

func (s *State) SetEmpoweredPredecessor(p *ProcessView, value *string) {
	p.data.snapshot.EmpoweredPredecessorUseRef = cloneOptional(value)
}
func (s *State) MarkEmpoweredResolved(p *ProcessView) { p.data.empoweredResolvedPublished = true }
func (s *State) ClearEmpoweredAttack(p *ProcessView)  { p.data.snapshot.EmpoweredAttack = nil }
func (s *State) ResolveEmpoweredMiss(p *ProcessView, index int, now int64) bool {
	window := p.data.snapshot.EmpoweredAttackWindow
	row := &window.Consumptions[index]
	if row.ResolvedAtMs != nil {
		return false
	}
	row.ResolvedAtMs = cloneOptional(&now)
	window.PendingHitCount--
	return true
}
func (s *State) InitSkillHitStages(p *ProcessView) {
	items := make([]model.ProcessSkillHitStage, 0)
	p.data.snapshot.SkillHitStages = &items
}
func (s *State) AppendSkillHitStage(p *ProcessView, stage model.ProcessSkillHitStage) {
	if p.data.snapshot.SkillHitStages != nil {
		*p.data.snapshot.SkillHitStages = append(*p.data.snapshot.SkillHitStages, stage)
	}
}
func (s *State) CompleteSkillHitStage(p *ProcessView, key string, contact, completed bool) {
	if p.data.snapshot.SkillHitStages == nil {
		return
	}
	items := *p.data.snapshot.SkillHitStages
	for index := len(items) - 1; index >= 0; index-- {
		if items[index].HitBindingKey == key {
			items[index].Contact, items[index].Completed = contact, completed
			return
		}
	}
}
func (s *State) ProcessViews() []*ProcessView       { return append([]*ProcessView(nil), s.processes...) }
func (s *State) EmpoweredCount() int                { return len(s.empoweredWaits) }
func (s *State) EmpoweredAt(index int) *ProcessView { return s.empoweredWaits[index] }
func (s *State) UpdateEmpoweredWait(p *ProcessView) {
	if !p.HasEmpoweredAbility() {
		return
	}
	index := -1
	for i, existing := range s.empoweredWaits {
		if existing == p {
			index = i
			break
		}
	}
	active := p.Status() == "active" && p.StepExecutionIndex() == 0 && p.StepKey() != "" && p.data.snapshot.ExpiresAtMs != nil
	if active && index < 0 {
		s.empoweredWaits = append(s.empoweredWaits, p)
	} else if !active && index >= 0 {
		s.empoweredWaits = append(s.empoweredWaits[:index], s.empoweredWaits[index+1:]...)
	}
}

func (s *State) ProcessCount() int                { return len(s.processes) }
func (s *State) ProcessAt(index int) *ProcessView { return s.processes[index] }
func (s *State) Process(ref contract.ProcessRef) *ProcessView {
	if !ref.Present || ref.Slot < 0 || ref.Slot >= len(s.processes) {
		return nil
	}
	return s.processes[ref.Slot]
}
func (s *State) AddProcess(p *ProcessView) {
	p.data.slot = len(s.processes)
	s.processes = append(s.processes, p)
}
func (s *State) ExportProcesses() []model.ProcessInstanceSnapshot {
	ordered := append([]*ProcessView(nil), s.processes...)
	if len(ordered) > 1 {
		sort.Slice(ordered, func(i, j int) bool {
			a, b := ordered[i], ordered[j]
			if a.MountKey() != b.MountKey() {
				return a.MountKey() < b.MountKey()
			}
			return a.UseKey() < b.UseKey()
		})
	}
	rows := make([]model.ProcessInstanceSnapshot, 0, len(ordered))
	for _, p := range ordered {
		rows = append(rows, p.Snapshot())
	}
	return rows
}
