package expression

const (
	MaxPrograms          = 65536
	MaxTotalInstructions = 262144
	MaxTotalInputs       = 262144
	MaxTotalStages       = 65536
	MaxMemoryBytes       = 32 << 20
)

// Table 只允许预检后追加不可变程序；不暴露程序列表、索引或累计计数的写入口。
type Table struct {
	programs     []*Program
	keys         map[string]uint16
	instructions int
	inputs       int
	stages       int
	bytes        int
}

type TableStats struct {
	Programs, Instructions, Inputs, Stages, ChargedBytes int
}

func (t *Table) Stats() TableStats {
	return TableStats{len(t.programs), t.instructions, t.inputs, t.stages, t.bytes}
}

func (t *Table) Register(key string, program *Program, path string) (uint16, *ContractIssue) {
	if program == nil || len(program.stages) == 0 || len(key) == 0 || len(key) > 128 {
		return 0, contractProblem("FORMULA_INVALID_PROGRAM", path)
	}
	if id, exists := t.keys[key]; exists {
		if t.programs[id] != program {
			return 0, contractProblem("FORMULA_DUPLICATE_KEY", path)
		}
		return id, nil
	}
	stats := program.Stats()
	// 每个表项额外保守收取指针、索引及标识映射的逻辑收费，不等同实际map堆。
	bytes := stats.ChargedBytes + len(key) + 64
	if len(t.programs) >= MaxPrograms || stats.Instructions > MaxTotalInstructions-t.instructions || stats.Inputs > MaxTotalInputs-t.inputs || stats.Stages > MaxTotalStages-t.stages || bytes > MaxMemoryBytes-t.bytes {
		return 0, contractProblem("FORMULA_LIMIT", path)
	}
	id := uint16(len(t.programs))
	if t.keys == nil {
		t.keys = make(map[string]uint16)
	}
	t.programs = append(t.programs, program)
	t.keys[key] = id
	t.instructions += stats.Instructions
	t.inputs += stats.Inputs
	t.stages += stats.Stages
	t.bytes += bytes
	return id, nil
}

func (t *Table) Evaluate(id uint16, reader ReadInput) (Evaluation, *ContractIssue) {
	if int(id) >= len(t.programs) {
		return Evaluation{}, contractProblem("FORMULA_INVALID_PROGRAM", "")
	}
	return t.programs[id].Evaluate(reader)
}
