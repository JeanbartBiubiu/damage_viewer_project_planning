// 本文件定义 source-target 标记状态骨架，用于 Akali E 这类 apply/consume/remove 机制。
package mark

type Key struct {
	Source uint8
	Target uint8
	ID     string
}

type State struct {
	items map[Key]int64
}

func NewState() State {
	return State{items: make(map[Key]int64)}
}

func (s State) Apply(key Key, expireAt int64) {
	s.items[key] = expireAt
}

func (s State) Has(key Key, nowMs int64) bool {
	expireAt, ok := s.items[key]
	return ok && (expireAt == 0 || expireAt > nowMs)
}

func (s State) Consume(key Key, nowMs int64) bool {
	if !s.Has(key, nowMs) {
		return false
	}
	delete(s.items, key)
	return true
}
