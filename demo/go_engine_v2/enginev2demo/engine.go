package enginev2demo

import (
	"container/heap"
	"fmt"
	"math"
)

const (
	actionCastPriority   = 100
	statusExpirePriority = 50
)

type EngineSession struct {
	bundle   EngineBundle
	formulas FormulaService
}

type ActorRuntime struct {
	ActorID         string
	TemplateID      string
	Attributes      map[string]float64
	Resources       map[string]float64
	CurrentHP       float64
	ShieldAmount    float64
	EquippedItemIDs []string
	ActiveStatuses  map[string]*StatusInstance
	Cooldowns       map[string]int64
}

type StatusInstance struct {
	StatusID    string
	Kind        StatusKind
	AppliedAtMs int64
	ExpireAtMs  int64
	Magnitude   float64
}

type runtimeState struct {
	nowMs           int64
	processedEvents int64
	nextSequence    int64
	queue           eventHeap
	actors          map[string]*ActorRuntime
	logs            []LogEntry
}

type scheduledEvent struct {
	triggerAtMs int64
	priority    int
	sequence    int64
	payload     internalEvent
}

type internalEvent struct {
	kind           internalEventKind
	action         ActionRequest
	expireActorID  string
	expireStatusID string
	appliedAtMs    int64
}

type internalEventKind string

const (
	internalEventActionCast   internalEventKind = "action_cast"
	internalEventStatusExpire internalEventKind = "status_expire"
)

type eventHeap []scheduledEvent

func (h eventHeap) Len() int { return len(h) }

func (h eventHeap) Less(i, j int) bool {
	left := h[i]
	right := h[j]
	if left.triggerAtMs != right.triggerAtMs {
		return left.triggerAtMs < right.triggerAtMs
	}
	if left.priority != right.priority {
		return left.priority < right.priority
	}
	return left.sequence < right.sequence
}

func (h eventHeap) Swap(i, j int) { h[i], h[j] = h[j], h[i] }

func (h *eventHeap) Push(x any) {
	*h = append(*h, x.(scheduledEvent))
}

func (h *eventHeap) Pop() any {
	old := *h
	last := old[len(old)-1]
	*h = old[:len(old)-1]
	return last
}

type TriggerEvent struct {
	TriggerType   TriggerType
	SourceActorID string
	TargetActorID string
	DamageDealt   float64
}

func NewSession(bundle EngineBundle) (*EngineSession, error) {
	formulas, err := NewFormulaService(bundle.Formulas)
	if err != nil {
		return nil, err
	}
	session := &EngineSession{
		bundle:   bundle,
		formulas: formulas,
	}
	if err := session.validateBundle(); err != nil {
		return nil, err
	}
	return session, nil
}

func (s *EngineSession) Run(input EngineRunInput) (EngineRunResult, error) {
	state, err := s.buildRuntimeState(input)
	if err != nil {
		return EngineRunResult{}, err
	}

	for _, request := range input.InitialActions {
		state.enqueueAction(request)
	}

	stopReason := "queue_empty"
	for state.processedEvents < input.StopCondition.MaxEvents {
		event, ok := state.popEvent()
		if !ok {
			break
		}
		state.nowMs = event.triggerAtMs
		switch event.payload.kind {
		case internalEventActionCast:
			if err := s.executeAction(state, event.payload.action); err != nil {
				return EngineRunResult{}, err
			}
		case internalEventStatusExpire:
			s.expireStatus(state, event.payload.expireActorID, event.payload.expireStatusID, event.payload.appliedAtMs)
		}
		state.processedEvents++
	}
	if state.processedEvents >= input.StopCondition.MaxEvents && len(state.queue) > 0 {
		stopReason = "max_events"
	}

	actors := make(map[string]ActorSnapshot, len(state.actors))
	for actorID, actor := range state.actors {
		actors[actorID] = ActorSnapshot{
			ActorID:      actor.ActorID,
			CurrentHP:    actor.CurrentHP,
			ShieldAmount: actor.ShieldAmount,
			Attributes:   cloneFloatMap(actor.Attributes),
			Resources:    cloneFloatMap(actor.Resources),
		}
	}

	return EngineRunResult{
		Actors:          actors,
		Logs:            append([]LogEntry(nil), state.logs...),
		FinalTimeMs:     state.nowMs,
		ProcessedEvents: state.processedEvents,
		StopReason:      stopReason,
	}, nil
}

func (s *EngineSession) validateBundle() error {
	for actorID, actor := range s.bundle.ActorTemplates {
		for _, actionID := range actor.ActionIDs {
			if _, ok := s.bundle.ActionTemplates[actionID]; !ok {
				return fmt.Errorf("actor template %q references unknown action %q", actorID, actionID)
			}
		}
	}

	for actionID, action := range s.bundle.ActionTemplates {
		if !s.formulas.Has(action.FormulaID) {
			return fmt.Errorf("action %q references unknown formula %q", actionID, action.FormulaID)
		}
		if !s.formulas.Has(action.CooldownFormulaID) {
			return fmt.Errorf("action %q references unknown cooldown formula %q", actionID, action.CooldownFormulaID)
		}
		if _, ok := s.bundle.DamageProfiles[action.DamageProfileID]; !ok {
			return fmt.Errorf("action %q references unknown damage profile %q", actionID, action.DamageProfileID)
		}
		if err := s.validateTriggers(action.Triggers); err != nil {
			return fmt.Errorf("action %q: %w", actionID, err)
		}
	}

	for itemID, item := range s.bundle.ItemTemplates {
		if err := s.validateTriggers(item.Triggers); err != nil {
			return fmt.Errorf("item %q: %w", itemID, err)
		}
	}

	for statusID, status := range s.bundle.StatusTemplates {
		if status.MagnitudeFormulaID != "" && !s.formulas.Has(status.MagnitudeFormulaID) {
			return fmt.Errorf("status %q references unknown magnitude formula %q", statusID, status.MagnitudeFormulaID)
		}
		if err := s.validateTriggers(status.Triggers); err != nil {
			return fmt.Errorf("status %q: %w", statusID, err)
		}
	}

	for profileID, profile := range s.bundle.DamageProfiles {
		if !s.formulas.Has(profile.EffectiveResistanceFormulaID) {
			return fmt.Errorf("damage profile %q references unknown effective resistance formula %q", profileID, profile.EffectiveResistanceFormulaID)
		}
		if !s.formulas.Has(profile.MitigationMultiplierFormulaID) {
			return fmt.Errorf("damage profile %q references unknown mitigation formula %q", profileID, profile.MitigationMultiplierFormulaID)
		}
	}

	return nil
}

func (s *EngineSession) validateTriggers(triggers []TriggerSubscriptionDef) error {
	for _, trigger := range triggers {
		if trigger.ConditionFormulaID != "" && !s.formulas.Has(trigger.ConditionFormulaID) {
			return fmt.Errorf("trigger references unknown condition formula %q", trigger.ConditionFormulaID)
		}
		for _, effect := range trigger.Effects {
			switch current := effect.(type) {
			case DealDamageEffect:
				if !s.formulas.Has(current.FormulaID) {
					return fmt.Errorf("deal damage effect references unknown formula %q", current.FormulaID)
				}
				if _, ok := s.bundle.DamageProfiles[current.DamageProfileID]; !ok {
					return fmt.Errorf("deal damage effect references unknown damage profile %q", current.DamageProfileID)
				}
			case ApplyStatusEffect:
				if _, ok := s.bundle.StatusTemplates[current.StatusID]; !ok {
					return fmt.Errorf("apply status effect references unknown status %q", current.StatusID)
				}
			default:
				return fmt.Errorf("unsupported effect type %T", current)
			}
		}
	}
	return nil
}

func (s *EngineSession) buildRuntimeState(input EngineRunInput) (*runtimeState, error) {
	state := &runtimeState{
		queue:  make(eventHeap, 0, len(input.InitialActions)+4),
		actors: make(map[string]*ActorRuntime, 2),
	}
	heap.Init(&state.queue)

	self, err := s.instantiateCombatant(input.Self)
	if err != nil {
		return nil, err
	}
	enemy, err := s.instantiateCombatant(input.Enemy)
	if err != nil {
		return nil, err
	}

	state.actors[self.ActorID] = self
	state.actors[enemy.ActorID] = enemy

	for _, statusID := range input.Self.InitialStatusIDs {
		if err := s.applyStatus(state, self.ActorID, self.ActorID, statusID); err != nil {
			return nil, err
		}
	}
	for _, statusID := range input.Enemy.InitialStatusIDs {
		if err := s.applyStatus(state, enemy.ActorID, enemy.ActorID, statusID); err != nil {
			return nil, err
		}
	}

	return state, nil
}

func (s *EngineSession) instantiateCombatant(init CombatantRunInit) (*ActorRuntime, error) {
	template, ok := s.bundle.ActorTemplates[init.TemplateID]
	if !ok {
		return nil, fmt.Errorf("unknown actor template %q", init.TemplateID)
	}
	for _, itemID := range init.EquippedItemIDs {
		if _, ok := s.bundle.ItemTemplates[itemID]; !ok {
			return nil, fmt.Errorf("unknown item template %q", itemID)
		}
	}

	return &ActorRuntime{
		ActorID:         init.ActorID,
		TemplateID:      init.TemplateID,
		Attributes:      cloneFloatMap(template.Attributes),
		Resources:       cloneFloatMap(template.InitialResources),
		CurrentHP:       template.Attributes["max_hp"],
		EquippedItemIDs: append([]string(nil), init.EquippedItemIDs...),
		ActiveStatuses:  make(map[string]*StatusInstance),
		Cooldowns:       make(map[string]int64),
	}, nil
}

func (s *EngineSession) executeAction(state *runtimeState, request ActionRequest) error {
	source := state.actors[request.SourceActorID]
	target := state.actors[request.TargetActorID]
	if source == nil || target == nil {
		return fmt.Errorf("unknown actor pair in action request %+v", request)
	}

	action, ok := s.bundle.ActionTemplates[request.ActionID]
	if !ok {
		return fmt.Errorf("unknown action %q", request.ActionID)
	}
	if state.nowMs < source.Cooldowns[action.ActionID] {
		state.log(LogEntry{
			TimeMs:        state.nowMs,
			Kind:          "action_blocked",
			ActionID:      action.ActionID,
			SourceActorID: source.ActorID,
			TargetActorID: target.ActorID,
			Message:       "cooldown",
		})
		return nil
	}
	if s.isStunned(source) {
		state.log(LogEntry{
			TimeMs:        state.nowMs,
			Kind:          "action_blocked",
			ActionID:      action.ActionID,
			SourceActorID: source.ActorID,
			TargetActorID: target.ActorID,
			Message:       "stunned",
		})
		return nil
	}
	if !hasResources(source, action.ResourceCosts) {
		state.log(LogEntry{
			TimeMs:        state.nowMs,
			Kind:          "action_blocked",
			ActionID:      action.ActionID,
			SourceActorID: source.ActorID,
			TargetActorID: target.ActorID,
			Message:       "resource",
		})
		return nil
	}

	consumeResources(source, action.ResourceCosts)
	state.log(LogEntry{
		TimeMs:        state.nowMs,
		Kind:          "action_cast",
		ActionID:      action.ActionID,
		SourceActorID: source.ActorID,
		TargetActorID: target.ActorID,
		Message:       action.Label,
	})

	rawDamage := math.Max(0, s.formulas.Eval(action.FormulaID, EvalContext{
		Source: source,
		Target: target,
	}))
	if rawDamage > 0 {
		if _, err := s.dealDamage(state, action.ActionID, action.Label, action.DamageProfileID, source, target, rawDamage); err != nil {
			return err
		}
	}

	triggerEvent := TriggerEvent{
		TriggerType:   TriggerTypeOnActionCast,
		SourceActorID: source.ActorID,
		TargetActorID: target.ActorID,
	}
	if err := s.dispatchSubscriptions(state, source, EventActorRoleSource, action.Triggers, triggerEvent); err != nil {
		return err
	}

	cooldown := int64(math.Round(s.formulas.Eval(action.CooldownFormulaID, EvalContext{
		Source: source,
		Target: target,
	})))
	if cooldown > 0 {
		source.Cooldowns[action.ActionID] = state.nowMs + cooldown
	}

	return nil
}

func (s *EngineSession) dealDamage(
	state *runtimeState,
	actionID string,
	label string,
	profileID string,
	source *ActorRuntime,
	target *ActorRuntime,
	rawDamage float64,
) (float64, error) {
	profile := s.bundle.DamageProfiles[profileID]
	ctx := EvalContext{
		Source: source,
		Target: target,
	}
	effectiveResistance := s.formulas.Eval(profile.EffectiveResistanceFormulaID, ctx)
	mitigation := s.formulas.Eval(profile.MitigationMultiplierFormulaID, EvalContext{
		Source: source,
		Target: target,
		Inputs: map[string]float64{
			"effective_resistance": effectiveResistance,
		},
	})
	finalDamage := math.Max(0, rawDamage*mitigation)

	shieldAbsorbed := math.Min(target.ShieldAmount, finalDamage)
	target.ShieldAmount = math.Max(0, target.ShieldAmount-shieldAbsorbed)
	hpDamage := finalDamage - shieldAbsorbed
	target.CurrentHP = math.Max(0, target.CurrentHP-hpDamage)

	state.log(LogEntry{
		TimeMs:        state.nowMs,
		Kind:          "damage",
		ActionID:      actionID,
		SourceActorID: source.ActorID,
		TargetActorID: target.ActorID,
		Amount:        finalDamage,
		Message:       label,
	})

	event := TriggerEvent{
		TriggerType:   TriggerTypeOnDamageTaken,
		SourceActorID: source.ActorID,
		TargetActorID: target.ActorID,
		DamageDealt:   finalDamage,
	}
	if err := s.dispatchOwnedTriggers(state, target, EventActorRoleTarget, event); err != nil {
		return 0, err
	}

	return finalDamage, nil
}

func (s *EngineSession) dispatchOwnedTriggers(
	state *runtimeState,
	owner *ActorRuntime,
	ownerRole EventActorRole,
	event TriggerEvent,
) error {
	for _, itemID := range owner.EquippedItemIDs {
		item := s.bundle.ItemTemplates[itemID]
		if err := s.dispatchSubscriptions(state, owner, ownerRole, item.Triggers, event); err != nil {
			return err
		}
	}
	for _, status := range owner.ActiveStatuses {
		template := s.bundle.StatusTemplates[status.StatusID]
		if err := s.dispatchSubscriptions(state, owner, ownerRole, template.Triggers, event); err != nil {
			return err
		}
	}
	return nil
}

func (s *EngineSession) dispatchSubscriptions(
	state *runtimeState,
	owner *ActorRuntime,
	ownerRole EventActorRole,
	subscriptions []TriggerSubscriptionDef,
	event TriggerEvent,
) error {
	for _, subscription := range subscriptions {
		if subscription.TriggerType != event.TriggerType {
			continue
		}
		if subscription.OwnerEventRole != ownerRole {
			continue
		}
		if subscription.RequiresPositiveDamage && event.DamageDealt <= 0 {
			continue
		}
		if subscription.ConditionFormulaID != "" {
			condition := s.formulas.Eval(subscription.ConditionFormulaID, EvalContext{
				Source: state.actors[event.SourceActorID],
				Target: state.actors[event.TargetActorID],
			})
			if condition <= 0 {
				continue
			}
		}
		for _, effect := range subscription.Effects {
			if err := s.applyEffect(state, owner, event, effect); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *EngineSession) applyEffect(
	state *runtimeState,
	owner *ActorRuntime,
	event TriggerEvent,
	effect EffectDef,
) error {
	_ = owner
	switch current := effect.(type) {
	case DealDamageEffect:
		source := actorByRole(state, event, current.SourceActorRole)
		target := actorByRole(state, event, current.TargetActorRole)
		if source == nil || target == nil {
			return nil
		}
		rawDamage := math.Max(0, s.formulas.Eval(current.FormulaID, EvalContext{
			Source: source,
			Target: target,
		}))
		if rawDamage <= 0 {
			return nil
		}
		_, err := s.dealDamage(state, current.ActionID, current.Label, current.DamageProfileID, source, target, rawDamage)
		return err
	case ApplyStatusEffect:
		source := actorByRole(state, event, current.SourceActorRole)
		target := actorByRole(state, event, current.TargetActorRole)
		if source == nil || target == nil {
			return nil
		}
		return s.applyStatus(state, source.ActorID, target.ActorID, current.StatusID)
	default:
		return fmt.Errorf("unsupported effect type %T", current)
	}
}

func (s *EngineSession) applyStatus(state *runtimeState, sourceActorID, targetActorID, statusID string) error {
	source := state.actors[sourceActorID]
	target := state.actors[targetActorID]
	if source == nil || target == nil {
		return fmt.Errorf("unknown status actor pair source=%q target=%q", sourceActorID, targetActorID)
	}

	template, ok := s.bundle.StatusTemplates[statusID]
	if !ok {
		return fmt.Errorf("unknown status %q", statusID)
	}

	existing := target.ActiveStatuses[statusID]
	magnitude := 0.0
	if template.MagnitudeFormulaID != "" {
		magnitude = math.Max(0, s.formulas.Eval(template.MagnitudeFormulaID, EvalContext{
			Source: source,
			Target: target,
		}))
	}
	if template.StatusKind == StatusKindShield && template.RefreshPolicy == StatusRefreshTakeMax && existing != nil && existing.Magnitude >= magnitude {
		return nil
	}

	instance := &StatusInstance{
		StatusID:    statusID,
		Kind:        template.StatusKind,
		AppliedAtMs: state.nowMs,
		Magnitude:   magnitude,
	}
	if template.DurationMs > 0 {
		instance.ExpireAtMs = state.nowMs + template.DurationMs
		state.enqueueStatusExpire(target.ActorID, statusID, instance.AppliedAtMs, instance.ExpireAtMs)
	}
	target.ActiveStatuses[statusID] = instance

	if template.StatusKind == StatusKindShield {
		switch template.RefreshPolicy {
		case StatusRefreshReplace:
			target.ShieldAmount = magnitude
		case StatusRefreshTakeMax:
			target.ShieldAmount = math.Max(target.ShieldAmount, magnitude)
		}
	}

	state.log(LogEntry{
		TimeMs:        state.nowMs,
		Kind:          "status_applied",
		SourceActorID: source.ActorID,
		TargetActorID: target.ActorID,
		StatusID:      statusID,
		Amount:        magnitude,
		Message:       template.Label,
	})

	return nil
}

func (s *EngineSession) expireStatus(state *runtimeState, actorID, statusID string, appliedAtMs int64) {
	actor := state.actors[actorID]
	if actor == nil {
		return
	}

	instance := actor.ActiveStatuses[statusID]
	if instance == nil || instance.AppliedAtMs != appliedAtMs {
		return
	}
	delete(actor.ActiveStatuses, statusID)
	if instance.Kind == StatusKindShield {
		actor.ShieldAmount = 0
	}
	state.log(LogEntry{
		TimeMs:        state.nowMs,
		Kind:          "status_expired",
		SourceActorID: actorID,
		TargetActorID: actorID,
		StatusID:      statusID,
	})
}

func (s *EngineSession) isStunned(actor *ActorRuntime) bool {
	for _, status := range actor.ActiveStatuses {
		if status.Kind == StatusKindStun {
			return true
		}
	}
	return false
}

func (s *runtimeState) enqueueAction(request ActionRequest) {
	heap.Push(&s.queue, scheduledEvent{
		triggerAtMs: request.TriggerAtMs,
		priority:    actionCastPriority,
		sequence:    s.nextSequenceID(),
		payload: internalEvent{
			kind:   internalEventActionCast,
			action: request,
		},
	})
}

func (s *runtimeState) enqueueStatusExpire(actorID, statusID string, appliedAtMs, expireAtMs int64) {
	heap.Push(&s.queue, scheduledEvent{
		triggerAtMs: expireAtMs,
		priority:    statusExpirePriority,
		sequence:    s.nextSequenceID(),
		payload: internalEvent{
			kind:           internalEventStatusExpire,
			expireActorID:  actorID,
			expireStatusID: statusID,
			appliedAtMs:    appliedAtMs,
		},
	})
}

func (s *runtimeState) popEvent() (scheduledEvent, bool) {
	if len(s.queue) == 0 {
		return scheduledEvent{}, false
	}
	return heap.Pop(&s.queue).(scheduledEvent), true
}

func (s *runtimeState) nextSequenceID() int64 {
	value := s.nextSequence
	s.nextSequence++
	return value
}

func (s *runtimeState) log(entry LogEntry) {
	s.logs = append(s.logs, entry)
}

func actorByRole(state *runtimeState, event TriggerEvent, role EventActorRole) *ActorRuntime {
	switch role {
	case EventActorRoleSource:
		return state.actors[event.SourceActorID]
	case EventActorRoleTarget:
		return state.actors[event.TargetActorID]
	default:
		return nil
	}
}

func hasResources(actor *ActorRuntime, costs map[string]float64) bool {
	for resourceID, cost := range costs {
		if actor.Resources[resourceID] < cost {
			return false
		}
	}
	return true
}

func consumeResources(actor *ActorRuntime, costs map[string]float64) {
	for resourceID, cost := range costs {
		actor.Resources[resourceID] -= cost
	}
}

func cloneFloatMap(input map[string]float64) map[string]float64 {
	if len(input) == 0 {
		return map[string]float64{}
	}
	cloned := make(map[string]float64, len(input))
	for key, value := range input {
		cloned[key] = value
	}
	return cloned
}

type errString string

func (e errString) Error() string {
	return string(e)
}
