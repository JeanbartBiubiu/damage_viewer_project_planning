package formula

func (r programStore) attributeCacheDependencies(id GenericProgramID) ([]GenericInstr, bool) {
	var reads []GenericInstr
	seen := make(map[GenericProgramID]bool)
	var visit func(GenericProgramID) bool
	visit = func(id GenericProgramID) bool {
		if int(id) >= len(r.programs) {
			return false
		}
		if seen[id] {
			return true
		}
		seen[id] = true
		p := r.programs[id]
		if p.Authored != nil && p.NamedBinding == nil {
			return false
		}
		if b := p.NamedBinding; b != nil {
			for _, param := range b.parameters {
				if param.ValueMode == "RUNTIME_INPUT" {
					return false
				}
			}
			for _, input := range b.inputs {
				binding := input.Binding
				if binding.Kind == "context" {
					return false
				}
				if binding.Kind != "attribute" {
					continue
				}
				kind := ReadSourceAttr
				if binding.Object == "target" {
					kind = ReadTargetAttr
				}
				// 核对整槽的声明字段；读值由运行态按实际字段依赖核对。
				reads = append(reads, bindAttributeInstruction(GenericInstr{Op: GenericOpRead, ReadKind: kind, ReadKey: binding.AttributeKey + ".presence", AuthoredRead: true}, r.attributeLayout))
			}
			reads = append(reads, b.dependencies...)
		}
		for _, in := range p.Instr {
			if in.Op == GenericOpRef && !visit(GenericProgramID(in.RefIndex)) {
				return false
			}
			if in.Op != GenericOpRead {
				continue
			}
			switch in.ReadKind {
			case ReadSourceAttr, ReadTargetAttr, ReadProviderState, ReadProviderTargetState:
				reads = append(reads, in)
			default:
				return false
			}
		}
		return true
	}
	supported := visit(id)
	return reads, supported
}
