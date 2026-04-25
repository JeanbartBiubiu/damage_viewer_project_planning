// 本文件验证资源 spend 阻断和 current/max clamp 的基础语义。
package resource

import "testing"

func TestManaBlocksSpend(t *testing.T) {
	mana := Slot{ID: "mana", Current: 30, Max: 100}

	result := mana.Spend(40)

	if result.Code != ErrInsufficient {
		t.Fatalf("code %v, want ErrInsufficient", result.Code)
	}
	if result.Current != 30 {
		t.Fatalf("current %.2f, want 30", result.Current)
	}
	if mana.CanSpend(40) {
		t.Fatal("CanSpend should be false when current mana is too low")
	}
}
