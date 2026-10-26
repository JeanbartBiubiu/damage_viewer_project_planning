package effect

import "testing"

func TestIdentityRegistryRetainsRestoredCollisionsAndIndependentSequences(t *testing.T) {
	registry := NewIdentityRegistry()
	registry.ReserveProvider("effect#1")
	registry.ReserveProvider("effect#3")
	registry.ReserveShield("shield:auto#1")
	if next := registry.NextProvider("effect"); next != "effect#2" {
		t.Fatal(next)
	}
	if next := registry.NextProvider("effect"); next != "effect#4" {
		t.Fatal(next)
	}
	if next := registry.NextShield(""); next != "shield:auto#2" || registry.providerSequence != 4 || registry.shieldSequence != 2 {
		t.Fatal("provider and shield sequence or default reference changed", next)
	}
	// 名称改变也不能重置本场序号，已用身份不因实例移除而重用。
	if next := registry.NextProvider("other"); next != "other#5" {
		t.Fatal(next)
	}
}
