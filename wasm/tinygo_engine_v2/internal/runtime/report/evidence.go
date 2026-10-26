package report

import (
	"sort"
	"tinygo_engine_v2/internal/model"
)

func (s *State) RecordEvidence(item model.EvidenceItem, detailed bool, limit int) {
	if s.evidenceCountsByKind == nil {
		s.evidenceCountsByKind = map[string]int{}
	}
	kind := string(item.Kind)
	s.evidenceCountsByKind[kind]++
	if s.evidenceRetainedCount >= limit {
		s.evidenceTruncated = true
		s.truncatedEvidenceCount++
		return
	}
	s.evidenceRetainedCount++
	if detailed {
		s.evidence = append(s.evidence, item)
	} else {
		if s.evidenceRetainedByKind == nil {
			s.evidenceRetainedByKind = map[string]int{}
		}
		s.evidenceRetainedByKind[kind]++
	}
}

func (s *State) TruncatedEvidenceKinds(detailed bool) []string {
	keptByKind := s.evidenceRetainedByKind
	if detailed {
		keptByKind = make(map[string]int)
		for _, item := range s.evidence {
			keptByKind[string(item.Kind)]++
		}
	}
	var kinds []string
	for kind, total := range s.evidenceCountsByKind {
		if total > keptByKind[kind] {
			kinds = append(kinds, kind)
		}
	}
	sort.Strings(kinds)
	return kinds
}

func (s *State) EvidenceTruncation() (bool, int) {
	return s.evidenceTruncated, s.truncatedEvidenceCount
}
