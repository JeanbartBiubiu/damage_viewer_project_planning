package effect

import planbundle "tinygo_engine_v2/internal/plan"

// DefinitionCache 按实际已编译定义缓存只读字段元数据，普通查找不重建映射。
type DefinitionCache struct{ fields []*FieldMetadata }

func (c *DefinitionCache) Lookup(index int, providers []planbundle.CompiledProvider) *FieldMetadata {
	if index < 0 || index >= len(providers) {
		return nil
	}
	if c.fields == nil {
		c.fields = make([]*FieldMetadata, len(providers))
	}
	if c.fields[index] == nil {
		c.fields[index] = CompileFields(providers[index].StateFields)
	}
	return c.fields[index]
}
func (m *FieldMetadata) HasInternalCooldowns() bool { return m != nil && m.hasInternalCooldowns }
