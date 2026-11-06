package listener

import (
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

// StateAPI 列出单场监听集合与施放节流能力；实际执行、共同额度和提交由父层协调。
type StateAPI interface {
	// ResetDynamic 清空动态监听绑定，不修改同场施放节流记录或复用已分配编号。
	ResetDynamic()
	// DynamicLen 返回当前动态监听数，不包含只读编译监听。
	DynamicLen() int
	// DynamicAt 借用指定序号的监听定义值；只在本次同步读取期间使用。
	DynamicAt(index int) planbundle.CompiledListener
	// FreezeDynamic 复制当前动态监听列表，后续绑定或移除不会改写该派发副本。
	FreezeDynamic() []planbundle.CompiledListener
	// Bind 按原序分配本场稳定负编号并绑定实际拥有者和挂载；编号不足时整批拒绝且不改变状态。
	// 空批次始终成功，不安装效果或执行监听。
	Bind(definitions []planbundle.CompiledListener, owner, providerRef string) bool
	// Unbind 按完整拥有者与挂载引用移除动态监听，保留其他成员原序。
	Unbind(owner, providerRef string)
	// Allow 按稳定监听编号与模拟时点查询施放节流资格，不修改记录；需要节流但缺少施放身份时拒绝。
	// 静态使用非负编译索引，动态使用本次绑定分配的负编号，派发列表压缩不改变身份。
	Allow(listenerIndex int, ownerCombatantKey, ownerProviderRef string, castInstanceID uint64, throttleMs int, nowMs int64) bool
	// Triggered 按与Allow相同的稳定编号记录成功时点，容量不足时按施放及绑定先后稳定淘汰。
	Triggered(listenerIndex int, ownerCombatantKey, ownerProviderRef string, castInstanceID uint64, nowMs int64)
	// OverflowWarning 返回本场实际淘汰次数的独立警告；未发生淘汰时返回缺失。
	OverflowWarning() *model.WarningItem
}

type dynamicListenerBinding struct {
	definition    planbundle.CompiledListener
	throttleIndex int
}

// State 私有持有本场动态监听与施放节流，不借用时钟、帧或效果集合。
type State struct {
	dynamic          []dynamicListenerBinding
	lastDynamicIndex int
	throttle         map[perCastThrottleKey]int64
	capacity         int
	overflowWarned   bool
	overflowCount    int
}

var _ StateAPI = (*State)(nil)

// New 按本场事件预算夹取施放节流容量，沿既有路径提前创建记录映射。
func New(maxEvents int) State {
	return State{throttle: make(map[perCastThrottleKey]int64), capacity: perCastThrottleCapacity(maxEvents)}
}

func (s *State) ResetDynamic() { s.dynamic = nil }

func (s *State) DynamicLen() int { return len(s.dynamic) }

func (s *State) DynamicAt(index int) planbundle.CompiledListener { return s.dynamic[index].definition }

func (s *State) FreezeDynamic() []planbundle.CompiledListener {
	if len(s.dynamic) == 0 {
		return nil
	}
	out := make([]planbundle.CompiledListener, len(s.dynamic))
	for index, binding := range s.dynamic {
		out[index] = binding.definition
	}
	return out
}

func (s *State) Bind(definitions []planbundle.CompiledListener, owner, providerRef string) bool {
	// 用目标int宽度的无符号差值计算剩余负编号；0处的模减法恰好保留全部负数空间。
	negativeSpace := (^uint(0) >> 1) + 1
	remaining := uint(s.lastDynamicIndex) - negativeSpace
	if uint(len(definitions)) > remaining {
		return false
	}
	for _, definition := range definitions {
		bound := definition
		bound.OwnerCombatantKey = owner
		bound.OwnerProviderRef = providerRef
		s.lastDynamicIndex--
		s.dynamic = append(s.dynamic, dynamicListenerBinding{definition: bound, throttleIndex: s.lastDynamicIndex})
	}
	return true
}

func (s *State) Unbind(owner, providerRef string) {
	if providerRef == "" || len(s.dynamic) == 0 {
		return
	}
	out := s.dynamic[:0]
	for _, binding := range s.dynamic {
		if binding.definition.OwnerProviderRef != providerRef || binding.definition.OwnerCombatantKey != owner {
			out = append(out, binding)
		}
	}
	s.dynamic = out
}
