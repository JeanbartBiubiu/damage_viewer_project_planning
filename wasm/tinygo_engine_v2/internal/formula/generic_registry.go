package formula

import (
	"errors"
	"math"
	"unsafe"

	"tinygo_engine_v2/internal/base/attribute"
)

const (
	MaxGenericPrograms            = 65536
	MaxGenericProgramInstructions = 512
	MaxGenericTotalInstructions   = 262144
	MaxGenericTotalInputs         = 262144
	MaxGenericTotalStages         = 65536
	MaxGenericFormulaMemoryBytes  = 32 << 20
)

var (
	errGenericProgramLimit     = errors.New("formula program count exceeds maximum")
	errGenericInstructionLimit = errors.New("formula instruction count exceeds maximum")
	errGenericTotalLimit       = errors.New("formula cumulative instruction count exceeds maximum")
	errGenericInputLimit       = errors.New("formula cumulative input count exceeds maximum")
	errGenericStageLimit       = errors.New("formula cumulative result count exceeds maximum")
	errGenericMemoryLimit      = errors.New("formula memory accounting exceeds maximum")
	errGenericKeyConflict      = errors.New("formula key already registered with different contents")
)

// programStore的两种内容共享同一预算和编号；程序内容注册后只读。
type programStore struct {
	shared            bool
	attributeLayout   *attribute.Layout
	programs          []GenericProgram
	index             map[string]GenericProgramID
	accountedPrograms int
	instructionCount  int
	inputCount        int
	stageCount        int
	memoryBytes       uint64
}

type genericUsage struct {
	instructions, inputs, stages int
	bytes                        uint64
}

func IsRegistryLimit(err error) bool {
	return errors.Is(err, errGenericProgramLimit) || errors.Is(err, errGenericInstructionLimit) || errors.Is(err, errGenericTotalLimit) || errors.Is(err, errGenericInputLimit) || errors.Is(err, errGenericStageLimit) || errors.Is(err, errGenericMemoryLimit)
}

func programUsage(program GenericProgram) (genericUsage, error) {
	usage := genericUsage{instructions: len(program.Instr)}
	if program.Authored != nil {
		if len(program.Instr) != 0 {
			return genericUsage{}, errors.New("formula program contents must be mutually exclusive")
		}
		stats := program.Authored.Stats()
		if stats.Stages < 1 {
			return genericUsage{}, errors.New("authored formula program is invalid")
		}
		usage.instructions, usage.inputs, usage.stages = stats.Instructions, stats.Inputs, stats.Stages
	} else if len(program.Instr) == 0 || program.BindingBytes != 0 {
		return genericUsage{}, errors.New("formula program requires instructions or authored content")
	}
	if usage.instructions > MaxGenericProgramInstructions {
		return genericUsage{}, errGenericInstructionLimit
	}
	var err error
	usage.bytes, err = genericProgramMemoryBytes(program)
	return usage, err
}

func addUsage(total, next genericUsage) (genericUsage, error) {
	if next.instructions > MaxGenericTotalInstructions-total.instructions {
		return genericUsage{}, errGenericTotalLimit
	}
	if next.inputs > MaxGenericTotalInputs-total.inputs {
		return genericUsage{}, errGenericInputLimit
	}
	if next.stages > MaxGenericTotalStages-total.stages {
		return genericUsage{}, errGenericStageLimit
	}
	if next.bytes > uint64(MaxGenericFormulaMemoryBytes)-total.bytes {
		return genericUsage{}, errGenericMemoryLimit
	}
	return genericUsage{total.instructions + next.instructions, total.inputs + next.inputs, total.stages + next.stages, total.bytes + next.bytes}, nil
}

func (r *programStore) register(program GenericProgram) (GenericProgramID, error) {
	if r == nil {
		return 0, errors.New("formula registry is nil")
	}
	if program.Key == "" {
		return 0, errors.New("formula program key is required")
	}
	if id, exists := r.index[program.Key]; exists {
		if int(id) >= len(r.programs) {
			return 0, errors.New("formula registered index is out of range")
		}
		if !sameGenericProgram(r.programs[id], program) {
			return 0, errGenericKeyConflict
		}
		return id, nil
	}
	if len(r.programs) >= MaxGenericPrograms {
		return 0, errGenericProgramLimit
	}
	current, err := r.usage()
	if err != nil {
		return 0, err
	}
	if err := r.validateCalls(program); err != nil {
		return 0, err
	}
	next, err := programUsage(program)
	if err != nil {
		return 0, err
	}
	total, err := addUsage(current, next)
	if err != nil {
		return 0, err
	}
	id := GenericProgramID(len(r.programs))
	if r.index == nil {
		r.index = make(map[string]GenericProgramID)
	}
	r.programs = append(r.programs, bindProgramAttributes(ownProgram(program), r.attributeLayout))
	r.index[program.Key] = id
	r.accountedPrograms, r.instructionCount = len(r.programs), total.instructions
	r.inputCount, r.stageCount, r.memoryBytes = total.inputs, total.stages, total.bytes
	return id, nil
}

func (r programStore) usage() (genericUsage, error) {
	if len(r.programs) > MaxGenericPrograms {
		return genericUsage{}, errGenericProgramLimit
	}
	total := genericUsage{}
	if r.accountedPrograms == len(r.programs) {
		cached := genericUsage{r.instructionCount, r.inputCount, r.stageCount, r.memoryBytes}
		if cached.instructions < 0 || cached.inputs < 0 || cached.stages < 0 {
			return genericUsage{}, errGenericTotalLimit
		}
		return addUsage(total, cached)
	}
	for _, program := range r.programs {
		next, err := programUsage(program)
		if err != nil {
			return genericUsage{}, err
		}
		total, err = addUsage(total, next)
		if err != nil {
			return genericUsage{}, err
		}
	}
	return total, nil
}

func genericProgramMemoryBytes(program GenericProgram) (uint64, error) {
	if len(program.Instr) > MaxGenericProgramInstructions {
		return 0, errGenericInstructionLimit
	}
	remaining := uint64(MaxGenericFormulaMemoryBytes)
	consume := func(bytes uint64) bool {
		if bytes > remaining {
			return false
		}
		remaining -= bytes
		return true
	}
	if !consume(uint64(unsafe.Sizeof(GenericProgram{}))) || !consume(uint64(len(program.Key))) {
		return 0, errGenericMemoryLimit
	}
	if !consume(program.PlanBytes) {
		return 0, errGenericMemoryLimit
	}
	if program.Authored != nil {
		stats := program.Authored.Stats()
		if stats.ChargedBytes < 0 || !consume(uint64(stats.ChargedBytes)) || !consume(program.BindingBytes) {
			return 0, errGenericMemoryLimit
		}
	} else {
		if !consume(uint64(len(program.Instr)) * uint64(unsafe.Sizeof(GenericInstr{}))) {
			return 0, errGenericMemoryLimit
		}
		for _, instr := range program.Instr {
			if !consume(uint64(len(instr.ReadKey))) {
				return 0, errGenericMemoryLimit
			}
		}
	}
	return uint64(MaxGenericFormulaMemoryBytes) - remaining, nil
}

func sameGenericProgram(a, b GenericProgram) bool {
	if a.Key != b.Key || authoredIdentity(a) != authoredIdentity(b) || a.BindingBytes != b.BindingBytes || a.PlanBytes != b.PlanBytes || !sameNamedBinding(a.NamedBinding, b.NamedBinding) || a.DeclaredNamed != b.DeclaredNamed || len(a.Instr) != len(b.Instr) {
		return false
	}
	for i, instr := range a.Instr {
		other := b.Instr[i]
		if instr.Op != other.Op || instr.AuthoredRead != other.AuthoredRead || math.Float64bits(instr.Value) != math.Float64bits(other.Value) || instr.ReadKind != other.ReadKind || instr.ReadKey != other.ReadKey || instr.RefIndex != other.RefIndex || instr.Decimals != other.Decimals || instr.JumpTarget != other.JumpTarget {
			return false
		}
	}
	return true
}

func (r programStore) validateCalls(program GenericProgram) error {
	visiting := make(map[GenericProgramID]bool)
	var count func(GenericProgram, int) (int, error)
	count = func(p GenericProgram, depth int) (int, error) {
		if depth > 32 {
			return 0, errGenericTotalLimit
		}
		total := len(p.Instr)
		if p.Authored != nil {
			total = p.Authored.Stats().Instructions
		}
		for _, in := range p.Instr {
			if in.Op != GenericOpRef {
				continue
			}
			id := GenericProgramID(in.RefIndex)
			if int(id) >= len(r.programs) || visiting[id] {
				return 0, errors.New("formula call is unknown or cyclic")
			}
			visiting[id] = true
			cost, err := count(r.programs[id], depth+1)
			delete(visiting, id)
			if err != nil {
				return 0, err
			}
			if cost > MaxGenericTotalInstructions-total {
				return 0, errGenericTotalLimit
			}
			total += cost
		}
		return total, nil
	}
	_, err := count(program, 1)
	return err
}
