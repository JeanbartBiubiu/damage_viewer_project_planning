// ShieldInstance runtime 辅助（§15 shield 不强制 provider 化）。
package shield

import "sort"

// Instance 是 combatant 上的护盾运行态。
type Instance struct {
	ShieldRef string
	Source    string
	Owner     string
	Remaining float64
	Priority  int16
	ExpireAt  int64
	State     map[string]interface{}
}

// Expired 判断护盾是否已到过期时刻（ExpireAt<=0 表示永不过期）。
func (s Instance) Expired(nowMs int64) bool {
	return s.ExpireAt > 0 && s.ExpireAt <= nowMs
}

// ActiveInstances 返回未过期且有余量的护盾。
func ActiveInstances(instances []Instance, nowMs int64) []Instance {
	if len(instances) == 0 {
		return nil
	}
	out := make([]Instance, 0, len(instances))
	for _, inst := range instances {
		if inst.Remaining <= 0 {
			continue
		}
		if inst.Expired(nowMs) {
			continue
		}
		out = append(out, inst)
	}
	return out
}

// SortByPriority 按 priority 升序排序（数值越小越先吸收）。
func SortByPriority(instances []Instance) {
	sort.SliceStable(instances, func(i, j int) bool {
		if instances[i].Priority != instances[j].Priority {
			return instances[i].Priority < instances[j].Priority
		}
		return instances[i].ShieldRef < instances[j].ShieldRef
	})
}

// RemoveExpired 移除已过期或耗尽的护盾。
func RemoveExpired(instances []Instance, nowMs int64) []Instance {
	out := instances[:0]
	for _, inst := range instances {
		if inst.Remaining <= 0 {
			continue
		}
		if inst.Expired(nowMs) {
			continue
		}
		out = append(out, inst)
	}
	return out
}
