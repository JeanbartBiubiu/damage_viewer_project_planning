package formula

import (
	"errors"
	"math"
	"strings"

	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/base/inputbinding"
	"tinygo_engine_v2/internal/model"
)

func (r *programStore) bindAttributeLayout(layout *attribute.Layout) {
	if r == nil {
		return
	}
	programs := make([]GenericProgram, len(r.programs))
	for i, program := range r.programs {
		programs[i] = bindProgramAttributes(program, layout)
	}
	r.programs, r.attributeLayout = programs, layout
}

func isAttributeRead(kind GenericReadKind) bool {
	switch kind {
	case ReadSourceAttr, ReadTargetAttr, ReadEventEntrySourceAttr, ReadEventEntryTargetAttr, ReadEventSourceAttr, ReadEventTargetAttr:
		return true
	}
	return false
}

func bindAttributeInstruction(in GenericInstr, layout *attribute.Layout) GenericInstr {
	if in.Op != GenericOpRead || !isAttributeRead(in.ReadKind) {
		return in
	}
	in.AttrKey, in.AttrField = in.ReadKey, "resolved"
	if dot := strings.LastIndex(in.ReadKey, "."); dot > 0 {
		in.AttrKey, in.AttrField = in.ReadKey[:dot], in.ReadKey[dot+1:]
	}
	in.AttrIndex, in.AttrIndexBound = 0, false
	if layout != nil {
		in.AttrIndex, in.AttrIndexBound = layout.Lookup(in.AttrKey)
	}
	return in
}

func bindProgramAttributes(program GenericProgram, layout *attribute.Layout) GenericProgram {
	if layout == nil {
		return program
	}
	if len(program.Instr) > 0 {
		program.Instr = append([]GenericInstr(nil), program.Instr...)
		for i, in := range program.Instr {
			program.Instr[i] = bindAttributeInstruction(in, layout)
		}
	}
	if binding := program.NamedBinding; binding != nil {
		clone := *binding
		clone.dependencies = append([]GenericInstr(nil), binding.dependencies...)
		for i, in := range clone.dependencies {
			clone.dependencies[i] = bindAttributeInstruction(in, layout)
		}
		clone.attributeInputs = make([]namedAttributeBinding, len(binding.inputs))
		for i, input := range binding.inputs {
			if input.Binding.Kind != "attribute" {
				continue
			}
			index, bound := layout.Lookup(input.Binding.AttributeKey)
			clone.attributeInputs[i] = namedAttributeBinding{index: index, bound: bound}
		}
		program.NamedBinding = &clone
	}
	return program
}

func lookupAttributeSlot(attrs attribute.Table, key string, index int, bound bool) (model.AttributeSlotDef, bool) {
	if bound && attrs.Layout() != nil && attrs.Layout().Key(index) == key {
		return attrs.LookupIndex(index)
	}
	return attrs.Lookup(key)
}

func evalInstructionRead(in GenericInstr, ctx *GenericEvalContext) (float64, error) {
	if in.ReadKind == ReadEventProviderTargetStateBefore {
		request, _ := FactRequestForRead(in)
		value, factErr, exists := ctx.Facts.Lookup(request)
		if !in.ReferenceBound || !ctx.HasProviderContext || !ctx.HasEventContext || !exists {
			return 0, errors.New("damage state before requires a bound original damage listener condition")
		}
		return value, factErr
	}
	if in.ReadKind == ReadProviderTargetStateRemainingMs {
		if !in.ReferenceBound || !ctx.HasProviderContext || !ctx.HasTargetStateRemainingContext {
			return 0, errors.New("target state remaining time requires a declared own finite integer field and provider condition context")
		}
		expires := ctx.TargetStateExpireAt.At(in.ReadKey)
		if ctx.ProviderTargetState.At(in.ReadKey) <= 0 || expires <= ctx.TargetStateRemainingNowMs {
			return 0, nil
		}
		return float64(expires - ctx.TargetStateRemainingNowMs), nil
	}
	if in.ReadKind == ReadReceivedLinkedShieldAbsorbed {
		request, _ := FactRequestForRead(in)
		value, factErr, exists := ctx.Facts.Lookup(request)
		if !in.ReferenceBound || !ctx.HasProviderContext || !ctx.HasEventContext || !ctx.HasEventDamageSnapshot || !exists {
			return 0, errors.New("linked shield absorption requires a bound native received-damage listener condition")
		}
		return value, factErr
	}
	if in.ReadKind == ReadLinkedShieldPresent {
		request, _ := FactRequestForRead(in)
		value, factErr, exists := ctx.Facts.Lookup(request)
		if !in.ReferenceBound || !ctx.HasProviderContext || !exists {
			return 0, errors.New("linked shield presence requires a bound definition and actual provider context")
		}
		return value, factErr
	}
	if !in.AttrIndexBound || (in.AttrField != "resolved" && in.AttrField != "base" && in.AttrField != "current" && in.AttrField != "max") {
		return evalRead(in.ReadKind, in.ReadKey, ctx)
	}
	var attrs attribute.Table
	switch in.ReadKind {
	case ReadSourceAttr:
		attrs = ctx.SourceAttrs
	case ReadTargetAttr:
		attrs = ctx.TargetAttrs
	case ReadEventEntrySourceAttr, ReadEventEntryTargetAttr, ReadEventSourceAttr, ReadEventTargetAttr:
		if err := requireEventContext(ctx); err != nil {
			return 0, err
		}
		switch in.ReadKind {
		case ReadEventEntrySourceAttr:
			attrs = ctx.EventEntrySourceAttrs
		case ReadEventEntryTargetAttr:
			attrs = ctx.EventEntryTargetAttrs
		case ReadEventSourceAttr:
			attrs = ctx.EventSourceAttrs
		case ReadEventTargetAttr:
			attrs = ctx.EventTargetAttrs
		}
	default:
		return evalRead(in.ReadKind, in.ReadKey, ctx)
	}
	slot, present := lookupAttributeSlot(attrs, in.AttrKey, in.AttrIndex, true)
	if !present {
		if ctx.StrictReads {
			return 0, errors.New("missing attribute: " + in.AttrKey)
		}
		return 0, nil
	}
	switch in.AttrField {
	case "base":
		return slot.Base, nil
	case "current":
		return slot.Current, nil
	case "max":
		return slot.Max, nil
	default:
		if slot.Resolved != 0 || ctx.StrictReads {
			return slot.Resolved, nil
		}
		return slot.Current, nil
	}
}

func sameNamedBinding(a, b *NamedBinding) bool {
	if a == b {
		return true
	}
	if a == nil || b == nil || a.scope != b.scope || a.skillKey != b.skillKey || a.path != b.path || namedPlanIdentity(a) != namedPlanIdentity(b) || len(a.inputs) != len(b.inputs) || len(a.parameters) != len(b.parameters) || len(a.dependencies) != len(b.dependencies) {
		return false
	}
	for i, input := range a.inputs {
		if input != b.inputs[i] {
			return false
		}
	}
	for i, param := range a.parameters {
		if !sameParameter(param, b.parameters[i]) {
			return false
		}
	}
	for i, dep := range a.dependencies {
		other := b.dependencies[i]
		if dep.Op != other.Op || dep.ReadKind != other.ReadKind || dep.ReadKey != other.ReadKey || dep.AuthoredRead != other.AuthoredRead {
			return false
		}
	}
	return true
}

func namedPlanIdentity(binding *NamedBinding) *inputbinding.Plan {
	if binding.planIdentity != nil {
		return binding.planIdentity
	}
	return binding.plan
}

func sameParameter(a, b model.FormulaParameter) bool {
	if a.ParameterKey != b.ParameterKey || a.ValueMode != b.ValueMode || a.ValueType != b.ValueType || (a.Value == nil) != (b.Value == nil) || (a.RuntimeSource == nil) != (b.RuntimeSource == nil) {
		return false
	}
	if a.Value != nil && math.Float64bits(*a.Value) != math.Float64bits(*b.Value) {
		return false
	}
	if a.RuntimeSource != nil {
		x, y := a.RuntimeSource, b.RuntimeSource
		if x.Kind != y.Kind || x.ResourceKey != y.ResourceKey || x.StateKey != y.StateKey || (x.Value == nil) != (y.Value == nil) {
			return false
		}
		if x.Value != nil && math.Float64bits(*x.Value) != math.Float64bits(*y.Value) {
			return false
		}
	}
	return true
}
