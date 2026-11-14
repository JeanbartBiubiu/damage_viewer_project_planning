// Package usage 私有持有命中和监听共同消费的同次使用额度。
package usage

import "tinygo_engine_v2/internal/model"

const MaxEntries = 1024

// Identity 指定本场额度错误的归属，不借用执行器或行动状态。
type Identity struct{ SchemaHash, RulesHash, SessionID string }

// Key 是共同额度的完整身份；使用技能不属于额度键，目标仅在目标范围内填写。
// 真实发动、事件来源和当前挂载的合法性由调用方在预留前核对。
type Key struct {
	Owner       string
	ProviderRef string
	GroupKey    string
	Scope       string
	UseSource   string
	UseKey      string
	Target      string
}

// GroupAuthorization 是调用方已核对为当前有效挂载的恢复依据。
// AnyUse 表示该组允许任意真实使用，否则只接受拥有者及 SkillKeys 指定的技能。
// 同身份的多项依据共同生效，不要求调用方合并或排列。
type GroupAuthorization struct {
	Owner       string
	ProviderRef string
	GroupKey    string
	Scope       string
	AnyUse      bool
	SkillKeys   []string
}

// UseIdentity 是调用方已登记的真实使用身份；历史使用可以不在本次集合中。
type UseIdentity struct{ UseKey, Source, SkillKey string }

// RestoreFacts 是恢复期间借用的有限事实；调用结束后额度账不保存这些切片。
type RestoreFacts struct {
	ActorKeys []string
	Groups    []GroupAuthorization
	Uses      []UseIdentity
}

// Reservation 是一次成功预留的只读凭据，零值表示没有预留。
// 凭据只属于原额度账；提交和失败释放均不允许作用于别场或后续重试。
type Reservation struct {
	ledger *Ledger
	record *record
}

// LedgerAPI 列出本场共同额度能力；调用方决定真实成功边界和失败释放时点。
type LedgerAPI interface {
	// Restore 按原顺序核对并恢复已提交记录，仅在新账初始化时调用。
	// 事实只在调用期间借用；失败保留此前已恢复的记录，不发布其他运行状态。
	Restore(rows []model.UseTriggerLedgerEntry, facts RestoreFacts) *model.EngineError
	// Reserve 按完整身份预留额度；已预留或提交返回 skip，容量不足返回原预算错误。
	// 调用方须先核对真实使用与挂载；失败不增加记录，也不消费其他运行预算。
	Reserve(key Key, useSkillKey string) (reservation Reservation, skip bool, err *model.EngineError)
	// Commit 在原帧成功边界提交该账的有效预留，重复提交和缺失凭据不产生变化。
	Commit(reservation Reservation)
	// Release 仅释放该账尚未提交的原预留；提交后的派生失败保留已消费额度。
	Release(reservation Reservation)
	// Snapshot 返回独立且按原身份顺序排列的已提交记录，不包含待提交预留。
	Snapshot() []model.UseTriggerLedgerEntry
	// ReserveAmount 在同一账中按完整身份预留数值；可用量扣除已提交和待提交量，可部分授权。
	// 上限须有限正数，请求须有限非负；同键的上限和使用技能不允许漂移。
	// 零授权不创建记录；调用方仍须先核对真实使用、挂载和额度对象。
	ReserveAmount(key AmountKey, useSkillKey string, maxValue, requested float64) (AmountReservation, *model.EngineError)
	// CommitAmount 在对应数值真正发布后提交本次有效预留，重复或跨账凭据不产生变化。
	CommitAmount(reservation AmountReservation)
	// ReleaseAmount 只撤回本账尚未提交的原预留，不删除此前已提交数量。
	ReleaseAmount(reservation AmountReservation)
	// SnapshotAmounts 返回独立且有序的已提交数值，不包含待提交量，不提供恢复能力。
	SnapshotAmounts() []AmountEntry
	// Len 返回一次额度与数值额度的记录总数，共同受MaxEntries约束，不借出可写账本。
	Len() int
	// Pending 返回两类尚未提交的预留总数，不决定战斗是否成功或完整。
	Pending() int
}

// Ledger 私有持有本场共同额度；开始使用后不得复制，每场只创建并共享一份。
type Ledger struct {
	identity      Identity
	buckets       map[uint64]*record
	amountBuckets map[uint64]*amountRecord
	count         int
	pending       int
}

type record struct {
	key         Key
	useSkillKey string
	reserved    bool
	committed   bool
	next        *record
}

var _ LedgerAPI = (*Ledger)(nil)

// New 在运行初始化时创建唯一共同额度账，不提前登记使用或消费额度。
func New(identity Identity) Ledger {
	return Ledger{identity: identity, buckets: make(map[uint64]*record)}
}

func (s *Ledger) Reserve(key Key, useSkillKey string) (reservation Reservation, skip bool, err *model.EngineError) {
	hash := keyHash(key)
	if previous := s.lookup(hash, key); previous != nil && (previous.committed || previous.reserved) {
		return Reservation{}, true, nil
	}
	if s.count >= MaxEntries {
		err := s.error(model.GenericErrRuntimeInvariantFailed, "useTriggerLedger exceeded dedicated budget", "", "")
		err.BudgetCause = model.BudgetCauseMaxUseTriggerLedger
		return Reservation{}, false, err
	}
	if s.buckets == nil {
		s.buckets = make(map[uint64]*record)
	}
	entry := &record{key: key, useSkillKey: useSkillKey, reserved: true, next: s.buckets[hash]}
	s.buckets[hash] = entry
	s.count++
	s.pending++
	return Reservation{ledger: s, record: entry}, false, nil
}

func (s *Ledger) Commit(reservation Reservation) {
	if reservation.ledger != s || reservation.record == nil || !reservation.record.reserved {
		return
	}
	reservation.record.reserved = false
	reservation.record.committed = true
	if s.pending > 0 {
		s.pending--
	}
}

func (s *Ledger) Release(reservation Reservation) {
	entry := reservation.record
	if reservation.ledger != s || entry == nil || !entry.reserved || entry.committed {
		return
	}
	hash := keyHash(entry.key)
	var previous *record
	for current := s.buckets[hash]; current != nil; current = current.next {
		if current != entry {
			previous = current
			continue
		}
		if previous == nil {
			if current.next == nil {
				delete(s.buckets, hash)
			} else {
				s.buckets[hash] = current.next
			}
		} else {
			previous.next = current.next
		}
		entry.reserved = false
		s.count--
		if s.pending > 0 {
			s.pending--
		}
		return
	}
}

func (s *Ledger) Len() int { return s.count }

func (s *Ledger) Pending() int { return s.pending }

func (s *Ledger) lookup(hash uint64, key Key) *record {
	for entry := s.buckets[hash]; entry != nil; entry = entry.next {
		if entry.key == key {
			return entry
		}
	}
	return nil
}

// 桶键仅用于定位，仍逐字段核对完整身份；避免含字符串的结构体映射触发反射哈希。
func keyHash(key Key) uint64 {
	hash := uint64(14695981039346656037)
	hash = hashPart(hash, key.Owner)
	hash = hashPart(hash, key.ProviderRef)
	hash = hashPart(hash, key.GroupKey)
	hash = hashPart(hash, key.Scope)
	hash = hashPart(hash, key.UseSource)
	hash = hashPart(hash, key.UseKey)
	return hashPart(hash, key.Target)
}

func hashPart(hash uint64, value string) uint64 {
	const prime = uint64(1099511628211)
	for index := 0; index < len(value); index++ {
		hash ^= uint64(value[index])
		hash *= prime
	}
	return hash * prime
}

func (s *Ledger) error(code model.GenericErrCode, message, path, ref string) *model.EngineError {
	err := model.NewEngineError(model.GenericPhaseRun, code, message)
	err.Path, err.Ref = path, ref
	err.SchemaHash, err.RulesHash, err.SessionID = s.identity.SchemaHash, s.identity.RulesHash, s.identity.SessionID
	return &err
}
