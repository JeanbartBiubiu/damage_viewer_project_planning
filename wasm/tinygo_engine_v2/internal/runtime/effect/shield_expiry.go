package effect

import "tinygo_engine_v2/internal/pipeline"

// HasExpiredRef 只查找指定引用已经到期的实际护盾，不把同引用的新盾或未到期的耗尽盾当成到期。
func (v ShieldList) HasExpiredRef(reference string, now int64) bool {
	for _, shield := range v.values {
		if shield.ShieldRef == reference && shield.Expired(now) {
			return true
		}
	}
	return false
}

// RemoveExpiredRef 只移除指定引用的到期实例；保留同引用刷新后的新盾，且不写穿旧列表。
func (v ShieldList) RemoveExpiredRef(reference string, now int64) ShieldList {
	if !v.HasExpiredRef(reference, now) {
		return v
	}
	values := make([]pipeline.ShieldInstance, 0, v.Len()-1)
	for _, shield := range v.values {
		if shield.ShieldRef != reference || !shield.Expired(now) {
			values = append(values, shield)
		}
	}
	return ShieldList{values: values}
}
