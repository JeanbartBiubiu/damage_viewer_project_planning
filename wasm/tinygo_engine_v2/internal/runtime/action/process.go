package action

import (
	"math"
	"sort"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/runtime/contract"
)

// ProcessView 是不可写的活借用，原过程发布后可读到新值；保存历史须使用Freeze或Snapshot。
type ProcessView struct{ data *processData }

type processData struct {
	snapshot                                    model.ProcessInstanceSnapshot
	slot                                        int
	definition                                  *planbundle.CompiledProcess
	ability                                     planbundle.CompiledAbility
	abilityRef, mountKey, stableKey, castUseKey string
	stepIndex                                   int
	castID                                      uint64
	startStateValues                            []formula.ProcessStartStateValue
	empoweredAbilityIndex                       uint16
	hasEmpoweredAbility, replacesPrimary        bool
	primaryReplacementBinding                   uint16
	empoweredResolvedPublished                  bool
}

type ProcessSeed struct {
	Snapshot                  model.ProcessInstanceSnapshot
	Definition                *planbundle.CompiledProcess
	Ability                   planbundle.CompiledAbility
	AbilityRef                string
	StepIndex                 int
	CastID                    uint64
	CastUseKey                string
	HasEmpoweredAbility       bool
	EmpoweredAbilityIndex     uint16
	ReplacesPrimary           bool
	PrimaryReplacementBinding uint16
}

// ProcessChangeSetAPI 列出单个过程的独占暂存能力；发布只更新该过程，不承担跨子系统提交。
type ProcessChangeSetAPI interface {
	// View 借用本次暂存过程的活视图；需要历史事实时另取Freeze或Snapshot。
	View() *ProcessView
	// Publish 将暂存状态发布到原过程并保留原槽位；旧活视图随后能看到新状态。
	Publish(original *ProcessView)
	// SetCast 暂存本次施放身份与使用引用。
	SetCast(id uint64, use string)
	// SetCooldownStarted 标记该过程已开始普通冷却，不直接修改冷却账本。
	SetCooldownStarted()
	// SetActualCost 保存已由执行层核定的实际资源成本。
	SetActualCost(key string, value float64)
	// SetStartStateValues 复制并保存过程开始时冻结的状态值。
	SetStartStateValues(values []formula.ProcessStartStateValue)
	// EnterStep 进入指定步骤并初始化本步骤版本、起点与执行计数。
	EnterStep(index int, step planbundle.CompiledProcessStep, now int64)
	// SetTiming 保存推进时刻和可选期限；复制期限值，不负责入队。
	SetTiming(advance int64, expires *int64)
	// SetRepeat 复制周期执行快照；nil表示清除本步骤重复安排。
	SetRepeat(repeat *model.ProcessRepeatSnapshot)
	// ExecuteStep 核对未完成与执行次数后标记实际执行；alreadyCommitted避免重复计数。
	ExecuteStep(now int64, alreadyCommitted bool) bool
	// CompleteStep 首次标记步骤完成时刻，重复完成返回false。
	CompleteStep(now int64) bool
	// Finish 暂存过程结束状态、时刻和失败原因，并清除后续重复执行时刻。
	Finish(status, reason string, now int64)
	// AcceptRecast 记录一次已接受重施的执行序号、时刻及新施放身份。
	AcceptRecast(advance, now int64, castID uint64, use string)
	// EnterEmpowered 进入强化等待步骤，保存期限并按定义创建多次消费窗口。
	EnterEmpowered(step planbundle.CompiledProcessStep, now, deadline int64)
	// SetEmpoweredAttack 复制强化攻击关联；nil表示清除关联。
	SetEmpoweredAttack(association *model.ProcessEmpoweredAttack)
	// ReserveEmpowered 为真实使用和目标预留一次强化消费；额度不足时返回false。
	ReserveEmpowered(use, target string, now int64) (int, bool)
	// ResolveEmpowered 填写预留消费的实际命中身份、序号与结算时刻，并减少待命中数。
	ResolveEmpowered(index int, now int64, hit string, sequence int)
	// ReconcileOccupancy 根据前后步骤同步占用区间；历史占用不匹配时返回false。
	ReconcileOccupancy(previous *ProcessView, now int64) bool
	// AdvanceRepeat 仅在预定时刻推进重复序号；分别返回是否继续等待及本次是否有效。
	AdvanceRepeat(now int64) (bool, bool)
}

type ProcessChangeSet struct{ view ProcessView }

// StateAPI 列出行动、过程、使用和驱动事实的公开能力；状态仍由具体类型独占。
type StateAPI interface {
	// BindAmmo 为弹药视图绑定实际目标、能力引用与已编译能力。
	BindAmmo(a *AmmoView, target, ref string, ability planbundle.CompiledAbility)
	// AddAmmo 登记弹药状态，保留原有登记顺序。
	AddAmmo(a *AmmoView)
	// AmmoCount 返回已登记弹药状态的数量。
	AmmoCount() int
	// AmmoAt 按有效下标借用弹药活视图。
	AmmoAt(index int) *AmmoView
	// PublishAmmoWait 发布该弹药的局部等待事实，不负责向调度器入队。
	PublishAmmoWait(a *AmmoView, wait AmmoWait)
	// RemoveAmmoProvider 移除指定拥有者和供值器关联的弹药状态。
	RemoveAmmoProvider(owner, provider string)
	// InitAutomatic 初始化本场自动行动的规则、索引和计数。
	InitAutomatic()
	// AddAutomaticRule 复制规则输入并登记自动行动及自身冷却依赖。
	AddAutomaticRule(seed AutomaticRuleSeed)
	// HasAutomatic 判断本场是否已初始化自动行动。
	HasAutomatic() bool
	// AutomaticCount 返回自动规则数；未初始化时返回0。
	AutomaticCount() int
	// AutomaticAt 按有效下标借用自动规则活视图。
	AutomaticAt(index int) *AutomaticRuleView
	// AutomaticByKey 按规则键借用自动规则；未命中时返回nil。
	AutomaticByKey(key string) *AutomaticRuleView
	// SortAutomaticRules 按作者优先级原地排列自动规则。
	SortAutomaticRules()
	// LinkAutomaticDependency 为自动规则追加已选规则的能力冷却依赖。
	LinkAutomaticDependency(rule, dependency *AutomaticRuleView)
	// LinkAutomaticQualification 关联唯一前后规则及其一次性释放资格归属。
	LinkAutomaticQualification(rule, parent *AutomaticRuleView)
	// LinkAutomaticRules 建立冷却和资格关联并检查引用与环；失败返回字段路径和原因。
	LinkAutomaticRules() (string, string)
	// AutomaticGeneration 读取自动调度世代；未初始化时返回0。
	AutomaticGeneration() uint64
	// NextAutomaticGeneration 推进并返回自动调度世代，使旧排程可被识别。
	NextAutomaticGeneration() uint64
	// RegisterAutomaticWait 向唯一冷却账本登记规则等待；重施窗口不等待普通冷却依赖。
	RegisterAutomaticWait(rule *AutomaticRuleView, ledger *CooldownLedger, notBefore, now int64, recast bool) CooldownWait
	// NewAutomaticAction 创建一次自动尝试并绑定使用身份，累计尝试数。
	NewAutomaticAction(rule *AutomaticRuleView, now int64) *SkillActionView
	// RecordAutomaticReject 分别累计开始前中止或普通拒绝次数。
	RecordAutomaticReject(rule *AutomaticRuleView, aborted bool)
	// AutomaticStarted 记录实际开始，消费已有前序资格，并返回实际转换记录。
	AutomaticStarted(a *SkillActionView, process *ProcessView) []model.AutomaticSkillRecord
	// AutomaticFinished 首次记录自动过程成功或失败；成功时按规则授予后继一次资格。
	AutomaticFinished(a *SkillActionView, process *ProcessView) []model.AutomaticSkillRecord
	// AutomaticWaiting 更新规则等待摘要，仅在等待内容变化时返回记录和true。
	AutomaticWaiting(rule *AutomaticRuleView, reason string, related []string, at, now int64) (model.AutomaticSkillRecord, bool)
	// AutomaticSummary 汇总规则、资格和使用统计；未初始化时返回nil，并更新在途计数。
	AutomaticSummary() (*model.AutomaticSkillSummary, *model.SkillUseSummary)
	// InitBasicAttack 按准备好的计划、初始能力和依赖建立普通攻击状态。
	InitBasicAttack(seed BasicAttackSeed)
	// BasicAttack 借用当前普通攻击活视图；未初始化时返回nil。
	BasicAttack() *BasicAttackView
	// SetBasicAmmo 替换当前普通攻击绑定的弹药视图。
	SetBasicAmmo(ammo *AmmoView)
	// BindPrimary 绑定普通攻击的真实主命中候选、计划和来源身份。
	BindPrimary(index int, plan *planbundle.CompiledSkillHit, identity model.BasicAttackPrimaryIdentity)
	// CommitPrimaryReplacement 按实际绑定和目标累计普通攻击替换的已提交数值事实。
	CommitPrimaryReplacement(row model.BasicAttackPrimaryReplacement, binding uint16)
	// BeginAttack 开始一次普通攻击，创建当前记录并返回使用、开始与命中身份。
	BeginAttack(now int64, speed float64) (string, string, string)
	// SetAttackRecordIndex 保存当前普通攻击在报告中的记录位置。
	SetAttackRecordIndex(index int)
	// SetAttackActive 标记当前事件是否处于普通攻击的伤害累计范围。
	SetAttackActive(active bool)
	// AttackActive 读取当前普通攻击事件标志。
	AttackActive() bool
	// MarkAttackHit 仅对匹配使用的首次命中记录时刻并增加命中数。
	MarkAttackHit(use string, now int64)
	// FinishAttackRecord 记录本次普通攻击结算后的双方生命值。
	FinishAttackRecord(sourceHP, targetHP float64)
	// CompleteAttack 标记当前普通攻击完成，累计完成数并清除未完成尾段。
	CompleteAttack()
	// SetAttackWait 保存普通攻击的当前等待活视图。
	SetAttackWait(wait *AttackWaitView)
	// SetAttackWindowSettled 保存普通攻击观察窗口是否已经结算。
	SetAttackWindowSettled(settled bool)
	// SetInitialActionReady 复制并记录初始行动许可时刻。
	SetInitialActionReady(at *int64)
	// SetInitialMechanicReady 复制并记录初始机制就绪时刻。
	SetInitialMechanicReady(at *int64)
	// SetAttackReady 记录当前普通攻击的就绪时刻。
	SetAttackReady(at int64)
	// SetAttackMechanicReady 记录当前普通攻击的机制就绪时刻。
	SetAttackMechanicReady(at int64)
	// SetAttackNext 复制并记录下一次普通攻击的开始时刻。
	SetAttackNext(at *int64)
	// SetAttackFinalReady 记录最终就绪时刻和可选行动许可时刻。
	SetAttackFinalReady(at int64, actionAt *int64)
	// ObserveAttackDamage 累计当前普攻事件内的实际伤害，并记录目标首次从存活转为死亡的时刻。
	ObserveAttackDamage(source, target string, mitigated, hploss, before, after float64, now int64)
	// InitDriverEntries 按编译驱动数量建立本场条件、间隔和尝试槽。
	InitDriverEntries(n int)
	// SetDriverCondition 保存某驱动的运行态条件公式编号与存在标记。
	SetDriverCondition(index int, id formula.GenericProgramID)
	// SetDriverInterval 保存某驱动的运行态重复间隔公式编号与存在标记。
	SetDriverInterval(index int, id formula.GenericProgramID)
	// DriverCondition 读取驱动条件编号与存在性；下标无效时返回false。
	DriverCondition(index int) (formula.GenericProgramID, bool)
	// DriverInterval 读取驱动间隔编号与存在性；下标无效时返回false。
	DriverInterval(index int) (formula.GenericProgramID, bool)
	// RecordDriverAttempt 增加指定有效驱动槽的尝试数。
	RecordDriverAttempt(index int)
	// InitProcessFacts 初始化用于行动驱动的过程事实映射。
	InitProcessFacts()
	// ProcessFact 按键读取过程事实；缺失时返回零值。
	ProcessFact(key string) model.ProcessCommandFact
	// HasProcessFact 判断指定过程事实是否已登记。
	HasProcessFact(key string) bool
	// SetProcessFact 保存执行层已经核定的过程驱动事实。
	SetProcessFact(key string, fact model.ProcessCommandFact)
	// RemoveProcessFact 删除指定过程驱动事实。
	RemoveProcessFact(key string)
	// Dead 读取拥有者是否已被标记死亡。
	Dead(owner string) bool
	// MarkDead 登记拥有者死亡事实，不结算生命变化。
	MarkDead(owner string)
	// RecordSkillTargetKilled 仅保存技能目标的首次击杀时刻。
	RecordSkillTargetKilled(at int64)
	// SkillTargetKilledAt 读取首次击杀时刻及其是否已发生。
	SkillTargetKilledAt() (int64, bool)
	// Occupied 检查拥有者是否仍有占用行动的活动过程。
	Occupied(owner string) bool
	// ReadyAt 取当前时刻与所有活动占用终点的最大值，得到局部行动许可时刻。
	ReadyAt(owner string, now int64) int64
	// OccupancyContribution 查询起点落在指定窗口内的占用最晚终点及存在性。
	OccupancyContribution(owner string, start, end int64) (int64, bool)
	// SetEmpoweredPredecessor 复制并保存过程关联的强化前序使用引用。
	SetEmpoweredPredecessor(p *ProcessView, value *string)
	// MarkEmpoweredResolved 标记强化结算事实已经发布。
	MarkEmpoweredResolved(p *ProcessView)
	// ClearEmpoweredAttack 清除该过程当前的强化攻击关联。
	ClearEmpoweredAttack(p *ProcessView)
	// ResolveEmpoweredMiss 首次结算未命中的强化预留，保存时刻并减少待命中数。
	ResolveEmpoweredMiss(p *ProcessView, index int, now int64) bool
	// InitSkillHitStages 为过程初始化独立的技能命中阶段记录。
	InitSkillHitStages(p *ProcessView)
	// AppendSkillHitStage 在已启用阶段记录时追加真实命中阶段。
	AppendSkillHitStage(p *ProcessView, stage model.ProcessSkillHitStage)
	// CompleteSkillHitStage 从后向前更新匹配阶段的接触和完成标记。
	CompleteSkillHitStage(p *ProcessView, key string, contact, completed bool)
	// RecordSkillHitContact 仅填本时刻首个已释放未完成阶段的真实接触身份；未提交命中不调用。
	RecordSkillHitContact(p *ProcessView, now int64, sequence int, occurrence uint64, blocked float64)
	// ProcessViews 复制过程指针列表；各元素仍是活借用，保存历史需Freeze或Snapshot。
	ProcessViews() []*ProcessView
	// EmpoweredCount 返回当前强化等待索引中的过程数。
	EmpoweredCount() int
	// EmpoweredAt 按有效下标借用强化等待过程。
	EmpoweredAt(index int) *ProcessView
	// UpdateEmpoweredWait 按过程的真实活动、执行与期限状态维护强化等待索引。
	UpdateEmpoweredWait(p *ProcessView)
	// ProcessCount 返回本场已登记过程数，包含已结束过程。
	ProcessCount() int
	// ProcessAt 按有效下标借用过程活视图。
	ProcessAt(index int) *ProcessView
	// Process 按稳定槽引用借用过程；缺失或非法引用返回nil。
	Process(ref contract.ProcessRef) *ProcessView
	// AddProcess 登记过程并分配稳定槽位，不复用旧过程身份。
	AddProcess(p *ProcessView)
	// ExportProcesses 按挂载和使用身份稳定排序后导出独立过程快照。
	ExportProcesses() []model.ProcessInstanceSnapshot
	// RegisterAction 为尚未登记的行动分配稳定槽位。
	RegisterAction(a *SkillActionView)
	// AddManualAction 登记并追加一条手动行动。
	AddManualAction(a *SkillActionView)
	// ManualCount 返回已登记手动行动数。
	ManualCount() int
	// ManualAt 按有效下标借用手动行动活视图。
	ManualAt(index int) *SkillActionView
	// SortManualActions 按首次时刻、排序值及指令键稳定排列手动行动。
	SortManualActions()
	// BindManualParents 按完整顺序绑定手动控制的首次行动；父引用或归属不合法时返回原因。
	BindManualParents() string
	// SetParent 保存手动控制的父行动下标及首次使用引用。
	SetParent(a *SkillActionView, index int, use string)
	// CurrentAction 借用当前行动；未设置时返回nil。
	CurrentAction() *SkillActionView
	// SetCurrentAction 登记并设置当前行动；nil表示清除当前借用。
	SetCurrentAction(a *SkillActionView)
	// BindActionUse 登记行动并建立使用引用到行动的映射。
	BindActionUse(use string, a *SkillActionView)
	// ForgetActionUse 移除使用引用到行动的映射，不删除稳定行动槽。
	ForgetActionUse(use string)
	// ActionForUse 按使用引用借用行动；未登记时返回nil。
	ActionForUse(use string) *SkillActionView
	// Action 按稳定槽引用借用行动；缺失或非法引用返回nil。
	Action(ref contract.ActionRef) *SkillActionView
	// ActionUses 复制已绑定使用的行动指针列表；元素仍是活借用且顺序未定义。
	ActionUses() []*SkillActionView
	// Reached 累计该行动已经到达一次请求时点。
	Reached(a *SkillActionView)
	// Reject 保存本次行动拒绝原因。
	Reject(a *SkillActionView, reason string)
	// Accept 记录行动已接受及实际使用引用；首次行动同时累计开始使用数。
	Accept(a *SkillActionView, use string, initial bool)
	// FinishAttempt 依据接受、错误或拒绝状态生成本次记录，并累计相应失败计数。
	FinishAttempt(a *SkillActionView, now int64, err *model.EngineError) model.SkillActionRecord
	// RecordUse 按已发生的使用或步骤事实更新该行动计数。
	RecordUse(a *SkillActionView, kind string)
	// SetChargeDuration 复制并保存已核定的蓄力时长。
	SetChargeDuration(a *SkillActionView, value int64)
	// BeginHit 推进并返回该行动的实际命中序号。
	BeginHit(a *SkillActionView) int
	// CommitHitContact 记录已提交命中绑定的接触位。
	CommitHitContact(a *SkillActionView, index int)
	// SkillSummaries 汇总手动行动及其使用计数，保留未到达和在途数量。
	SkillSummaries() (model.SkillActionSummary, model.SkillUseSummary)
	// NewUse 保存真实使用身份；相同使用键按当前语义替换映射。
	NewUse(seed UseSeed) *UseView
	// Use 按键借用使用身份；未登记时返回nil。
	Use(key string) *UseView
	// ReserveUseEmpowerment 为使用身份关联强化过程及其消费下标。
	ReserveUseEmpowerment(u *UseView, process contract.ProcessRef, index int)
}

// State 持有运行中的行动身份；不把集合或可写过程返回给执行层。
type State struct {
	processes              []*ProcessView
	empoweredWaits         []*ProcessView
	manualActions          []*SkillActionView
	actionRegistry         []*SkillActionView
	actionsByUse           map[string]*SkillActionView
	currentAction          *SkillActionView
	automatic              *automaticSkillData
	uses                   map[string]*UseView
	basicAttack            *BasicAttackView
	ammo                   []*AmmoView
	basicAttackEventActive bool
	drivers                driverState
}

var _ ProcessChangeSetAPI = (*ProcessChangeSet)(nil)
var _ StateAPI = (*State)(nil)

func NewProcess(seed ProcessSeed) *ProcessView {
	p := &ProcessView{data: &processData{snapshot: cloneProcessSnapshot(seed.Snapshot), slot: -1, definition: seed.Definition, ability: seed.Ability, abilityRef: seed.AbilityRef, stepIndex: seed.StepIndex, castID: seed.CastID, castUseKey: seed.CastUseKey, hasEmpoweredAbility: seed.HasEmpoweredAbility, empoweredAbilityIndex: seed.EmpoweredAbilityIndex, replacesPrimary: seed.ReplacesPrimary, primaryReplacementBinding: seed.PrimaryReplacementBinding}}
	p.data.stableKey = p.Owner() + "\x00" + p.ProviderRef() + "\x00" + p.ProcessKey() + "\x00" + p.UseKey()
	p.data.mountKey = p.Owner() + "\x00" + p.ProviderRef() + "\x00" + p.ProcessKey()
	return p
}

func StageProcess(original *ProcessView) *ProcessChangeSet {
	data := *original.data
	data.snapshot = cloneProcessSnapshot(original.data.snapshot)
	return &ProcessChangeSet{view: ProcessView{data: &data}}
}

func (c *ProcessChangeSet) View() *ProcessView { return &c.view }

func (c *ProcessChangeSet) Publish(original *ProcessView) {
	slot := original.data.slot
	*original.data = *c.view.data
	original.data.slot = slot
}
func (p *ProcessView) Freeze() *ProcessView { return StageProcess(p).View() }
func (p *ProcessView) WithTarget(target string) *ProcessView {
	copy := *p.data
	copy.snapshot.Target = target
	return &ProcessView{data: &copy}
}

func cloneOptional[T any](value *T) *T {
	if value == nil {
		return nil
	}
	copied := *value
	return &copied
}

func cloneProcessSnapshot(row model.ProcessInstanceSnapshot) model.ProcessInstanceSnapshot {
	row.PassiveOrigin = cloneOptional(row.PassiveOrigin)
	row.LastExecutionAtMs = cloneOptional(row.LastExecutionAtMs)
	row.StepCompletedAtMs = cloneOptional(row.StepCompletedAtMs)
	row.ExpiresAtMs = cloneOptional(row.ExpiresAtMs)
	row.FailureReason = cloneOptional(row.FailureReason)
	row.FinishedAtMs = cloneOptional(row.FinishedAtMs)
	row.EmpoweredPredecessorUseRef = cloneOptional(row.EmpoweredPredecessorUseRef)
	row.ActualCosts = cloneCosts(row.ActualCosts)
	row.ActionOccupancies = append([]model.ProcessActionOccupancy{}, row.ActionOccupancies...)
	for index := range row.ActionOccupancies {
		row.ActionOccupancies[index].FinishedAtMs = cloneOptional(row.ActionOccupancies[index].FinishedAtMs)
	}
	if row.Repeat != nil {
		repeat := *row.Repeat
		repeat.NextExecutionAtMs = cloneOptional(repeat.NextExecutionAtMs)
		row.Repeat = &repeat
	}
	if row.SkillHitStages != nil {
		rows := cloneSkillHitStages(*row.SkillHitStages)
		row.SkillHitStages = &rows
	}
	if row.EmpoweredAttack != nil {
		value := *row.EmpoweredAttack
		value.ReplacedPrimary = cloneOptional(value.ReplacedPrimary)
		row.EmpoweredAttack = &value
	}
	if row.EmpoweredAttackWindow != nil {
		window := *row.EmpoweredAttackWindow
		window.Consumptions = append(make([]model.ProcessAttackConsumption, 0, window.MaximumAttackCount), window.Consumptions...)
		for index := range window.Consumptions {
			item := &window.Consumptions[index]
			item.HitRef = cloneOptional(item.HitRef)
			item.HitSequence = cloneOptional(item.HitSequence)
			item.ResolvedAtMs = cloneOptional(item.ResolvedAtMs)
		}
		row.EmpoweredAttackWindow = &window
	}
	return row
}

func cloneCosts(values map[string]float64) map[string]float64 {
	out := make(map[string]float64, len(values))
	for key, value := range values {
		out[key] = value
	}
	return out
}

func (p *ProcessView) Snapshot() model.ProcessInstanceSnapshot {
	return cloneProcessSnapshot(p.data.snapshot)
}
func (p *ProcessView) Reference() contract.ProcessRef {
	if p == nil {
		return contract.ProcessRef{}
	}
	return contract.ProcessRef{Slot: p.data.slot, Present: true}
}
func (p *ProcessView) Slot() int                               { return p.data.slot }
func (p *ProcessView) Definition() *planbundle.CompiledProcess { return p.data.definition }
func (p *ProcessView) Ability() planbundle.CompiledAbility     { return p.data.ability }
func (p *ProcessView) AbilityRef() string                      { return p.data.abilityRef }
func (p *ProcessView) StepIndex() int                          { return p.data.stepIndex }
func (p *ProcessView) CastID() uint64                          { return p.data.castID }
func (p *ProcessView) CastUseKey() string                      { return p.data.castUseKey }
func (p *ProcessView) MountKey() string                        { return p.data.mountKey }
func (p *ProcessView) StableKey() string                       { return p.data.stableKey }
func (p *ProcessView) HasEmpoweredAbility() bool               { return p.data.hasEmpoweredAbility }
func (p *ProcessView) EmpoweredAbilityIndex() uint16           { return p.data.empoweredAbilityIndex }
func (p *ProcessView) ReplacesPrimary() bool                   { return p.data.replacesPrimary }
func (p *ProcessView) PrimaryReplacementBinding() uint16       { return p.data.primaryReplacementBinding }
func (p *ProcessView) EmpoweredResolvedPublished() bool        { return p.data.empoweredResolvedPublished }
func (p *ProcessView) StartStateValues() []formula.ProcessStartStateValue {
	return append([]formula.ProcessStartStateValue(nil), p.data.startStateValues...)
}
func (p *ProcessView) StartState() formula.ProcessStartStateView {
	return formula.BorrowProcessStartState(p.data.startStateValues)
}
func (p *ProcessView) Owner() string       { return p.data.snapshot.Owner }
func (p *ProcessView) ProviderRef() string { return p.data.snapshot.ProviderRef }
func (p *ProcessView) ProcessKey() string  { return p.data.snapshot.ProcessKey }
func (p *ProcessView) SkillKey() string    { return p.data.snapshot.SkillKey }

// PassiveOrigin返回有限因果值及存在标记，不借出可写指针。
func (p *ProcessView) PassiveOrigin() (model.PassiveProcessOrigin, bool) {
	if p.data.snapshot.PassiveOrigin == nil {
		return model.PassiveProcessOrigin{}, false
	}
	return *p.data.snapshot.PassiveOrigin, true
}

func (p *ProcessView) UseKey() string          { return p.data.snapshot.UseKey }
func (p *ProcessView) Target() string          { return p.data.snapshot.Target }
func (p *ProcessView) StepKey() string         { return p.data.snapshot.StepKey }
func (p *ProcessView) StepVersion() int        { return p.data.snapshot.StepVersion }
func (p *ProcessView) StepExecutionIndex() int { return p.data.snapshot.StepExecutionIndex }
func (p *ProcessView) StartedAtMs() int64      { return p.data.snapshot.StartedAtMs }
func (p *ProcessView) StepStartedAtMs() int64  { return p.data.snapshot.StepStartedAtMs }
func (p *ProcessView) AdvanceAtMs() int64      { return p.data.snapshot.AdvanceAtMs }
func (p *ProcessView) CooldownStarted() bool   { return p.data.snapshot.CooldownStarted }
func (p *ProcessView) Status() string          { return p.data.snapshot.Status }
func (p *ProcessView) LastExecutionAtMs() *int64 {
	return cloneOptional(p.data.snapshot.LastExecutionAtMs)
}
func (p *ProcessView) StepCompletedAtMs() *int64 {
	return cloneOptional(p.data.snapshot.StepCompletedAtMs)
}
func (p *ProcessView) ExpiresAtMs() *int64    { return cloneOptional(p.data.snapshot.ExpiresAtMs) }
func (p *ProcessView) FinishedAtMs() *int64   { return cloneOptional(p.data.snapshot.FinishedAtMs) }
func (p *ProcessView) FailureReason() *string { return cloneOptional(p.data.snapshot.FailureReason) }
func (p *ProcessView) EmpoweredPredecessorUseRef() *string {
	return cloneOptional(p.data.snapshot.EmpoweredPredecessorUseRef)
}
func (p *ProcessView) ActualCosts() map[string]float64 {
	return cloneCosts(p.data.snapshot.ActualCosts)
}
func (p *ProcessView) HasExpiry() bool         { return p.data.snapshot.ExpiresAtMs != nil }
func (p *ProcessView) Expiry() int64           { return *p.data.snapshot.ExpiresAtMs }
func (p *ProcessView) HasLastExecution() bool  { return p.data.snapshot.LastExecutionAtMs != nil }
func (p *ProcessView) LastExecution() int64    { return *p.data.snapshot.LastExecutionAtMs }
func (p *ProcessView) HasStepCompletion() bool { return p.data.snapshot.StepCompletedAtMs != nil }
func (p *ProcessView) StepCompletion() int64   { return *p.data.snapshot.StepCompletedAtMs }
func (p *ProcessView) HasFinished() bool       { return p.data.snapshot.FinishedAtMs != nil }
func (p *ProcessView) FinishedAt() int64       { return *p.data.snapshot.FinishedAtMs }
func (p *ProcessView) HasRepeat() bool         { return p.data.snapshot.Repeat != nil }
func (p *ProcessView) HasNextExecution() bool {
	return p.data.snapshot.Repeat != nil && p.data.snapshot.Repeat.NextExecutionAtMs != nil
}
func (p *ProcessView) NextExecutionAt() int64   { return *p.data.snapshot.Repeat.NextExecutionAtMs }
func (p *ProcessView) RepeatIndex() int         { return p.data.snapshot.Repeat.ExecutionIndex }
func (p *ProcessView) HasEmpoweredWindow() bool { return p.data.snapshot.EmpoweredAttackWindow != nil }
func (p *ProcessView) WindowMaximum() int {
	return p.data.snapshot.EmpoweredAttackWindow.MaximumAttackCount
}
func (p *ProcessView) WindowConsumed() int {
	return p.data.snapshot.EmpoweredAttackWindow.ConsumptionCount
}
func (p *ProcessView) WindowPending() int {
	return p.data.snapshot.EmpoweredAttackWindow.PendingHitCount
}
func (p *ProcessView) ConsumptionCount() int {
	return len(p.data.snapshot.EmpoweredAttackWindow.Consumptions)
}
func (p *ProcessView) Consumption(index int) model.ProcessAttackConsumption {
	value := p.data.snapshot.EmpoweredAttackWindow.Consumptions[index]
	value.HitRef = cloneOptional(value.HitRef)
	value.HitSequence = cloneOptional(value.HitSequence)
	value.ResolvedAtMs = cloneOptional(value.ResolvedAtMs)
	return value
}
func (p *ProcessView) HasSkillHitStages() bool { return p.data.snapshot.SkillHitStages != nil }
func (p *ProcessView) OccupancyCount() int     { return len(p.data.snapshot.ActionOccupancies) }
func (p *ProcessView) HasOccupancies() bool    { return p.data.snapshot.ActionOccupancies != nil }
func (p *ProcessView) OccupancyAt(index int) model.ProcessActionOccupancy {
	value := p.data.snapshot.ActionOccupancies[index]
	value.FinishedAtMs = cloneOptional(value.FinishedAtMs)
	return value
}
func (p *ProcessView) Costs() model.NumericView {
	return model.BorrowNumericView(p.data.snapshot.ActualCosts)
}
func (p *ProcessView) Repeat() *model.ProcessRepeatSnapshot {
	r := p.data.snapshot.Repeat
	if r == nil {
		return nil
	}
	out := *r
	out.NextExecutionAtMs = cloneOptional(out.NextExecutionAtMs)
	return &out
}
func (p *ProcessView) ActionOccupancies() []model.ProcessActionOccupancy {
	out := append([]model.ProcessActionOccupancy{}, p.data.snapshot.ActionOccupancies...)
	for index := range out {
		out[index].FinishedAtMs = cloneOptional(out[index].FinishedAtMs)
	}
	return out
}
func (p *ProcessView) SkillHitStages() *[]model.ProcessSkillHitStage {
	if p.data.snapshot.SkillHitStages == nil {
		return nil
	}
	out := cloneSkillHitStages(*p.data.snapshot.SkillHitStages)
	return &out
}

func cloneSkillHitStages(stages []model.ProcessSkillHitStage) []model.ProcessSkillHitStage {
	rows := append([]model.ProcessSkillHitStage{}, stages...)
	for index := range rows {
		rows[index].HitSequence = cloneOptional(rows[index].HitSequence)
		rows[index].HitOccurrenceID = cloneOptional(rows[index].HitOccurrenceID)
		rows[index].HitBlocked = cloneOptional(rows[index].HitBlocked)
	}
	return rows
}
func (p *ProcessView) EmpoweredAttack() *model.ProcessEmpoweredAttack {
	if p.data.snapshot.EmpoweredAttack == nil {
		return nil
	}
	out := *p.data.snapshot.EmpoweredAttack
	out.ReplacedPrimary = cloneOptional(out.ReplacedPrimary)
	return &out
}
func (p *ProcessView) EmpoweredAttackWindow() *model.ProcessEmpoweredAttackWindow {
	if p.data.snapshot.EmpoweredAttackWindow == nil {
		return nil
	}
	row := cloneProcessSnapshot(model.ProcessInstanceSnapshot{EmpoweredAttackWindow: p.data.snapshot.EmpoweredAttackWindow})
	return row.EmpoweredAttackWindow
}

func (c *ProcessChangeSet) SetCast(id uint64, use string) {
	c.view.data.castID, c.view.data.castUseKey = id, use
}
func (c *ProcessChangeSet) SetCooldownStarted() { c.view.data.snapshot.CooldownStarted = true }
func (c *ProcessChangeSet) SetActualCost(key string, value float64) {
	c.view.data.snapshot.ActualCosts[key] = value
}
func (c *ProcessChangeSet) SetStartStateValues(values []formula.ProcessStartStateValue) {
	c.view.data.startStateValues = append([]formula.ProcessStartStateValue(nil), values...)
}
func (c *ProcessChangeSet) EnterStep(index int, step planbundle.CompiledProcessStep, now int64) {
	d := c.view.data
	d.stepIndex = index
	r := &d.snapshot
	r.StepVersion = index + 1
	r.StepKey = step.StepKey
	r.StepStartedAtMs = now
	r.AdvanceAtMs = now
	r.ExpiresAtMs = nil
	r.Repeat = nil
	r.StepExecutionIndex = 0
	r.LastExecutionAtMs = nil
	r.StepCompletedAtMs = nil
}
func (c *ProcessChangeSet) SetTiming(advance int64, expires *int64) {
	c.view.data.snapshot.AdvanceAtMs = advance
	c.view.data.snapshot.ExpiresAtMs = cloneOptional(expires)
}
func (c *ProcessChangeSet) SetRepeat(repeat *model.ProcessRepeatSnapshot) {
	if repeat == nil {
		c.view.data.snapshot.Repeat = nil
		return
	}
	copy := *repeat
	copy.NextExecutionAtMs = cloneOptional(copy.NextExecutionAtMs)
	c.view.data.snapshot.Repeat = &copy
}
func (c *ProcessChangeSet) ExecuteStep(now int64, alreadyCommitted bool) bool {
	r := &c.view.data.snapshot
	if r.StepCompletedAtMs != nil || !alreadyCommitted && r.Repeat == nil && r.StepExecutionIndex > 0 {
		return false
	}
	if !alreadyCommitted {
		r.StepExecutionIndex++
		r.LastExecutionAtMs = cloneOptional(&now)
	}
	return true
}
func (c *ProcessChangeSet) CompleteStep(now int64) bool {
	r := &c.view.data.snapshot
	if r.StepCompletedAtMs != nil {
		return false
	}
	r.StepCompletedAtMs = cloneOptional(&now)
	return true
}
func (c *ProcessChangeSet) Finish(status, reason string, now int64) {
	r := &c.view.data.snapshot
	r.Status = status
	r.FinishedAtMs = cloneOptional(&now)
	r.FailureReason = nil
	if status == "failed" {
		r.FailureReason = cloneOptional(&reason)
	}
	if r.Repeat != nil {
		r.Repeat.NextExecutionAtMs = nil
	}
}
func (c *ProcessChangeSet) AcceptRecast(advance, now int64, castID uint64, use string) {
	r := &c.view.data.snapshot
	r.StepExecutionIndex++
	r.LastExecutionAtMs = cloneOptional(&now)
	r.AdvanceAtMs = advance
	c.SetCast(castID, use)
}

func (p *ProcessView) OccupiesAction(owner string) bool {
	return p != nil && p.Owner() == owner && p.Status() == "active" && p.StepIndex() >= 0 && p.StepIndex() < len(p.Definition().Steps) && p.Definition().Steps[p.StepIndex()].OccupiesAction
}
func (p *ProcessView) ActionDeadline() int64 {
	if at := p.data.snapshot.ExpiresAtMs; at != nil {
		return *at
	}
	return p.AdvanceAtMs()
}
func (p *ProcessView) TimerAt() int64 {
	r := &p.data.snapshot
	if r.StepVersion == 0 {
		return r.StartedAtMs
	}
	if r.StepCompletedAtMs != nil {
		return *r.StepCompletedAtMs
	}
	if r.Repeat == nil && r.StepExecutionIndex > 0 && r.LastExecutionAtMs != nil && p.Definition().Steps[p.StepIndex()].StepType != "RECAST" {
		return *r.LastExecutionAtMs
	}
	if r.Repeat != nil && r.Repeat.NextExecutionAtMs != nil {
		return *r.Repeat.NextExecutionAtMs
	}
	if r.ExpiresAtMs != nil {
		return *r.ExpiresAtMs
	}
	return r.AdvanceAtMs
}
func (p *ProcessView) RepeatOffset(index int) int64 {
	repeat := p.data.snapshot.Repeat
	step := p.Definition().Steps[p.StepIndex()]
	if step.StepType == "MULTI_HIT" {
		return int64(index) * repeat.IntervalMs
	}
	if step.FirstExecution == "CUSTOM_WINDOW" {
		if repeat.ExecutionCount == 1 {
			return repeat.FirstExecutionOffsetMs
		}
		return repeat.FirstExecutionOffsetMs + ((repeat.LastExecutionOffsetMs-repeat.FirstExecutionOffsetMs)*int64(index)+int64(repeat.ExecutionCount-1)/2)/int64(repeat.ExecutionCount-1)
	}
	slot := index
	if step.FirstExecution == "AFTER_INTERVAL" {
		slot++
	}
	return int64(math.Round(float64(*p.data.snapshot.ExpiresAtMs-p.StepStartedAtMs()) * float64(slot) / float64(repeat.ExecutionCount)))
}
func (p *ProcessView) NextRepeatAt() int64 {
	return p.StepStartedAtMs() + p.RepeatOffset(p.RepeatIndex())
}
func ProcessLess(a, b *ProcessView) bool {
	if a.MountKey() != b.MountKey() {
		return a.MountKey() < b.MountKey()
	}
	return a.UseKey() < b.UseKey()
}

func (s *State) SetEmpoweredPredecessor(p *ProcessView, value *string) {
	p.data.snapshot.EmpoweredPredecessorUseRef = cloneOptional(value)
}
func (s *State) MarkEmpoweredResolved(p *ProcessView) { p.data.empoweredResolvedPublished = true }
func (s *State) ClearEmpoweredAttack(p *ProcessView)  { p.data.snapshot.EmpoweredAttack = nil }
func (s *State) ResolveEmpoweredMiss(p *ProcessView, index int, now int64) bool {
	window := p.data.snapshot.EmpoweredAttackWindow
	row := &window.Consumptions[index]
	if row.ResolvedAtMs != nil {
		return false
	}
	row.ResolvedAtMs = cloneOptional(&now)
	window.PendingHitCount--
	return true
}
func (s *State) InitSkillHitStages(p *ProcessView) {
	items := make([]model.ProcessSkillHitStage, 0)
	p.data.snapshot.SkillHitStages = &items
}
func (s *State) AppendSkillHitStage(p *ProcessView, stage model.ProcessSkillHitStage) {
	if p.data.snapshot.SkillHitStages != nil {
		*p.data.snapshot.SkillHitStages = append(*p.data.snapshot.SkillHitStages, stage)
	}
}
func (s *State) CompleteSkillHitStage(p *ProcessView, key string, contact, completed bool) {
	if p.data.snapshot.SkillHitStages == nil {
		return
	}
	items := *p.data.snapshot.SkillHitStages
	for index := len(items) - 1; index >= 0; index-- {
		if items[index].HitBindingKey == key {
			items[index].Contact, items[index].Completed = contact, completed
			return
		}
	}
}

func (s *State) RecordSkillHitContact(p *ProcessView, now int64, sequence int, occurrence uint64, blocked float64) {
	if p.data.snapshot.SkillHitStages == nil {
		return
	}
	items := *p.data.snapshot.SkillHitStages
	for index := range items {
		stage := &items[index]
		if stage.TimeMs == now && stage.Released && !stage.Completed && !stage.Contact {
			stage.Contact = true
			stage.HitSequence, stage.HitOccurrenceID, stage.HitBlocked = cloneOptional(&sequence), cloneOptional(&occurrence), cloneOptional(&blocked)
			return
		}
	}
}
func (s *State) ProcessViews() []*ProcessView       { return append([]*ProcessView(nil), s.processes...) }
func (s *State) EmpoweredCount() int                { return len(s.empoweredWaits) }
func (s *State) EmpoweredAt(index int) *ProcessView { return s.empoweredWaits[index] }
func (s *State) UpdateEmpoweredWait(p *ProcessView) {
	if !p.HasEmpoweredAbility() {
		return
	}
	index := -1
	for i, existing := range s.empoweredWaits {
		if existing == p {
			index = i
			break
		}
	}
	active := p.Status() == "active" && p.StepExecutionIndex() == 0 && p.StepKey() != "" && p.data.snapshot.ExpiresAtMs != nil
	if active && index < 0 {
		s.empoweredWaits = append(s.empoweredWaits, p)
	} else if !active && index >= 0 {
		s.empoweredWaits = append(s.empoweredWaits[:index], s.empoweredWaits[index+1:]...)
	}
}

func (s *State) ProcessCount() int                { return len(s.processes) }
func (s *State) ProcessAt(index int) *ProcessView { return s.processes[index] }
func (s *State) Process(ref contract.ProcessRef) *ProcessView {
	if !ref.Present || ref.Slot < 0 || ref.Slot >= len(s.processes) {
		return nil
	}
	return s.processes[ref.Slot]
}
func (s *State) AddProcess(p *ProcessView) {
	p.data.slot = len(s.processes)
	s.processes = append(s.processes, p)
}
func (s *State) ExportProcesses() []model.ProcessInstanceSnapshot {
	ordered := append([]*ProcessView(nil), s.processes...)
	if len(ordered) > 1 {
		sort.Slice(ordered, func(i, j int) bool {
			a, b := ordered[i], ordered[j]
			if a.MountKey() != b.MountKey() {
				return a.MountKey() < b.MountKey()
			}
			return a.UseKey() < b.UseKey()
		})
	}
	rows := make([]model.ProcessInstanceSnapshot, 0, len(ordered))
	for _, p := range ordered {
		rows = append(rows, p.Snapshot())
	}
	return rows
}
