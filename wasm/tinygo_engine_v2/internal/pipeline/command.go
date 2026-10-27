// operation command 类型：damage/heal/shield/resource_change/cooldown_change/execute_threshold。
package pipeline

// CommandKind 区分 operation command 类型。
type CommandKind string

const (
	KindDamage           CommandKind = "damage"
	KindHeal             CommandKind = "heal"
	KindShield           CommandKind = "shield"
	KindResourceChange   CommandKind = "resource_change"
	KindCooldownChange   CommandKind = "cooldown_change"
	KindApplyProvider    CommandKind = "apply_provider"
	KindRefreshProvider  CommandKind = "refresh_provider"
	KindExpireProvider   CommandKind = "expire_provider"
	KindEmitEvent        CommandKind = "emit_event"
	KindExecuteThreshold CommandKind = "execute_threshold"
)

// Command 是 pipeline 输入的统一 command DTO。
type Command struct {
	Kind         CommandKind
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

// CommandResult 是单条 command 执行结果。
type CommandResult struct {
	Kind    CommandKind
	Applied bool
	Amount  float64
	Message string
}

func NewCommand(kind CommandKind, source, target string, amount float64) Command {
	return Command{Kind: kind, Source: source, Target: target, Amount: amount}
}

func ValidateCommand(cmd Command) bool {
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
