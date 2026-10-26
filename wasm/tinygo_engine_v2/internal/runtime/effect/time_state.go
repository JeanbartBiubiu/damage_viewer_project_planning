package effect

// ExpiryPayload 与 AnchoredPayload 只保存稳定身份和版本，不含队列或执行控制。
type ExpiryPayload struct {
	TimingSlot       int
	StateGeneration  uint64
	CombatantKey     string
	ProviderRef      string
	ShieldRef        string
	Kind             string
	TargetKey        string
	StateKey         string
	ExpectedExpireAt int64
	CooldownVersion  uint64
}

type AnchoredPayload struct {
	Phased           bool
	TimingSlot       int
	OwnerKey         string
	ProviderRef      string
	SourceKey        string
	TargetKey        string
	AnchorStateKey   string
	Generation       uint64
	ExpectedExpireAt int64
}

// TimeState 拥有效果生命周期的负载与同刻终点事实，执行协调单独发布排程。
type TimeState struct {
	expiry   []ExpiryPayload
	anchored []AnchoredPayload
	terminal map[int64]int
}

func (s *TimeState) RegisterExpiry(payload ExpiryPayload) int {
	index := len(s.expiry)
	s.expiry = append(s.expiry, payload)
	return index
}
func (s *TimeState) RegisterAnchored(payload AnchoredPayload) int {
	index := len(s.anchored)
	s.anchored = append(s.anchored, payload)
	return index
}
func (s TimeState) ExpiryCount() int                     { return len(s.expiry) }
func (s TimeState) AnchoredCount() int                   { return len(s.anchored) }
func (s TimeState) ExpiryAt(index int) ExpiryPayload     { return s.expiry[index] }
func (s TimeState) AnchoredAt(index int) AnchoredPayload { return s.anchored[index] }
func (s TimeState) HasTerminals() bool                   { return len(s.terminal) != 0 }
func (s TimeState) TerminalCount(at int64) int           { return s.terminal[at] }
func (s *TimeState) AddTerminal(at int64) {
	if s.terminal == nil {
		s.terminal = make(map[int64]int)
	}
	s.terminal[at]++
}
func (s *TimeState) SetTerminalCount(at int64, count int) {
	if count == 0 {
		delete(s.terminal, at)
		return
	}
	if s.terminal == nil {
		s.terminal = make(map[int64]int)
	}
	s.terminal[at] = count
}
func (s *TimeState) DecrementTerminal(at int64) { s.SetTerminalCount(at, s.terminal[at]-1) }
func (s *TimeState) ClearTerminal(at int64)     { delete(s.terminal, at) }
