package scheduler

// SetLimit applies the effective compile queue limit without relaxing the hard cap.
func (h *GenericHeap) SetLimit(limit int) {
	if limit <= 0 || limit > MaxGenericEventHeap {
		limit = MaxGenericEventHeap
	}
	h.limit = limit
}
func (h *GenericHeap) RemainingCapacity() int {
	limit := h.limit
	if limit <= 0 {
		limit = MaxGenericEventHeap
	}
	return limit - len(h.items)
}
func (h *GenericHeap) CanPush(count int) bool { return count >= 0 && count <= h.RemainingCapacity() }
