package action

func (s *State) Occupied(owner string) bool {
	for _, p := range s.processes {
		if p.OccupiesAction(owner) {
			return true
		}
	}
	return false
}

func (s *State) ReadyAt(owner string, now int64) int64 {
	ready := now
	for _, p := range s.processes {
		if p.OccupiesAction(owner) && p.ActionDeadline() > ready {
			ready = p.ActionDeadline()
		}
	}
	return ready
}

func (s *State) OccupancyContribution(owner string, start, end int64) (int64, bool) {
	var contribution int64
	present := false
	for _, p := range s.processes {
		if p.Owner() != owner {
			continue
		}
		for _, interval := range p.data.snapshot.ActionOccupancies {
			if interval.StartedAtMs < start || interval.StartedAtMs >= end {
				continue
			}
			deadline := interval.ExpectedEndAtMs
			if interval.FinishedAtMs != nil {
				deadline = *interval.FinishedAtMs
			}
			if deadline > interval.StartedAtMs && (!present || deadline > contribution) {
				contribution, present = deadline, true
			}
		}
	}
	return contribution, present
}
