// 本文件定义护盾 scope/刷新策略枚举；运行态实例见 instance.go。
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

// MatchesDamageType 判断护盾是否匹配伤害类型。
func MatchesDamageType(kind, damageType string) bool {
	return kind == "" || kind == "all" || kind == damageType
}
