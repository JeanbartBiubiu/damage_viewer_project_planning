package testkit

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

// GenericFixture 是 generic_p0_* fixture 的顶层结构。
type GenericFixture struct {
	Name                  string                 `json:"name"`
	Phase                 string                 `json:"phase"`
	CompileRequest        model.CompileRequest   `json:"compileRequest"`
	RunRequest            model.RunRequest       `json:"runRequest,omitempty"`
	ExpectedResultKind    string                 `json:"expectedResultKind"`
	ExpectedErrorCodes    []model.GenericErrCode `json:"expectedErrorCodes"`
	ExpectedWarnings      []string               `json:"expectedWarnings"`
	ExpectedEvidenceKinds []string               `json:"expectedEvidenceKinds"`
	ExpectedSummarySubset map[string]interface{} `json:"expectedSummarySubset"`
	Notes                 string                 `json:"notes"`
}

// LoadGenericFixture 读取 internal/testkit/fixtures 下的 generic fixture。
func LoadGenericFixture(name string) (GenericFixture, error) {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		return GenericFixture{}, os.ErrInvalid
	}
	path := filepath.Join(filepath.Dir(file), "fixtures", name)
	raw, err := os.ReadFile(path)
	if err != nil {
		return GenericFixture{}, err
	}
	var fixture GenericFixture
	if err := json.Unmarshal(raw, &fixture); err != nil {
		return GenericFixture{}, err
	}
	return fixture, nil
}

// CompileGenericFixture 编译 fixture 中的 compileRequest。
func CompileGenericFixture(name string) (compile.GenericCompileResult, error) {
	fixture, err := LoadGenericFixture(name)
	if err != nil {
		return compile.GenericCompileResult{}, err
	}
	return compile.CompileGeneric(fixture.CompileRequest), nil
}
