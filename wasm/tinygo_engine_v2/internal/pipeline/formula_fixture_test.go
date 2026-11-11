package pipeline

import (
	"strconv"
	"tinygo_engine_v2/internal/formula"
)

func fixtureFormulaBuilder(programs []formula.GenericProgram) formula.Builder {
	var builder formula.Builder
	for index, program := range programs {
		if program.Key == "" {
			program.Key = "fixture:" + strconv.Itoa(index)
		}
		if _, err := builder.Register(program); err != nil {
			panic(err)
		}
	}
	return builder
}
func fixtureFormulaLibrary(programs []formula.GenericProgram) formula.Library {
	builder := fixtureFormulaBuilder(programs)
	return builder.Freeze()
}
