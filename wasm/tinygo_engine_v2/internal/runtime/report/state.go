// Package report 拥有已提交结果、明细预算及观察游标，只消费数值而不调度或改变战斗状态。
package report

import "tinygo_engine_v2/internal/model"

type Totals struct {
	SourceDamageDealt, SourceDamageTaken, TargetDamageDealt, TargetDamageTaken     float64
	SourceHpLoss, TargetHpLoss, SourceOverheal, TargetOverheal                     float64
	SourceVampHealing, TargetVampHealing, SourceDirectHealing, TargetDirectHealing float64
	AbilityAttemptCount, AttemptSkippedCount                                       int
}

type abilityStatAcc struct {
	abilityRef                         string
	attemptCount, castCount, skipCount int
	damageDealt, healingDone           *float64
}

type damageRecord struct {
	timeMs               int64
	sourceKey, targetKey string
	amount               float64
}

type damageBreakdownKey struct{ owner, source, target, ability, operation, damageType, definition string }

// StateAPI 汇总报告的累计、明细及观察能力；数值累计不依赖明细是否保留。
type StateAPI interface {
	// Totals 返回双方已提交数值的累计副本。
	Totals() Totals
	// InitBasicRecords 初始化普攻、机制及伤害明细预算，预算越界时返回false。
	InitBasicRecords(b *model.RecordBudget) bool
	// InitSkillRecords 初始化技能行动、使用及治疗明细预算，预算越界时返回false。
	InitSkillRecords(b *model.RecordBudget) bool
	// InitResourceRecords 校验资源明细预算，按开关初始化资源累计与明细容器。
	InitResourceRecords(b *model.RecordBudget, enabled bool) bool
	// InitAutomaticRecords 初始化自动释放明细预算，预算越界时返回false。
	InitAutomaticRecords(b *model.RecordBudget) bool
	// EnsureAbility 为指定能力建立累计项，未发生的伤害或治疗仍保持缺失。
	EnsureAbility(ref string)
	// Attempt 同时增加全场与指定能力的尝试次数。
	Attempt(ref string)
	// Skip 同时增加全场与指定能力的跳过次数。
	Skip(ref string)
	// Cast 增加指定能力已接受的释放次数。
	Cast(ref string)
	// AbilityOutput 将实际伤害与治疗累加到指定能力；零值不补造缺失字段。
	AbilityOutput(ref string, damage, healing float64)
	// AbilityStats 返回按能力标识排序的独立累计结果。
	AbilityStats() []model.AbilityStat
	// RecordDamage 累计正数伤害，并在启用采样时保存观察窗口所需的历史事实。
	RecordDamage(source, target string, amount float64, timeMs int64)
	// RecordOverheal 累计指定角色的正数过量治疗。
	RecordOverheal(source string, amount float64)
	// RecordCommittedDamage 累计已提交伤害及归属分解，返回是否还有伤害明细额度。
	RecordCommittedDamage(fact DamageFact, detailed bool) bool
	// AppendDamageDetails 追加已获准保留的伤害明细，调用方须先核定额度。
	AppendDamageDetails(data map[string]interface{})
	// AddTargetMark 累加已提交的目标标记消费分类计数。
	AddTargetMark(value model.TargetMarkSummary)
	// TargetMarkSummary 返回目标标记累计副本。
	TargetMarkSummary() model.TargetMarkSummary
	// AppendAttack 在启用明细且额度充足时保存普攻记录，返回索引，否则返回-1。
	AppendAttack(record model.BasicAttackRecord, detailed bool) int
	// AttackRecordCount 返回已保留的普攻明细条数。
	AttackRecordCount() int
	// AttackStartAt 读取已保留普攻的开始时刻，索引无效时返回false。
	AttackStartAt(index int) (int64, bool)
	// SetAttackActionReadyAt 为有效索引记录关联的行动就绪时刻，索引无效时不修改。
	SetAttackActionReadyAt(index int, readyAt *int64)
	// ReplaceAttackRecord 替换有效索引的普攻记录，索引无效时不修改。
	ReplaceAttackRecord(index int, row model.BasicAttackRecord)
	// RecordMechanic 可靠累计机制记录数，并按明细开关及预算保留记录。
	RecordMechanic(row model.MechanicRecord, detailed bool)
	// RecordSkillAction 可靠累计技能行动数，并按明细开关及预算保留记录。
	RecordSkillAction(row model.SkillActionRecord, detailed bool)
	// BeginSkillUse 累计技能使用数，并返回是否允许随后追加该次明细。
	BeginSkillUse(detailed bool) bool
	// AppendSkillUse 保存已获准保留的使用明细，调用方须先通过 BeginSkillUse。
	AppendSkillUse(row model.SkillUseRecord)
	// RecordDirectHealing 累计实际直接治疗与记录数，并按预算保留明细。
	RecordDirectHealing(row model.DirectHealingRecord, detailed bool)
	// RecordResourceChange 累计已提交资源变化，并按预算保留明细；须先启用资源累计。
	RecordResourceChange(row model.ResourceChangeRecord, detailed bool)
	// ResourceSummary 返回补入双方最终上限的资源累计副本，未启用时返回nil。
	ResourceSummary(sourceMax, targetMax float64) *model.ResourceChangeSummary
	// RecordAutomatic 分配稳定记录序号、累计自动释放数，并按预算保留明细。
	RecordAutomatic(row model.AutomaticSkillRecord, timeMs int64, detailed bool)
	// AutomaticRecording 返回自动释放明细的保留、遗漏及截断计数。
	AutomaticRecording(detailed bool) *model.AutomaticSkillRecording
	// Recording 按实际总数、保留条数与明细开关生成各类记录摘要。
	Recording(attacks int, detailed bool) model.RecordingSummary
	// RecordEvidence 累计真实证据种类与额度，并按明细开关决定是否保存内容。
	RecordEvidence(item model.EvidenceItem, detailed bool, limit int)
	// TruncatedEvidenceKinds 返回按名称排序的未完整保留证据种类。
	TruncatedEvidenceKinds(detailed bool) []string
	// EvidenceTruncation 返回是否发生证据截断及被截断的条数。
	EvidenceTruncation() (bool, int)
	// InitSampling 校验观察间隔、点数预算及32位输出范围，按时长提高有效采样间隔。
	InitSampling(config model.SamplingConfig, start, duration int64) bool
	// Sampling 返回当前采样配置副本。
	Sampling() model.SamplingConfig
	// EffectiveSampleEveryMs 返回预算调整后的实际采样间隔。
	EffectiveSampleEveryMs() int64
	// NextSample 返回下一采样时刻及该时刻是否仍在启用的观察范围内。
	NextSample() (int64, bool)
	// AppendSample 追加观察点，不推进采样游标。
	AppendSample(point model.SeriesPoint)
	// AdvanceSample 追加观察点，并按有效间隔推进游标；下个时刻越出窗口时标记耗尽，不计算溢出时刻。
	AdvanceSample(point model.SeriesPoint)
	// NeedsFinalSample 判断启用采样后是否还缺少指定结束时刻的观察点。
	NeedsFinalSample(timeMs int64) bool
	// SeriesPoint 使用累计伤害、窗口历史及传入生命值构造观察点，不改战斗状态。
	SeriesPoint(timeMs int64, sourceHp, targetHp float64) model.SeriesPoint
	// DamageInWindow 按造成或承受方向累计包含起止端点的历史伤害。
	DamageInWindow(key string, dealer bool, from, to int64) float64
	// FinalizeSeries 按点数预算抽样；非最终读取返回独立切片，最终读取可交出原容器。
	FinalizeSeries(final bool) ([]model.SeriesPoint, bool)
	// SeriesCount 返回已保留的观察点数。
	SeriesCount() int
	// Snapshot 返回独立报告快照，原状态仍可继续接收已提交事实。
	Snapshot() Output
	// Finish 交出最终展示容器并清空本状态；调用方接管返回的映射、切片和指针。
	Finish() Output
}

// State 私有保存可靠累计、有限明细及观察游标，不调度或修改战斗状态。
type State struct {
	totals                                                          Totals
	abilityStats                                                    map[string]*abilityStatAcc
	damageHistory                                                   []damageRecord
	targetMarkSummary                                               model.TargetMarkSummary
	resourceChangeRecords                                           []model.ResourceChangeRecord
	resourceChangeSummary                                           *model.ResourceChangeSummary
	maxResourceChangeRecords                                        int
	skillActionRecords                                              []model.SkillActionRecord
	skillUseRecords                                                 []model.SkillUseRecord
	healingRecords                                                  []model.DirectHealingRecord
	skillActionRecordCount, skillUseRecordCount, healingRecordCount int
	maxSkillActionRecords, maxSkillUseRecords, maxHealingRecords    int
	attackRecords                                                   []model.BasicAttackRecord
	mechanicRecords                                                 []model.MechanicRecord
	mechanicRecordCount, maxMechanicRecords                         int
	damageRecords                                                   []map[string]interface{}
	damageBreakdown                                                 []model.DamageBreakdown
	damageBreakdownIndex                                            map[damageBreakdownKey]int
	damageRecordCount, maxAttackRecords, maxDamageRecords           int
	evidence                                                        []model.EvidenceItem
	evidenceTruncated                                               bool
	truncatedEvidenceCount, evidenceRetainedCount                   int
	evidenceCountsByKind, evidenceRetainedByKind                    map[string]int
	series                                                          []model.SeriesPoint
	sampling                                                        model.SamplingConfig
	samplingExhausted                                               bool
	effectiveSampleEveryMs, nextSampleAtMs, startMs, durationMs     int64
	automaticRecords                                                []model.AutomaticSkillRecord
	automaticRecordCount, maxAutomaticRecords                       int
}

var _ StateAPI = (*State)(nil)

func (s *State) Totals() Totals { return s.totals }

func (s *State) InitBasicRecords(b *model.RecordBudget) bool {
	s.maxAttackRecords, s.maxDamageRecords = 1000, 2000
	s.attackRecords = []model.BasicAttackRecord{}
	s.mechanicRecords = []model.MechanicRecord{}
	s.damageRecords = []map[string]interface{}{}
	s.damageBreakdown = []model.DamageBreakdown{}
	if b != nil {
		if b.MaxMechanicRecords != nil {
			s.maxMechanicRecords = *b.MaxMechanicRecords
		}
		if b.MaxAttackRecords != nil {
			s.maxAttackRecords = *b.MaxAttackRecords
		}
		if b.MaxDamageRecords != nil {
			s.maxDamageRecords = *b.MaxDamageRecords
		}
	}
	return s.maxAttackRecords >= 0 && s.maxAttackRecords <= 4096 && s.maxDamageRecords >= 0 && s.maxDamageRecords <= 10000 && s.maxMechanicRecords >= 0 && s.maxMechanicRecords <= 10000
}

func (s *State) InitSkillRecords(b *model.RecordBudget) bool {
	s.skillActionRecords = []model.SkillActionRecord{}
	s.skillUseRecords = []model.SkillUseRecord{}
	s.healingRecords = []model.DirectHealingRecord{}
	s.maxSkillActionRecords, s.maxSkillUseRecords, s.maxHealingRecords = 1000, 2000, 2000
	if b != nil {
		if b.MaxSkillActionRecords != nil {
			s.maxSkillActionRecords = *b.MaxSkillActionRecords
		}
		if b.MaxSkillUseRecords != nil {
			s.maxSkillUseRecords = *b.MaxSkillUseRecords
		}
		if b.MaxHealingRecords != nil {
			s.maxHealingRecords = *b.MaxHealingRecords
		}
	}
	return s.maxSkillActionRecords >= 0 && s.maxSkillActionRecords <= 4096 && s.maxSkillUseRecords >= 0 && s.maxSkillUseRecords <= 10000 && s.maxHealingRecords >= 0 && s.maxHealingRecords <= 10000
}

func (s *State) InitResourceRecords(b *model.RecordBudget, enabled bool) bool {
	s.maxResourceChangeRecords = 1000
	if b != nil && b.MaxResourceChangeRecords != nil {
		s.maxResourceChangeRecords = *b.MaxResourceChangeRecords
	}
	if s.maxResourceChangeRecords < 0 || s.maxResourceChangeRecords > 10000 {
		return false
	}
	if enabled {
		s.resourceChangeSummary = &model.ResourceChangeSummary{}
		s.resourceChangeRecords = []model.ResourceChangeRecord{}
	}
	return true
}

func (s *State) InitAutomaticRecords(b *model.RecordBudget) bool {
	s.automaticRecords = []model.AutomaticSkillRecord{}
	s.maxAutomaticRecords = model.DefaultMaxAutomaticSkillRecords
	if b != nil && b.MaxAutomaticSkillRecords != nil {
		s.maxAutomaticRecords = *b.MaxAutomaticSkillRecords
	}
	return s.maxAutomaticRecords >= 0 && s.maxAutomaticRecords <= model.MaxAutomaticSkillRecords
}

// RetainedRecordCount 按实际明细或关闭明细时的预算口径计算保留数，不修改累计。
func RetainedRecordCount(total, returned, limit int, detailed bool) int {
	if detailed {
		return returned
	}
	if total < limit {
		return total
	}
	return limit
}
