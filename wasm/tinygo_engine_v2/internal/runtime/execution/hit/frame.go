package hit

import (
	"tinygo_engine_v2/internal/base/typeset"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

// ProcessPublishHost 只将命中包已确定的过程暂存发布回真实行动状态。
type ProcessPublishHost interface {
	// PublishEmpoweredMutation 发布原过程的暂存并更新等待索引，clearAttack只清除计数窗口的临时关联。
	PublishEmpoweredMutation(original *actionpkg.ProcessView, changes *actionpkg.ProcessChangeSet, clearAttack bool)
}

// FactPublishHost 只发布已经完成统一预检的强化事实，不决定新的执行顺序。
type FactPublishHost interface {
	// PublishEmpoweredReservation 将真实原生使用关联原窗口的既有消耗位置。
	PublishEmpoweredReservation(use *actionpkg.UseView, process *actionpkg.ProcessView, index int)
	// PublishEmpoweredPrimary 发布本帧根据真实负载生成的主体替换累计。
	PublishEmpoweredPrimary(row model.BasicAttackPrimaryReplacement, binding uint16)
	// PublishEmpoweredMoment 发布已经在本帧发生的过程时点。
	PublishEmpoweredMoment(process *actionpkg.ProcessView, kind string)
	// PublishEmpoweredContact 登记实际目标接触及原激活使用的报告事实。
	PublishEmpoweredContact(process *actionpkg.ProcessView, association model.ProcessEmpoweredAttack)
	// PublishEmpoweredFinish 发布已经完成的过程，不再执行负载。
	PublishEmpoweredFinish(process *actionpkg.ProcessView)
	// PublishEmpoweredOutput 将实际能力输出归入已有报告累计。
	PublishEmpoweredOutput(ref string, damage, healing float64)
}

// FrameAPI 列出当前共享强化帧的私有暂存能力，真实发布由根层原位调用。
type FrameAPI interface {
	// StageReservation 暂存真实原生使用对已选择窗口的关联，不发布。
	StageReservation(use *actionpkg.UseView, process *actionpkg.ProcessView, index int)
	// StageMutation 暂存原过程的独占变更，不修改活动过程。
	StageMutation(original *actionpkg.ProcessView, changes *actionpkg.ProcessChangeSet)
	// RecordMoment 暂存已经发生的原过程时点事实。
	RecordMoment(process *actionpkg.ProcessView, kind string)
	// StageContact 暂存原激活使用与本次实际普攻目标的双使用关联。
	StageContact(process *actionpkg.ProcessView, association model.ProcessEmpoweredAttack)
	// StageFinished 暂存已经完成的过程，保留原序。
	StageFinished(process *actionpkg.ProcessView)
	// RecordOutput 暂存本求值范围实际产生的能力输出。
	RecordOutput(ref string, damage, healing float64)
	// ClaimShield 认领本帧已消费的原盾，后续负载不可再次选择。
	ClaimShield(owner, provider string)
	// AvailableShields 在当前效果投影上按原序排除已认领的活动法术盾。
	AvailableShields(owner string, instances effectpkg.ProviderList, definitions []planbundle.CompiledProvider, typeID typeset.TypeID, declared bool, nowMs int64) effectpkg.ProviderList
	// MarkPrimaryBlocked 标记真实替换负载被阻挡，不影响其他候选。
	MarkPrimaryBlocked()
	// PrimaryBlocked 返回本帧原主体替换是否被阻挡。
	PrimaryBlocked() bool
	// StagePrimary 暂存根据本次实际负载生成的主体替换记录。
	StagePrimary(row *model.BasicAttackPrimaryReplacement, binding uint16)
	// FinishedCount 返回本组已暂存完成的过程数。
	FinishedCount() int
	// FinishedAt 借用指定原序的完成过程，只用于本次同步发布尾部。
	FinishedAt(index int) *actionpkg.ProcessView
	// PublishProcesses 在原统一提交位置发布过程，不发布其他事实。
	PublishProcesses(host ProcessPublishHost)
	// PublishFacts 在原过程提交之后按原序发布关联、时点、接触及输出。
	PublishFacts(host FactPublishHost)
}

// Frame 私有持有本次强化共享帧的局部事实，不借用根帧、队列或全场账本。
type Frame struct {
	reservations       []attackReservation
	mutations          []processMutation
	moments            []processMoment
	finished           []*actionpkg.ProcessView
	contacts           []attackContact
	outputs            []abilityOutput
	shields            []shieldClaim
	primaryReplacement *model.BasicAttackPrimaryReplacement
	primaryBinding     uint16
	primaryBlocked     bool
}

type attackReservation struct {
	use     *actionpkg.UseView
	process *actionpkg.ProcessView
	index   int
}

type processMutation struct {
	original *actionpkg.ProcessView
	changes  *actionpkg.ProcessChangeSet
}

type processMoment struct {
	process *actionpkg.ProcessView
	kind    string
}

type attackContact struct {
	process     *actionpkg.ProcessView
	association model.ProcessEmpoweredAttack
}

type abilityOutput struct {
	ref             string
	damage, healing float64
}

type shieldClaim struct{ owner, provider string }

var _ FrameAPI = (*Frame)(nil)

func (f *Frame) StageReservation(use *actionpkg.UseView, process *actionpkg.ProcessView, index int) {
	f.reservations = append(f.reservations, attackReservation{use, process, index})
}

func (f *Frame) StageMutation(original *actionpkg.ProcessView, changes *actionpkg.ProcessChangeSet) {
	f.mutations = append(f.mutations, processMutation{original, changes})
}

func (f *Frame) RecordMoment(process *actionpkg.ProcessView, kind string) {
	f.moments = append(f.moments, processMoment{process, kind})
}

func (f *Frame) StageContact(process *actionpkg.ProcessView, association model.ProcessEmpoweredAttack) {
	f.contacts = append(f.contacts, attackContact{process, association})
}

func (f *Frame) StageFinished(process *actionpkg.ProcessView) {
	f.finished = append(f.finished, process)
}

func (f *Frame) RecordOutput(ref string, damage, healing float64) {
	f.outputs = append(f.outputs, abilityOutput{ref, damage, healing})
}

func (f *Frame) ClaimShield(owner, provider string) {
	f.shields = append(f.shields, shieldClaim{owner, provider})
}

func (f *Frame) AvailableShields(owner string, instances effectpkg.ProviderList, definitions []planbundle.CompiledProvider, typeID typeset.TypeID, declared bool, nowMs int64) effectpkg.ProviderList {
	active := ActiveSpellShields(instances, definitions, typeID, declared, nowMs)
	var available effectpkg.ProviderList
	for index := 0; index < active.Len(); index++ {
		shield := active.At(index)
		if !f.shieldClaimed(owner, shield.ProviderRef) {
			available = available.Append(shield)
		}
	}
	return available
}

func (f *Frame) MarkPrimaryBlocked() { f.primaryBlocked = true }

func (f *Frame) PrimaryBlocked() bool { return f.primaryBlocked }

func (f *Frame) StagePrimary(row *model.BasicAttackPrimaryReplacement, binding uint16) {
	f.primaryReplacement, f.primaryBinding = row, binding
}

func (f *Frame) FinishedCount() int { return len(f.finished) }

func (f *Frame) FinishedAt(index int) *actionpkg.ProcessView { return f.finished[index] }

func (f *Frame) PublishProcesses(host ProcessPublishHost) {
	for _, mutation := range f.mutations {
		host.PublishEmpoweredMutation(mutation.original, mutation.changes, mutation.changes.View().HasEmpoweredWindow())
	}
}

func (f *Frame) PublishFacts(host FactPublishHost) {
	for _, reservation := range f.reservations {
		host.PublishEmpoweredReservation(reservation.use, reservation.process, reservation.index)
	}
	if f.primaryReplacement != nil {
		host.PublishEmpoweredPrimary(*f.primaryReplacement, f.primaryBinding)
	}
	for _, moment := range f.moments {
		host.PublishEmpoweredMoment(moment.process, moment.kind)
	}
	for _, contact := range f.contacts {
		host.PublishEmpoweredContact(contact.process, contact.association)
	}
	for _, process := range f.finished {
		host.PublishEmpoweredFinish(process)
	}
	for _, output := range f.outputs {
		if output.damage != 0 || output.healing != 0 {
			host.PublishEmpoweredOutput(output.ref, output.damage, output.healing)
		}
	}
}

func (f *Frame) shieldClaimed(owner, provider string) bool {
	for _, claim := range f.shields {
		if claim.owner == owner && claim.provider == provider {
			return true
		}
	}
	return false
}
