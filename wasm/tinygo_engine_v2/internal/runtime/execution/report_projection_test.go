package execution

import "tinygo_engine_v2/internal/model"

// Combination tests observe the committed report instead of private report storage.
func reportedDamageHistory(s *Engine) []damageRecord {
	var out []damageRecord
	for _, row := range s.report.Snapshot().Evidence.Items {
		if row.Kind != model.EvidenceKindDamage {
			continue
		}
		amount, _ := row.Data["mitigatedAmount"].(float64)
		if amount <= 0 {
			continue
		}
		source, _ := row.Data["source"].(string)
		target, _ := row.Data["target"].(string)
		out = append(out, damageRecord{TimeMs: row.TimeMs, SourceKey: source, TargetKey: target, Amount: amount})
	}
	return out
}

func reportedEvidenceRetained(s *Engine) int {
	output := s.report.Snapshot().Evidence
	total := 0
	for _, count := range output.CountsByKind {
		total += count
	}
	return total - output.TruncatedEvidenceCount
}

func reportedAbilityStat(s *Engine, ref string) model.AbilityStat {
	for _, row := range s.report.AbilityStats() {
		if row.AbilityRef == ref {
			return row
		}
	}
	return model.AbilityStat{AbilityRef: ref}
}
