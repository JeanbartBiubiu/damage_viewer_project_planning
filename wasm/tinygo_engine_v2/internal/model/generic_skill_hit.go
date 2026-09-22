package model

// 第5项 authoring-p5-r2：命中供值与法术护盾的共享 DTO 与资格矩阵。

const (
	OperationKindResolveSkillHit = "resolve_skill_hit"

	EventTypeSkillHit            = "event/skill_hit"
	EventTypeSpellShieldBlocked  = "event/spell_shield_blocked"
	ProviderTypeSpellShield      = "provider/spell_shield"
	ProviderTypeStatusPrefix     = "provider/status_"

	SkillHitHistoryComplete = "complete"
	SkillHitHistoryUnknown  = "unknown"

	SkillHitValueFirstContact = "first_contact"
	SkillHitValueBlocked      = "blocked"

	SpellShieldScopeSkill           = "SKILL"
	SpellShieldScopeEffect          = "EFFECT"
	SpellShieldScopeResult          = "RESULT"
	SpellShieldScopeDamageInstance  = "DAMAGE_INSTANCE"

	SkillHitResultDamage            = "DAMAGE"
	SkillHitResultAttributeChange   = "ATTRIBUTE_CHANGE"
	SkillHitResultResourceChange    = "RESOURCE_CHANGE"
	SkillHitResultCooldownChange    = "COOLDOWN_CHANGE"
	SkillHitResultStatusOperation   = "STATUS_OPERATION"
	SkillHitResultLifecycleOp       = "LIFECYCLE_OPERATION"
	SkillHitResultSpellShield       = "SPELL_SHIELD"
	SkillHitResultDamageModifier    = "DAMAGE_MODIFIER"
	SkillHitResultHealingModifier   = "HEALING_MODIFIER"
	SkillHitResultDamageImmunity    = "DAMAGE_IMMUNITY"
	SkillHitResultHealthFloor       = "HEALTH_FLOOR"

	SkillHitTargetTARGET = "TARGET"
	SkillHitTargetSOURCE = "SOURCE"
	SkillHitTargetSELF   = "SELF"

	SkillHitMomentInstant     = "INSTANT"
	SkillHitMomentPersistent  = "PERSISTENT"

	StatusOperationApply  = "APPLY"
	StatusOperationRemove = "REMOVE"

	StatusKindStun     = "stun"
	StatusKindRoot     = "root"
	StatusKindSilence  = "silence"
	StatusKindCharm    = "charm"
	StatusKindAirborne = "airborne"

	FormulaPathSkillHitFirstContact = "event.skill_hit.firstContact"
	FormulaPathSkillHitBlocked      = "event.skill_hit.blocked"
)

// ClosedStatusKindProviderType 将封闭控制种类映射到 provider 类型域身份。
// 普通减速复用第7项 statusContributions，不走此表。
var ClosedStatusKindProviderType = map[string]string{
	StatusKindStun:     ProviderTypeStatusPrefix + StatusKindStun,
	StatusKindRoot:     ProviderTypeStatusPrefix + StatusKindRoot,
	StatusKindSilence:  ProviderTypeStatusPrefix + StatusKindSilence,
	StatusKindCharm:    ProviderTypeStatusPrefix + StatusKindCharm,
	StatusKindAirborne: ProviderTypeStatusPrefix + StatusKindAirborne,
}

// SkillUseFact 是本 run 已核定使用事实。useKey 不是编译常量，也不是 castInstanceId。
type SkillUseFact struct {
	UseKey                  string   `json:"useKey"`
	Source                  string   `json:"source"`
	SkillKey                string   `json:"skillKey"`
	HistoryState            string   `json:"historyState"`
	PriorQualifiedContacts  []string `json:"priorQualifiedContacts,omitempty"`
}

// SkillHitFact 把单次 driver 入口映射到使用归属与同刻序号。
type SkillHitFact struct {
	DriverEntryKey string  `json:"driverEntryKey"`
	UseRef         *string `json:"useRef"`
	Sequence       *int    `json:"sequence"`
}

// SkillHitDefinition 是 resolve_skill_hit 的计划，无自由 payload 和静态 useKey。
type SkillHitDefinition struct {
	SkillKey   string                  `json:"skillKey"`
	Candidates []SkillHitCandidate     `json:"candidates"`
}

// SkillHitCandidate 是一次命中内按作者顺序排列的结果候选。
type SkillHitCandidate struct {
	CandidateKey             string                        `json:"candidateKey"`
	EffectOccurrenceKey      string                        `json:"effectOccurrenceKey"`
	EffectKey                string                        `json:"effectKey"`
	ResultKey                string                        `json:"resultKey"`
	Semantic                 SkillHitSemantic              `json:"semantic"`
	SpellShieldBlockScope    *string                       `json:"spellShieldBlockScope"`
	ParticipationCondition   *GenericFormulaExpr           `json:"participationCondition"`
	EventValueConditions     []SkillHitEventValueCondition `json:"eventValueConditions,omitempty"`
	Operations               []OperationDefinition         `json:"operations"`
}

// SkillHitSemantic 声明候选的真实结果身份，必须与 operations 对应。
type SkillHitSemantic struct {
	ResultType       string `json:"resultType"`
	Target           string `json:"target"`
	Moment           string `json:"moment"`
	StatusOperation  string `json:"statusOperation,omitempty"`
	StatusKey        string `json:"statusKey,omitempty"`
	StatusKind       string `json:"statusKind,omitempty"`
}

// SkillHitEventValueCondition 是固定 AND 集合的一条 0/1 源值比较。
type SkillHitEventValueCondition struct {
	Key        string             `json:"key"`
	Comparator string             `json:"comparator"`
	Value      GenericFormulaExpr `json:"value"`
}

// SpellShieldScopeAllowed 按资格矩阵返回该语义允许的非空范围。
// mustNull 为 true 时只能 null；unknown 时返回明确错误。
func SpellShieldScopeAllowed(sem SkillHitSemantic) (allowed map[string]struct{}, mustNull bool, errMsg string) {
	allowed = map[string]struct{}{}
	if sem.Target != SkillHitTargetTARGET {
		return allowed, true, ""
	}
	switch sem.ResultType {
	case SkillHitResultDamageModifier, SkillHitResultHealingModifier, SkillHitResultDamageImmunity, SkillHitResultHealthFloor, SkillHitResultSpellShield:
		return allowed, true, ""
	case SkillHitResultDamage:
		if sem.Moment == SkillHitMomentPersistent {
			return allowed, true, ""
		}
		allowed[SpellShieldScopeSkill] = struct{}{}
		allowed[SpellShieldScopeEffect] = struct{}{}
		allowed[SpellShieldScopeDamageInstance] = struct{}{}
		allowed[SpellShieldScopeResult] = struct{}{}
		return allowed, false, ""
	case SkillHitResultAttributeChange, SkillHitResultResourceChange, SkillHitResultCooldownChange, SkillHitResultLifecycleOp:
		if sem.Moment == SkillHitMomentPersistent {
			return allowed, true, ""
		}
		allowed[SpellShieldScopeSkill] = struct{}{}
		allowed[SpellShieldScopeEffect] = struct{}{}
		allowed[SpellShieldScopeResult] = struct{}{}
		return allowed, false, ""
	case SkillHitResultStatusOperation:
		if sem.Moment == SkillHitMomentPersistent {
			if sem.StatusOperation == StatusOperationApply {
				allowed[SpellShieldScopeResult] = struct{}{}
				return allowed, false, ""
			}
			return allowed, true, ""
		}
		allowed[SpellShieldScopeSkill] = struct{}{}
		allowed[SpellShieldScopeEffect] = struct{}{}
		allowed[SpellShieldScopeResult] = struct{}{}
		return allowed, false, ""
	default:
		return nil, false, "unknown skill hit resultType"
	}
}

// ValidateSpellShieldScope 检查声明范围是否合格。scope==nil 表示 null。
func ValidateSpellShieldScope(sem SkillHitSemantic, scope *string) string {
	allowed, mustNull, errMsg := SpellShieldScopeAllowed(sem)
	if errMsg != "" {
		return errMsg
	}
	if scope == nil || *scope == "" {
		return ""
	}
	if mustNull {
		return "spellShieldBlockScope must be null for this result"
	}
	if *scope == SpellShieldScopeDamageInstance && sem.ResultType != SkillHitResultDamage {
		return "DAMAGE_INSTANCE is only allowed on DAMAGE"
	}
	if _, ok := allowed[*scope]; !ok {
		return "spellShieldBlockScope is not eligible for this result"
	}
	return ""
}

// SemanticSelector 把语义 target 映射到现有 selector。
func SemanticSelector(target string) (string, bool) {
	switch target {
	case SkillHitTargetTARGET:
		return SelectorTarget, true
	case SkillHitTargetSOURCE:
		return SelectorSource, true
	case SkillHitTargetSELF:
		return SelectorSelf, true
	default:
		return "", false
	}
}

// ValidSkillHitComparator 是 eventValueConditions 允许的比较运算。
var ValidSkillHitComparator = map[string]struct{}{
	"eq": {}, "ne": {}, "lt": {}, "lte": {}, "gt": {}, "gte": {},
}

// CompareSkillHitValue 用 0/1 源值与右值比较。
func CompareSkillHitValue(comparator string, left, right float64) (bool, bool) {
	switch comparator {
	case "eq":
		return left == right, true
	case "ne":
		return left != right, true
	case "lt":
		return left < right, true
	case "lte":
		return left <= right, true
	case "gt":
		return left > right, true
	case "gte":
		return left >= right, true
	default:
		return false, false
	}
}

// ScopeCovers 判断已冻结单元是否覆盖另一非 null 候选。
func ScopeCovers(unitScope string, unitOccID uint64, unitEffectOcc, unitResult, unitCandidate string, unitUse string, candScope string, candOccID uint64, candEffectOcc, candResult, candCandidate, candUse string) bool {
	if candScope == "" {
		return true
	}
	switch unitScope {
	case SpellShieldScopeSkill:
		return unitUse == candUse
	case SpellShieldScopeEffect:
		return unitOccID == candOccID && unitEffectOcc != "" && unitEffectOcc == candEffectOcc
	case SpellShieldScopeResult:
		return unitOccID == candOccID && unitResult != "" && unitResult == candResult && unitCandidate == candCandidate
	case SpellShieldScopeDamageInstance:
		return unitOccID == candOccID && unitCandidate != "" && unitCandidate == candCandidate
	default:
		return false
	}
}
