// ProviderInstance runtime 辅助（§15 dynamic provider）。
package status

// ProviderInstance 是 combatant 上已挂载的 dynamic provider 运行态。
// ProviderInstance 是 combatant 上已挂载的 dynamic provider 运行态。
type ProviderInstance struct {
	ProviderRef         string
	DefinitionRef       string
	Source              string
	Owner               string
	Stacks              int
	ExpireAt            int64
	State               map[string]interface{}
	DefinitionIndex     uint16
	StatusContributions []StatusContribution
}

// StatusContribution 是 apply/refresh 当时保存的普通减速快照值。
type StatusContribution struct {
	ResultRef  string
	StatusKey  string
	StatusKind string
	Strength   float64
}

// Expired 判断 provider 是否已到过期时刻（ExpireAt<=0 表示永不过期）。
func (p ProviderInstance) Expired(nowMs int64) bool {
	return p.ExpireAt > 0 && p.ExpireAt <= nowMs
}

// NeverExpires 返回 provider 是否永不过期。
func (p ProviderInstance) NeverExpires() bool {
	return p.ExpireAt <= 0
}

// FindByRef 在列表中查找 providerRef。
func FindByRef(instances []ProviderInstance, providerRef string) (ProviderInstance, int, bool) {
	for i, inst := range instances {
		if inst.ProviderRef == providerRef {
			return inst, i, true
		}
	}
	return ProviderInstance{}, -1, false
}

// RemoveByRef 移除指定 providerRef 的实例。
func RemoveByRef(instances []ProviderInstance, providerRef string) []ProviderInstance {
	out := instances[:0]
	for _, inst := range instances {
		if inst.ProviderRef != providerRef {
			out = append(out, inst)
		}
	}
	return out
}

// ActiveInstances 返回未过期的 provider 列表。
func ActiveInstances(instances []ProviderInstance, nowMs int64) []ProviderInstance {
	if len(instances) == 0 {
		return nil
	}
	out := make([]ProviderInstance, 0, len(instances))
	for _, inst := range instances {
		if !inst.Expired(nowMs) {
			out = append(out, inst)
		}
	}
	return out
}
