package eval

import "testing"

var sinkFloat float64

const (
    cooldownExpr = "base * 100 / (100 + haste)"
    regenExpr    = "flat + missing_hp * ratio"
    linearExpr   = "base + ap*0.5 + bonus_ad*0.5"
)

var linearJSONDefinition = []byte(`{
  "base_var": "base",
  "terms": [
    {"var": "ap", "coef": 0.5},
    {"var": "bonus_ad", "coef": 0.5}
  ]
}`)

func mustAST(b *testing.B, expr string) *ASTProgram {
    b.Helper()
    p, err := CompileAST(expr)
    if err != nil {
        b.Fatalf("compile ast failed: %v", err)
    }
    return p
}

func mustDSL(b *testing.B, expr string) *DSLProgram {
    b.Helper()
    p, err := CompileDSL(expr)
    if err != nil {
        b.Fatalf("compile dsl failed: %v", err)
    }
    return p
}

func mustLowered(b *testing.B, expr string) *LoweredProgram {
    b.Helper()
    p, err := CompileLowered(expr)
    if err != nil {
        b.Fatalf("compile lowered failed: %v", err)
    }
    return p
}

func mustPredefinedCooldown(b *testing.B) *PredefinedFormula {
    b.Helper()
    p, err := CompilePredefinedCooldown("haste", 0.1)
    if err != nil {
        b.Fatalf("compile predefined cooldown failed: %v", err)
    }
    return p
}

func mustPredefinedRegen(b *testing.B) *PredefinedFormula {
    b.Helper()
    p, err := CompilePredefinedRegen("flat", "missing_hp", "ratio")
    if err != nil {
        b.Fatalf("compile predefined regen failed: %v", err)
    }
    return p
}

func mustPredefinedRegistry(b *testing.B) *PredefinedRegistry {
    b.Helper()
    cooldown, err := CompilePredefinedCooldown("haste", 0.1)
    if err != nil {
        b.Fatalf("compile predefined cooldown failed: %v", err)
    }
    regen, err := CompilePredefinedRegen("flat", "missing_hp", "ratio")
    if err != nil {
        b.Fatalf("compile predefined regen failed: %v", err)
    }
    return NewPredefinedRegistry(map[string]*PredefinedFormula{
        "lol.cd.haste_global":   cooldown,
        "lol.regen.missing_hp":  regen,
    })
}

func mustLinearProgramFromStruct(b *testing.B) *LinearFormulaProgram {
    b.Helper()
    prog, err := CompileLinearFormula(LinearFormulaDefinition{
        BaseVar: "base",
        Terms: []LinearTermDefinition{
            {Var: "ap", Coef: 0.5},
            {Var: "bonus_ad", Coef: 0.5},
        },
    })
    if err != nil {
        b.Fatalf("compile linear formula from struct failed: %v", err)
    }
    return prog
}

func mustLinearProgramFromJSON(b *testing.B) *LinearFormulaProgram {
    b.Helper()
    prog, err := CompileLinearFormulaJSON(linearJSONDefinition)
    if err != nil {
        b.Fatalf("compile linear formula from json failed: %v", err)
    }
    return prog
}

func mustLinearRegistry(b *testing.B) *LinearFormulaRegistry {
    b.Helper()
    prog := mustLinearProgramFromStruct(b)
    return NewLinearFormulaRegistry(map[string]*LinearFormulaProgram{
        "lol.damage.katarina_q_magic": prog,
    })
}

func BenchmarkCooldownDirect(b *testing.B) {
    base := 11.0
    haste := 65.0
    sum := 0.0
    for i := 0; i < b.N; i++ {
        haste += 0.01
        if haste > 180 {
            haste = 20
        }
        sum += CooldownDirect(base, haste)
    }
    sinkFloat = sum
}

func BenchmarkCooldownAST(b *testing.B) {
    prog := mustAST(b, cooldownExpr)
    vars := Vars{Base: 11.0, Haste: 65.0}
    sum := 0.0
    for i := 0; i < b.N; i++ {
        vars.Haste += 0.01
        if vars.Haste > 180 {
            vars.Haste = 20
        }
        v, err := prog.Eval(vars)
        if err != nil {
            b.Fatal(err)
        }
        sum += v
    }
    sinkFloat = sum
}

func BenchmarkCooldownPredefined(b *testing.B) {
    prog := mustPredefinedCooldown(b)
    vars := Vars{Base: 11.0, Haste: 65.0}
    sum := 0.0
    for i := 0; i < b.N; i++ {
        vars.Haste += 0.01
        if vars.Haste > 180 {
            vars.Haste = 20
        }
        v, err := prog.Eval(vars)
        if err != nil {
            b.Fatal(err)
        }
        sum += v
    }
    sinkFloat = sum
}

func BenchmarkCooldownPredefinedRegistry(b *testing.B) {
    reg := mustPredefinedRegistry(b)
    vars := Vars{Base: 11.0, Haste: 65.0}
    sum := 0.0
    for i := 0; i < b.N; i++ {
        vars.Haste += 0.01
        if vars.Haste > 180 {
            vars.Haste = 20
        }
        v, err := reg.Eval("lol.cd.haste_global", vars)
        if err != nil {
            b.Fatal(err)
        }
        sum += v
    }
    sinkFloat = sum
}

func BenchmarkCooldownDSL(b *testing.B) {
    prog := mustDSL(b, cooldownExpr)
    vars := Vars{Base: 11.0, Haste: 65.0}
    sum := 0.0
    for i := 0; i < b.N; i++ {
        vars.Haste += 0.01
        if vars.Haste > 180 {
            vars.Haste = 20
        }
        v, err := prog.Eval(vars)
        if err != nil {
            b.Fatal(err)
        }
        sum += v
    }
    sinkFloat = sum
}

func BenchmarkCooldownPredefinedCompileAndEval(b *testing.B) {
    vars := Vars{Base: 11.0, Haste: 65.0}
    sum := 0.0
    for i := 0; i < b.N; i++ {
        prog, err := CompilePredefinedCooldown("haste", 0.1)
        if err != nil {
            b.Fatal(err)
        }
        vars.Haste += 0.01
        if vars.Haste > 180 {
            vars.Haste = 20
        }
        v, err := prog.Eval(vars)
        if err != nil {
            b.Fatal(err)
        }
        sum += v
    }
    sinkFloat = sum
}

func BenchmarkCooldownASTCompileAndEval(b *testing.B) {
    vars := Vars{Base: 11.0, Haste: 65.0}
    sum := 0.0
    for i := 0; i < b.N; i++ {
        prog, err := CompileAST(cooldownExpr)
        if err != nil {
            b.Fatal(err)
        }
        vars.Haste += 0.01
        if vars.Haste > 180 {
            vars.Haste = 20
        }
        v, err := prog.Eval(vars)
        if err != nil {
            b.Fatal(err)
        }
        sum += v
    }
    sinkFloat = sum
}

func BenchmarkCooldownDSLCompileAndEval(b *testing.B) {
    vars := Vars{Base: 11.0, Haste: 65.0}
    sum := 0.0
    for i := 0; i < b.N; i++ {
        prog, err := CompileDSL(cooldownExpr)
        if err != nil {
            b.Fatal(err)
        }
        vars.Haste += 0.01
        if vars.Haste > 180 {
            vars.Haste = 20
        }
        v, err := prog.Eval(vars)
        if err != nil {
            b.Fatal(err)
        }
        sum += v
    }
    sinkFloat = sum
}

func BenchmarkRegenDirect(b *testing.B) {
    flat := 10.0
    missing := 500.0
    ratio := 0.01
    sum := 0.0
    for i := 0; i < b.N; i++ {
        missing += 0.5
        if missing > 2000 {
            missing = 200
        }
        sum += RegenDirect(flat, missing, ratio)
    }
    sinkFloat = sum
}

func BenchmarkRegenAST(b *testing.B) {
    prog := mustAST(b, regenExpr)
    vars := Vars{Flat: 10.0, MissingHP: 500.0, Ratio: 0.01}
    sum := 0.0
    for i := 0; i < b.N; i++ {
        vars.MissingHP += 0.5
        if vars.MissingHP > 2000 {
            vars.MissingHP = 200
        }
        v, err := prog.Eval(vars)
        if err != nil {
            b.Fatal(err)
        }
        sum += v
    }
    sinkFloat = sum
}

func BenchmarkRegenPredefined(b *testing.B) {
    prog := mustPredefinedRegen(b)
    vars := Vars{Flat: 10.0, MissingHP: 500.0, Ratio: 0.01}
    sum := 0.0
    for i := 0; i < b.N; i++ {
        vars.MissingHP += 0.5
        if vars.MissingHP > 2000 {
            vars.MissingHP = 200
        }
        v, err := prog.Eval(vars)
        if err != nil {
            b.Fatal(err)
        }
        sum += v
    }
    sinkFloat = sum
}

func BenchmarkRegenPredefinedRegistry(b *testing.B) {
    reg := mustPredefinedRegistry(b)
    vars := Vars{Flat: 10.0, MissingHP: 500.0, Ratio: 0.01}
    sum := 0.0
    for i := 0; i < b.N; i++ {
        vars.MissingHP += 0.5
        if vars.MissingHP > 2000 {
            vars.MissingHP = 200
        }
        v, err := reg.Eval("lol.regen.missing_hp", vars)
        if err != nil {
            b.Fatal(err)
        }
        sum += v
    }
    sinkFloat = sum
}

func BenchmarkRegenDSL(b *testing.B) {
    prog := mustDSL(b, regenExpr)
    vars := Vars{Flat: 10.0, MissingHP: 500.0, Ratio: 0.01}
    sum := 0.0
    for i := 0; i < b.N; i++ {
        vars.MissingHP += 0.5
        if vars.MissingHP > 2000 {
            vars.MissingHP = 200
        }
        v, err := prog.Eval(vars)
        if err != nil {
            b.Fatal(err)
        }
        sum += v
    }
    sinkFloat = sum
}

func BenchmarkRegenPredefinedCompileAndEval(b *testing.B) {
    vars := Vars{Flat: 10.0, MissingHP: 500.0, Ratio: 0.01}
    sum := 0.0
    for i := 0; i < b.N; i++ {
        prog, err := CompilePredefinedRegen("flat", "missing_hp", "ratio")
        if err != nil {
            b.Fatal(err)
        }
        vars.MissingHP += 0.5
        if vars.MissingHP > 2000 {
            vars.MissingHP = 200
        }
        v, err := prog.Eval(vars)
        if err != nil {
            b.Fatal(err)
        }
        sum += v
    }
    sinkFloat = sum
}

func BenchmarkLinearDirect(b *testing.B) {
    vars := Vars{Base: 230.0, AP: 300.0, BonusAD: 120.0}
    sum := 0.0
    for i := 0; i < b.N; i++ {
        vars.AP += 0.3
        if vars.AP > 1000 {
            vars.AP = 100
        }
        vars.BonusAD += 0.2
        if vars.BonusAD > 400 {
            vars.BonusAD = 40
        }
        sum += LinearDamageDirect(vars.Base, vars.AP, vars.BonusAD, 0.5, 0.5)
    }
    sinkFloat = sum
}

func BenchmarkLinearAST(b *testing.B) {
    prog := mustAST(b, linearExpr)
    vars := Vars{Base: 230.0, AP: 300.0, BonusAD: 120.0}
    sum := 0.0
    for i := 0; i < b.N; i++ {
        vars.AP += 0.3
        if vars.AP > 1000 {
            vars.AP = 100
        }
        vars.BonusAD += 0.2
        if vars.BonusAD > 400 {
            vars.BonusAD = 40
        }
        v, err := prog.Eval(vars)
        if err != nil {
            b.Fatal(err)
        }
        sum += v
    }
    sinkFloat = sum
}

func BenchmarkLinearDSL(b *testing.B) {
    prog := mustDSL(b, linearExpr)
    vars := Vars{Base: 230.0, AP: 300.0, BonusAD: 120.0}
    sum := 0.0
    for i := 0; i < b.N; i++ {
        vars.AP += 0.3
        if vars.AP > 1000 {
            vars.AP = 100
        }
        vars.BonusAD += 0.2
        if vars.BonusAD > 400 {
            vars.BonusAD = 40
        }
        v, err := prog.Eval(vars)
        if err != nil {
            b.Fatal(err)
        }
        sum += v
    }
    sinkFloat = sum
}

func BenchmarkLinearLowered(b *testing.B) {
    prog := mustLowered(b, linearExpr)
    vars := Vars{Base: 230.0, AP: 300.0, BonusAD: 120.0}
    sum := 0.0
    for i := 0; i < b.N; i++ {
        vars.AP += 0.3
        if vars.AP > 1000 {
            vars.AP = 100
        }
        vars.BonusAD += 0.2
        if vars.BonusAD > 400 {
            vars.BonusAD = 40
        }
        v, err := prog.Eval(vars)
        if err != nil {
            b.Fatal(err)
        }
        sum += v
    }
    sinkFloat = sum
}

func BenchmarkLinearTemplateStruct(b *testing.B) {
    prog := mustLinearProgramFromStruct(b)
    vars := Vars{Base: 230.0, AP: 300.0, BonusAD: 120.0}
    sum := 0.0
    for i := 0; i < b.N; i++ {
        vars.AP += 0.3
        if vars.AP > 1000 {
            vars.AP = 100
        }
        vars.BonusAD += 0.2
        if vars.BonusAD > 400 {
            vars.BonusAD = 40
        }
        v, err := prog.Eval(vars)
        if err != nil {
            b.Fatal(err)
        }
        sum += v
    }
    sinkFloat = sum
}

func BenchmarkLinearTemplateJSON(b *testing.B) {
    prog := mustLinearProgramFromJSON(b)
    vars := Vars{Base: 230.0, AP: 300.0, BonusAD: 120.0}
    sum := 0.0
    for i := 0; i < b.N; i++ {
        vars.AP += 0.3
        if vars.AP > 1000 {
            vars.AP = 100
        }
        vars.BonusAD += 0.2
        if vars.BonusAD > 400 {
            vars.BonusAD = 40
        }
        v, err := prog.Eval(vars)
        if err != nil {
            b.Fatal(err)
        }
        sum += v
    }
    sinkFloat = sum
}

func BenchmarkLinearTemplateRegistry(b *testing.B) {
    reg := mustLinearRegistry(b)
    vars := Vars{Base: 230.0, AP: 300.0, BonusAD: 120.0}
    sum := 0.0
    for i := 0; i < b.N; i++ {
        vars.AP += 0.3
        if vars.AP > 1000 {
            vars.AP = 100
        }
        vars.BonusAD += 0.2
        if vars.BonusAD > 400 {
            vars.BonusAD = 40
        }
        v, err := reg.Eval("lol.damage.katarina_q_magic", vars)
        if err != nil {
            b.Fatal(err)
        }
        sum += v
    }
    sinkFloat = sum
}

func BenchmarkLinearTemplateCompileAndEval(b *testing.B) {
    vars := Vars{Base: 230.0, AP: 300.0, BonusAD: 120.0}
    sum := 0.0
    for i := 0; i < b.N; i++ {
        prog, err := CompileLinearFormula(LinearFormulaDefinition{
            BaseVar: "base",
            Terms: []LinearTermDefinition{
                {Var: "ap", Coef: 0.5},
                {Var: "bonus_ad", Coef: 0.5},
            },
        })
        if err != nil {
            b.Fatal(err)
        }
        vars.AP += 0.3
        if vars.AP > 1000 {
            vars.AP = 100
        }
        vars.BonusAD += 0.2
        if vars.BonusAD > 400 {
            vars.BonusAD = 40
        }
        v, err := prog.Eval(vars)
        if err != nil {
            b.Fatal(err)
        }
        sum += v
    }
    sinkFloat = sum
}

func BenchmarkLinearTemplateJSONCompileAndEval(b *testing.B) {
    vars := Vars{Base: 230.0, AP: 300.0, BonusAD: 120.0}
    sum := 0.0
    for i := 0; i < b.N; i++ {
        prog, err := CompileLinearFormulaJSON(linearJSONDefinition)
        if err != nil {
            b.Fatal(err)
        }
        vars.AP += 0.3
        if vars.AP > 1000 {
            vars.AP = 100
        }
        vars.BonusAD += 0.2
        if vars.BonusAD > 400 {
            vars.BonusAD = 40
        }
        v, err := prog.Eval(vars)
        if err != nil {
            b.Fatal(err)
        }
        sum += v
    }
    sinkFloat = sum
}

func BenchmarkLinearLoweredCompileAndEval(b *testing.B) {
    vars := Vars{Base: 230.0, AP: 300.0, BonusAD: 120.0}
    sum := 0.0
    for i := 0; i < b.N; i++ {
        prog, err := CompileLowered(linearExpr)
        if err != nil {
            b.Fatal(err)
        }
        vars.AP += 0.3
        if vars.AP > 1000 {
            vars.AP = 100
        }
        vars.BonusAD += 0.2
        if vars.BonusAD > 400 {
            vars.BonusAD = 40
        }
        v, err := prog.Eval(vars)
        if err != nil {
            b.Fatal(err)
        }
        sum += v
    }
    sinkFloat = sum
}
