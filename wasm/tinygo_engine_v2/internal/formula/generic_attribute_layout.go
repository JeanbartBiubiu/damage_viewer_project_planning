package formula

import (
	"errors"
	"strings"

	"tinygo_engine_v2/internal/attribute"
	"tinygo_engine_v2/internal/model"
)

// BindAttributeLayout绑定只读目录；重绑先复制指令和输入描述，不改共享会话内容。
func (r *GenericRegistry) BindAttributeLayout(layout *attribute.Layout) {
	if r == nil {
		return
	}
	programs := make([]GenericProgram, len(r.Programs))
	for i, program := range r.Programs {
		programs[i] = bindProgramAttributes(program, layout)
	}
	r.Programs, r.attributeLayout = programs, layout
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
	if a == nil || b == nil || a.scope != b.scope || a.skillKey != b.skillKey || a.path != b.path || a.plan != b.plan || len(a.inputs) != len(b.inputs) || len(a.parameters) != len(b.parameters) || len(a.dependencies) != len(b.dependencies) {
		return false
	}
	for i, input := range a.inputs {
		if input != b.inputs[i] {
			return false
		}
	}
	for i, param := range a.parameters {
		if param != b.parameters[i] {
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
