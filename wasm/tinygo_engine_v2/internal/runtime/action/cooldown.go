package action

import "tinygo_engine_v2/internal/runtime/contract"

import (
	"math"
	"sort"
	"strconv"

	planbundle "tinygo_engine_v2/internal/plan"
)

const (
	stateScopeProvider             = "state_scope/provider"
	stateScopeProviderTarget       = "state_scope/provider_target"
	maxJSONSafeInteger       int64 = 9007199254740991
)

func InternalCooldownWaitKey(id contract.CooldownIdentity) CooldownWaitKey {
	part := func(value string) string { return strconv.Itoa(len(value)) + ":" + value }
	return CooldownWaitKey{Kind: "provider_cooldown", Owner: id.Owner, Key: part(id.ProviderRef) + part(id.Scope) + part(id.StateKey) + part(id.Target)}
}

type CooldownWaitKey struct {
	Kind, Owner, Key string
}

type CooldownWait struct {
	Key          CooldownWaitKey
	dependencies []contract.CooldownIdentity
	NotBefore    int64
	ReadyAt      int64
	Version      uint64
	Active       bool
}

// CooldownLedger 是每个拥有者唯一可写的冷却与等待账本。
// 帧首次修改时复制它，已发布的账本及其公式投影随后只读。
type CooldownLedger struct {
	entries []contract.CooldownSlot
	waits   []CooldownWait
	// 插入编号稳定；小表直接扫描，大表只在对应挂载的候选槽中核对完整身份。
	// 索引发布后只读，clone共享；新建槽位时复制索引及被追加的候选切片。
	entrySlots map[string][]int
	waitSlots  map[string][]int
	revision   uint64
}

func NewCooldownLedger() *CooldownLedger {
	return &CooldownLedger{}
}

// View 只借用当前版本；调用者沿既有写时复制规则保留冻结视图。
func (l *CooldownLedger) View() contract.CooldownView {
	if l == nil {
		return contract.CooldownView{}
	}
	return contract.BorrowCooldownView(l.entries, l.entrySlots, l.revision)
}

// EntryAt returns an identity and scalar value; no mutable slot escapes the ledger.
func (l *CooldownLedger) EntryAt(index int) (contract.CooldownIdentity, contract.CooldownEntry) {
	return l.entries[index].Identity, l.entries[index].Entry
}

func (l *CooldownLedger) EntryCount() int {
	if l == nil {
		return 0
	}
	return len(l.entries)
}

func (l *CooldownLedger) Revision() uint64 {
	if l == nil {
		return 0
	}
	return l.revision
}

func AbilityCooldownIdentity(owner, abilityRef string) contract.CooldownIdentity {
	id := contract.CooldownIdentity{Owner: owner, AbilityRef: abilityRef}
	if ref, ok := planbundle.ParseAbilityRef(abilityRef); ok {
		id.ProviderRef = ref.ProviderRef
	}
	return id
}

func AbilityCooldownOwner(fallback, abilityRef string) string {
	if ref, ok := planbundle.ParseAbilityRef(abilityRef); ok && ref.Combatant != "" && ref.Combatant != "self" && ref.Combatant != "opponent" {
		return ref.Combatant
	}
	return fallback
}

func StateCooldownIdentity(owner, provider, state, scope, target string) contract.CooldownIdentity {
	if scope != stateScopeProviderTarget {
		target = ""
	}
	return contract.CooldownIdentity{Owner: owner, ProviderRef: provider, StateKey: state, Scope: scope, Target: target}
}

func (l *CooldownLedger) Clone() *CooldownLedger {
	if l == nil {
		return NewCooldownLedger()
	}
	return &CooldownLedger{
		entries:    append([]contract.CooldownSlot(nil), l.entries...),
		waits:      append([]CooldownWait(nil), l.waits...),
		entrySlots: l.entrySlots, waitSlots: l.waitSlots, revision: l.revision,
	}
}

const cooldownLinearSlots = 16

func cooldownEntryBucket(id contract.CooldownIdentity) string {
	if id.ProviderRef != "" {
		return id.ProviderRef
	}
	return id.AbilityRef
}

func (l *CooldownLedger) entryIndex(id contract.CooldownIdentity) int {
	if l == nil {
		return -1
	}
	if l.entrySlots != nil {
		for _, index := range l.entrySlots[cooldownEntryBucket(id)] {
			if l.entries[index].Identity == id {
				return index
			}
		}
		return -1
	}
	for index := range l.entries {
		if l.entries[index].Identity == id {
			return index
		}
	}
	return -1
}

func (l *CooldownLedger) Entry(id contract.CooldownIdentity) (contract.CooldownEntry, bool) {
	if index := l.entryIndex(id); index >= 0 {
		return l.entries[index].Entry, true
	}
	return contract.CooldownEntry{}, false
}

func (l *CooldownLedger) EntryValue(id contract.CooldownIdentity) contract.CooldownEntry {
	value, _ := l.Entry(id)
	return value
}

func (l *CooldownLedger) appendEntry(id contract.CooldownIdentity, value contract.CooldownEntry) {
	l.entries = append(l.entries, contract.CooldownSlot{Identity: id, Entry: value})
	if l.entrySlots == nil {
		if len(l.entries) <= cooldownLinearSlots {
			return
		}
		l.entrySlots = make(map[string][]int)
		for index, slot := range l.entries {
			bucket := cooldownEntryBucket(slot.Identity)
			l.entrySlots[bucket] = append(l.entrySlots[bucket], index)
		}
		return
	}
	bucket := cooldownEntryBucket(id)
	l.entrySlots = appendCooldownSlotIndex(l.entrySlots, bucket, len(l.entries)-1)
}

// 不能只复制外层表：未修改的候选切片仍可能属于已冻结账本。
func appendCooldownSlotIndex(before map[string][]int, key string, index int) map[string][]int {
	out := make(map[string][]int, len(before)+1)
	for key, slots := range before {
		out[key] = slots
	}
	slots := make([]int, len(before[key])+1)
	copy(slots, before[key])
	slots[len(slots)-1] = index
	out[key] = slots
	return out
}

func (l *CooldownLedger) waitIndex(key CooldownWaitKey) int {
	if l == nil {
		return -1
	}
	if l.waitSlots != nil {
		for _, index := range l.waitSlots[key.Key] {
			if l.waits[index].Key == key {
				return index
			}
		}
		return -1
	}
	for index := range l.waits {
		if l.waits[index].Key == key {
			return index
		}
	}
	return -1
}

func (l *CooldownLedger) WaitValue(key CooldownWaitKey) CooldownWait {
	if index := l.waitIndex(key); index >= 0 {
		return l.waits[index]
	}
	return CooldownWait{}
}

func (l *CooldownLedger) appendWait(wait CooldownWait) {
	l.waits = append(l.waits, wait)
	if l.waitSlots == nil {
		if len(l.waits) <= cooldownLinearSlots {
			return
		}
		l.waitSlots = make(map[string][]int)
		for index, wait := range l.waits {
			l.waitSlots[wait.Key.Key] = append(l.waitSlots[wait.Key.Key], index)
		}
		return
	}
	l.waitSlots = appendCooldownSlotIndex(l.waitSlots, wait.Key.Key, len(l.waits)-1)
}

func (l *CooldownLedger) ReadyAt(id contract.CooldownIdentity) int64 {
	if l == nil {
		return 0
	}
	return l.EntryValue(id).ReadyAt
}

func (l *CooldownLedger) AbilityReadyAt(owner, abilityRef string) int64 {
	return l.ReadyAt(AbilityCooldownIdentity(owner, abilityRef))
}

func CooldownLedgerFromDeadlines(owner string, deadlines map[string]int64) *CooldownLedger {
	l := NewCooldownLedger()
	refs := make([]string, 0, len(deadlines))
	for ref := range deadlines {
		refs = append(refs, ref)
	}
	sort.Strings(refs)
	for _, ref := range refs {
		ready := deadlines[ref]
		l.Set(AbilityCooldownIdentity(owner, ref), ready, 0)
	}
	return l
}

func (l *CooldownLedger) Version(id contract.CooldownIdentity) uint64 {
	if l == nil {
		return 0
	}
	return l.EntryValue(id).Version
}

func (l *CooldownLedger) Remaining(id contract.CooldownIdentity, now int64) int64 {
	if l == nil {
		return 0
	}
	entry := l.EntryValue(id)
	if !entry.Active || now >= entry.ReadyAt {
		return 0
	}
	return entry.ReadyAt - now
}

func (l *CooldownLedger) IsReady(id contract.CooldownIdentity, now int64) bool {
	return l.Remaining(id, now) == 0
}

// set 更新唯一截止，并使读取该冷却的所有等待统一失效、改期。
func (l *CooldownLedger) Set(id contract.CooldownIdentity, readyAt, now int64) bool {
	if l == nil {
		return false
	}
	index := l.entryIndex(id)
	active := readyAt > now
	if index >= 0 && l.entries[index].Entry.ReadyAt == readyAt && l.entries[index].Entry.Active == active {
		return false
	}
	l.revision++
	value := l.EntryValue(id)
	if !active || !value.Active || value.ReadyAt <= now {
		value.OrdinaryTotalMs, value.HasOrdinaryTotal = 0, false
	}
	value.ReadyAt, value.Active, value.Version = readyAt, active, l.revision
	if index >= 0 {
		l.entries[index].Entry = value
	} else {
		l.appendEntry(id, value)
	}
	for index, wait := range l.waits {
		if !wait.Active || !cooldownWaitContains(wait, id) {
			continue
		}
		wait.ReadyAt = l.waitDeadline(wait, now)
		wait.Version = l.revision
		l.waits[index] = wait
	}
	return true
}

// Only a real process cooldown commit can create this provenance. Ordinary
// reduce/extend keep it; becoming ready clears it. Deadlines alone cannot restore it.
func (l *CooldownLedger) CommitOrdinary(id contract.CooldownIdentity, readyAt, now int64) {
	l.Set(id, readyAt, now)
	if index := l.entryIndex(id); index >= 0 {
		entry := &l.entries[index].Entry
		entry.HasOrdinaryTotal = readyAt > now
		entry.OrdinaryTotalMs = 0
		if entry.HasOrdinaryTotal {
			entry.OrdinaryTotalMs = readyAt - now
		}
	}
}

func (l *CooldownLedger) Start(id contract.CooldownIdentity, duration, now int64) (changed, valid bool) {
	if !l.IsReady(id, now) {
		return false, true
	}
	if duration <= 0 || now > math.MaxInt64-duration {
		return false, false
	}
	ready := now + duration
	if ready > maxJSONSafeInteger {
		return false, false
	}
	return l.Set(id, ready, now), true
}

func (l *CooldownLedger) Reset(id contract.CooldownIdentity, now int64) bool {
	return l.Set(id, 0, now)
}

func (l *CooldownLedger) Subtract(id contract.CooldownIdentity, delta, now int64) (changed, expired bool, readyAt int64) {
	if delta < 0 || l.IsReady(id, now) {
		return false, false, 0
	}
	remaining := l.Remaining(id, now)
	if delta >= remaining {
		return l.Reset(id, now), true, 0
	}
	readyAt = now + remaining - delta
	return l.Set(id, readyAt, now), false, readyAt
}

func (l *CooldownLedger) RemoveProvider(owner, provider string, now int64) {
	if l == nil {
		return
	}
	keys := make([]contract.CooldownIdentity, 0)
	for _, slot := range l.entries {
		id := slot.Identity
		if id.Owner == owner && id.ProviderRef == provider {
			keys = append(keys, id)
		}
	}
	SortCooldownIdentities(keys)
	for _, id := range keys {
		// 保留版本墓碑，重新挂载同名实例也不能复用旧事件身份。
		l.invalidate(id, now)
	}
}

func (l *CooldownLedger) RemoveTarget(owner, provider, target string, now int64) {
	if l == nil {
		return
	}
	keys := make([]contract.CooldownIdentity, 0)
	for _, slot := range l.entries {
		id := slot.Identity
		if id.Owner == owner && id.ProviderRef == provider && id.Scope == stateScopeProviderTarget && id.Target == target {
			keys = append(keys, id)
		}
	}
	SortCooldownIdentities(keys)
	for _, id := range keys {
		l.invalidate(id, now)
	}
}

func (l *CooldownLedger) invalidate(id contract.CooldownIdentity, now int64) {
	if l == nil {
		return
	}
	l.revision++
	value := contract.CooldownEntry{Version: l.revision}
	if index := l.entryIndex(id); index >= 0 {
		l.entries[index].Entry = value
	} else {
		l.appendEntry(id, value)
	}
	for index, wait := range l.waits {
		if wait.Active && cooldownWaitContains(wait, id) {
			wait.ReadyAt, wait.Version = l.waitDeadline(wait, now), l.revision
			if wait.Key.Kind == "provider_cooldown" {
				wait.Active = false
			}
			l.waits[index] = wait
		}
	}
}

func cooldownWaitContains(wait CooldownWait, id contract.CooldownIdentity) bool {
	for _, dependency := range wait.dependencies {
		if dependency == id {
			return true
		}
	}
	return false
}

func (l *CooldownLedger) waitDeadline(wait CooldownWait, now int64) int64 {
	ready := now
	if wait.NotBefore > ready {
		ready = wait.NotBefore
	}
	for _, id := range wait.dependencies {
		if remaining := l.Remaining(id, now); remaining > 0 && now+remaining > ready {
			ready = now + remaining
		}
	}
	return ready
}

func sameCooldownDependencies(left, right []contract.CooldownIdentity) bool {
	if len(left) != len(right) {
		return false
	}
	for i, id := range left {
		if id != right[i] {
			return false
		}
	}
	return true
}

// registerWait 为一个等待身份建立唯一登记。重新登记会替换依赖；旧事件只核对版本。
// notBefore 只表达占用或弹药的行动许可，不写入任何能力CD。
func (l *CooldownLedger) RegisterWait(key CooldownWaitKey, dependencies []contract.CooldownIdentity, notBefore, now int64) CooldownWait {
	if l == nil {
		return CooldownWait{}
	}
	wait := CooldownWait{Key: key, dependencies: dependencies, NotBefore: notBefore, Active: true}
	wait.ReadyAt = l.waitDeadline(wait, now)
	index := l.waitIndex(key)
	if index >= 0 {
		old := l.waits[index]
		if old.Active && old.NotBefore == notBefore && old.ReadyAt == wait.ReadyAt && sameCooldownDependencies(old.dependencies, dependencies) {
			return old
		}
	}
	l.revision++
	wait.Version = l.revision
	wait.dependencies = append([]contract.CooldownIdentity(nil), dependencies...)
	if index >= 0 {
		l.waits[index] = wait
	} else {
		l.appendWait(wait)
	}
	return wait
}

func (l *CooldownLedger) CancelWait(key CooldownWaitKey) {
	index := l.waitIndex(key)
	if index < 0 || !l.waits[index].Active {
		return
	}
	l.revision++
	l.waits[index].Active, l.waits[index].Version = false, l.revision
}

func (l *CooldownLedger) Wait(key CooldownWaitKey) (CooldownWait, bool) {
	index := l.waitIndex(key)
	if index < 0 {
		return CooldownWait{}, false
	}
	wait := l.waits[index]
	return wait, wait.Active
}

func (l *CooldownLedger) WaitCurrent(key CooldownWaitKey, at int64, version uint64) bool {
	wait, exists := l.Wait(key)
	return exists && wait.Version == version && wait.ReadyAt == at
}

func (l *CooldownLedger) ChangedKeys(before *CooldownLedger) []contract.CooldownIdentity {
	if l == nil {
		return nil
	}
	keys := make([]contract.CooldownIdentity, 0)
	for index, slot := range l.entries {
		previous := contract.CooldownEntry{}
		if before != nil {
			if index < len(before.entries) && before.entries[index].Identity == slot.Identity {
				previous = before.entries[index].Entry
			} else {
				previous = before.EntryValue(slot.Identity)
			}
		}
		if before == nil || previous != slot.Entry {
			keys = append(keys, slot.Identity)
		}
	}
	SortCooldownIdentities(keys)
	return keys
}

func (l *CooldownLedger) ChangedWaits(before *CooldownLedger) []CooldownWait {
	if l == nil {
		return nil
	}
	waits := make([]CooldownWait, 0)
	for index, wait := range l.waits {
		if !wait.Active {
			continue
		}
		previous := CooldownWait{}
		if before != nil {
			if index < len(before.waits) && before.waits[index].Key == wait.Key {
				previous = before.waits[index]
			} else {
				previous = before.WaitValue(wait.Key)
			}
		}
		if before == nil || previous.Version != wait.Version {
			waits = append(waits, wait)
		}
	}
	sort.Slice(waits, func(i, j int) bool {
		left, right := waits[i].Key, waits[j].Key
		if left.Owner != right.Owner {
			return left.Owner < right.Owner
		}
		if left.Kind != right.Kind {
			return left.Kind < right.Kind
		}
		return left.Key < right.Key
	})
	return waits
}

func SortCooldownIdentities(keys []contract.CooldownIdentity) {
	sort.Slice(keys, func(i, j int) bool {
		left, right := keys[i], keys[j]
		if left.Owner != right.Owner {
			return left.Owner < right.Owner
		}
		if left.ProviderRef != right.ProviderRef {
			return left.ProviderRef < right.ProviderRef
		}
		if left.AbilityRef != right.AbilityRef {
			return left.AbilityRef < right.AbilityRef
		}
		if left.Scope != right.Scope {
			return left.Scope < right.Scope
		}
		if left.StateKey != right.StateKey {
			return left.StateKey < right.StateKey
		}
		return left.Target < right.Target
	})
}

// abilityDeadlines 只生成边界或测试使用的只读数值投影，不用于运行时写入。
func (l *CooldownLedger) AbilityDeadlines() map[string]int64 {
	out := make(map[string]int64)
	if l != nil {
		for _, slot := range l.entries {
			id, entry := slot.Identity, slot.Entry
			if id.AbilityRef != "" {
				out[id.AbilityRef] = entry.ReadyAt
			}
		}
	}
	return out
}

func (l *CooldownLedger) Snapshot(now int64) map[string]interface{} {
	out := make(map[string]interface{})
	if l != nil {
		for _, slot := range l.entries {
			id, entry := slot.Identity, slot.Entry
			if id.AbilityRef != "" {
				out[id.AbilityRef] = map[string]interface{}{"readyAtMs": entry.ReadyAt, "remainingMs": l.Remaining(id, now)}
			}
		}
	}
	return out
}
