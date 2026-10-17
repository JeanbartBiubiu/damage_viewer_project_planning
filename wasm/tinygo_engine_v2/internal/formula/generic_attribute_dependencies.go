package formula

// AttributeCacheDependencies只允许可以完整核对的属性和供值状态读取。
// 同时包含声明但不参与输出的作者输入，保留缺字段与严格读取的错误边界。
func (r GenericRegistry) AttributeCacheDependencies(id GenericProgramID) ([]GenericInstr, bool) {
	var reads []GenericInstr
	seen := make(map[GenericProgramID]bool)
	var visit func(GenericProgramID) bool
	visit = func(id GenericProgramID) bool {
		if int(id) >= len(r.Programs) {
			return false
		}
		if seen[id] {
			return true
		}
		seen[id] = true
		p := r.Programs[id]
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
