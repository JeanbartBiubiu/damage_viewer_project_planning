package execution

import (
	"reflect"
	"testing"
	"tinygo_engine_v2/internal/model"
)

// 跨帧组合测试只观察数值与期限；私有世代、共享标志和终点保护在effect包内核对。
type providerStateOwnershipView struct {
	state, targetValues    map[string]float64
	expireAt, targetExpire map[string]int64
	target                 string
}
type providerStateReadView interface {
	State() model.NumericView
	TargetValues() model.NumericView
	ExpireAt() model.DeadlineView
	TargetExpireAt() model.DeadlineView
	TargetKey() string
}

func providerStateOwnershipSnapshot(bag providerStateReadView) providerStateOwnershipView {
	return providerStateOwnershipView{bag.State().ToMap(), bag.TargetValues().ToMap(), bag.ExpireAt().ToMap(), bag.TargetExpireAt().ToMap(), bag.TargetKey()}
}
func assertProviderStateOwnershipView(t *testing.T, label string, bag providerStateReadView, want providerStateOwnershipView) {
	t.Helper()
	if got := providerStateOwnershipSnapshot(bag); !reflect.DeepEqual(got, want) {
		t.Fatalf("%s changed another version: got %+v want %+v", label, got, want)
	}
}
