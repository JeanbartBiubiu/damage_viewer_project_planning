package usage

import (
	"math"
	"strings"

	"tinygo_engine_v2/internal/model"
)

// AmountKey 在完整原使用身份上区分实际被计量对象，不用对象显示名代替身份。
type AmountKey struct {
	Key
	SubjectRef string
}

// AmountEntry 是本账已提交数值的独立快照；不携带可写记录或未提交预留。
type AmountEntry struct {
	Key                 AmountKey
	UseSkillKey         string
	MaxValue, UsedValue float64
}

// AmountReservation 是数值预留的只读凭据，零值没有可提交的数量。
// 累计前后值固定于预留时，包含当时同身份的待提交量；释放其它凭据不会重写该视图。
type AmountReservation struct {
	ledger                     *Ledger
	token                      *amountToken
	previous, granted, current float64
}

type amountRecord struct {
	key          AmountKey
	useSkillKey  string
	maximum      float64
	used         float64
	reserved     float64
	reservations *amountToken
	next         *amountRecord
}

type amountToken struct {
	record  *amountRecord
	granted float64
	pending bool
	next    *amountToken
}

// Previous 返回授予本凭据前已提交与待提交的累计量。
func (r AmountReservation) Previous() float64 { return r.previous }

// Granted 返回本次实际预留量；为0时没有可提交凭据。
func (r AmountReservation) Granted() float64 { return r.granted }

// Current 返回本次授权后的累计视图，不随后续提交或释放改写。
func (r AmountReservation) Current() float64 { return r.current }

func (s *Ledger) ReserveAmount(key AmountKey, useSkillKey string, maxValue, requested float64) (AmountReservation, *model.EngineError) {
	if err := s.validateAmountRequest(key, useSkillKey, maxValue, requested); err != nil {
		return AmountReservation{}, err
	}
	hash := amountKeyHash(key)
	entry := s.lookupAmount(hash, key)
	previous := float64(0)
	if entry != nil {
		if entry.maximum != maxValue {
			return AmountReservation{}, s.error(model.GenericErrRuntimeInvariantFailed, "amount budget maximum changed for the same identity", "useAmountBudgets.maxValue", key.SubjectRef)
		}
		if entry.useSkillKey != useSkillKey {
			return AmountReservation{}, s.error(model.GenericErrRuntimeInvariantFailed, "amount budget use skill changed for the same identity", "useAmountBudgets.useSkillKey", key.UseKey)
		}
		previous = math.Min(maxValue, entry.used+entry.reserved)
	}
	granted := math.Min(requested, math.Max(0, maxValue-previous))
	current := math.Min(maxValue, previous+granted)
	if current == previous {
		granted = 0
	}
	view := AmountReservation{previous: previous, granted: granted, current: current}
	if granted == 0 {
		return view, nil
	}
	if entry == nil {
		if s.count >= MaxEntries {
			err := s.error(model.GenericErrRuntimeInvariantFailed, "useTriggerLedger exceeded dedicated budget", "", "")
			err.BudgetCause = model.BudgetCauseMaxUseTriggerLedger
			return AmountReservation{}, err
		}
		if s.amountBuckets == nil {
			s.amountBuckets = make(map[uint64]*amountRecord)
		}
		entry = &amountRecord{key: key, useSkillKey: useSkillKey, maximum: maxValue, next: s.amountBuckets[hash]}
		s.amountBuckets[hash] = entry
		s.count++
	}
	token := &amountToken{record: entry, granted: granted, pending: true, next: entry.reservations}
	entry.reservations = token
	entry.reserved += granted
	s.pending++
	view.ledger, view.token = s, token
	return view, nil
}

func (s *Ledger) CommitAmount(reservation AmountReservation) {
	if reservation.ledger != s || reservation.token == nil || !reservation.token.pending {
		return
	}
	token := reservation.token
	entry := token.record
	if !s.finishAmountToken(token) {
		return
	}
	entry.used = math.Min(entry.maximum, entry.used+token.granted)
}

func (s *Ledger) ReleaseAmount(reservation AmountReservation) {
	if reservation.ledger != s || reservation.token == nil || !reservation.token.pending {
		return
	}
	token := reservation.token
	entry := token.record
	if !s.finishAmountToken(token) || entry.used != 0 || entry.reservations != nil {
		return
	}
	hash := amountKeyHash(entry.key)
	var previous *amountRecord
	for current := s.amountBuckets[hash]; current != nil; current = current.next {
		if current != entry {
			previous = current
			continue
		}
		if previous == nil {
			if current.next == nil {
				delete(s.amountBuckets, hash)
			} else {
				s.amountBuckets[hash] = current.next
			}
		} else {
			previous.next = current.next
		}
		s.count--
		return
	}
}

func (s *Ledger) SnapshotAmounts() []AmountEntry {
	rows := make([]AmountEntry, 0, s.count)
	if s.count == 0 {
		return rows
	}
	for _, first := range s.amountBuckets {
		for entry := first; entry != nil; entry = entry.next {
			if entry.used > 0 {
				rows = append(rows, AmountEntry{Key: entry.key, UseSkillKey: entry.useSkillKey, MaxValue: entry.maximum, UsedValue: entry.used})
			}
		}
	}
	for index := 0; index < len(rows); index++ {
		for other := index + 1; other < len(rows); other++ {
			if amountEntryLess(rows[other], rows[index]) {
				rows[index], rows[other] = rows[other], rows[index]
			}
		}
	}
	return rows
}

func (s *Ledger) validateAmountRequest(key AmountKey, useSkillKey string, maximum, requested float64) *model.EngineError {
	if math.IsNaN(maximum) || math.IsInf(maximum, 0) || maximum <= 0 {
		return s.error(model.GenericErrRuntimeInvariantFailed, "amount budget maximum must be finite and positive", "useAmountBudgets.maxValue", key.SubjectRef)
	}
	if math.IsNaN(requested) || math.IsInf(requested, 0) || requested < 0 {
		return s.error(model.GenericErrRuntimeInvariantFailed, "amount budget request must be finite and nonnegative", "useAmountBudgets.requested", key.SubjectRef)
	}
	if strings.TrimSpace(key.Owner) == "" || strings.TrimSpace(key.ProviderRef) == "" || strings.TrimSpace(key.GroupKey) == "" ||
		strings.TrimSpace(key.UseSource) == "" || strings.TrimSpace(key.UseKey) == "" || strings.TrimSpace(useSkillKey) == "" || strings.TrimSpace(key.SubjectRef) == "" {
		return s.error(model.GenericErrMissingRequiredField, "amount budget identity must be complete", "useAmountBudgets", key.UseKey)
	}
	if key.Scope != model.OncePerUseScopeProvider && key.Scope != model.OncePerUseScopeProviderTarget {
		return s.error(model.GenericErrUnknownRef, "amount budget scope must be provider or provider_target", "useAmountBudgets.scope", key.Scope)
	}
	if key.Scope == model.OncePerUseScopeProviderTarget && strings.TrimSpace(key.Target) == "" || key.Scope == model.OncePerUseScopeProvider && key.Target != "" {
		return s.error(model.GenericErrUnknownRef, "amount budget target must match its scope", "useAmountBudgets.target", key.Target)
	}
	return nil
}

func (s *Ledger) lookupAmount(hash uint64, key AmountKey) *amountRecord {
	for entry := s.amountBuckets[hash]; entry != nil; entry = entry.next {
		if entry.key == key {
			return entry
		}
	}
	return nil
}

func (s *Ledger) finishAmountToken(token *amountToken) bool {
	entry := token.record
	var previous *amountToken
	for current := entry.reservations; current != nil; current = current.next {
		if current != token {
			previous = current
			continue
		}
		if previous == nil {
			entry.reservations = current.next
		} else {
			previous.next = current.next
		}
		token.pending, token.next = false, nil
		entry.reserved = 0
		for remaining := entry.reservations; remaining != nil; remaining = remaining.next {
			entry.reserved += remaining.granted
		}
		if s.pending > 0 {
			s.pending--
		}
		return true
	}
	return false
}

func amountKeyHash(key AmountKey) uint64 { return hashPart(keyHash(key.Key), key.SubjectRef) }

func amountEntryLess(a, b AmountEntry) bool {
	left := [...]string{a.Key.Owner, a.Key.ProviderRef, a.Key.GroupKey, a.Key.Scope, a.Key.UseSource, a.Key.UseKey, a.UseSkillKey, a.Key.Target, a.Key.SubjectRef}
	right := [...]string{b.Key.Owner, b.Key.ProviderRef, b.Key.GroupKey, b.Key.Scope, b.Key.UseSource, b.Key.UseKey, b.UseSkillKey, b.Key.Target, b.Key.SubjectRef}
	for index, value := range left {
		if value != right[index] {
			return value < right[index]
		}
	}
	return false
}
