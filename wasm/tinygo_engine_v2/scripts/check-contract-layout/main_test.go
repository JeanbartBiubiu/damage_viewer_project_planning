package main

import (
	"go/parser"
	"go/token"
	"strings"
	"testing"
)

func fixture(t *testing.T, path, source string) sourceFile {
	t.Helper()
	set := token.NewFileSet()
	file, err := parser.ParseFile(set, path, source, parser.ParseComments)
	if err != nil {
		t.Fatal(err)
	}
	return sourceFile{path, set, file}
}

func TestContractBoundaries(t *testing.T) {
	valid := `package example
type StateAPI interface {
    // Read 借用当前数值，不修改状态。
    Read() int
}
type State struct { value int }
var _ StateAPI = (*State)(nil)
func (s *State) Read() int { return s.value }
`
	tests := []struct {
		name, source, want string
	}{
		{"valid", valid, ""},
		{"multiline signature", strings.Replace(strings.Replace(valid, "Read() int\n", "Read(\nvalue int,\n) int\n", 1), "Read() int {", "Read(value int) int {", 1), ""},
		{"missing method", valid + "func (s *State) Write() {}", "遗漏方法"},
		{"wrong signature", strings.Replace(valid, "Read() int\n", "Read() float64\n", 1), "签名不一致"},
		{"missing documentation", strings.Replace(valid, "// Read 借用当前数值，不修改状态。", "", 1), "缺少使用说明"},
		{"missing assertion", strings.Replace(valid, "var _ StateAPI = (*State)(nil)", "", 1), "编译期实现检查"},
		{"wrong assertion", strings.Replace(valid, "(*State)(nil)", "(*Other)(nil)", 1), "编译期实现检查"},
		{"late type", valid + "type Other struct{}", "函数实现之前"},
		{"local type", valid + "func local() { type localState struct{}; _ = localState{} }", ""},
		{"extra contract method", strings.Replace(valid, "Read() int\n", "Read() int\n// Extra 不存在的能力。\nExtra()\n", 1), "不存在的公开方法"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			problems, _, _ := checkSources([]sourceFile{fixture(t, "internal/example/state.go", test.source)}, nil)
			joined := strings.Join(problems, "\n")
			if test.want == "" && joined != "" || test.want != "" && !strings.Contains(joined, test.want) {
				t.Fatalf("want %q, got %q", test.want, joined)
			}
		})
	}
}

func TestContractAcrossFilesAndRequiredObject(t *testing.T) {
	files := []sourceFile{
		fixture(t, "internal/example/state.go", `package example
type StateAPI interface {
// Read 借用数值，不写入。
Read(value int) (int, bool)
}
type State struct{}
var _ StateAPI = (*State)(nil)
`),
		fixture(t, "internal/example/read.go", `package example
func (s *State) Read(value int) (int, bool) { return value, true }
`),
	}
	problems, contracts, methods := checkSources(files, map[string][]string{"internal/example": {"State"}})
	if len(problems) != 0 || contracts != 1 || methods != 1 {
		t.Fatalf("unexpected result: %v, %d, %d", problems, contracts, methods)
	}
	problems, _, _ = checkSources(files, map[string][]string{"internal/example": {"Missing"}})
	if !strings.Contains(strings.Join(problems, "\n"), "缺少主要对象") {
		t.Fatal(problems)
	}
}

func TestEstablishedBaseContractCannotDisappear(t *testing.T) {
	files := []sourceFile{fixture(t, "internal/base/attribute/editor.go", `package attribute
type Editor struct{}
func (e *Editor) Finish() {}
`)}
	problems, _, _ := checkSources(files, requiredContracts)
	if !strings.Contains(strings.Join(problems, "\n"), "internal/base/attribute/EditorAPI: 缺少主要对象") {
		t.Fatal(problems)
	}
}
