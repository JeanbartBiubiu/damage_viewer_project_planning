package execution

import effectpkg "tinygo_engine_v2/internal/runtime/effect"

// 组合测试用真实效果写口准备输入，不公开生产状态供测试修改。
type providerStateTestSeed struct {
	state, targetValues      map[string]float64
	expireAt, targetExpireAt map[string]int64
	targetKey                string
	fieldDefs                map[string]effectpkg.FieldDefinition
}
type providerStateTestSeeds map[string]providerStateTestSeed

func setTestProviderStateBag(state *effectpkg.BagState, ref string, seed providerStateTestSeed) {
	change := state.Edit(ref, true)
	if seed.fieldDefs != nil {
		change.BindFieldDefs(effectpkg.NewFields(seed.fieldDefs))
	}
	for key, value := range seed.state {
		change.SetStateValue(key, value)
	}
	for key, value := range seed.expireAt {
		change.SetExpireAt(key, value)
	}
	if seed.targetKey != "" {
		change.ActivateProviderTarget(seed.targetKey)
	}
	for key, value := range seed.targetValues {
		change.SetTargetValue(key, value)
	}
	for key, value := range seed.targetExpireAt {
		change.SetTargetExpireAt(key, value)
	}
}
func testProviderStates(seeds providerStateTestSeeds) effectpkg.BagState {
	state := effectpkg.RestoreBags(nil)
	for ref, seed := range seeds {
		setTestProviderStateBag(&state, ref, seed)
	}
	return state
}
func newTestProviderStateBag(seed providerStateTestSeed) effectpkg.BagChange {
	state := testProviderStates(providerStateTestSeeds{"test": seed})
	return state.Edit("test", false)
}
