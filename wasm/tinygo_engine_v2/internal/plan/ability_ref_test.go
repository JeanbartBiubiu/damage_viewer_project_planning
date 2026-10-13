package plan

import (
	"math/rand"
	"regexp"
	"testing"
)

func TestParseAbilityRefMatchesOriginalGrammar(t *testing.T) {
	grammar := regexp.MustCompile(`^(source|target|self|opponent)\.provider\[([^\]]+)\]\.ability\[([^\]]+)\]$`)
	check := func(ref string) {
		t.Helper()
		matches := grammar.FindStringSubmatch(ref)
		want := ParsedAbilityRef{}
		wantOK := len(matches) == 4
		if wantOK {
			want = ParsedAbilityRef{matches[1], matches[2], matches[3]}
		}
		got, ok := ParseAbilityRef(ref)
		if got != want || ok != wantOK {
			t.Fatalf("ParseAbilityRef(%q) = %+v, %v; grammar wants %+v, %v", ref, got, ok, want, wantOK)
		}
	}
	selectors := []string{"source", "target", "self", "opponent", "", "other", "source.target"}
	names := []string{"", "a", "item_3153_passive", "[", "a.b", "a]b", "a\nb", "中文", "\x00", "\xff", "].ability["}
	for _, selector := range selectors {
		for _, provider := range names {
			for _, ability := range names {
				ref := selector + ".provider[" + provider + "].ability[" + ability + "]"
				check(ref)
				check(ref + "\n")
				check(" " + ref)
				for end := 0; end < len(ref); end++ {
					check(ref[:end])
				}
			}
		}
	}
	// 差分覆盖非法UTF-8、错误定界和任意尾缀，不只检查常见合法引用。
	random := rand.New(rand.NewSource(1))
	for i := 0; i < 4000; i++ {
		ref := make([]byte, random.Intn(64))
		for index := range ref {
			ref[index] = byte(random.Intn(256))
		}
		check(string(ref))
	}
}

func TestParseAbilityRefDoesNotAllocate(t *testing.T) {
	ref := "source.provider[source_item_3153_passive].ability[resolve_melee_damage]"
	if allocations := testing.AllocsPerRun(100, func() {
		got, ok := ParseAbilityRef(ref)
		if !ok || got.AbilityKey != "resolve_melee_damage" {
			t.Fatal(got, ok)
		}
	}); allocations != 0 {
		t.Fatalf("reference parsing allocated %v objects", allocations)
	}
}
