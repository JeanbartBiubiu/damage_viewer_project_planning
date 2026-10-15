package runtime

import (
	"sort"

	planbundle "tinygo_engine_v2/internal/plan"
)

// 冷却身份使用实际挂载和实际目标，能力与内部状态不会因显示名相同而合并。
type genericCooldownIdentity struct {
	owner, providerRef, abilityRef, stateKey, scope, target string
}

type genericCooldownEntry struct {
	readyAt int64
	active  bool
	version uint64
}

type genericCooldownWaitKey struct {
	kind, owner, key string
}

type genericCooldownWait struct {
	key          genericCooldownWaitKey
	dependencies []genericCooldownIdentity
	notBefore    int64
	readyAt      int64
	version      uint64
	active       bool
}

// genericCooldownLedger 是每个拥有者唯一可写的冷却与等待账本。
// 帧首次修改时复制它，已发布的账本及其公式投影随后只读。
type genericCooldownLedger struct {
	entries  map[genericCooldownIdentity]genericCooldownEntry
	waits    map[genericCooldownWaitKey]genericCooldownWait
	revision uint64
}

func newGenericCooldownLedger() *genericCooldownLedger {
	return &genericCooldownLedger{entries: make(map[genericCooldownIdentity]genericCooldownEntry), waits: make(map[genericCooldownWaitKey]genericCooldownWait)}
}

func genericAbilityCooldownIdentity(owner, abilityRef string) genericCooldownIdentity {
	id := genericCooldownIdentity{owner: owner, abilityRef: abilityRef}
	if ref, ok := planbundle.ParseAbilityRef(abilityRef); ok {
		id.providerRef = ref.ProviderRef
	}
	return id
}

func genericAbilityCooldownOwner(fallback, abilityRef string) string {
	if ref, ok := planbundle.ParseAbilityRef(abilityRef); ok && ref.Combatant != "" && ref.Combatant != "self" && ref.Combatant != "opponent" {
		return ref.Combatant
	}
	return fallback
}

func genericStateCooldownIdentity(owner, provider, state, scope, target string) genericCooldownIdentity {
	if scope != stateScopeProviderTarget {
		target = ""
	}
	return genericCooldownIdentity{owner: owner, providerRef: provider, stateKey: state, scope: scope, target: target}
}

func (l *genericCooldownLedger) clone() *genericCooldownLedger {
	if l == nil {
		return newGenericCooldownLedger()
	}
	out := newGenericCooldownLedger()
	out.revision = l.revision
	for key, entry := range l.entries {
		out.entries[key] = entry
	}
	for key, wait := range l.waits {
		// 等待依赖建立时冻结，之后只替换整条登记，可以共享只读切片。
		out.waits[key] = wait
	}
	return out
}

func (l *genericCooldownLedger) readyAt(id genericCooldownIdentity) int64 {
	if l == nil {
		return 0
	}
	return l.entries[id].readyAt
}

func (l *genericCooldownLedger) abilityReadyAt(owner, abilityRef string) int64 {
	return l.readyAt(genericAbilityCooldownIdentity(owner, abilityRef))
}

func genericCooldownLedgerFromDeadlines(owner string, deadlines map[string]int64) *genericCooldownLedger {
	l := newGenericCooldownLedger()
	refs := make([]string, 0, len(deadlines))
	for ref := range deadlines {
		refs = append(refs, ref)
	}
	sort.Strings(refs)
	for _, ref := range refs {
		ready := deadlines[ref]
		l.set(genericAbilityCooldownIdentity(owner, ref), ready, 0)
	}
	return l
}

func (l *genericCooldownLedger) version(id genericCooldownIdentity) uint64 {
	if l == nil {
		return 0
	}
	return l.entries[id].version
}

func (l *genericCooldownLedger) remaining(id genericCooldownIdentity, now int64) int64 {
	if l == nil {
		return 0
	}
	entry := l.entries[id]
	if !entry.active || now >= entry.readyAt {
		return 0
	}
	return entry.readyAt - now
}

func (l *genericCooldownLedger) isReady(id genericCooldownIdentity, now int64) bool {
	return l.remaining(id, now) == 0
}

// set 更新唯一截止，并使读取该冷却的所有等待统一失效、改期。
func (l *genericCooldownLedger) set(id genericCooldownIdentity, readyAt, now int64) bool {
	if l == nil {
		return false
	}
	if l.entries == nil {
		l.entries = make(map[genericCooldownIdentity]genericCooldownEntry)
	}
	previous, exists := l.entries[id]
	active := readyAt > now
	if exists && previous.readyAt == readyAt && previous.active == active {
		return false
	}
	l.revision++
	l.entries[id] = genericCooldownEntry{readyAt: readyAt, active: active, version: l.revision}
	for key, wait := range l.waits {
		if !wait.active || !cooldownWaitContains(wait, id) {
			continue
		}
		wait.readyAt = l.waitDeadline(wait, now)
		wait.version = l.revision
		l.waits[key] = wait
	}
	return true
}

func (l *genericCooldownLedger) start(id genericCooldownIdentity, duration, now int64) (changed, valid bool) {
	if !l.isReady(id, now) {
		return false, true
	}
	ready, valid := addDuration(now, duration)
	if !valid || duration <= 0 || ready > maxJSONSafeInteger {
		return false, false
	}
	return l.set(id, ready, now), true
}

func (l *genericCooldownLedger) reset(id genericCooldownIdentity, now int64) bool {
	return l.set(id, 0, now)
}

func (l *genericCooldownLedger) subtract(id genericCooldownIdentity, delta, now int64) (changed, expired bool, readyAt int64) {
	if delta < 0 || l.isReady(id, now) {
		return false, false, 0
	}
	remaining := l.remaining(id, now)
	if delta >= remaining {
		return l.reset(id, now), true, 0
	}
	readyAt = now + remaining - delta
	return l.set(id, readyAt, now), false, readyAt
}

func (l *genericCooldownLedger) removeProvider(owner, provider string, now int64) {
	if l == nil {
		return
	}
	keys := make([]genericCooldownIdentity, 0)
	for id := range l.entries {
		if id.owner == owner && id.providerRef == provider {
			keys = append(keys, id)
		}
	}
	sortCooldownIdentities(keys)
	for _, id := range keys {
		// 保留版本墓碑，重新挂载同名实例也不能复用旧事件身份。
		l.invalidate(id, now)
	}
}

func (l *genericCooldownLedger) removeTarget(owner, provider, target string, now int64) {
	if l == nil {
		return
	}
	keys := make([]genericCooldownIdentity, 0)
	for id := range l.entries {
		if id.owner == owner && id.providerRef == provider && id.scope == stateScopeProviderTarget && id.target == target {
			keys = append(keys, id)
		}
	}
	sortCooldownIdentities(keys)
	for _, id := range keys {
		l.invalidate(id, now)
	}
}

func (l *genericCooldownLedger) invalidate(id genericCooldownIdentity, now int64) {
	if l == nil {
		return
	}
	l.revision++
	l.entries[id] = genericCooldownEntry{version: l.revision}
	for key, wait := range l.waits {
		if wait.active && cooldownWaitContains(wait, id) {
			wait.readyAt, wait.version = l.waitDeadline(wait, now), l.revision
			if key.kind == "provider_cooldown" {
				wait.active = false
			}
			l.waits[key] = wait
		}
	}
}

func cooldownWaitContains(wait genericCooldownWait, id genericCooldownIdentity) bool {
	for _, dependency := range wait.dependencies {
		if dependency == id {
			return true
		}
	}
	return false
}

func (l *genericCooldownLedger) waitDeadline(wait genericCooldownWait, now int64) int64 {
	ready := now
	if wait.notBefore > ready {
		ready = wait.notBefore
	}
	for _, id := range wait.dependencies {
		if remaining := l.remaining(id, now); remaining > 0 && now+remaining > ready {
			ready = now + remaining
		}
	}
	return ready
}

func sameCooldownDependencies(left, right []genericCooldownIdentity) bool {
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
func (l *genericCooldownLedger) registerWait(key genericCooldownWaitKey, dependencies []genericCooldownIdentity, notBefore, now int64) genericCooldownWait {
	if l == nil {
		return genericCooldownWait{}
	}
	if l.waits == nil {
		l.waits = make(map[genericCooldownWaitKey]genericCooldownWait)
	}
	wait := genericCooldownWait{key: key, dependencies: dependencies, notBefore: notBefore, active: true}
	wait.readyAt = l.waitDeadline(wait, now)
	old, exists := l.waits[key]
	if exists && old.active && old.notBefore == notBefore && old.readyAt == wait.readyAt && sameCooldownDependencies(old.dependencies, dependencies) {
		return old
	}
	l.revision++
	wait.version = l.revision
	wait.dependencies = append([]genericCooldownIdentity(nil), dependencies...)
	l.waits[key] = wait
	return wait
}

func (l *genericCooldownLedger) cancelWait(key genericCooldownWaitKey) {
	if l == nil {
		return
	}
	wait, exists := l.waits[key]
	if !exists || !wait.active {
		return
	}
	l.revision++
	wait.active, wait.version = false, l.revision
	l.waits[key] = wait
}

func (l *genericCooldownLedger) wait(key genericCooldownWaitKey) (genericCooldownWait, bool) {
	if l == nil {
		return genericCooldownWait{}, false
	}
	wait, exists := l.waits[key]
	return wait, exists && wait.active
}

func (l *genericCooldownLedger) waitCurrent(key genericCooldownWaitKey, at int64, version uint64) bool {
	wait, exists := l.wait(key)
	return exists && wait.version == version && wait.readyAt == at
}

func (l *genericCooldownLedger) changedKeys(before *genericCooldownLedger) []genericCooldownIdentity {
	if l == nil {
		return nil
	}
	keys := make([]genericCooldownIdentity, 0)
	for id, entry := range l.entries {
		if before == nil || before.entries[id] != entry {
			keys = append(keys, id)
		}
	}
	sortCooldownIdentities(keys)
	return keys
}

func (l *genericCooldownLedger) changedWaits(before *genericCooldownLedger) []genericCooldownWait {
	if l == nil {
		return nil
	}
	waits := make([]genericCooldownWait, 0)
	for key, wait := range l.waits {
		if !wait.active {
			continue
		}
		if before == nil || before.waits[key].version != wait.version {
			waits = append(waits, wait)
		}
	}
	sort.Slice(waits, func(i, j int) bool {
		left, right := waits[i].key, waits[j].key
		if left.owner != right.owner {
			return left.owner < right.owner
		}
		if left.kind != right.kind {
			return left.kind < right.kind
		}
		return left.key < right.key
	})
	return waits
}

func sortCooldownIdentities(keys []genericCooldownIdentity) {
	sort.Slice(keys, func(i, j int) bool {
		left, right := keys[i], keys[j]
		if left.owner != right.owner {
			return left.owner < right.owner
		}
		if left.providerRef != right.providerRef {
			return left.providerRef < right.providerRef
		}
		if left.abilityRef != right.abilityRef {
			return left.abilityRef < right.abilityRef
		}
		if left.scope != right.scope {
			return left.scope < right.scope
		}
		if left.stateKey != right.stateKey {
			return left.stateKey < right.stateKey
		}
		return left.target < right.target
	})
}

// abilityDeadlines 只生成边界或测试使用的只读数值投影，不用于运行时写入。
func (l *genericCooldownLedger) abilityDeadlines() map[string]int64 {
	out := make(map[string]int64)
	if l != nil {
		for id, entry := range l.entries {
			if id.abilityRef != "" {
				out[id.abilityRef] = entry.readyAt
			}
		}
	}
	return out
}

func (l *genericCooldownLedger) snapshot(now int64) map[string]interface{} {
	out := make(map[string]interface{})
	if l != nil {
		for id, entry := range l.entries {
			if id.abilityRef != "" {
				out[id.abilityRef] = map[string]interface{}{"readyAtMs": entry.readyAt, "remainingMs": l.remaining(id, now)}
			}
		}
	}
	return out
}
