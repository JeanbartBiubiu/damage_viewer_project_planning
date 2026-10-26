package model

// ResourceView 借用不可变的资源槽集合；只返回槽值，不公开底层映射。
// 创建方负责在视图存活期间保持映射不变，后续写入须先取得独占副本。
type ResourceView struct {
	values map[string]ResourceSlotDef
}

func BorrowResources(values map[string]ResourceSlotDef) ResourceView {
	return ResourceView{values: values}
}

func (v ResourceView) Lookup(key string) (ResourceSlotDef, bool) {
	slot, ok := v.values[key]
	return slot, ok
}

func (v ResourceView) At(key string) ResourceSlotDef {
	return v.values[key]
}

func (v ResourceView) Len() int { return len(v.values) }

// ToMap 为最终协议快照复制资源；同步求值只使用 Lookup/At。
func (v ResourceView) ToMap() map[string]ResourceSlotDef {
	if v.values == nil {
		return nil
	}
	out := make(map[string]ResourceSlotDef, len(v.values))
	for key, slot := range v.values {
		out[key] = slot
	}
	return out
}
