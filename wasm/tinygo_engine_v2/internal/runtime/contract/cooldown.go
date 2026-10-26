package contract

// 冷却身份和数值在子系统之间按值传递；拥有者和实际目标均参与身份。
type CooldownIdentity struct {
	Owner, ProviderRef, AbilityRef, StateKey, Scope, Target string
}

type CooldownEntry struct {
	ReadyAt          int64
	Active           bool
	Version          uint64
	OrdinaryTotalMs  int64
	HasOrdinaryTotal bool
}

type CooldownSlot struct {
	Identity CooldownIdentity
	Entry    CooldownEntry
}

// CooldownView 借用已冻结的冷却槽和索引，仅返回单条值。
// 构造者负责在下一次写入前复制槽；视图不提供底层集合。
type CooldownView struct {
	slots    []CooldownSlot
	index    map[string][]int
	revision uint64
	present  bool
}

func BorrowCooldownView(slots []CooldownSlot, index map[string][]int, revision uint64) CooldownView {
	return CooldownView{slots: slots, index: index, revision: revision, present: true}
}

func (v CooldownView) Present() bool    { return v.present }
func (v CooldownView) Len() int         { return len(v.slots) }
func (v CooldownView) Revision() uint64 { return v.revision }
func (v CooldownView) At(index int) (CooldownIdentity, CooldownEntry) {
	return v.slots[index].Identity, v.slots[index].Entry
}

func (v CooldownView) Lookup(id CooldownIdentity) (CooldownEntry, bool) {
	if v.index != nil {
		bucket := id.ProviderRef
		if bucket == "" {
			bucket = id.AbilityRef
		}
		for _, index := range v.index[bucket] {
			if v.slots[index].Identity == id {
				return v.slots[index].Entry, true
			}
		}
		return CooldownEntry{}, false
	}
	for _, slot := range v.slots {
		if slot.Identity == id {
			return slot.Entry, true
		}
	}
	return CooldownEntry{}, false
}

func (v CooldownView) Remaining(id CooldownIdentity, now int64) int64 {
	entry, _ := v.Lookup(id)
	if !entry.Active || now >= entry.ReadyAt {
		return 0
	}
	return entry.ReadyAt - now
}
