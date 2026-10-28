package expression

import (
	"encoding/json"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

// ContractIssue 是共同公式定义中的确定性首个问题；Path 为 JSON Pointer。
type ContractIssue struct {
	Code string `json:"code"`
	Path string `json:"path"`
}

type contractShapeCheck struct {
	schema       map[string]any
	nodes        int
	instructions int
	limits       map[string]any
}

type contractEdge struct {
	target int
	path   string
}

func decodeContractSchema() (map[string]any, error) {
	var schema map[string]any
	err := json.Unmarshal([]byte(contractSchemaJSON), &schema)
	return schema, err
}

func contractProblem(code, path string) *ContractIssue {
	return &ContractIssue{Code: code, Path: path}
}

func contractPointer(path, field string) string {
	return path + "/" + strings.ReplaceAll(strings.ReplaceAll(field, "~", "~0"), "/", "~1")
}

func contractMap(v any) map[string]any { m, _ := v.(map[string]any); return m }
func contractArray(v any) []any        { a, _ := v.([]any); return a }
func contractString(v any) string      { s, _ := v.(string); return s }

func contractEqual(a, b any) bool {
	switch x := a.(type) {
	case nil:
		return b == nil
	case string:
		y, ok := b.(string)
		return ok && x == y
	case bool:
		y, ok := b.(bool)
		return ok && x == y
	case float64:
		y, ok := contractNumber(b)
		return ok && x == y
	case map[string]any:
		y, ok := b.(map[string]any)
		if !ok || len(x) != len(y) {
			return false
		}
		for key, value := range x {
			other, exists := y[key]
			if !exists || !contractEqual(value, other) {
				return false
			}
		}
		return true
	case []any:
		y, ok := b.([]any)
		if !ok || len(x) != len(y) {
			return false
		}
		for i, value := range x {
			if !contractEqual(value, y[i]) {
				return false
			}
		}
		return true
	default:
		return false
	}
}

func contractNumber(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, !math.IsNaN(n) && !math.IsInf(n, 0)
	case json.Number:
		f, err := n.Float64()
		return f, err == nil && !math.IsNaN(f) && !math.IsInf(f, 0)
	case int:
		return float64(n), true
	default:
		return 0, false
	}
}

func contractInteger(v any) (float64, bool) {
	n, ok := contractNumber(v)
	if !ok || math.Trunc(n) != n {
		return 0, false
	}
	if raw, isTextNumber := v.(json.Number); isTextNumber {
		text := raw.String()
		if !json.Valid([]byte(text)) {
			return 0, false
		}
		mantissa, exponent := text, int64(0)
		at := strings.IndexAny(text, "eE")
		if at >= 0 {
			mantissa = text[:at]
		}
		// 合法零不受无关指数大小影响，也不触发整数指数缩窄。
		if !strings.ContainsAny(mantissa, "123456789") {
			return n, true
		}
		if at >= 0 {
			parsed, err := strconv.ParseInt(text[at+1:], 10, 32)
			if err != nil {
				return 0, false
			}
			exponent = parsed
		}
		if dot := strings.IndexByte(mantissa, '.'); dot >= 0 {
			exponent -= int64(len(mantissa) - dot - 1)
			mantissa = mantissa[:dot] + mantissa[dot+1:]
		}
		// 去掉末尾十进制0，再判断是否仍有小数位；不先舍入原数值文本。
		for len(mantissa) > 0 && mantissa[len(mantissa)-1] == '0' {
			mantissa = mantissa[:len(mantissa)-1]
			exponent++
		}
		if strings.ContainsAny(mantissa, "123456789") && exponent < 0 {
			return 0, false
		}
	}
	return n, true
}

func contractLimit(limits map[string]any, key string) int {
	n, _ := contractNumber(limits[key])
	return int(n)
}

// ValidateDefinition 校验原始 JSON 树及使用点明确授权的绑定，不读取战斗状态。
// 合法定义不代表运行输入已经供值；此入口尚未接入旧编译和保存协议。
func ValidateDefinition(definition any, allowedBindings []any) *ContractIssue {
	schema, err := decodeContractSchema()
	if err != nil {
		return contractProblem("FORMULA_INVALID_STRUCTURE", "")
	}
	check := contractShapeCheck{schema: schema, limits: contractMap(schema["x-limits"])}
	if issue := check.shape(schema, definition, "", 0); issue != nil {
		return issue
	}
	root := contractMap(definition)
	inputs := contractArray(root["inputs"])
	stages := contractArray(root["stages"])
	check.instructions += len(stages)
	if check.instructions > contractLimit(check.limits, "maxInstructions") {
		return contractProblem("FORMULA_LIMIT", "/stages")
	}
	for i, raw := range stages {
		stage := contractMap(raw)
		if issue := contractDecimals(contractMap(stage["expression"]), "/stages/"+strconv.Itoa(i)+"/expression"); issue != nil {
			return issue
		}
	}
	inputKeys := make(map[string]bool, len(inputs))
	for i, raw := range inputs {
		key := contractString(contractMap(raw)["key"])
		if inputKeys[key] {
			return contractProblem("FORMULA_DUPLICATE_KEY", "/inputs/"+strconv.Itoa(i)+"/key")
		}
		inputKeys[key] = true
	}
	stageIndex := make(map[string]int, len(stages))
	for i, raw := range stages {
		key := contractString(contractMap(raw)["key"])
		if _, exists := stageIndex[key]; exists {
			return contractProblem("FORMULA_DUPLICATE_KEY", "/stages/"+strconv.Itoa(i)+"/key")
		}
		stageIndex[key] = i
	}
	if _, exists := stageIndex[contractString(root["outputStageKey"])]; !exists {
		return contractProblem("FORMULA_UNKNOWN_STAGE", "/outputStageKey")
	}
	for i, raw := range inputs {
		binding := contractMap(raw)["binding"]
		found := false
		for _, allowed := range allowedBindings {
			if contractEqual(binding, allowed) {
				found = true
				break
			}
		}
		if !found {
			return contractProblem("FORMULA_UNKNOWN_BINDING", "/inputs/"+strconv.Itoa(i)+"/binding")
		}
	}
	edges := make([][]contractEdge, len(stages))
	for i, raw := range stages {
		expr := contractMap(contractMap(raw)["expression"])
		path := "/stages/" + strconv.Itoa(i) + "/expression"
		if issue := contractReferences(expr, path, inputKeys, stageIndex, &edges[i]); issue != nil {
			return issue
		}
	}
	colors := make([]uint8, len(stages))
	var visit func(int) *ContractIssue
	visit = func(i int) *ContractIssue {
		if colors[i] == 2 {
			return nil
		}
		colors[i] = 1
		for _, edge := range edges[i] {
			if colors[edge.target] == 1 {
				return contractProblem("FORMULA_CYCLE", edge.path)
			}
			if issue := visit(edge.target); issue != nil {
				return issue
			}
		}
		colors[i] = 2
		return nil
	}
	for i := range stages {
		if issue := visit(i); issue != nil {
			return issue
		}
	}
	depths := make([]int, len(stages))
	var stageDepth func(int) int
	var expressionDepth func(map[string]any) int
	stageDepth = func(i int) int {
		if depths[i] == 0 {
			depths[i] = expressionDepth(contractMap(contractMap(stages[i])["expression"]))
		}
		return depths[i]
	}
	expressionDepth = func(expr map[string]any) int {
		if contractString(expr["op"]) == "ref" {
			return 1 + stageDepth(stageIndex[contractString(expr["stageKey"])])
		}
		longest := 0
		for _, child := range contractArray(expr["args"]) {
			d := expressionDepth(contractMap(child))
			if d > longest {
				longest = d
			}
		}
		return longest + 1
	}
	for i := range stages {
		if stageDepth(i) > contractLimit(check.limits, "maxDepth") {
			return contractProblem("FORMULA_LIMIT", "/stages/"+strconv.Itoa(i)+"/expression")
		}
	}
	return nil
}

func (c *contractShapeCheck) shape(schema map[string]any, value any, path string, depth int) *ContractIssue {
	if reference, ok := schema["$ref"].(string); ok {
		name := strings.TrimPrefix(reference, "#/$defs/")
		if name == "expression" {
			depth++
			c.nodes++
			if depth > contractLimit(c.limits, "maxDepth") || c.nodes > contractLimit(c.limits, "maxNodes") {
				return contractProblem("FORMULA_LIMIT", path)
			}
		}
		return c.shape(contractMap(contractMap(c.schema["$defs"])[name]), value, path, depth)
	}
	if discriminator, ok := schema["x-discriminator"].(string); ok {
		object := contractMap(value)
		if object == nil {
			return contractProblem("FORMULA_INVALID_STRUCTURE", path)
		}
		for _, alternative := range contractArray(schema["oneOf"]) {
			variant := contractMap(alternative)
			properties := contractMap(variant["properties"])
			if contractEqual(contractMap(properties[discriminator])["const"], object[discriminator]) {
				if discriminator == "op" {
					cost := 1
					if object["op"] == "if" {
						cost = 3
					}
					c.instructions += cost
					if c.instructions > contractLimit(c.limits, "maxInstructions") {
						return contractProblem("FORMULA_LIMIT", path)
					}
				}
				return c.shape(variant, value, path, depth)
			}
		}
		return contractProblem("FORMULA_INVALID_STRUCTURE", contractPointer(path, discriminator))
	}
	if literal, exists := schema["const"]; exists && !contractEqual(literal, value) {
		return contractProblem("FORMULA_INVALID_STRUCTURE", path)
	}
	if values, exists := schema["enum"]; exists {
		matched := false
		for _, candidate := range contractArray(values) {
			if contractEqual(candidate, value) {
				matched = true
				break
			}
		}
		if !matched {
			return contractProblem("FORMULA_INVALID_STRUCTURE", path)
		}
	}
	switch schema["type"] {
	case "object":
		object := contractMap(value)
		if object == nil {
			return contractProblem("FORMULA_INVALID_STRUCTURE", path)
		}
		properties := contractMap(schema["properties"])
		keys := make([]string, 0, len(object))
		for key := range object {
			keys = append(keys, key)
		}
		sort.Strings(keys) // UTF-8字典顺序与有效Unicode码点顺序一致。
		for _, key := range keys {
			if _, exists := properties[key]; !exists && schema["additionalProperties"] == false {
				return contractProblem("FORMULA_INVALID_STRUCTURE", contractPointer(path, key))
			}
		}
		for _, raw := range contractArray(schema["required"]) {
			key := contractString(raw)
			_, exists := object[key]
			if !exists {
				return contractProblem("FORMULA_INVALID_STRUCTURE", contractPointer(path, key))
			}
		}
		for _, raw := range contractArray(schema["required"]) {
			key := contractString(raw)
			if issue := c.shape(contractMap(properties[key]), object[key], contractPointer(path, key), depth); issue != nil {
				return issue
			}
		}
	case "array":
		array, ok := value.([]any)
		if !ok || array == nil {
			return contractProblem("FORMULA_INVALID_STRUCTURE", path)
		}
		if min, exists := schema["minItems"]; exists && len(array) < contractLimit(map[string]any{"n": min}, "n") {
			return contractProblem("FORMULA_INVALID_STRUCTURE", path)
		}
		if max, exists := schema["maxItems"]; exists && len(array) > contractLimit(map[string]any{"n": max}, "n") {
			return contractProblem("FORMULA_INVALID_STRUCTURE", path)
		}
		for i, child := range array {
			if issue := c.shape(contractMap(schema["items"]), child, contractPointer(path, strconv.Itoa(i)), depth); issue != nil {
				return issue
			}
		}
	case "string":
		text, ok := value.(string)
		if !ok {
			return contractProblem("FORMULA_INVALID_STRUCTURE", path)
		}
		length := utf8.RuneCountInString(text)
		if min, exists := schema["minLength"]; exists && length < contractLimit(map[string]any{"n": min}, "n") {
			return contractProblem("FORMULA_INVALID_STRUCTURE", path)
		}
		if max, exists := schema["maxLength"]; exists && length > contractLimit(map[string]any{"n": max}, "n") {
			return contractProblem("FORMULA_INVALID_STRUCTURE", path)
		}
		if pattern, ok := schema["pattern"].(string); ok {
			matches, err := regexp.MatchString(pattern, text)
			if err != nil || !matches {
				return contractProblem("FORMULA_INVALID_STRUCTURE", path)
			}
		}
	case "integer":
		number, ok := contractInteger(value)
		if !ok {
			return contractProblem("FORMULA_INVALID_STRUCTURE", path)
		}
		if min, exists := schema["minimum"]; exists {
			bound, _ := contractNumber(min)
			if number < bound {
				return contractProblem("FORMULA_INVALID_STRUCTURE", path)
			}
		}
		if max, exists := schema["maximum"]; exists {
			bound, _ := contractNumber(max)
			if number > bound {
				return contractProblem("FORMULA_INVALID_STRUCTURE", path)
			}
		}
	}
	return nil
}

func contractDecimals(expr map[string]any, path string) *ContractIssue {
	if expr["op"] == "const" {
		text := contractString(expr["value"])
		value, err := strconv.ParseFloat(text, 64)
		nonzero := strings.ContainsAny(text, "123456789")
		if err != nil || math.IsNaN(value) || math.IsInf(value, 0) || value == 0 && nonzero {
			return contractProblem("FORMULA_INVALID_DECIMAL", contractPointer(path, "value"))
		}
	}
	for i, child := range contractArray(expr["args"]) {
		if issue := contractDecimals(contractMap(child), path+"/args/"+strconv.Itoa(i)); issue != nil {
			return issue
		}
	}
	return nil
}

func contractReferences(expr map[string]any, path string, inputs map[string]bool, stages map[string]int, edges *[]contractEdge) *ContractIssue {
	switch expr["op"] {
	case "read":
		if !inputs[contractString(expr["inputKey"])] {
			return contractProblem("FORMULA_UNKNOWN_INPUT", path+"/inputKey")
		}
	case "ref":
		target, exists := stages[contractString(expr["stageKey"])]
		if !exists {
			return contractProblem("FORMULA_UNKNOWN_STAGE", path+"/stageKey")
		}
		*edges = append(*edges, contractEdge{target: target, path: path + "/stageKey"})
	}
	for i, child := range contractArray(expr["args"]) {
		if issue := contractReferences(contractMap(child), path+"/args/"+strconv.Itoa(i), inputs, stages, edges); issue != nil {
			return issue
		}
	}
	return nil
}
