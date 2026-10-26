// 测试输入使用独立属性表，避免场景构造之间共享可写映射。
package runtime_test

import "tinygo_engine_v2/internal/model"

func copyAttributeInput(source map[string]model.AttributeSlotDef) map[string]model.AttributeSlotDef {
	result := make(map[string]model.AttributeSlotDef, len(source))
	for key, value := range source {
		result[key] = value
	}
	return result
}
