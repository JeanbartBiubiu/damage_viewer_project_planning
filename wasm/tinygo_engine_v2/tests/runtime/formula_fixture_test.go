package runtime_test

import (
	"strconv"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
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

func fixtureCompileDeclaredNamed(defs []model.NamedFormula, attrs []string, library *formula.Library, add func(model.GenericErrCode, string, string, string)) {
	builder := formula.NewBuilder(*library)
	formula.CompileDeclaredNamedFormulas(defs, attrs, &builder, add)
	*library = builder.Freeze()
}
