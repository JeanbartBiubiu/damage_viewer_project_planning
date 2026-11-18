package effect

// ExpiryPayload 与 AnchoredPayload 只保存稳定身份和版本，不含队列或执行控制。
type ExpiryPayload struct {
	BeforeCombat     bool
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

// TimeStateAPI 列出生命周期载荷与同刻终点事实的登记能力；本类型不拥有时钟、队列或排程控制。
type TimeStateAPI interface {
	// RegisterExpiry 保存到期载荷并返回稳定下标，不负责排程。
	RegisterExpiry(payload ExpiryPayload) int
	// RegisterAnchored 保存锚定周期载荷并返回稳定下标，不负责排程。
	RegisterAnchored(payload AnchoredPayload) int
	// ExpiryCount 返回已经登记的到期载荷数。
	ExpiryCount() int
	// AnchoredCount 返回已经登记的锚定载荷数。
	AnchoredCount() int
	// ExpiryAt 按有效下标读取到期载荷值。
	ExpiryAt(index int) ExpiryPayload
	// AnchoredAt 按有效下标读取锚定载荷值。
	AnchoredAt(index int) AnchoredPayload
	// HasTerminals 判断是否存在同刻终点计数。
	HasTerminals() bool
	// TerminalCount 读取指定时刻的终点计数；缺失时返回0。
	TerminalCount(at int64) int
	// AddTerminal 增加指定时刻的终点计数。
	AddTerminal(at int64)
	// SetTerminalCount 设置指定时刻的终点计数；设为0时删除该时刻。
	SetTerminalCount(at int64, count int)
	// DecrementTerminal 减少指定时刻的终点计数，由调用方保证对应事实已经登记。
	DecrementTerminal(at int64)
	// ClearTerminal 清除指定时刻的终点事实。
	ClearTerminal(at int64)
}

// TimeState 拥有效果生命周期的负载与同刻终点事实，执行协调单独发布排程。
type TimeState struct {
	expiry   []ExpiryPayload
	anchored []AnchoredPayload
	terminal map[int64]int
}

var _ TimeStateAPI = (*TimeState)(nil)

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
