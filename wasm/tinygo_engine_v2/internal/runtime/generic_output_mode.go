package runtime

import "tinygo_engine_v2/internal/model"

func (s *genericRunState) detailedOutput() bool {
	return s.req.OutputMode != model.RunOutputSummary
}

func (s *genericRunState) resultOutputMode() model.RunOutputMode {
	if !s.detailedOutput() {
		return model.RunOutputSummary
	}
	return ""
}

// 工厂同步调用，完整模式保持原记录时点；汇总模式不创建展示字典。
func (s *genericRunState) recordEvidenceLazy(kind model.EvidenceKind, factory func() model.EvidenceItem) {
	if !s.detailedOutput() {
		s.recordEvidence(model.EvidenceItem{Kind: kind})
		return
	}
	s.recordEvidence(factory())
}

func (f *executionFrame) recordEvidenceLazy(kind model.EvidenceKind, factory func() model.EvidenceItem) {
	if !f.run.detailedOutput() {
		f.recordEvidenceKind(kind)
		return
	}
	f.recordEvidence(factory())
}

// 汇总模式仍核对原明细预算，未请求明细不计作预算丢弃。
func (s *genericRunState) retainedRecordCount(total, returned, limit int) int {
	if s.detailedOutput() {
		return returned
	}
	if total < limit {
		return total
	}
	return limit
}
