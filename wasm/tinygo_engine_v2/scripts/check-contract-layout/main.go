// 能力声明与源码排列检查。只读取正式源码，不参与战斗运行。
package main

import (
	"bytes"
	"flag"
	"fmt"
	"go/ast"
	"go/parser"
	"go/printer"
	"go/scanner"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"
)

type sourceFile struct {
	path string
	set  *token.FileSet
	file *ast.File
}

// 这些是真实状态所有者或协作对象；数据包、纯函数不建立服务接口。
var requiredContracts = map[string][]string{
	"internal/base/abi":                     {"Outbox"},
	"internal/base/attribute":               {"Layout", "Table", "Editor"},
	"internal/base/expression":              {"Program", "Table"},
	"internal/base/inputbinding":            {"Plan"},
	"internal/base/numeric":                 {"AmplificationGroups"},
	"internal/base/typeset":                 {"Registry", "Matcher"},
	"internal/runtime":                      {"Session"},
	"internal/runtime/execution":            {"Engine", "Frame"},
	"internal/runtime/execution/hit":        {"State", "History"},
	"internal/runtime/execution/listener":   {"State"},
	"internal/runtime/execution/evaluation": {"State", "Memo"},
	"internal/runtime/actor":                {"State", "ChangeSet"},
	"internal/runtime/action":               {"State", "CooldownLedger", "ProcessChangeSet"},
	"internal/runtime/effect":               {"InstanceState", "InstanceChangeSet", "BagState", "BagChangeSet", "BagView", "BagChange", "IdentityRegistry", "TimeState", "DefinitionCache", "AttributeResolver", "DamageResolver"},
	"internal/runtime/report":               {"State"},
	"internal/scheduler":                    {"Loop"},
	"internal/formula":                      {"GenericRegistry"},
	"internal/pipeline":                     {"AttributeResolver", "DamageModifierResolver"},
}

func main() {
	root := flag.String("root", ".", "引擎模块目录")
	flag.Parse()
	files, err := readSources(*root)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	errors, contracts, methods := checkSources(files, requiredContracts)
	if len(errors) > 0 {
		for _, problem := range errors {
			fmt.Fprintln(os.Stderr, problem)
		}
		os.Exit(1)
	}
	fmt.Printf("能力声明检查通过：%d 个正式源码文件，%d 个能力接口，%d 个方法声明。\n", len(files), contracts, methods)
}

func readSources(root string) ([]sourceFile, error) {
	var files []sourceFile
	for _, directory := range []string{"internal", "cmd/engine_wasm"} {
		err := filepath.WalkDir(filepath.Join(root, directory), func(path string, entry fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if entry.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
				return nil
			}
			set := token.NewFileSet()
			file, err := parser.ParseFile(set, path, nil, parser.ParseComments)
			if err != nil {
				return err
			}
			if !ast.IsGenerated(file) {
				relative, err := filepath.Rel(root, path)
				if err != nil {
					return err
				}
				files = append(files, sourceFile{filepath.ToSlash(relative), set, file})
			}
			return nil
		})
		if err != nil {
			return nil, err
		}
	}
	return files, nil
}

func receiverName(expression ast.Expr) string {
	switch value := expression.(type) {
	case *ast.Ident:
		return value.Name
	case *ast.StarExpr:
		return receiverName(value.X)
	case *ast.IndexExpr:
		return receiverName(value.X)
	case *ast.IndexListExpr:
		return receiverName(value.X)
	}
	return ""
}

func tokensOf(set *token.FileSet, node any) string {
	var output bytes.Buffer
	_ = printer.Fprint(&output, set, node)
	var scan scanner.Scanner
	scan.Init(token.NewFileSet().AddFile("", -1, output.Len()), output.Bytes(), nil, 0)
	var result strings.Builder
	for {
		_, kind, literal := scan.Scan()
		if kind == token.EOF {
			break
		}
		fmt.Fprintf(&result, "%s:%s|", kind, literal)
	}
	return result.String()
}

func hasDescription(comment *ast.CommentGroup, name string) bool {
	if comment == nil {
		return false
	}
	text := strings.TrimSpace(comment.Text())
	return strings.HasPrefix(text, name) && utf8.RuneCountInString(strings.TrimSpace(strings.TrimPrefix(text, name))) > 2
}

func checkSources(files []sourceFile, required map[string][]string) ([]string, int, int) {
	var problems []string
	types := map[string]*ast.TypeSpec{}
	methods := map[string]map[string]string{}
	contracts := map[string]*ast.InterfaceType{}
	locations := map[string]string{}
	assertions := map[string]bool{}
	for _, source := range files {
		pkg := filepath.ToSlash(filepath.Dir(source.path))
		seenFunction := false
		for _, declaration := range source.file.Decls {
			switch value := declaration.(type) {
			case *ast.FuncDecl:
				seenFunction = true
				if value.Recv != nil && ast.IsExported(value.Name.Name) {
					key := pkg + "/" + receiverName(value.Recv.List[0].Type)
					if methods[key] == nil {
						methods[key] = map[string]string{}
					}
					methods[key][value.Name.Name] = tokensOf(token.NewFileSet(), value.Type)
				}
			case *ast.GenDecl:
				if value.Tok == token.TYPE && seenFunction {
					problems = append(problems, source.path+": 包级类型必须放在函数实现之前")
				}
				for _, spec := range value.Specs {
					if definition, ok := spec.(*ast.TypeSpec); ok {
						key := pkg + "/" + definition.Name.Name
						types[key] = definition
						locations[key] = source.path
						if contract, ok := definition.Type.(*ast.InterfaceType); ok {
							for _, method := range contract.Methods.List {
								if len(method.Names) > 0 && !hasDescription(method.Doc, method.Names[0].Name) {
									problems = append(problems, key+"."+method.Names[0].Name+": 能力方法缺少使用说明")
								}
							}
							if strings.HasSuffix(definition.Name.Name, "API") {
								contracts[strings.TrimSuffix(key, "API")] = contract
							}
						}
					}
					if assignment, ok := spec.(*ast.ValueSpec); ok && len(assignment.Names) == 1 && assignment.Names[0].Name == "_" {
						if name, ok := assignment.Type.(*ast.Ident); ok && strings.HasSuffix(name.Name, "API") && len(assignment.Values) == 1 {
							call, ok := assignment.Values[0].(*ast.CallExpr)
							if !ok || len(call.Args) != 1 {
								continue
							}
							argument, ok := call.Args[0].(*ast.Ident)
							if !ok || argument.Name != "nil" {
								continue
							}
							function := call.Fun
							if parenthesized, ok := function.(*ast.ParenExpr); ok {
								function = parenthesized.X
							}
							key := pkg + "/" + strings.TrimSuffix(name.Name, "API")
							assertions[key] = receiverName(function) == strings.TrimSuffix(name.Name, "API")
						}
					}
				}
			}
		}
	}
	for pkg, names := range required {
		for _, name := range names {
			if contracts[pkg+"/"+name] == nil {
				problems = append(problems, pkg+"/"+name+"API: 缺少主要对象的能力声明")
			}
		}
	}
	methodCount := 0
	for key, contract := range contracts {
		definition := types[key]
		if definition == nil {
			problems = append(problems, key+"API: 没有对应的具体类型")
			continue
		}
		if locations[key] != locations[key+"API"] || contract.Pos() >= definition.Pos() {
			problems = append(problems, key+"API: 能力声明必须位于同文件的具体类型之前")
		}
		if !assertions[key] {
			problems = append(problems, key+"API: 缺少对应类型的编译期实现检查")
		}
		declared := map[string]string{}
		for _, method := range contract.Methods.List {
			if len(method.Names) != 1 {
				problems = append(problems, key+"API: 请直接列出能力方法，避免嵌入隐藏目录")
				continue
			}
			declared[method.Names[0].Name] = tokensOf(token.NewFileSet(), method.Type)
			methodCount++
		}
		for name, signature := range methods[key] {
			if declared[name] != signature {
				problems = append(problems, key+"API."+name+": 能力声明遗漏方法或签名不一致")
			}
		}
		for name := range declared {
			if _, exists := methods[key][name]; !exists {
				problems = append(problems, key+"API."+name+": 不得声明实际不存在的公开方法")
			}
		}
	}
	sort.Strings(problems)
	return problems, len(contracts), methodCount
}
