// 本文件定义计数器状态骨架，支持 actor、pair、global 不同作用域的机制计数。
package counter

type Scope uint8

const (
	ScopeActor Scope = iota + 1
	ScopePair
	ScopeGlobal
)

type Key struct {
	Scope  Scope
	Actor  uint8
	Source uint8
	Target uint8
	Name   string
}

type State struct {
	Values map[Key]float64
}

func NewState() State {
	return State{Values: make(map[Key]float64)}
}

func (s State) Get(key Key) float64 {
	return s.Values[key]
}

func (s State) Add(key Key, delta float64) float64 {
	next := s.Values[key] + delta
	s.Values[key] = next
	return next
}

func (s State) Reset(key Key) {
	delete(s.Values, key)
}
