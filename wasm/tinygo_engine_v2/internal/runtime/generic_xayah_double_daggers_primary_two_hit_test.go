package runtime

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

// hero_xayah Q Double Daggers / 双刃 — Phase-A v3 Wasm exact verification slice
// (FROZEN_PLAN_REV: xayah-q-double-daggers-primary-two-hit-phase-a-v3).

const (
	xayahDDCandidateKey       = "hero_skill|hero_xayah|Q|双刃"
	xayahDDTaskKey            = "wasm-generic-xayah-double-daggers-primary-two-hit"
	xayahDDPlanRev            = "xayah-q-double-daggers-primary-two-hit-phase-a-v3"
	xayahDDRequestTitle       = "Template:Data Xayah/Q"
	xayahDDResolvedTitle      = "Template:Data Xayah/Double Daggers"
	xayahDDWikiPageID         = 1324541
	xayahDDRevisionID         = 4008615
	xayahDDTimestamp          = "2026-04-15T00:26:21Z"
	xayahDDRawBytes           = 2615
	xayahDDLocalRawBytes      = 2615
	xayahDDContentSHA         = "8010e567d2366730c5eb6cd0a31baec09c7f5137018ab2ca15fd84f167d990fd"
	xayahDDLocalRawSHA        = "6a1fde0a18de0b6f28e55be7df27e58f99c91d49310e79ae81a9e95384f974de"
	xayahDDLiveRedirectPageID = 1324536
	xayahDDLiveRedirectRevID  = 2864045
	xayahDDBoundary           = "rank5_primary_champion_two_feather_hits; immediate_impact_scaffold; " +
		"two_physical_hits_each_105_plus_0_50_bonus_ad; preserve_deadly_plumage_ability_type_listener_isolation; " +
		"no_cast_time_attack_lockout_direction_range_width_projectile_travel_interception_spellshield_" +
		"secondary_target_reduction_feather_generation_ground_state_or_other_ranks"

	xayahDDProviderRef = "provider_hero_xayah_q_double_daggers_primary_two_hit"
	xayahDDStableID    = "hero_xayah_q_double_daggers_primary_two_hit"
	xayahDDAbilityID   = "ability_hero_xayah_q_double_daggers_primary_two_hit"
	xayahDDAbilityKey  = "double_daggers_primary_two_hit"
	xayahDDLeftOpRef   = "op:xayah_double_daggers_primary_two_hit_left"
	xayahDDRightOpRef  = "op:xayah_double_daggers_primary_two_hit_right"
	xayahDDBonusADMod  = "fixture_xayah_double_daggers_primary_two_hit_bonus_ad"

	xayahDDBaseDamage   = 105.0
	xayahDDBonusADRatio = 0.50
	xayahDDManaCost     = 35.0
	xayahDDCDMs         = 8000.0

	xayahDDADBase            = 60.0
	xayahDDADResolvedDefault = 110.0
	xayahDDFixtureManaCD     = 105.0
	xayahDDFixtureManaShort  = 34.0
	xayahDDTargetArmor       = 100.0
	xayahDDTargetHP          = 1000.0
	xayahDDBaselineAS        = 0.658
	xayahDDManaAfter2        = 35.0  // 105 - 35 - 35
	xayahDDHPAfter2          = 740.0 // 1000 - 130 - 130
	xayahDDTol               = 1e-9

	xayahDDSeedDamageJSON = `{"op":"add","args":[{"op":"const","value":105},` +
		`{"op":"mul","args":[{"op":"const","value":0.50},{"op":"sub","args":[` +
		`{"op":"read","path":"source.attr.ad.resolved"},{"op":"read","path":"source.attr.ad.base"}]}]}]}`
)

func xayahDDOrderedTags() []string {
	return []string{
		"ability_cost_cooldown",
		"active_physical_damage",
		"bonus_ad_ratio",
		"immediate_impact_scaffold",
	}
}

func xayahDDExpectedRawFromStats(resolvedAD, baseAD float64) float64 {
	return xayahDDBaseDamage + xayahDDBonusADRatio*(resolvedAD-baseAD)
}

func xayahDDDamageAmount() *model.GenericFormulaExpr {
	base := xayahDDBaseDamage
	ratio := xayahDDBonusADRatio
	return &model.GenericFormulaExpr{
		Op: "add",
		Args: []model.GenericFormulaExpr{
			{Op: "const", Value: &base},
			{
				Op: "mul",
				Args: []model.GenericFormulaExpr{
					{Op: "const", Value: &ratio},
					{
						Op: "sub",
						Args: []model.GenericFormulaExpr{
							{Op: "read", Path: "source.attr.ad.resolved"},
							{Op: "read", Path: "source.attr.ad.base"},
						},
					},
				},
			},
		},
	}
}

func xayahDDAbility() model.AbilityDefinition {
	cost := xayahDDManaCost
	cd := xayahDDCDMs
	amount := xayahDDDamageAmount()
	return model.AbilityDefinition{
		AbilityKey: xayahDDAbilityKey,
		Kind:       "active",
		Types:      []string{},
		Cost: &model.AbilityCost{
			ResourceKey: "mana",
			Amount:      model.GenericFormulaExpr{Op: "const", Value: &cost},
		},
		Cooldown: &model.AbilityCooldown{
			DurationMs: model.GenericFormulaExpr{Op: "const", Value: &cd},
		},
		Operations: []model.OperationDefinition{
			{
				Operation:     "damage",
				Target:        "target",
				DamageType:    "damage/physical",
				Ref:           xayahDDLeftOpRef,
				Amount:        amount,
				CritEligible:  false,
				CopyableOnHit: false,
			},
			{
				Operation:     "damage",
				Target:        "target",
				DamageType:    "damage/physical",
				Ref:           xayahDDRightOpRef,
				Amount:        amount,
				CritEligible:  false,
				CopyableOnHit: false,
			},
		},
	}
}

func xayahDDProviderDef(bonusAD float64) model.ProviderDefinition {
	p := model.ProviderDefinition{
		ProviderKey: xayahDDProviderRef,
		Kind:        "champion",
		StableID:    xayahDDStableID,
		Abilities:   []model.AbilityDefinition{xayahDDAbility()},
	}
	// Fixture-only flat AD; production/seed Q provider has zero modifiers.
	if bonusAD != 0 {
		p.Modifiers = []model.ModifierDefinition{{
			ModifierKey: xayahDDBonusADMod,
			Kind:        "attribute",
			Target:      "ad",
			ValuePolicy: "add",
			Value:       gfConst(bonusAD),
		}}
	}
	return p
}

// Fine-grained same-package W helpers only — never overwrite via configureXayahDPProvider.
func xayahDDWProviderDef() model.ProviderDefinition {
	return model.ProviderDefinition{
		ProviderKey:        xayahDPProviderRef,
		Kind:               "champion",
		StableID:           xayahDPStableID,
		InitialStateSchema: xayahDPStateSchema(),
		Modifiers: []model.ModifierDefinition{
			xayahDPASModifier(),
			xayahDPBasicDamageModifier(),
		},
		Listeners: []model.ListenerDefinition{xayahDPCastArmListener()},
		Abilities: []model.AbilityDefinition{xayahDPWAbility()},
	}
}

func xayahDDAbilityRef() string {
	return "source.provider[" + xayahDDProviderRef + "].ability[" + xayahDDAbilityKey + "]"
}

type xayahDDFixtureOpts struct {
	resolvedAD float64
	armor      float64
	mana       float64
	withW      bool
	wAS        bool // use W fixture AS base (0.60) instead of Q baseline 0.658
}

func configureXayahDDProviders(compileReq *model.CompileRequest, runReq *model.RunRequest, opts xayahDDFixtureOpts) {
	bonusAD := opts.resolvedAD - xayahDDADBase
	q := xayahDDProviderDef(bonusAD)
	shared := []model.ProviderDefinition{q}
	mounts := []model.CombatantProviderMount{
		{ProviderRef: xayahDDProviderRef, DefinitionRef: xayahDDProviderRef},
	}
	snaps := []model.CombatantProviderSnapshot{
		{ProviderRef: xayahDDProviderRef, DefinitionRef: xayahDDProviderRef, Stacks: 1, State: map[string]interface{}{}},
	}
	if opts.withW {
		shared = append(shared, xayahDDWProviderDef())
		mounts = append(mounts, model.CombatantProviderMount{
			ProviderRef: xayahDPProviderRef, DefinitionRef: xayahDPProviderRef,
		})
		snaps = append(snaps, model.CombatantProviderSnapshot{
			ProviderRef: xayahDPProviderRef, DefinitionRef: xayahDPProviderRef,
			Stacks: 1, State: map[string]interface{}{},
		})
	}
	compileReq.SharedProviders = shared
	compileReq.Combatants[0].Providers = mounts
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = snaps
	}
}

func ensureXayahDDTypes(req *model.CompileRequest, withW bool) {
	need := []model.TypeCatalogEntry{
		{Key: "damage/physical", Domain: "damage"},
		{Key: "ability/basic_attack", Domain: "ability"},
		{Key: "event/ability_started", Domain: "event"},
	}
	if withW {
		need = append(need,
			model.TypeCatalogEntry{Key: xayahDPAbilityType, Domain: "ability"},
			model.TypeCatalogEntry{Key: "event/source_owner", Domain: "event"},
			model.TypeCatalogEntry{Key: "state_scope/provider", Domain: "state_scope"},
			model.TypeCatalogEntry{Key: "damage_trait/on_hit", Domain: "damage_trait"},
			model.TypeCatalogEntry{Key: "damage_trait/proc", Domain: "damage_trait"},
		)
	}
	have := map[string]bool{}
	for _, t := range req.TypeCatalog.Types {
		have[t.Key] = true
	}
	for _, t := range need {
		if !have[t.Key] {
			req.TypeCatalog.Types = append(req.TypeCatalog.Types, t)
		}
	}
}

func loadXayahDDFixture(t *testing.T, opts xayahDDFixtureOpts) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	if opts.mana == 0 {
		opts.mana = xayahDDFixtureManaCD
	}
	compileReq, runReq := loadBasicFixture(t)
	ensureXayahDDTypes(&compileReq, opts.withW)
	configureXayahDDProviders(&compileReq, &runReq, opts)

	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: xayahDDADBase, Current: xayahDDADBase,
		Max: xayahDDADBase, Resolved: xayahDDADBase,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: opts.mana, Max: math.Max(opts.mana, xayahDDFixtureManaCD),
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: xayahDDTargetHP, Current: xayahDDTargetHP,
		Max: xayahDDTargetHP, Resolved: xayahDDTargetHP,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: opts.armor, Current: opts.armor, Max: opts.armor, Resolved: opts.armor,
	})
	asBase := xayahDDBaselineAS
	if opts.wAS {
		asBase = xayahDPBaseAS
	}
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "attack_speed", model.AttributeSlotDef{
		Base: asBase, Current: asBase, Max: asBase, Resolved: asBase,
	})
	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func runXayahDD(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
	t.Helper()
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	return done
}

func runXayahDDFrames(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
	t.Helper()
	session := NewSession()
	session.ClearOutbox()
	if code := session.CompileFrame(encodeGenericFrame(model.FrameKindGenericCompile, compileReq)); code != 0 {
		t.Fatalf("CompileFrame code=%d err=%+v", code, lastGenericError(session.OutboxBytes()))
	}
	compiled := lastGenericCompileResult(session.OutboxBytes())
	if !compiled.OK || compiled.SessionID == "" {
		t.Fatalf("compile failed: %+v", compiled)
	}
	runReq.SessionID = compiled.SessionID
	runReq.ExpectedRulesHash = compiled.RulesHash
	session.ClearOutbox()
	if code := session.RunFrame(encodeGenericFrame(model.FrameKindGenericRun, runReq)); code != 0 {
		t.Fatalf("RunFrame code=%d err=%+v", code, lastGenericError(session.OutboxBytes()))
	}
	done := lastGenericRunDone(session.OutboxBytes())
	if !done.OK {
		t.Fatalf("done.ok=false stop=%q", done.Summary.StopReason)
	}
	session.ClearOutbox()
	releaseReq := model.ReleaseSessionRequest{SessionID: compiled.SessionID, ExpectedRulesHash: compiled.RulesHash}
	if code := session.ReleaseSessionFrame(encodeGenericFrame(model.FrameKindGenericReleaseSession, releaseReq)); code != 0 {
		t.Fatalf("ReleaseSessionFrame code=%d err=%+v", code, lastGenericError(session.OutboxBytes()))
	}
	released := lastGenericReleaseDone(session.OutboxBytes())
	if !released.OK || !released.Released || released.SessionID != compiled.SessionID {
		t.Fatalf("release=%+v", released)
	}
	session.ClearOutbox()
	if code := session.RunFrame(encodeGenericFrame(model.FrameKindGenericRun, runReq)); code != -1 {
		t.Fatalf("RunFrame after release code=%d want -1", code)
	}
	if lastGenericError(session.OutboxBytes()).Code != model.GenericErrSessionNotFound {
		t.Fatal("after release want session_not_found")
	}
	return done
}

func xayahDDSourceMana(t *testing.T, snap model.Snapshot) float64 {
	t.Helper()
	for _, c := range snap.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		slot, ok := c.Resources["mana"]
		if !ok {
			t.Fatal("source mana missing")
		}
		return slot.Current
	}
	t.Fatal("source missing")
	return 0
}

func xayahDDSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
	n := 0
	for _, item := range done.Evidence.Items {
		if item.Kind == model.EvidenceKindAttemptSkipped && item.Data["skipReason"] == string(reason) {
			n++
		}
	}
	return n
}

func xayahDDDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	for _, item := range damageEvidenceItems(done) {
		ref := evidenceDataString(item.Data, "operationRef")
		if ref == xayahDDLeftOpRef || ref == xayahDDRightOpRef {
			out = append(out, item)
		}
	}
	return out
}

func xayahDDAssertOrderedPair(t *testing.T, items []model.EvidenceItem, wantRaw, wantMit float64) {
	t.Helper()
	if len(items) != 2 {
		t.Fatalf("ordered pair len=%d want 2", len(items))
	}
	if evidenceDataString(items[0].Data, "operationRef") != xayahDDLeftOpRef {
		t.Fatalf("first op=%q want %q", evidenceDataString(items[0].Data, "operationRef"), xayahDDLeftOpRef)
	}
	if evidenceDataString(items[1].Data, "operationRef") != xayahDDRightOpRef {
		t.Fatalf("second op=%q want %q", evidenceDataString(items[1].Data, "operationRef"), xayahDDRightOpRef)
	}
	for i, item := range items {
		raw := evidenceDataFloat(item.Data, "rawAmount")
		mit := evidenceDataFloat(item.Data, "mitigatedAmount")
		if math.Abs(raw-wantRaw) > xayahDDTol {
			t.Fatalf("hit[%d] raw=%v want %v", i, raw, wantRaw)
		}
		if math.Abs(mit-wantMit) > xayahDDTol {
			t.Fatalf("hit[%d] mit=%v want %v", i, mit, wantMit)
		}
		if evidenceDataString(item.Data, "damageType") != "damage/physical" {
			t.Fatalf("hit[%d] damageType=%q", i, evidenceDataString(item.Data, "damageType"))
		}
		if evidenceDataBool(item.Data, "phantom") {
			t.Fatal("damage must not be phantom")
		}
		if evidenceDataString(item.Data, "phase") != "original" {
			t.Fatalf("hit[%d] phase=%q want original", i, evidenceDataString(item.Data, "phase"))
		}
		if _, ok := item.Data["eligible"]; ok {
			t.Fatalf("must not carry crit evidence: %+v", item.Data)
		}
	}
}

func assertXayahDDProviderShape(t *testing.T, compileReq model.CompileRequest, expectShared int, expectBonusADMod bool) {
	t.Helper()
	if len(compileReq.SharedProviders) != expectShared {
		t.Fatalf("SharedProviders=%d want %d", len(compileReq.SharedProviders), expectShared)
	}
	var p *model.ProviderDefinition
	for i := range compileReq.SharedProviders {
		if compileReq.SharedProviders[i].ProviderKey == xayahDDProviderRef {
			p = &compileReq.SharedProviders[i]
			break
		}
	}
	if p == nil {
		t.Fatal("Q provider missing")
	}
	if p.StableID != xayahDDStableID {
		t.Fatalf("stableId=%q", p.StableID)
	}
	if p.ProviderKey == xayahDPProviderRef || p.StableID == xayahDPStableID {
		t.Fatal("Q must not reuse Deadly Plumage provider refs")
	}
	if len(p.Listeners) != 0 || len(p.InitialStateSchema) != 0 {
		t.Fatalf("Q listeners/state=%d/%d want 0/0", len(p.Listeners), len(p.InitialStateSchema))
	}
	if expectBonusADMod {
		if len(p.Modifiers) != 1 || p.Modifiers[0].ModifierKey != xayahDDBonusADMod {
			t.Fatalf("want fixture-only bonus-AD mod, got %+v", p.Modifiers)
		}
	} else if len(p.Modifiers) != 0 {
		t.Fatalf("modifiers=%d want 0 (production Q seed has no Q modifiers)", len(p.Modifiers))
	}
	if len(p.Abilities) != 1 {
		t.Fatalf("abilities=%d want 1", len(p.Abilities))
	}
	a := p.Abilities[0]
	if a.AbilityKey != xayahDDAbilityKey || a.Kind != "active" {
		t.Fatalf("ability=%+v", a)
	}
	for _, typ := range a.Types {
		if typ == "ability/basic_attack" || typ == xayahDPAbilityType {
			t.Fatalf("Q must not carry type %q", typ)
		}
	}
	if a.Cost == nil || a.Cost.ResourceKey != "mana" || a.Cost.Amount.Value == nil ||
		math.Abs(*a.Cost.Amount.Value-xayahDDManaCost) > xayahDDTol {
		t.Fatalf("cost=%+v want mana 35", a.Cost)
	}
	if a.Cooldown == nil || a.Cooldown.DurationMs.Value == nil ||
		math.Abs(*a.Cooldown.DurationMs.Value-xayahDDCDMs) > xayahDDTol {
		t.Fatalf("cooldown=%+v want 8000", a.Cooldown)
	}
	if len(a.Operations) != 2 {
		t.Fatalf("ops=%d want 2", len(a.Operations))
	}
	assertOp := func(op model.OperationDefinition, wantRef string) {
		t.Helper()
		if op.Operation != "damage" || op.DamageType != "damage/physical" || op.Target != "target" ||
			op.CritEligible || op.CopyableOnHit || op.Ref != wantRef {
			t.Fatalf("op=%+v want physical target %s noncrit/noncopyable", op, wantRef)
		}
		if op.Amount == nil || op.Amount.Op != "add" || len(op.Amount.Args) != 2 {
			t.Fatalf("amount=%+v want nested binary add", op.Amount)
		}
		if op.Amount.Args[0].Op != "const" || op.Amount.Args[0].Value == nil ||
			math.Abs(*op.Amount.Args[0].Value-xayahDDBaseDamage) > xayahDDTol {
			t.Fatalf("base const=%+v want 105", op.Amount.Args[0])
		}
		adMul := op.Amount.Args[1]
		if adMul.Op != "mul" || len(adMul.Args) != 2 || adMul.Args[0].Value == nil ||
			math.Abs(*adMul.Args[0].Value-xayahDDBonusADRatio) > xayahDDTol {
			t.Fatalf("bonusAD mul=%+v", adMul)
		}
		sub := adMul.Args[1]
		if sub.Op != "sub" || sub.Args[0].Path != "source.attr.ad.resolved" || sub.Args[1].Path != "source.attr.ad.base" {
			t.Fatalf("bonusAD sub=%+v", sub)
		}
	}
	assertOp(a.Operations[0], xayahDDLeftOpRef)
	assertOp(a.Operations[1], xayahDDRightOpRef)
	if a.Operations[0].Amount != a.Operations[1].Amount {
		t.Fatal("left/right ops must share the same formula helper pointer")
	}
	for _, banned := range a.Operations {
		if banned.Operation == "emit_event" || banned.Operation == "projectile" ||
			banned.Operation == "dash" || banned.Operation == "blink" ||
			banned.Operation == "state_change" || banned.Operation == "repeat" {
			t.Fatalf("forbidden op: %+v", banned)
		}
	}
}

func xayahDDRepoPath(t *testing.T, parts ...string) string {
	t.Helper()
	path := filepath.Join(append([]string{"..", "..", "..", ".."}, parts...)...)
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("missing %s: %v", path, err)
	}
	return path
}

func xayahDDSHA256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func xayahDDLoadSeed(t *testing.T) (full, noComments string) {
	t.Helper()
	raw, err := os.ReadFile(xayahDDRepoPath(t, "db", "game_manage", "seeds",
		"lol_generic_xayah_double_daggers_primary_two_hit_seed.sql"))
	if err != nil {
		t.Fatal(err)
	}
	full = string(raw)
	var b strings.Builder
	for _, line := range strings.Split(full, "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "--") {
			continue
		}
		b.WriteString(line)
		b.WriteByte('\n')
	}
	return full, b.String()
}

// TestXayahDoubleDaggersSourceSeedProviderFormulaShape locks wiki/sidecar/pages/
// local-raw caveat, seed/README identifiers, and Q provider/formula shape.
func TestXayahDoubleDaggersSourceSeedProviderFormulaShape(t *testing.T) {
	type wikiDoc struct {
		CandidateKey, RequestTitle, ResolvedTitle, ContentSHA256 string
		RevisionTimestamp, SkillKey, ZhDisplayName, OwnerID      string
		WikiPageID, RevisionID, RawByteSize                      int
		Fields                                                   struct {
			Description, Leveling, Description2, Description3 string
			Cooldown, Cost, Costtype, Damagetype, Notes       string
		}
		FieldPresence map[string]bool
	}
	sidecarRaw, err := os.ReadFile(xayahDDRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "normalized", "generic", "xayah-q.json"))
	if err != nil {
		t.Fatal(err)
	}
	var doc wikiDoc
	if err := json.Unmarshal(sidecarRaw, &doc); err != nil {
		t.Fatal(err)
	}
	if doc.CandidateKey != xayahDDCandidateKey || doc.RequestTitle != xayahDDRequestTitle ||
		doc.ResolvedTitle != xayahDDResolvedTitle || doc.WikiPageID != xayahDDWikiPageID ||
		doc.RevisionID != xayahDDRevisionID || doc.RevisionTimestamp != xayahDDTimestamp ||
		doc.ContentSHA256 != xayahDDContentSHA || doc.RawByteSize != xayahDDRawBytes ||
		doc.SkillKey != "Q" || doc.ZhDisplayName != "双刃" || doc.OwnerID != "hero_xayah" {
		t.Fatalf("sidecar identity drifted: %+v", doc)
	}
	for _, key := range []string{"description", "leveling", "description2", "cooldown", "cost", "costtype", "damagetype", "notes"} {
		if !doc.FieldPresence[key] {
			t.Fatalf("fieldPresence[%s]=false", key)
		}
	}
	if doc.Fields.Cost != "35\n" || doc.Fields.Costtype != "Mana\n" || doc.Fields.Damagetype != "Physical\n" {
		t.Fatalf("cost/type/damage=%q/%q/%q", doc.Fields.Cost, doc.Fields.Costtype, doc.Fields.Damagetype)
	}
	if !strings.Contains(doc.Fields.Leveling, "{{ap|45 to 105}}") ||
		!strings.Contains(doc.Fields.Leveling, "50% '''bonus''' AD") {
		t.Fatalf("leveling=%q", doc.Fields.Leveling)
	}
	if !strings.Contains(doc.Fields.Description2, "50% reduced") ||
		!strings.Contains(doc.Fields.Notes, "left and right") ||
		!strings.Contains(doc.Fields.Notes, "Spell shield") {
		t.Fatal("wiki prose must retain excluded secondary-reduction/geometry/spellshield surfaces")
	}
	pagesRaw, err := os.ReadFile(xayahDDRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "pages", "xayah-q.json"))
	if err != nil {
		t.Fatal(err)
	}
	var pages struct {
		CandidateKey, ContentSHA256 string
		PageID, RevisionID          int
	}
	if err := json.Unmarshal(pagesRaw, &pages); err != nil {
		t.Fatal(err)
	}
	if pages.CandidateKey != doc.CandidateKey || pages.ContentSHA256 != doc.ContentSHA256 ||
		pages.PageID != doc.WikiPageID || pages.RevisionID != doc.RevisionID {
		t.Fatalf("pages must agree with sidecar; got %+v", pages)
	}
	rawBytes, err := os.ReadFile(xayahDDRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "raw", "xayah-q.wikitext"))
	if err != nil {
		t.Fatal(err)
	}
	if len(rawBytes) != xayahDDLocalRawBytes {
		t.Fatalf("local raw len=%d want %d", len(rawBytes), xayahDDLocalRawBytes)
	}
	localSHA := xayahDDSHA256Hex(rawBytes)
	if localSHA != xayahDDLocalRawSHA {
		t.Fatalf("local raw sha=%q want %q", localSHA, xayahDDLocalRawSHA)
	}
	if localSHA == xayahDDContentSHA {
		t.Fatal("local raw hash must differ from canonical (caveat; not equivalence/contradiction)")
	}
	if xayahDDPlanRev != "xayah-q-double-daggers-primary-two-hit-phase-a-v3" ||
		xayahDDBoundary != "rank5_primary_champion_two_feather_hits; immediate_impact_scaffold; "+
			"two_physical_hits_each_105_plus_0_50_bonus_ad; preserve_deadly_plumage_ability_type_listener_isolation; "+
			"no_cast_time_attack_lockout_direction_range_width_projectile_travel_interception_spellshield_"+
			"secondary_target_reduction_feather_generation_ground_state_or_other_ranks" {
		t.Fatal("frozen plan/boundary drifted")
	}

	seed, sqlNoComments := xayahDDLoadSeed(t)
	_ = xayahDDRepoPath(t, "server", "data_manage", "src", "test", "java", "xyz", "game",
		"datamanage", "db", "LolGenericXayahDoubleDaggersPrimaryTwoHitSeedSqlTest.java")
	readmeBytes, err := os.ReadFile(xayahDDRepoPath(t, "server", "data_manage", "README.md"))
	if err != nil {
		t.Fatal(err)
	}
	readme := string(readmeBytes)
	for _, want := range []string{
		xayahDDCandidateKey, xayahDDTaskKey, xayahDDPlanRev,
		xayahDDRequestTitle, xayahDDResolvedTitle,
		"1324541", "4008615", xayahDDTimestamp,
		xayahDDContentSHA, xayahDDLocalRawSHA, "2615",
		"1324536", "2864045",
		xayahDDBoundary, xayahDDProviderRef, xayahDDAbilityID,
		xayahDDAbilityKey, "double_daggers_damage", "q_mana_cost", "q_cooldown_ms",
		`{"op":"const","value":35}`, `{"op":"const","value":8000}`,
		xayahDDSeedDamageJSON, "local raw materialization caveat",
		"normalized/generic/xayah-q.json", "ability/xayah_deadly_plumage",
		"provider_hero_xayah_w_deadly_plumage", "preserve_deadly_plumage",
	} {
		if !strings.Contains(seed, want) {
			t.Fatalf("seed missing %q", want)
		}
	}
	for _, tag := range xayahDDOrderedTags() {
		if !strings.Contains(seed, tag) {
			t.Fatalf("seed missing tag %q", tag)
		}
	}
	if regexp.MustCompile(`(?is)INSERT\s+INTO\s+public\.modifier_definitions\b`).MatchString(sqlNoComments) ||
		regexp.MustCompile(`(?is)INSERT\s+INTO\s+public\.provider_modifiers\b`).MatchString(sqlNoComments) {
		t.Fatal("seed must not insert Q production modifier rows")
	}
	if regexp.MustCompile(`(?is)INSERT\s+INTO\s+public\.provider_listeners\b`).MatchString(sqlNoComments) ||
		regexp.MustCompile(`(?is)INSERT\s+INTO\s+public\.listener_match_types\b`).MatchString(sqlNoComments) ||
		regexp.MustCompile(`(?is)INSERT\s+INTO\s+public\.provider_state_schemas\b`).MatchString(sqlNoComments) {
		t.Fatal("seed must not insert Q listeners/matchers/state")
	}
	if !strings.Contains(readme, xayahDDProviderRef) ||
		!strings.Contains(readme, "8000") || !strings.Contains(readme, "0.50") {
		t.Fatal("README missing Q identity/formula/cost-CD contract")
	}
	if strings.Contains(readme, xayahDDBonusADMod) {
		t.Fatal("README must not claim fixture-only AD modifier as production Q behavior")
	}

	compileReq, _ := loadXayahDDFixture(t, xayahDDFixtureOpts{
		resolvedAD: xayahDDADResolvedDefault,
		armor:      xayahDDTargetArmor,
		mana:       xayahDDFixtureManaCD,
		withW:      true,
	})
	assertXayahDDProviderShape(t, compileReq, 2, true)
	assertXayahDPListenerAbilityTypeIsolation(t, model.CompileRequest{
		TypeCatalog:     compileReq.TypeCatalog,
		SharedProviders: []model.ProviderDefinition{xayahDDWProviderDef()},
	})
	rawX := xayahDDExpectedRawFromStats(xayahDDADResolvedDefault, xayahDDADBase)
	if math.Abs(rawX-130) > xayahDDTol {
		t.Fatalf("default raw cross-check=%v want 130", rawX)
	}
	mitX := expectedMitigatedPhysical(rawX, xayahDDTargetArmor)
	if math.Abs(mitX-65) > xayahDDTol {
		t.Fatalf("default mit=%v want 65", mitX)
	}
}

// TestXayahDoubleDaggersFormulaBranchTable: AD×armor four-case ordered two-hit table.
func TestXayahDoubleDaggersFormulaBranchTable(t *testing.T) {
	cases := []struct {
		name             string
		resolvedAD       float64
		armor            float64
		wantRaw, wantMit float64
		wantTotalMit     float64
	}{
		{"ad60_armor0", 60, 0, 105, 105, 210},
		{"ad60_armor100", 60, 100, 105, 52.5, 105},
		{"ad110_armor0", 110, 0, 130, 130, 260},
		{"ad110_armor100", 110, 100, 130, 65, 130},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rawX := xayahDDExpectedRawFromStats(tc.resolvedAD, xayahDDADBase)
			if math.Abs(rawX-tc.wantRaw) > xayahDDTol {
				t.Fatalf("cross-check raw=%v want %v", rawX, tc.wantRaw)
			}
			if math.Abs(expectedMitigatedPhysical(tc.wantRaw, tc.armor)-tc.wantMit) > xayahDDTol {
				t.Fatalf("cross-check mit want %v", tc.wantMit)
			}
			compileReq, runReq := loadXayahDDFixture(t, xayahDDFixtureOpts{
				resolvedAD: tc.resolvedAD, armor: tc.armor, mana: xayahDDFixtureManaCD, withW: true,
			})
			assertXayahDDProviderShape(t, compileReq, 2, tc.resolvedAD != xayahDDADBase)
			ref := xayahDDAbilityRef()
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runXayahDD(t, compileReq, runReq)
			if done.Summary.AbilityCastCount != 1 {
				t.Fatalf("castCount=%d", done.Summary.AbilityCastCount)
			}
			dmg := xayahDDDamageEvidence(done)
			xayahDDAssertOrderedPair(t, dmg, tc.wantRaw, tc.wantMit)
			totalMit := evidenceDataFloat(dmg[0].Data, "mitigatedAmount") + evidenceDataFloat(dmg[1].Data, "mitigatedAmount")
			if math.Abs(totalMit-tc.wantTotalMit) > xayahDDTol {
				t.Fatalf("totalMit=%v want %v", totalMit, tc.wantTotalMit)
			}
			if got := xayahDPStateValue(t, done, xayahDPActiveKey); got != 0 {
				t.Fatalf("W active=%v want 0 after Q cast (ability-type isolation)", got)
			}
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "attack_speed")-xayahDDBaselineAS) > xayahDDTol {
				t.Fatalf("AS=%v want baseline %v", sourceAttrResolved(t, done.FinalSnapshot, "attack_speed"), xayahDDBaselineAS)
			}
		})
	}
}

// TestXayahDoubleDaggersCooldownResourceAndWIsolation: CD/resource gates + W coexistence.
func TestXayahDoubleDaggersCooldownResourceAndWIsolation(t *testing.T) {
	t.Run("cooldown_mana105", func(t *testing.T) {
		compileReq, runReq := loadXayahDDFixture(t, xayahDDFixtureOpts{
			resolvedAD: xayahDDADResolvedDefault,
			armor:      xayahDDTargetArmor,
			mana:       xayahDDFixtureManaCD,
			withW:      true,
		})
		assertXayahDDProviderShape(t, compileReq, 2, true)
		ref := xayahDDAbilityRef()
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
			{EntryKey: "q_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 7999},
			{EntryKey: "q_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 8000},
		}
		runReq.StopPolicy.DurationMs = 8100
		done := runXayahDD(t, compileReq, runReq)
		if done.Summary.AbilityAttemptCount != 3 || done.Summary.AbilityCastCount != 2 ||
			done.Summary.AttemptSkippedCount != 1 {
			t.Fatalf("attempt/cast/skip=%d/%d/%d want 3/2/1",
				done.Summary.AbilityAttemptCount, done.Summary.AbilityCastCount, done.Summary.AttemptSkippedCount)
		}
		if xayahDDSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
			t.Fatal("want one cooldown_not_ready")
		}
		var skipOK bool
		for _, item := range done.Evidence.Items {
			if item.Kind != model.EvidenceKindAttemptSkipped ||
				item.Data["skipReason"] != string(model.AttemptSkipCooldownNotReady) {
				continue
			}
			if item.TimeMs != 7999 || numericAsInt64(item.Data["readyAtMs"]) != 8000 {
				t.Fatalf("skip TimeMs/readyAt=%d/%v", item.TimeMs, item.Data["readyAtMs"])
			}
			skipOK = true
		}
		if !skipOK {
			t.Fatal("missing cooldown skip at 7999 readyAt 8000")
		}
		items := xayahDDDamageEvidence(done)
		if len(items) != 4 {
			t.Fatalf("Q damage=%d want 4", len(items))
		}
		xayahDDAssertOrderedPair(t, items[0:2], 130, 65)
		xayahDDAssertOrderedPair(t, items[2:4], 130, 65)
		if math.Abs(xayahDDSourceMana(t, done.FinalSnapshot)-xayahDDManaAfter2) > xayahDDTol {
			t.Fatalf("mana=%v want %v", xayahDDSourceMana(t, done.FinalSnapshot), xayahDDManaAfter2)
		}
		if math.Abs(done.Summary.TargetFinalHp-xayahDDHPAfter2) > 1e-6 {
			t.Fatalf("hp=%v want %v", done.Summary.TargetFinalHp, xayahDDHPAfter2)
		}
		if countEmittedEvents(done, "event/ability_started") != 2 {
			t.Fatalf("ability_started=%d want 2", countEmittedEvents(done, "event/ability_started"))
		}
		if got := xayahDPStateValue(t, done, xayahDPActiveKey); got != 0 {
			t.Fatalf("W active=%v want 0", got)
		}
		if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "attack_speed")-xayahDDBaselineAS) > xayahDDTol {
			t.Fatalf("AS=%v want baseline", sourceAttrResolved(t, done.FinalSnapshot, "attack_speed"))
		}
	})

	t.Run("resource_mana34", func(t *testing.T) {
		compileReq, runReq := loadXayahDDFixture(t, xayahDDFixtureOpts{
			resolvedAD: xayahDDADResolvedDefault,
			armor:      xayahDDTargetArmor,
			mana:       xayahDDFixtureManaShort,
			withW:      true,
		})
		ref := xayahDDAbilityRef()
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		}
		runReq.StopPolicy.DurationMs = 50
		done := runXayahDD(t, compileReq, runReq)
		if done.Summary.AbilityCastCount != 0 || done.Summary.AbilityAttemptCount != 1 {
			t.Fatalf("cast/attempt=%d/%d", done.Summary.AbilityCastCount, done.Summary.AbilityAttemptCount)
		}
		if xayahDDSkipReasonCount(done, model.AttemptSkipResourceInsufficient) != 1 {
			t.Fatal("want resource_insufficient")
		}
		if math.Abs(xayahDDSourceMana(t, done.FinalSnapshot)-xayahDDFixtureManaShort) > xayahDDTol {
			t.Fatal("mana must be unchanged")
		}
		if math.Abs(done.Summary.TargetFinalHp-xayahDDTargetHP) > 1e-6 {
			t.Fatal("HP must be unchanged")
		}
		if len(xayahDDDamageEvidence(done)) != 0 || len(damageEvidenceItems(done)) != 0 {
			t.Fatal("want zero damage")
		}
		if countEmittedEvents(done, "event/ability_started") != 0 {
			t.Fatal("resource skip must not synthesize ability_started")
		}
		if got := xayahDPStateValue(t, done, xayahDPActiveKey); got != 0 {
			t.Fatalf("W active=%v want 0", got)
		}
		if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "attack_speed")-xayahDDBaselineAS) > xayahDDTol {
			t.Fatal("baseline AS must be unchanged")
		}
	})

	t.Run("w_coexistence", func(t *testing.T) {
		compileReq, runReq := loadXayahDDFixture(t, xayahDDFixtureOpts{
			resolvedAD: xayahDDADResolvedDefault,
			armor:      xayahDDTargetArmor,
			mana:       xayahDDFixtureManaCD,
			withW:      true,
			wAS:        true,
		})
		assertXayahDDProviderShape(t, compileReq, 2, true)
		var w *model.ProviderDefinition
		for i := range compileReq.SharedProviders {
			if compileReq.SharedProviders[i].ProviderKey == xayahDPProviderRef {
				w = &compileReq.SharedProviders[i]
			}
		}
		if w == nil || len(w.Listeners) != 1 || len(w.InitialStateSchema) == 0 || len(w.Modifiers) != 2 {
			t.Fatalf("W provider incomplete: %+v", w)
		}
		if len(compileReq.Combatants[0].Providers) != 2 {
			t.Fatal("both Q and W mounts required")
		}
		assertXayahDPListenerAbilityTypeIsolation(t, model.CompileRequest{
			TypeCatalog:     compileReq.TypeCatalog,
			SharedProviders: []model.ProviderDefinition{*w},
		})
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "w0", AbilityRef: xayahDPWRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		runReq.StopPolicy.DurationMs = 50
		done := runXayahDD(t, compileReq, runReq)
		if done.Summary.AbilityCastCount != 1 {
			t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
		}
		if len(xayahDDDamageEvidence(done)) != 0 {
			t.Fatal("W cast must produce no Q damage")
		}
		if countEmittedEvents(done, "event/ability_started") != 1 {
			t.Fatalf("ability_started=%d want 1", countEmittedEvents(done, "event/ability_started"))
		}
		if got := xayahDPStateValue(t, done, xayahDPActiveKey); got != 1 {
			t.Fatalf("W active=%v want 1", got)
		}
		slot := xayahDPSourceASSlot(t, done.FinalSnapshot)
		if math.Abs(slot.Base-xayahDPBaseAS) > xayahDDTol ||
			math.Abs(slot.Resolved-xayahDPResolvedAS) > xayahDDTol {
			t.Fatalf("AS base/resolved=%v/%v want %v/%v", slot.Base, slot.Resolved, xayahDPBaseAS, xayahDPResolvedAS)
		}
		// Q remains independently mounted.
		foundQ := false
		for _, m := range compileReq.Combatants[0].Providers {
			if m.ProviderRef == xayahDDProviderRef {
				foundQ = true
			}
		}
		if !foundQ {
			t.Fatal("Q mount must remain present alongside W")
		}
		assertXayahDDProviderShape(t, compileReq, 2, true)
	})
}

// TestXayahDoubleDaggersDeterminismAndRelease: repeated compile/run + frame lifecycle.
func TestXayahDoubleDaggersDeterminismAndRelease(t *testing.T) {
	t.Run("determinism", func(t *testing.T) {
		runOnce := func() (string, string, string) {
			c, r := loadXayahDDFixture(t, xayahDDFixtureOpts{
				resolvedAD: xayahDDADResolvedDefault,
				armor:      xayahDDTargetArmor,
				mana:       xayahDDFixtureManaCD,
				withW:      true,
			})
			ref := xayahDDAbilityRef()
			r.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
				{EntryKey: "q_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 7999},
				{EntryKey: "q_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 8000},
			}
			r.StopPolicy.DurationMs = 8100
			done := runXayahDD(t, c, r)
			sum, _ := json.Marshal(done.Summary)
			ev, _ := json.Marshal(done.Evidence)
			snap, _ := json.Marshal(done.FinalSnapshot)
			return string(sum), string(ev), string(snap)
		}
		s1, e1, f1 := runOnce()
		s2, e2, f2 := runOnce()
		if s1 != s2 || e1 != e2 || f1 != f2 {
			t.Fatal("summary/evidence/finalSnapshot unstable")
		}
	})

	t.Run("frame_release", func(t *testing.T) {
		c, r := loadXayahDDFixture(t, xayahDDFixtureOpts{
			resolvedAD: xayahDDADResolvedDefault,
			armor:      xayahDDTargetArmor,
			mana:       xayahDDFixtureManaCD,
			withW:      true,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: xayahDDAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		r.StopPolicy.DurationMs = 50
		done := runXayahDDFrames(t, c, r)
		xayahDDAssertOrderedPair(t, xayahDDDamageEvidence(done), 130, 65)
		if got := xayahDPStateValue(t, done, xayahDPActiveKey); got != 0 {
			t.Fatalf("W active=%v want 0 after Q frame path", got)
		}
	})
}
