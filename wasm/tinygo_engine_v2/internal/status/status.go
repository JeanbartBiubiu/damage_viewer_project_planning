// 本文件定义状态实例骨架，用于后续拆分 buff、debuff、control、expire 等状态生命周期。
package status

type Kind uint8

const (
	KindGeneric Kind = iota + 1
	KindBuff
	KindDebuff
	KindControl
)

type Handle struct {
	Index      uint16
	Generation uint16
}

type Instance struct {
	Alive      bool
	Generation uint16
	Actor      uint8
	Def        uint16
	Kind       Kind
	AppliedAt  int64
	ExpireAt   int64
}

func (s Instance) Expired(nowMs int64) bool {
	return s.Alive && s.ExpireAt > 0 && s.ExpireAt <= nowMs
}
