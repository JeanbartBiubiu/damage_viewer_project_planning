package pipeline

import "sort"

// ShieldInstance 是结算与效果存储共用的底层值。运行集合仍由效果子系统私有持有。
type ShieldInstance struct {
	Remaining            float64
	ExpireAt             int64
	Priority             int16
	ShieldRef            string
	DefinitionRef        string
	LifecycleProviderRef string
	Source               string
	Owner                string
	State                map[string]interface{}
}

func (s ShieldInstance) Expired(nowMs int64) bool {
	return s.ExpireAt > 0 && s.ExpireAt <= nowMs
}

// ActiveShields 建立独立工作表；过滤和排序不得改动输入集合。
// 没有有效条目时保持既有结算投影的缺失语义。
func ActiveShields(instances []ShieldInstance, nowMs int64) []ShieldInstance {
	if len(instances) == 0 {
		return nil
	}
	out := make([]ShieldInstance, 0, len(instances))
	for _, inst := range instances {
		if inst.Remaining <= 0 || inst.Expired(nowMs) {
			continue
		}
		out = append(out, inst)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// SortShields 只接收调用方独占的工作表；相同优先级按稳定护盾身份吸收。
func SortShields(instances []ShieldInstance) {
	sort.SliceStable(instances, func(i, j int) bool {
		if instances[i].Priority != instances[j].Priority {
			return instances[i].Priority < instances[j].Priority
		}
		return instances[i].ShieldRef < instances[j].ShieldRef
	})
}

// removeExpiredShields 压缩本次独占工作表，不再为类型转换复制结果。
func removeExpiredShields(instances []ShieldInstance, nowMs int64) []ShieldInstance {
	out := instances[:0]
	for _, inst := range instances {
		if inst.Remaining <= 0 || inst.Expired(nowMs) {
			continue
		}
		out = append(out, inst)
	}
	clear(instances[len(out):])
	if len(out) == 0 {
		return nil
	}
	return out
}

// NormalizeShields 复制待发布值并补全现有归属，不借出仍被暂存分支使用的切片。
// 嵌套状态按既有只读约定借用，nil状态按原发布语义规范化为空对象。
func NormalizeShields(values []ShieldInstance, owner, source string) []ShieldInstance {
	if len(values) == 0 {
		return nil
	}
	out := make([]ShieldInstance, len(values))
	copy(out, values)
	for i := range out {
		if out[i].Source == "" {
			out[i].Source = source
		}
		if out[i].Owner == "" {
			out[i].Owner = owner
		}
		if out[i].State == nil {
			out[i].State = map[string]interface{}{}
		}
	}
	return out
}
