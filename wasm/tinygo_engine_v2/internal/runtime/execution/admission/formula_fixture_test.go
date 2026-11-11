package admission

import (
	"strconv"
	"tinygo_engine_v2/internal/base/attribute"
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

func fixtureFormulaLibraryPtr(programs []formula.GenericProgram) *formula.Library {
	value := fixtureFormulaLibrary(programs)
	return &value
}
func fixtureRegister(library *formula.Library, program formula.GenericProgram) (formula.GenericProgramID, error) {
	builder := formula.NewBuilder(*library)
	id, err := builder.Register(program)
	if err == nil {
		*library = builder.Freeze()
	}
	return id, err
}
func fixtureBindLayout(library *formula.Library, layout *attribute.Layout) {
	builder := formula.NewBuilder(*library)
	builder.BindAttributeLayout(layout)
	*library = builder.Freeze()
}
