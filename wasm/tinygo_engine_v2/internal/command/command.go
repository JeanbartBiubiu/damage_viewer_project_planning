// 本文件定义 trigger 产出的 command 骨架，后续所有机制改动都应回流到 resolver 统一处理。
package command

type Kind uint8

const (
	KindDamage Kind = iota + 1
	KindHeal
	KindShield
	KindResource
	KindAttribute
)

type Command struct {
	ID      uint32
	Kind    Kind
	Source  uint8
	Target  uint8
	Amount  float64
	Channel string
	AttrID  string
}

type Result struct {
	CommandID uint32
	Kind      Kind
	Applied   bool
	Amount    float64
	Message   string
}

func New(kind Kind, source uint8, target uint8, amount float64) Command {
	return Command{Kind: kind, Source: source, Target: target, Amount: amount}
}

func Validate(cmd Command) bool {
	return cmd.Kind != 0 && cmd.Amount >= 0
}
