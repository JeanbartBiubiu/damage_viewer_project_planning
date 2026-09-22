package model

// 吸血种类采用固定结算顺序；缺省规则不启用吸血。
const (
	VampLifeSteal    = "LIFE_STEAL"
	VampOmnivamp     = "OMNIVAMP"
	VampPhysical     = "PHYSICAL_VAMP"
	VampSpell        = "SPELL_VAMP"
	VampResolved     = "RESOLVED"
	VampUnresolved   = "UNRESOLVED"
	VampDisabled     = "DISABLED"
	VampOverride     = "OVERRIDE"
	VampPostDefense  = "POST_DEFENSE_DAMAGE"
	VampActualHPLoss = "ACTUAL_HP_LOSS"
	HealDone         = "DONE"
	HealReceived     = "RECEIVED"
	HealAny          = "ANY"
	HealVamp         = "VAMP"
	HealDirect       = "DIRECT"
)

var VampTypeOrder = [...]string{VampLifeSteal, VampOmnivamp, VampPhysical, VampSpell}

// VampRuleDefinition 在游戏规则中保存一次；三个匹配器分别约束目标、技能与伤害。
type VampRuleDefinition struct {
	VampType           string      `json:"vampType"`
	SourceAttributeKey string      `json:"sourceAttributeKey"`
	BasisOutputKind    string      `json:"basisOutputKind"`
	DefaultEfficiency  *float64    `json:"defaultEfficiency"`
	TargetMatcher      TypeMatcher `json:"targetMatcher"`
	AbilityMatcher     TypeMatcher `json:"abilityMatcher"`
	DamageMatcher      TypeMatcher `json:"damageMatcher"`
}

// VampOverrideDefinition 仅保存禁止或确有依据的技能例外。
type VampOverrideDefinition struct {
	VampType        string              `json:"vampType"`
	Mode            string              `json:"mode"`
	BasisOutputKind string              `json:"basisOutputKind,omitempty"`
	Efficiency      *GenericFormulaExpr `json:"efficiency,omitempty"`
}
