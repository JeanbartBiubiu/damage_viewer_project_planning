// operation command 类型：damage/heal/shield/resource_change/cooldown_change/execute_threshold。
package command

// Kind 区分 operation command 类型。
type Kind string

const (
	KindDamage           Kind = "damage"
	KindHeal             Kind = "heal"
	KindShield           Kind = "shield"
	KindResourceChange   Kind = "resource_change"
	KindCooldownChange   Kind = "cooldown_change"
	KindApplyProvider    Kind = "apply_provider"
	KindRefreshProvider  Kind = "refresh_provider"
	KindExpireProvider   Kind = "expire_provider"
	KindEmitEvent        Kind = "emit_event"
	KindExecuteThreshold Kind = "execute_threshold"
)

// Command 是 pipeline 输入的统一 command DTO。
type Command struct {
	Kind         Kind
	Source       string
	Target       string
	Amount       float64
	DamageType   string
	ValuePolicy  string
	Ref          string
	ResourceKey  string
	AttributeKey string
	AbilityRef   string
	// Threshold / SnapshotHP / SnapshotMaxHP：execute_threshold 元数据（pipeline 仅用 Target 置零 HP）。
	Threshold     float64
	SnapshotHP    float64
	SnapshotMaxHP float64
}

// Result 是单条 command 执行结果。
type Result struct {
	Kind    Kind
	Applied bool
	Amount  float64
	Message string
}

func New(kind Kind, source, target string, amount float64) Command {
	return Command{Kind: kind, Source: source, Target: target, Amount: amount}
}

func Validate(cmd Command) bool {
	switch cmd.Kind {
	case KindDamage, KindHeal, KindShield:
		return cmd.Target != "" && cmd.Amount >= 0
	case KindResourceChange:
		return cmd.Target != "" && cmd.ResourceKey != ""
	case KindCooldownChange:
		return cmd.Target != "" && cmd.AbilityRef != ""
	case KindExecuteThreshold:
		return cmd.Target != ""
	default:
		return cmd.Kind != ""
	}
}
