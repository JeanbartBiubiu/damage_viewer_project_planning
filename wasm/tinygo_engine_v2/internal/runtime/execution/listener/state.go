package listener

import (
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

// StateAPI 列出单场监听集合与施放节流能力；实际执行、共同额度和提交由父层协调。
type StateAPI interface {
	// ResetDynamic 清空动态监听绑定，不修改同场施放节流记录。
	ResetDynamic()
	// DynamicLen 返回当前动态监听数，不包含只读编译监听。
	DynamicLen() int
	// DynamicAt 借用指定序号的监听定义值；只在本次同步读取期间使用。
	DynamicAt(index int) planbundle.CompiledListener
	// FreezeDynamic 复制当前动态监听列表，后续绑定或移除不会改写该派发副本。
	FreezeDynamic() []planbundle.CompiledListener
	// Bind 按定义原序绑定实际拥有者和挂载引用，不安装效果或执行监听。
	Bind(definitions []planbundle.CompiledListener, owner, providerRef string)
	// Unbind 按完整拥有者与挂载引用移除动态监听，保留其他成员原序。
	Unbind(owner, providerRef string)
	// Allow 按给定模拟时点查询施放节流资格，不修改记录；需要节流但缺少施放身份时拒绝。
	Allow(listenerIndex int, ownerCombatantKey, ownerProviderRef string, castInstanceID uint64, throttleMs int, nowMs int64) bool
	// Triggered 记录已成功触发监听的实际时点，容量不足时按既有稳定顺序淘汰旧施放。
	Triggered(listenerIndex int, ownerCombatantKey, ownerProviderRef string, castInstanceID uint64, nowMs int64)
	// OverflowWarning 返回本场实际淘汰次数的独立警告；未发生淘汰时返回缺失。
	OverflowWarning() *model.WarningItem
}

// State 私有持有本场动态监听与施放节流，不借用时钟、帧或效果集合。
type State struct {
	dynamic        []planbundle.CompiledListener
	throttle       map[perCastThrottleKey]int64
	capacity       int
	overflowWarned bool
	overflowCount  int
}

var _ StateAPI = (*State)(nil)

// New 按本场事件预算夹取施放节流容量，沿既有路径提前创建记录映射。
func New(maxEvents int) State {
	return State{throttle: make(map[perCastThrottleKey]int64), capacity: perCastThrottleCapacity(maxEvents)}
}

func (s *State) ResetDynamic() { s.dynamic = nil }

func (s *State) DynamicLen() int { return len(s.dynamic) }

func (s *State) DynamicAt(index int) planbundle.CompiledListener { return s.dynamic[index] }

func (s *State) FreezeDynamic() []planbundle.CompiledListener {
	return append([]planbundle.CompiledListener(nil), s.dynamic...)
}

func (s *State) Bind(definitions []planbundle.CompiledListener, owner, providerRef string) {
	for _, definition := range definitions {
		bound := definition
		bound.OwnerCombatantKey = owner
		bound.OwnerProviderRef = providerRef
		s.dynamic = append(s.dynamic, bound)
	}
}

func (s *State) Unbind(owner, providerRef string) {
	if providerRef == "" || len(s.dynamic) == 0 {
		return
	}
	out := s.dynamic[:0]
	for _, definition := range s.dynamic {
		if definition.OwnerProviderRef != providerRef || definition.OwnerCombatantKey != owner {
			out = append(out, definition)
		}
	}
	s.dynamic = out
}
