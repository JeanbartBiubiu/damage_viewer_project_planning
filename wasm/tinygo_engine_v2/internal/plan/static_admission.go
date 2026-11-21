package plan

// StaticAdmissionFacts 保存最终编译计划中需要跨对象索引的运行准入事实。
// 单个定义即可携带的事实随定义保存。
type StaticAdmissionFacts struct {
	spellShields   map[string]CompiledListener
	settledHeals   map[SettledHealAdmissionKey]bool
	mountedSources map[StaticSourceMountKey][]uint16
	expiryWrites   map[string]map[int]struct{}
}

type StaticSourceMountKey struct {
	Owner, Reference string
}

type SettledHealAdmissionKey struct {
	AbilityIndex   int
	OperationIndex int
}

type StaticModifierAdmissionFacts struct {
	FiniteFinalAttribute    bool
	StaticIncomingReduction bool
	GroupedDamageSource     bool
}

type StaticListenerAdmissionFacts struct {
	PassiveSkillHit         bool
	SettledDamageHeal       bool
	OwnAttackCooldownSet    bool
	OwnSkillCooldownSet     bool
	LinkedShieldInitializer bool
	ExpiryDamageListener    bool
}

type StaticProviderAdmissionFacts struct {
	StateExpiry           bool
	CooldownExpirySource  bool
	CooldownExpiryClosure bool
}

type PassiveProcessAdmission uint8

const (
	PassiveProcessOutsideProvider PassiveProcessAdmission = iota
	PassiveProcessMissingProcess
	PassiveProcessInvalidEntry
	PassiveProcessComplete
)

// NewStaticAdmissionFacts 接收编译器构建的事实表，之后只通过查询方法借用。
func NewStaticAdmissionFacts(
	spellShields map[string]CompiledListener,
	settledHeals map[SettledHealAdmissionKey]bool,
	mountedSources map[StaticSourceMountKey][]uint16,
	expiryWrites map[string]map[int]struct{},
) StaticAdmissionFacts {
	return StaticAdmissionFacts{spellShields: spellShields, settledHeals: settledHeals, mountedSources: mountedSources, expiryWrites: expiryWrites}
}

// SpellShieldInitializer 返回该定义唯一获准的实际挂载监听。
func (facts StaticAdmissionFacts) SpellShieldInitializer(definition string) (CompiledListener, bool) {
	listener, found := facts.spellShields[definition]
	return listener, found
}

// SettledEventHeal 查询操作在该能力参数上下文中是否符合静态自疗公式约束。
func (facts StaticAdmissionFacts) SettledEventHeal(ability, operation int) bool {
	return facts.settledHeals[SettledHealAdmissionKey{AbilityIndex: ability, OperationIndex: operation}]
}

// HasMountedDefinition 核对已编译挂载的完整身份，同一引用可能对应多个定义。
func (facts StaticAdmissionFacts) HasMountedDefinition(owner, reference string, definition int) bool {
	for _, index := range facts.mountedSources[StaticSourceMountKey{Owner: owner, Reference: reference}] {
		if int(index) == definition {
			return true
		}
	}
	return false
}

// ExpiryStateWrites 核对实际来源定义与该监听构成的到期状态写入闭包。
func (facts StaticAdmissionFacts) ExpiryStateWrites(definition string, listenerIndex int) bool {
	_, found := facts.expiryWrites[definition][listenerIndex]
	return found
}
