package report

import "tinygo_engine_v2/internal/model"

// BuildEffectiveStatuses 聚合给定时点仍有效的状态快照，保留来源和贡献顺序，不读取运行时状态。
func BuildEffectiveStatuses(instances []model.CombatantProviderSnapshot, nowMs int64) []model.EffectiveStatusSnapshot {
	type acc struct {
		strength      float64
		contributions []model.EffectiveStatusContribution
	}
	byKind := map[string]*acc{}
	order := make([]string, 0)
	for _, inst := range instances {
		if inst.ExpireAt != nil && *inst.ExpireAt > 0 && *inst.ExpireAt <= nowMs {
			continue
		}
		source := inst.Source
		if source == "" {
			source = inst.Owner
		}
		for _, item := range inst.StatusContributions {
			if item.StatusKind != model.StatusKindMovementSlow {
				continue
			}
			strength := *item.Strength // The owned output was built from validated actual contributions.
			expires := int64(0)
			if inst.ExpireAt != nil {
				expires = *inst.ExpireAt
			}
			bucket, ok := byKind[item.StatusKind]
			if !ok {
				bucket = &acc{}
				byKind[item.StatusKind] = bucket
				order = append(order, item.StatusKind)
			}
			bucket.contributions = append(bucket.contributions, model.EffectiveStatusContribution{
				ProviderRef: inst.ProviderRef,
				ResultRef:   item.ResultRef,
				StatusKey:   item.StatusKey,
				Source:      source,
				ExpireAt:    expires,
				Strength:    strength,
			})
			if len(bucket.contributions) == 1 || strength > bucket.strength {
				bucket.strength = strength
			}
		}
	}
	if len(order) == 0 {
		return []model.EffectiveStatusSnapshot{}
	}
	out := make([]model.EffectiveStatusSnapshot, 0, len(order))
	for _, kind := range order {
		bucket := byKind[kind]
		contribs := bucket.contributions
		if contribs == nil {
			contribs = []model.EffectiveStatusContribution{}
		}
		out = append(out, model.EffectiveStatusSnapshot{
			StatusKind:    kind,
			Strength:      bucket.strength,
			Contributions: contribs,
		})
	}
	return out
}

// StatusContributionData 将一项已冻结状态贡献整理为证据字段；记录时点由执行协调决定。
func StatusContributionData(resultRef, statusKey, statusKind string, strength float64) map[string]interface{} {
	return map[string]interface{}{"resultRef": resultRef, "statusKey": statusKey, "statusKind": statusKind, "strength": strength}
}
