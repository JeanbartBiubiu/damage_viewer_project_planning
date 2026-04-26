// 本文件定义护盾实例骨架，表达 shield scope、刷新策略、优先级和伤害类型匹配。
package shield

type Scope uint8

const (
	ScopeAll Scope = iota + 1
	ScopePhysical
	ScopeMagic
	ScopeTrue
)

type RefreshPolicy uint8

const (
	RefreshStack RefreshPolicy = iota + 1
	RefreshReplace
	RefreshKeepHigher
)

type Instance struct {
	Alive      bool
	Generation uint16
	Actor      uint8
	Kind       string
	Amount     float64
	ExpireAt   int64
	Priority   int16
	Policy     RefreshPolicy
}

func (s Instance) Matches(damageType string) bool {
	return s.Kind == "" || s.Kind == "all" || s.Kind == damageType
}
