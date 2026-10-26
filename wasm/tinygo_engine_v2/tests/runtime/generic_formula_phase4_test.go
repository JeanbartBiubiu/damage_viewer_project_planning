// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	testing "testing"
)

func assertNoLegacyDefenseFields(t *testing.T, data map[string]interface{}) {
	t.Helper()
	for _, key := range []string{"resistanceBeforePenetration", "penetrationPercent", "penetrationFlat", "effectiveResistance"} {
		if _, exists := data[key]; exists {
			t.Fatalf("removed defense field %s survived: %+v", key, data)
		}
	}
}
