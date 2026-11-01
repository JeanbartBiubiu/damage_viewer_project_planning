package continuation

import "tinygo_engine_v2/internal/model"

// Host 只交接原位读取、真实帧执行及父层唯一入队，不提供总运行状态。
type Host interface {
	// ReadRepeatState 在原重复资格检查位置读取拥有者状态，读取可能准备到期状态。
	ReadRepeatState(owner, provider, key string) (float64, bool)
	// ApplyCopy 创建并完整提交一笔原始复制伤害；失败保留已经发布的前序事实。
	ApplyCopy(*Collector, FrozenDamage, string) *model.EngineError
	// SettleCopyDeaths 在原复制尾部判断死亡，不提前截断同步复制遍历。
	SettleCopyDeaths()
	// CopiesStopped 返回唯一循环当前停止状态。
	CopiesStopped() bool
	// QueueCopyContinuation 使用父层唯一队列写入已登记载荷的时间及身份；失败不保留载荷。
	QueueCopyContinuation(id uint64, delayMs int) *model.EngineError
}

// Executor 私有持有本场延迟载荷及同步栈，零值可直接使用。
// ExecutorAPI 列出该对象当前实际公开的完整能力。
type ExecutorAPI interface {
	// Find 返回相同使用的最近同步深度和原事件收集器；计时恢复不会继承。
	Find(use string) (int, *Collector)
	// Fire 取出且移除唯一延迟载荷，按原重复次数同步执行；缺失身份无变化。
	Fire(host Host, id uint64) *model.EngineError
	// Flush 在真实事件尾部稳定排序，先立即复制，再判断死亡并安排延迟复制。
	Flush(host Host, c *Collector) *model.EngineError
	// PendingCounts 返回不会写入最终快照的续接数及复制伤害数。
	PendingCounts() (int, int)
	// Pop 在原同步调用返回位置清除最内层因果。
	Pop()
	// Push 在真实同步过程启动位置登记因果，仅当前同步调用期间有效。
	Push(use string, depth int, c *Collector)
}

type Executor struct {
	pending map[uint64]*payload
	nextID  uint64
	inline  [2]causal
	extra   []causal
	count   int
}
type payload struct {
	damages  []FrozenDamage
	request  RepeatRequest
	commands int
}
type causal struct {
	use       string
	depth     int
	collector *Collector
}

var _ ExecutorAPI = (*Executor)(nil)

func (s *Executor) Flush(host Host, c *Collector) *model.EngineError {
	if c == nil || len(c.repeats) == 0 || c.Phantom() {
		return nil
	}
	d, r := c.CloneSorted()
	immediate := make([]RepeatRequest, 0, len(r))
	delayed := make([]RepeatRequest, 0, len(r))
	for _, request := range r {
		if request.RepeatDelayMs > 0 {
			delayed = append(delayed, request)
		} else {
			immediate = append(immediate, request)
		}
	}
	c.phantomDepth = 1
	defer func() { c.phantomDepth = 0 }()
	for _, request := range immediate {
		if request.RepeatScope != model.RepeatScopeCopyableOnHit || !triggerMet(host, request) {
			continue
		}
		if err := executeCopies(host, c, d, request); err != nil {
			return err
		}
	}
	host.SettleCopyDeaths()
	if !host.CopiesStopped() {
		for _, request := range delayed {
			if request.RepeatScope != model.RepeatScopeCopyableOnHit || !triggerMet(host, request) {
				continue
			}
			s.nextID++
			id := s.nextID
			if s.pending == nil {
				s.pending = make(map[uint64]*payload)
			}
			s.pending[id] = &payload{damages: append([]FrozenDamage(nil), d...), request: request}
			if err := host.QueueCopyContinuation(id, request.RepeatDelayMs); err != nil {
				delete(s.pending, id)
				return err
			}
		}
	}
	return nil
}
func (s *Executor) Fire(host Host, id uint64) *model.EngineError {
	p, ok := s.pending[id]
	if !ok || p == nil {
		return nil
	}
	delete(s.pending, id)
	if host.CopiesStopped() || p.request.RepeatScope != model.RepeatScopeCopyableOnHit {
		return nil
	}
	c := &Collector{phantomDepth: 1, commandCount: p.commands}
	if err := executeCopies(host, c, p.damages, p.request); err != nil {
		return err
	}
	host.SettleCopyDeaths()
	return nil
}
func executeCopies(host Host, c *Collector, d []FrozenDamage, r RepeatRequest) *model.EngineError {
	times := r.RepeatCount
	if times <= 0 {
		times = 1
	}
	for i := 0; i < times; i++ {
		for _, damage := range d {
			if err := host.ApplyCopy(c, damage, r.RepeatTag); err != nil {
				return err
			}
		}
	}
	return nil
}
func triggerMet(host Host, r RepeatRequest) bool {
	if r.OwnerCombatantKey == "" || r.OwnerProviderRef == "" || r.TriggerStateKey == "" {
		return false
	}
	value, ok := host.ReadRepeatState(r.OwnerCombatantKey, r.OwnerProviderRef, r.TriggerStateKey)
	return ok && value >= r.Threshold
}
func (s *Executor) PendingCounts() (int, int) {
	copies := 0
	for _, p := range s.pending {
		if p == nil {
			continue
		}
		times := p.request.RepeatCount
		if times <= 0 {
			times = 1
		}
		copies += times * len(p.damages)
	}
	return len(s.pending), copies
}
func (s *Executor) Push(use string, depth int, c *Collector) {
	v := causal{use: use, depth: depth, collector: c}
	if s.count < len(s.inline) {
		s.inline[s.count] = v
	} else {
		s.extra = append(s.extra, v)
	}
	s.count++
}
func (s *Executor) Pop() {
	s.count--
	if s.count < len(s.inline) {
		s.inline[s.count] = causal{}
	} else {
		last := len(s.extra) - 1
		s.extra[last] = causal{}
		s.extra = s.extra[:last]
	}
}
func (s *Executor) Find(use string) (int, *Collector) {
	for i := s.count - 1; i >= 0; i-- {
		var v causal
		if i < len(s.inline) {
			v = s.inline[i]
		} else {
			v = s.extra[i-len(s.inline)]
		}
		if v.use == use {
			return v.depth, v.collector
		}
	}
	return 0, nil
}
