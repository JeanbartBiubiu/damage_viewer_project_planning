package effect

import planbundle "tinygo_engine_v2/internal/plan"

// DefinitionCacheAPI 列出编译字段元数据的按需缓存能力；缓存归属实际编译定义。
type DefinitionCacheAPI interface {
	// Lookup 按有效定义下标借用元数据；首次访问会建立缓存，越界返回nil。
	Lookup(index int, providers []planbundle.CompiledProvider) *FieldMetadata
}

// DefinitionCache 按实际已编译定义缓存只读字段元数据，普通查找不重建映射。
type DefinitionCache struct{ fields []*FieldMetadata }

var _ DefinitionCacheAPI = (*DefinitionCache)(nil)

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
