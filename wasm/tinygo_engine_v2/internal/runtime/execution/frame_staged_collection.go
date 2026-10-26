package execution

type frameStagedEntry struct {
	key   string
	value *stagedCombatant
}

// 常见双方条目保存在独立集合中，等待预检可共享集合而不持有父帧地址。
type frameStagedCollection struct {
	inline [2]frameStagedEntry
	count  int
	extra  map[string]*stagedCombatant
}

func (staged *frameStagedCollection) Lookup(key string) (*stagedCombatant, bool) {
	if staged == nil {
		return nil, false
	}
	for index := 0; index < staged.count; index++ {
		entry := staged.inline[index]
		if entry.key == key {
			return entry.value, true
		}
	}
	value, found := staged.extra[key]
	return value, found
}

func (staged *frameStagedCollection) Get(key string) *stagedCombatant {
	value, _ := staged.Lookup(key)
	return value
}

func (staged *frameStagedCollection) Set(key string, value *stagedCombatant) {
	for index := 0; index < staged.count; index++ {
		if staged.inline[index].key == key {
			staged.inline[index].value = value
			return
		}
	}
	if staged.count < len(staged.inline) {
		staged.inline[staged.count] = frameStagedEntry{key: key, value: value}
		staged.count++
		return
	}
	if staged.extra == nil {
		staged.extra = make(map[string]*stagedCombatant)
	}
	staged.extra[key] = value
}

func (staged *frameStagedCollection) Len() int {
	if staged == nil {
		return 0
	}
	return staged.count + len(staged.extra)
}

// 同步遍历；尚未访问的条目被替换时读取新值，不返回条目地址。
func (staged *frameStagedCollection) Range(visit func(string, *stagedCombatant)) {
	if staged == nil {
		return
	}
	for index := 0; index < staged.count; index++ {
		entry := staged.inline[index]
		visit(entry.key, entry.value)
	}
	for key, value := range staged.extra {
		visit(key, value)
	}
}
