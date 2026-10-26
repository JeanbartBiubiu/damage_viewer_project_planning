package execution

import (
	model "tinygo_engine_v2/internal/model"
)

func damageDealtEmittedEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	for _, item := range done.Evidence.Items {
		if item.Kind == model.EvidenceKindEmittedEvent && item.Ref == eventTypeDamageDealt {
			out = append(out, item)
		}
	}
	return out
}
