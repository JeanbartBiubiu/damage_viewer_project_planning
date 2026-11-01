package contract

// SkillHitFacts 是可交给事件消费者的有限命中事实，不含计划、候选或执行能力。
type SkillHitFacts struct {
	HasPlan             bool
	IsBasicAttack       bool
	AbilityRef          string
	HitSequence         *int
	RootDamageEvent     bool
	OccurrenceID        uint64
	UseRef              string
	SkillKey            string
	SourceKey           string
	TargetKey           string
	HasFirstContact     bool
	FirstContact        float64
	Blocked             float64
	UnitScope           string
	EffectOccurrenceKey string
	ResultKey           string
	CandidateKey        string
	ShieldOwner         string
	ShieldProviderRef   string
	ShieldDefinitionRef string
	ShieldSource        string
	ReusedSkillUnit     bool
}
