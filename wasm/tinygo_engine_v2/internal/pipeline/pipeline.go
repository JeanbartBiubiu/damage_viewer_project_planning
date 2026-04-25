// 本文件定义 ValuePipeline 的 packet/result 骨架，统一 damage、heal、shield、resource、attribute 通道。
package pipeline

type Channel uint8

const (
	ChannelDamage Channel = iota + 1
	ChannelHeal
	ChannelShield
	ChannelResource
	ChannelAttribute
)

type DamagePacket struct {
	Source     uint8
	Target     uint8
	Amount     float64
	DamageType string
}

type HealPacket struct {
	Source uint8
	Target uint8
	Amount float64
}

type ShieldPacket struct {
	Source uint8
	Target uint8
	Amount float64
	Kind   string
}

type ResourcePacket struct {
	Source     uint8
	Target     uint8
	ResourceID string
	Delta      float64
}

type AttributePacket struct {
	Source      uint8
	Target      uint8
	AttributeID string
	Delta       float64
}

type Result struct {
	Channel Channel
	Applied bool
	Amount  float64
	Message string
}

func DamageResult(applied bool, amount float64) Result {
	return Result{Channel: ChannelDamage, Applied: applied, Amount: amount}
}

func HealResult(applied bool, amount float64) Result {
	return Result{Channel: ChannelHeal, Applied: applied, Amount: amount}
}

func ShieldResult(applied bool, amount float64) Result {
	return Result{Channel: ChannelShield, Applied: applied, Amount: amount}
}

func ResourceResult(applied bool, amount float64) Result {
	return Result{Channel: ChannelResource, Applied: applied, Amount: amount}
}

func AttributeResult(applied bool, amount float64) Result {
	return Result{Channel: ChannelAttribute, Applied: applied, Amount: amount}
}
