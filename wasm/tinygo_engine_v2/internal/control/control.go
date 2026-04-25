// 本文件定义控制指令骨架，用于表达 action gate、interrupt 和 immunity 等控制效果。
package control

type Directive uint8

const (
	DirectiveBlockAction Directive = iota + 1
	DirectiveInterrupt
	DirectiveImmunity
)

type Instance struct {
	Directive Directive
	Actor     uint8
	Source    uint8
	ExpireAt  int64
}

func BlocksAction(items []Instance, actor uint8, nowMs int64) bool {
	for _, item := range items {
		if item.Actor == actor && item.Directive == DirectiveBlockAction && (item.ExpireAt == 0 || item.ExpireAt > nowMs) {
			return true
		}
	}
	return false
}
