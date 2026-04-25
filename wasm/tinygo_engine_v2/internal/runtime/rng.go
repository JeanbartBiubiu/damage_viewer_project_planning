// 本文件实现确定性 RNG，并记录 stream、draw index、用途和结果，便于 replay 对齐。
package runtime

import "tinygo_engine_v2/internal/model"

type RNG struct {
	state uint64
	index uint64
	draws []model.RNGDraw
}

func NewRNG(seed uint64) RNG {
	if seed == 0 {
		seed = 0x9e3779b97f4a7c15
	}
	return RNG{state: seed, draws: make([]model.RNGDraw, 0, 16)}
}

func (r *RNG) Float(use string) float64 {
	r.state = r.state*6364136223846793005 + 1442695040888963407
	value := float64(r.state>>11) * (1.0 / 9007199254740992.0)
	r.draws = append(r.draws, model.RNGDraw{Stream: "main", Index: r.index, Use: use, Value: value})
	r.index++
	return value
}

func (r *RNG) Draws() []model.RNGDraw {
	return r.draws
}
