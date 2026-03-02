package eval

import (
    "encoding/json"
    "fmt"
    "go/ast"
    "go/parser"
    "go/token"
    "strconv"
    "strings"
    "unicode"
)

// Vars is the runtime variable bag used by formula evaluators.
type Vars struct {
    Base      float64
    Haste     float64
    Flat      float64
    MissingHP float64
    Ratio     float64
    AP        float64
    BonusAD   float64
}

func (v Vars) Lookup(name string) (float64, bool) {
    switch name {
    case "base":
        return v.Base, true
    case "haste":
        return v.Haste, true
    case "flat":
        return v.Flat, true
    case "missing_hp":
        return v.MissingHP, true
    case "ratio":
        return v.Ratio, true
    case "ap":
        return v.AP, true
    case "bonus_ad":
        return v.BonusAD, true
    default:
        return 0, false
    }
}

// Direct baseline implementations.
func CooldownDirect(base, haste float64) float64 {
    return base * 100.0 / (100.0 + haste)
}

func RegenDirect(flat, missingHP, ratio float64) float64 {
    return flat + missingHP*ratio
}

func LinearDamageDirect(base, ap, bonusAD, apRatio, bonusADRatio float64) float64 {
    return base + ap*apRatio + bonusAD*bonusADRatio
}

// Predefined formula evaluator (formula_kind + typed params).
type PredefinedKind uint8

const (
    PredefinedCooldownHaste PredefinedKind = iota
    PredefinedRegenFlatPlusMissingRatio
)

type CooldownHasteParams struct {
    HasteSlot  VarSlot
    MinSeconds float64
}

type RegenFlatPlusMissingRatioParams struct {
    FlatSlot      VarSlot
    MissingHPSlot VarSlot
    RatioSlot     VarSlot
}

type PredefinedFormula struct {
    Kind           PredefinedKind
    CooldownParams CooldownHasteParams
    RegenParams    RegenFlatPlusMissingRatioParams
}

func CompilePredefinedCooldown(hasteVar string, minSeconds float64) (*PredefinedFormula, error) {
    slot, ok := lookupVarSlot(hasteVar)
    if !ok {
        return nil, fmt.Errorf("predefined cooldown unknown var: %s", hasteVar)
    }
    return &PredefinedFormula{
        Kind: PredefinedCooldownHaste,
        CooldownParams: CooldownHasteParams{
            HasteSlot:  slot,
            MinSeconds: minSeconds,
        },
    }, nil
}

func CompilePredefinedRegen(flatVar, missingHPVar, ratioVar string) (*PredefinedFormula, error) {
    flatSlot, ok := lookupVarSlot(flatVar)
    if !ok {
        return nil, fmt.Errorf("predefined regen unknown flat var: %s", flatVar)
    }
    missingSlot, ok := lookupVarSlot(missingHPVar)
    if !ok {
        return nil, fmt.Errorf("predefined regen unknown missing hp var: %s", missingHPVar)
    }
    ratioSlot, ok := lookupVarSlot(ratioVar)
    if !ok {
        return nil, fmt.Errorf("predefined regen unknown ratio var: %s", ratioVar)
    }
    return &PredefinedFormula{
        Kind: PredefinedRegenFlatPlusMissingRatio,
        RegenParams: RegenFlatPlusMissingRatioParams{
            FlatSlot:      flatSlot,
            MissingHPSlot: missingSlot,
            RatioSlot:     ratioSlot,
        },
    }, nil
}

func (f *PredefinedFormula) Eval(vars Vars) (float64, error) {
    if f == nil {
        return 0, fmt.Errorf("predefined formula is nil")
    }
    switch f.Kind {
    case PredefinedCooldownHaste:
        haste := vars.GetSlot(f.CooldownParams.HasteSlot)
        out := CooldownDirect(vars.Base, haste)
        if out < f.CooldownParams.MinSeconds {
            return f.CooldownParams.MinSeconds, nil
        }
        return out, nil
    case PredefinedRegenFlatPlusMissingRatio:
        flat := vars.GetSlot(f.RegenParams.FlatSlot)
        missing := vars.GetSlot(f.RegenParams.MissingHPSlot)
        ratio := vars.GetSlot(f.RegenParams.RatioSlot)
        return RegenDirect(flat, missing, ratio), nil
    default:
        return 0, fmt.Errorf("unsupported predefined kind: %d", f.Kind)
    }
}

// PredefinedRegistry simulates runtime formula_id -> formula dispatch.
type PredefinedRegistry struct {
    byID map[string]*PredefinedFormula
}

func NewPredefinedRegistry(formulas map[string]*PredefinedFormula) *PredefinedRegistry {
    copied := make(map[string]*PredefinedFormula, len(formulas))
    for k, v := range formulas {
        copied[k] = v
    }
    return &PredefinedRegistry{byID: copied}
}

func (r *PredefinedRegistry) Eval(formulaID string, vars Vars) (float64, error) {
    if r == nil {
        return 0, fmt.Errorf("predefined registry is nil")
    }
    f := r.byID[formulaID]
    if f == nil {
        return 0, fmt.Errorf("predefined formula not found: %s", formulaID)
    }
    return f.Eval(vars)
}

// AST evaluator (parse once, evaluate many times).
type ASTProgram struct {
    expr ast.Expr
}

func CompileAST(expression string) (*ASTProgram, error) {
    expr, err := parser.ParseExpr(expression)
    if err != nil {
        return nil, fmt.Errorf("parse ast expression: %w", err)
    }
    return &ASTProgram{expr: expr}, nil
}

func (p *ASTProgram) Eval(vars Vars) (float64, error) {
    return evalASTExpr(p.expr, vars)
}

func evalASTExpr(node ast.Expr, vars Vars) (float64, error) {
    switch n := node.(type) {
    case *ast.ParenExpr:
        return evalASTExpr(n.X, vars)
    case *ast.BasicLit:
        if n.Kind != token.INT && n.Kind != token.FLOAT {
            return 0, fmt.Errorf("unsupported literal kind: %v", n.Kind)
        }
        value, err := strconv.ParseFloat(n.Value, 64)
        if err != nil {
            return 0, fmt.Errorf("parse number %q: %w", n.Value, err)
        }
        return value, nil
    case *ast.Ident:
        value, ok := vars.Lookup(n.Name)
        if !ok {
            return 0, fmt.Errorf("unknown var: %s", n.Name)
        }
        return value, nil
    case *ast.UnaryExpr:
        value, err := evalASTExpr(n.X, vars)
        if err != nil {
            return 0, err
        }
        switch n.Op {
        case token.ADD:
            return value, nil
        case token.SUB:
            return -value, nil
        default:
            return 0, fmt.Errorf("unsupported unary op: %s", n.Op.String())
        }
    case *ast.BinaryExpr:
        left, err := evalASTExpr(n.X, vars)
        if err != nil {
            return 0, err
        }
        right, err := evalASTExpr(n.Y, vars)
        if err != nil {
            return 0, err
        }
        switch n.Op {
        case token.ADD:
            return left + right, nil
        case token.SUB:
            return left - right, nil
        case token.MUL:
            return left * right, nil
        case token.QUO:
            return left / right, nil
        default:
            return 0, fmt.Errorf("unsupported binary op: %s", n.Op.String())
        }
    default:
        return 0, fmt.Errorf("unsupported ast node: %T", node)
    }
}

// LoweredProgram compiles user expression into predefined primitive ops.
// This is closer to: user expression -> logic block runnable by predefined code.
type loweredOp uint8

const (
    loweredLoadVar loweredOp = iota
    loweredLoadConst
    loweredAdd
    loweredSub
    loweredMul
    loweredDiv
    loweredAddConst
    loweredSubConst
    loweredMulConst
    loweredDivConst
)

type loweredInstr struct {
    op   loweredOp
    dst  int
    a    int
    b    int
    imm  float64
    slot VarSlot
}

type LoweredProgram struct {
    code     []loweredInstr
    outReg   int
    regCount int
}

func CompileLowered(expression string) (*LoweredProgram, error) {
    expr, err := parser.ParseExpr(expression)
    if err != nil {
        return nil, fmt.Errorf("parse lowered expression: %w", err)
    }
    b := &loweredBuilder{}
    outReg, err := b.compile(expr)
    if err != nil {
        return nil, err
    }
    return &LoweredProgram{
        code:     b.code,
        outReg:   outReg,
        regCount: b.nextReg,
    }, nil
}

func (p *LoweredProgram) Eval(vars Vars) (float64, error) {
    if p == nil {
        return 0, fmt.Errorf("lowered program is nil")
    }
    var scratch [64]float64
    var regs []float64
    if p.regCount <= len(scratch) {
        regs = scratch[:p.regCount]
    } else {
        regs = make([]float64, p.regCount)
    }
    for _, ins := range p.code {
        switch ins.op {
        case loweredLoadVar:
            regs[ins.dst] = vars.GetSlot(ins.slot)
        case loweredLoadConst:
            regs[ins.dst] = ins.imm
        case loweredAdd:
            regs[ins.dst] = regs[ins.a] + regs[ins.b]
        case loweredSub:
            regs[ins.dst] = regs[ins.a] - regs[ins.b]
        case loweredMul:
            regs[ins.dst] = regs[ins.a] * regs[ins.b]
        case loweredDiv:
            regs[ins.dst] = regs[ins.a] / regs[ins.b]
        case loweredAddConst:
            regs[ins.dst] = regs[ins.a] + ins.imm
        case loweredSubConst:
            regs[ins.dst] = regs[ins.a] - ins.imm
        case loweredMulConst:
            regs[ins.dst] = regs[ins.a] * ins.imm
        case loweredDivConst:
            regs[ins.dst] = regs[ins.a] / ins.imm
        default:
            return 0, fmt.Errorf("unsupported lowered op: %d", ins.op)
        }
    }
    if p.outReg < 0 || p.outReg >= len(regs) {
        return 0, fmt.Errorf("invalid lowered out reg: %d", p.outReg)
    }
    return regs[p.outReg], nil
}

type loweredBuilder struct {
    code    []loweredInstr
    nextReg int
}

func (b *loweredBuilder) newReg() int {
    r := b.nextReg
    b.nextReg++
    return r
}

func (b *loweredBuilder) emit(ins loweredInstr) {
    b.code = append(b.code, ins)
}

func (b *loweredBuilder) compile(node ast.Expr) (int, error) {
    switch n := node.(type) {
    case *ast.ParenExpr:
        return b.compile(n.X)
    case *ast.BasicLit:
        if n.Kind != token.INT && n.Kind != token.FLOAT {
            return -1, fmt.Errorf("lowered unsupported literal kind: %v", n.Kind)
        }
        value, err := strconv.ParseFloat(n.Value, 64)
        if err != nil {
            return -1, fmt.Errorf("lowered parse number %q: %w", n.Value, err)
        }
        dst := b.newReg()
        b.emit(loweredInstr{op: loweredLoadConst, dst: dst, imm: value})
        return dst, nil
    case *ast.Ident:
        slot, ok := lookupVarSlot(n.Name)
        if !ok {
            return -1, fmt.Errorf("lowered unknown var: %s", n.Name)
        }
        dst := b.newReg()
        b.emit(loweredInstr{op: loweredLoadVar, dst: dst, slot: slot})
        return dst, nil
    case *ast.UnaryExpr:
        switch n.Op {
        case token.ADD:
            return b.compile(n.X)
        case token.SUB:
            if c, ok := literalFloat(n.X); ok {
                dst := b.newReg()
                b.emit(loweredInstr{op: loweredLoadConst, dst: dst, imm: -c})
                return dst, nil
            }
            xReg, err := b.compile(n.X)
            if err != nil {
                return -1, err
            }
            dst := b.newReg()
            b.emit(loweredInstr{op: loweredMulConst, dst: dst, a: xReg, imm: -1})
            return dst, nil
        default:
            return -1, fmt.Errorf("lowered unsupported unary op: %s", n.Op.String())
        }
    case *ast.BinaryExpr:
        return b.compileBinary(n)
    default:
        return -1, fmt.Errorf("lowered unsupported ast node: %T", node)
    }
}

func (b *loweredBuilder) compileBinary(n *ast.BinaryExpr) (int, error) {
    if c, ok := literalFloat(n.Y); ok {
        leftReg, err := b.compile(n.X)
        if err != nil {
            return -1, err
        }
        dst := b.newReg()
        switch n.Op {
        case token.ADD:
            b.emit(loweredInstr{op: loweredAddConst, dst: dst, a: leftReg, imm: c})
        case token.SUB:
            b.emit(loweredInstr{op: loweredSubConst, dst: dst, a: leftReg, imm: c})
        case token.MUL:
            b.emit(loweredInstr{op: loweredMulConst, dst: dst, a: leftReg, imm: c})
        case token.QUO:
            b.emit(loweredInstr{op: loweredDivConst, dst: dst, a: leftReg, imm: c})
        default:
            return -1, fmt.Errorf("lowered unsupported binary op with const rhs: %s", n.Op.String())
        }
        return dst, nil
    }

    if c, ok := literalFloat(n.X); ok && (n.Op == token.ADD || n.Op == token.MUL) {
        rightReg, err := b.compile(n.Y)
        if err != nil {
            return -1, err
        }
        dst := b.newReg()
        if n.Op == token.ADD {
            b.emit(loweredInstr{op: loweredAddConst, dst: dst, a: rightReg, imm: c})
        } else {
            b.emit(loweredInstr{op: loweredMulConst, dst: dst, a: rightReg, imm: c})
        }
        return dst, nil
    }

    leftReg, err := b.compile(n.X)
    if err != nil {
        return -1, err
    }
    rightReg, err := b.compile(n.Y)
    if err != nil {
        return -1, err
    }
    dst := b.newReg()
    switch n.Op {
    case token.ADD:
        b.emit(loweredInstr{op: loweredAdd, dst: dst, a: leftReg, b: rightReg})
    case token.SUB:
        b.emit(loweredInstr{op: loweredSub, dst: dst, a: leftReg, b: rightReg})
    case token.MUL:
        b.emit(loweredInstr{op: loweredMul, dst: dst, a: leftReg, b: rightReg})
    case token.QUO:
        b.emit(loweredInstr{op: loweredDiv, dst: dst, a: leftReg, b: rightReg})
    default:
        return -1, fmt.Errorf("lowered unsupported binary op: %s", n.Op.String())
    }
    return dst, nil
}

func literalFloat(node ast.Expr) (float64, bool) {
    switch n := node.(type) {
    case *ast.BasicLit:
        if n.Kind != token.INT && n.Kind != token.FLOAT {
            return 0, false
        }
        v, err := strconv.ParseFloat(n.Value, 64)
        if err != nil {
            return 0, false
        }
        return v, true
    case *ast.UnaryExpr:
        if n.Op != token.ADD && n.Op != token.SUB {
            return 0, false
        }
        inner, ok := literalFloat(n.X)
        if !ok {
            return 0, false
        }
        if n.Op == token.SUB {
            return -inner, true
        }
        return inner, true
    case *ast.ParenExpr:
        return literalFloat(n.X)
    default:
        return 0, false
    }
}

// DSL bytecode evaluator (compile once, evaluate many times).
type VarSlot uint8

const (
    VarBase VarSlot = iota
    VarHaste
    VarFlat
    VarMissingHP
    VarRatio
    VarAP
    VarBonusAD
)

func lookupVarSlot(name string) (VarSlot, bool) {
    switch name {
    case "base":
        return VarBase, true
    case "haste":
        return VarHaste, true
    case "flat":
        return VarFlat, true
    case "missing_hp":
        return VarMissingHP, true
    case "ratio":
        return VarRatio, true
    case "ap":
        return VarAP, true
    case "bonus_ad":
        return VarBonusAD, true
    default:
        return 0, false
    }
}

func (v Vars) GetSlot(slot VarSlot) float64 {
    switch slot {
    case VarBase:
        return v.Base
    case VarHaste:
        return v.Haste
    case VarFlat:
        return v.Flat
    case VarMissingHP:
        return v.MissingHP
    case VarRatio:
        return v.Ratio
    case VarAP:
        return v.AP
    case VarBonusAD:
        return v.BonusAD
    default:
        return 0
    }
}

// Linear template demo: user-defined params -> compiled predefined code.
// Formula shape: result = base_var + sum(term.var * term.coef)
type LinearTermDefinition struct {
    Var  string  `json:"var"`
    Coef float64 `json:"coef"`
}

type LinearFormulaDefinition struct {
    BaseVar string                 `json:"base_var"`
    Terms   []LinearTermDefinition `json:"terms"`
}

type linearCompiledTerm struct {
    slot VarSlot
    coef float64
}

type LinearFormulaProgram struct {
    baseSlot VarSlot
    terms    []linearCompiledTerm
}

func CompileLinearFormula(def LinearFormulaDefinition) (*LinearFormulaProgram, error) {
    baseVar := def.BaseVar
    if strings.TrimSpace(baseVar) == "" {
        baseVar = "base"
    }
    baseSlot, ok := lookupVarSlot(baseVar)
    if !ok {
        return nil, fmt.Errorf("linear formula unknown base var: %s", baseVar)
    }
    if len(def.Terms) == 0 {
        return nil, fmt.Errorf("linear formula terms cannot be empty")
    }

    compiled := make([]linearCompiledTerm, 0, len(def.Terms))
    for i, term := range def.Terms {
        if strings.TrimSpace(term.Var) == "" {
            return nil, fmt.Errorf("linear formula term[%d] var is empty", i)
        }
        slot, ok := lookupVarSlot(term.Var)
        if !ok {
            return nil, fmt.Errorf("linear formula term[%d] unknown var: %s", i, term.Var)
        }
        compiled = append(compiled, linearCompiledTerm{slot: slot, coef: term.Coef})
    }

    return &LinearFormulaProgram{
        baseSlot: baseSlot,
        terms:    compiled,
    }, nil
}

func CompileLinearFormulaJSON(raw []byte) (*LinearFormulaProgram, error) {
    var def LinearFormulaDefinition
    if err := json.Unmarshal(raw, &def); err != nil {
        return nil, fmt.Errorf("unmarshal linear formula json: %w", err)
    }
    return CompileLinearFormula(def)
}

func (p *LinearFormulaProgram) Eval(vars Vars) (float64, error) {
    if p == nil {
        return 0, fmt.Errorf("linear formula program is nil")
    }
    out := vars.GetSlot(p.baseSlot)
    for _, term := range p.terms {
        out += vars.GetSlot(term.slot) * term.coef
    }
    return out, nil
}

type LinearFormulaRegistry struct {
    byID map[string]*LinearFormulaProgram
}

func NewLinearFormulaRegistry(formulas map[string]*LinearFormulaProgram) *LinearFormulaRegistry {
    copied := make(map[string]*LinearFormulaProgram, len(formulas))
    for k, v := range formulas {
        copied[k] = v
    }
    return &LinearFormulaRegistry{byID: copied}
}

func (r *LinearFormulaRegistry) Eval(formulaID string, vars Vars) (float64, error) {
    if r == nil {
        return 0, fmt.Errorf("linear formula registry is nil")
    }
    p := r.byID[formulaID]
    if p == nil {
        return 0, fmt.Errorf("linear formula not found: %s", formulaID)
    }
    return p.Eval(vars)
}

type opCode uint8

const (
    opPushConst opCode = iota
    opPushVar
    opAdd
    opSub
    opMul
    opDiv
)

type instruction struct {
    op   opCode
    num  float64
    slot VarSlot
}

type DSLProgram struct {
    code []instruction
}

func CompileDSL(expression string) (*DSLProgram, error) {
    toks, err := tokenize(expression)
    if err != nil {
        return nil, err
    }

    output := make([]tokenItem, 0, len(toks))
    ops := make([]tokenItem, 0, len(toks))

    for _, t := range toks {
        switch t.kind {
        case tkNumber, tkIdent:
            output = append(output, t)
        case tkOp:
            for len(ops) > 0 {
                top := ops[len(ops)-1]
                if top.kind != tkOp {
                    break
                }
                if opPrecedence(top.text) >= opPrecedence(t.text) {
                    output = append(output, top)
                    ops = ops[:len(ops)-1]
                    continue
                }
                break
            }
            ops = append(ops, t)
        case tkLParen:
            ops = append(ops, t)
        case tkRParen:
            matched := false
            for len(ops) > 0 {
                top := ops[len(ops)-1]
                ops = ops[:len(ops)-1]
                if top.kind == tkLParen {
                    matched = true
                    break
                }
                output = append(output, top)
            }
            if !matched {
                return nil, fmt.Errorf("dsl: unmatched right parenthesis")
            }
        }
    }

    for i := len(ops) - 1; i >= 0; i-- {
        if ops[i].kind == tkLParen || ops[i].kind == tkRParen {
            return nil, fmt.Errorf("dsl: unmatched parenthesis")
        }
        output = append(output, ops[i])
    }

    code := make([]instruction, 0, len(output))
    for _, t := range output {
        switch t.kind {
        case tkNumber:
            n, err := strconv.ParseFloat(t.text, 64)
            if err != nil {
                return nil, fmt.Errorf("dsl parse number %q: %w", t.text, err)
            }
            code = append(code, instruction{op: opPushConst, num: n})
        case tkIdent:
            slot, ok := lookupVarSlot(t.text)
            if !ok {
                return nil, fmt.Errorf("dsl unknown var: %s", t.text)
            }
            code = append(code, instruction{op: opPushVar, slot: slot})
        case tkOp:
            switch t.text {
            case "+":
                code = append(code, instruction{op: opAdd})
            case "-":
                code = append(code, instruction{op: opSub})
            case "*":
                code = append(code, instruction{op: opMul})
            case "/":
                code = append(code, instruction{op: opDiv})
            default:
                return nil, fmt.Errorf("dsl unsupported op: %s", t.text)
            }
        default:
            return nil, fmt.Errorf("dsl compile unsupported token: %v", t.kind)
        }
    }

    return &DSLProgram{code: code}, nil
}

func (p *DSLProgram) Eval(vars Vars) (float64, error) {
    stack := make([]float64, 0, 16)
    for _, ins := range p.code {
        switch ins.op {
        case opPushConst:
            stack = append(stack, ins.num)
        case opPushVar:
            stack = append(stack, vars.GetSlot(ins.slot))
        case opAdd, opSub, opMul, opDiv:
            if len(stack) < 2 {
                return 0, fmt.Errorf("dsl eval stack underflow")
            }
            right := stack[len(stack)-1]
            left := stack[len(stack)-2]
            stack = stack[:len(stack)-2]
            switch ins.op {
            case opAdd:
                stack = append(stack, left+right)
            case opSub:
                stack = append(stack, left-right)
            case opMul:
                stack = append(stack, left*right)
            case opDiv:
                stack = append(stack, left/right)
            }
        default:
            return 0, fmt.Errorf("dsl eval unsupported opcode: %d", ins.op)
        }
    }

    if len(stack) != 1 {
        return 0, fmt.Errorf("dsl eval invalid stack size: %d", len(stack))
    }
    return stack[0], nil
}

type tokenKind uint8

const (
    tkNumber tokenKind = iota
    tkIdent
    tkOp
    tkLParen
    tkRParen
)

type tokenItem struct {
    kind tokenKind
    text string
}

func tokenize(expression string) ([]tokenItem, error) {
    expr := strings.TrimSpace(expression)
    out := make([]tokenItem, 0, len(expr))

    for i := 0; i < len(expr); {
        ch := rune(expr[i])
        if unicode.IsSpace(ch) {
            i++
            continue
        }

        if unicode.IsDigit(ch) || ch == '.' {
            start := i
            dotCount := 0
            for i < len(expr) {
                c := rune(expr[i])
                if c == '.' {
                    dotCount++
                    if dotCount > 1 {
                        return nil, fmt.Errorf("dsl number has multiple dots near %q", expr[start:i+1])
                    }
                    i++
                    continue
                }
                if !unicode.IsDigit(c) {
                    break
                }
                i++
            }
            out = append(out, tokenItem{kind: tkNumber, text: expr[start:i]})
            continue
        }

        if unicode.IsLetter(ch) || ch == '_' {
            start := i
            i++
            for i < len(expr) {
                c := rune(expr[i])
                if unicode.IsLetter(c) || unicode.IsDigit(c) || c == '_' {
                    i++
                    continue
                }
                break
            }
            out = append(out, tokenItem{kind: tkIdent, text: expr[start:i]})
            continue
        }

        switch ch {
        case '+', '-', '*', '/':
            out = append(out, tokenItem{kind: tkOp, text: string(ch)})
            i++
        case '(':
            out = append(out, tokenItem{kind: tkLParen, text: "("})
            i++
        case ')':
            out = append(out, tokenItem{kind: tkRParen, text: ")"})
            i++
        default:
            return nil, fmt.Errorf("dsl unsupported char %q", ch)
        }
    }

    return out, nil
}

func opPrecedence(op string) int {
    switch op {
    case "*", "/":
        return 2
    case "+", "-":
        return 1
    default:
        return 0
    }
}
