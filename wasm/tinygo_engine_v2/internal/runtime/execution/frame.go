package execution

import (
	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	"tinygo_engine_v2/internal/runtime/actor"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

type stagedProviderMutation struct {
	projected       bool
	useRef          string
	definitionIndex uint16 // shield_apply is already bound by the compiler
	evidenceKind    model.EvidenceKind
	kind            string
	providerRef     string
	definitionRef   string
	targetKey       string
	sourceKey       string
	shieldAmount    float64
	shieldRef       string
	shieldPriority  int16
	expireAt        int64
	hasExpireAt     bool
	strict          bool
	contributions   effectpkg.ContributionView
}

type stagedCombatant struct {
	instances effectpkg.InstanceChangeSet
	numbers   actor.ChangeSet

	resourceBatchContributors []model.ResourceChangeContributor
	// 属性视图可供入口、事件和live读取；真正写入前才取得独占副本。

	cooldownsShared bool

	cooldowns *actionpkg.CooldownLedger

	providerOps   []stagedProviderMutation
	providerState effectpkg.BagChangeSet

	dirty bool
}

// FrameAPI 只向公式求值暴露已获准的战斗事实读取能力。
type FrameAPI interface {
	// DamageStateBefore 读取原始本来源伤害实例冻结的指定状态值；缺少声明事实时返回错误。
	DamageStateBefore(key string) (float64, error)
	// LinkedShieldPresent 查询当前帧投影中本来源关联盾是否有效，返回0或1；绑定非法时返回错误。
	LinkedShieldPresent(index uint16) (float64, error)
	// ReceivedLinkedShieldAbsorbed 读取原始受伤事件中指定自身关联盾的实际吸收额；因果不完整时返回错误。
	ReceivedLinkedShieldAbsorbed(index uint16) (float64, error)
}

// Frame 拥有单次操作的暂存投影与待提交事实，提交仍由执行协调统一完成。
type Frame struct {
	readsDamageStateBefore         bool
	pendingTargetMark              model.TargetMarkSummary
	projectedLifecycles            []projectedProviderLifecycle
	flushingDynamicProviders       bool
	dynamicProviderDirty           bool
	dynamicExpiryChecked           bool
	pendingResourceChanges         []model.ResourceChangeRecord
	empowered                      *empoweredFrame
	empoweredAttack                *model.ProcessEmpoweredAttack
	pendingAutomaticWake           bool
	pendingBasicAttackCooldownWake bool
	pendingCooldownAttempts        []pendingCooldownAttempt
	pendingAmmoWaits               []pendingAmmoRecovery
	pendingAmmoCapture             *ammoUseCapture
	pendingMechanicRecords         []model.MechanicRecord
	pendingBasicAttackWait         *actionpkg.AttackWaitView
	pendingActionWait              bool
	processUseKey                  string
	processCastPhase               string
	recastExecutionCommitted       bool
	processUseSkillKey             string
	processUseSource               string
	damageDefenseContext           *formula.GenericEvalContext
	processActualCosts             model.NumericView
	processCostReadable            bool
	processMomentKind              string
	run                            *Engine
	frameID                        uint64
	sourceKey                      string
	targetKey                      string
	abilityRef                     string
	ownerCombatantKey              string // mounted provider owner; distinct from event/op sourceKey
	ownerProviderRef               string
	mountedListener                bool
	strictReads                    bool

	// castInstanceID / castOrigin：同一次施放的身份与来源；多 op / delayed / listener ops 继承。
	castInstanceID uint64
	castOrigin     string

	staged *frameStagedCollection

	// entry_*：本 frame 创建时、cost/CD/operations 前的不可变深拷贝（供本 frame 后续 emit 使用）。
	entrySourceAttrs     attribute.Table
	entryTargetAttrs     attribute.Table
	entrySourceResources model.ResourceView
	entryTargetResources model.ResourceView

	// eventCtx：listener / child ability 继承的原始 event 快照；nil 表示无 event context。
	eventCtx *eventFormulaSnapshot

	damageDealt  float64
	healingDone  float64
	commandCount int
	chainDepth   int
	// rootSkillHitDamage 仅由本次根 resolve_skill_hit 的候选继承，不能由监听或旧命中上下文推导。
	rootSkillHitDamage bool
	fatal              bool
	fatalErr           *model.EngineError

	pendingEvents []emittedEvent

	// copyableCollector：单次 emitted event / dispatchListeners 局部上下文；禁止挂到 Engine。
	copyableCollector *eventCopyableCollector

	// damageAggregation 收集本根帧或合格根命中候选的正数伤害，类型身份来自实际作者操作。
	damageAggregation frameDamageAggregation

	// consumedFirstPerCast tracks first_per_cast pipeline modifiers already applied in this cast/frame.
	// Key: ownerCombatantKey + "\x00" + providerRef + "\x00" + modifierKey.
	consumedFirstPerCast map[string]bool

	driverEntryKey        string
	skipBlockedWrites     bool
	skillHitCandidateKey  string
	skillHitOccurrenceID  uint64
	operationOutputs      map[string]formula.OperationOutputValues
	pendingShieldExpires  []pendingShieldExpire
	committed             bool
	pendingEvidence       []model.EvidenceItem
	pendingEvidenceKinds  []model.EvidenceKind
	pendingSkillHits      []committedSkillActionHit
	pendingDamage         []genericDamageEvidence
	pendingDirectHealing  []model.DirectHealingRecord
	pendingDamageHistory  []damageRecord
	pendingOverheal       map[string]float64
	pendingDamageIDs      uint64
	pendingCopyable       []copyableDamageFrozen
	pendingRepeats        []deferredRepeatRequest
	pendingStateExpiry    []pendingFrameStateExpiry
	pendingAnchoredTicks  []pendingFrameAnchoredTick
	pendingProviderTick   *pendingFrameProviderTick
	providerDefinitionRef string
	providerActivatedAtMs *int64
	damageOwnerKey        string
	pendingProcess        *actionpkg.ProcessView
	processChanges        *actionpkg.ProcessChangeSet
	processOriginal       *actionpkg.ProcessView
	processIsNew          bool
	pendingProcessTimer   bool
	countCastOnCommit     bool
	castStatRef           string
	statRef               string
}

var _ FrameAPI = (*Frame)(nil)

func (s *Engine) initExecutionFrame(f *Frame, sourceKey, targetKey, abilityRef string) {
	s.nextFrameID++
	*f = Frame{
		run:        s,
		frameID:    s.nextFrameID,
		sourceKey:  sourceKey,
		targetKey:  targetKey,
		abilityRef: abilityRef,
		staged:     &frameStagedCollection{},
	}
	f.captureEntrySnapshots()
}

func (f *Frame) stageFor(key string) *stagedCombatant {
	if sc, ok := f.staged.Lookup(key); ok {
		return sc
	}
	base, ok := f.run.combatants[key]
	if !ok {
		sc := &stagedCombatant{numbers: actor.Stage(actor.New(key, attribute.Table{},
			nil)), cooldowns: actionpkg.NewCooldownLedger(),
		}
		f.staged.Set(key, sc)
		return sc
	}
	// 帧只读取已挂载列表；真正的挂载、刷新和移除由运行态写口取得独占列表。

	stateView := effectpkg.StageBags(&base.providerState)

	f.run.combatants[key] = base
	sc := &stagedCombatant{instances: effectpkg.StageInstances(base.instances, f.run.loop.TimeMs()), numbers: actor.Stage(base.numbers),

		cooldowns:       base.cooldowns,
		cooldownsShared: true,

		providerState: stateView,
	}
	f.staged.Set(key, sc)
	return sc
}

func (s *stagedCombatant) writableCooldowns() *actionpkg.CooldownLedger {
	if s.cooldownsShared {
		s.cooldowns = s.cooldowns.Clone()
		s.cooldownsShared = false
	} else if s.cooldowns == nil {
		s.cooldowns = actionpkg.NewCooldownLedger()
	}
	return s.cooldowns
}

func (s *stagedCombatant) readonlyCooldowns() *actionpkg.CooldownLedger {
	s.cooldownsShared = true
	return s.cooldowns
}
