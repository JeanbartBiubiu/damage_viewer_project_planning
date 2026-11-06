package scheduler

import "tinygo_engine_v2/internal/model"

func (l *Loop) SetQueueLimit(limit int) { l.queue.SetLimit(limit) }

func (l *Loop) NextEventAt() (int64, bool) { return l.queue.PeekTime() }

func (l *Loop) CanEnqueue(count int) bool { return l.queue.CanPush(count) }

func (l *Loop) RemainingCapacity() int { return l.queue.RemainingCapacity() }

func (l *Loop) Enqueue(event GenericEvent) model.ErrCode { return l.queue.Push(event) }

func (l *Loop) HasBasicAttack() bool { return l.queue.HasBasicAttack() }

func (l *Loop) RescheduleBasicAttack(at int64, generation uint64) bool {
	return l.queue.RescheduleBasicAttack(at, generation)
}

func (l *Loop) HasAutomaticSkill() bool { return l.queue.HasAutomaticSkill() }

func (l *Loop) RescheduleAutomaticSkill(at int64, generation uint64) bool {
	return l.queue.RescheduleAutomaticSkill(at, generation)
}

func (l *Loop) HasCooldownAttempt(entry int) bool { return l.queue.HasCooldownAttempt(entry) }

func (l *Loop) RescheduleCooldownAttempt(entry int, at int64, version uint64) bool {
	return l.queue.RescheduleCooldownAttempt(entry, at, version)
}

func (l *Loop) TakeAt(at int64) (GenericEvent, bool) {
	if next, exists := l.queue.PeekTime(); !exists || next != at {
		return GenericEvent{}, false
	}
	return l.queue.Pop()
}

func (l *Loop) RestoreCandidate(event GenericEvent) model.ErrCode {
	if event.Seq == 0 {
		return model.ErrInvalidInput
	}
	return l.queue.Push(event)
}

func (l *Loop) QueuedEvents() int { return l.queue.Len() }

func (l *Loop) PeakQueuedEvents() int { return l.queue.Peak }
