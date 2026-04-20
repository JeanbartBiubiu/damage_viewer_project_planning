package enginev2demo

func BenchmarkBundle() EngineBundle {
	const (
		physicalProfile = "profile_physical"
		magicalProfile  = "profile_magical"
		trueProfile     = "profile_true"
	)

	const (
		physicalResistanceFormula = "profile_physical_effective_resistance"
		magicalResistanceFormula  = "profile_magical_effective_resistance"
		trueResistanceFormula     = "profile_true_effective_resistance"
		standardMitigationFormula = "profile_standard_mitigation"
		trueMitigationFormula     = "profile_true_mitigation"
		zeroCooldownFormula       = "formula_zero_cooldown"
	)

	formulas := []FormulaDefinition{
		{
			ID: physicalResistanceFormula,
			Root: MaxOf(
				Constant{Value: -99.0},
				Sum(
					TargetAttr("armor"),
					Product(Constant{Value: -1.0}, SourceAttr("armor_pen_flat")),
				),
			),
		},
		{
			ID: magicalResistanceFormula,
			Root: MaxOf(
				Constant{Value: -99.0},
				Sum(
					TargetAttr("magic_resist"),
					Product(Constant{Value: -1.0}, SourceAttr("magic_pen_flat")),
				),
			),
		},
		{ID: trueResistanceFormula, Root: Constant{Value: 0.0}},
		{
			ID: standardMitigationFormula,
			Root: Switch(
				Input("effective_resistance"),
				Quotient(
					Constant{Value: 100.0},
					Sum(Constant{Value: 100.0}, Input("effective_resistance")),
				),
				Sum(
					Constant{Value: 2.0},
					Product(
						Constant{Value: -1.0},
						Quotient(
							Constant{Value: 100.0},
							Sum(
								Constant{Value: 100.0},
								Product(Constant{Value: -1.0}, Input("effective_resistance")),
							),
						),
					),
				),
			),
		},
		{ID: trueMitigationFormula, Root: Constant{Value: 1.0}},
		{ID: zeroCooldownFormula, Root: Constant{Value: 0.0}},
		{ID: "formula_basic_attack_damage", Root: SourceAttr("attack_damage")},
		{ID: "formula_enemy_basic_attack_damage", Root: SourceAttr("attack_damage")},
		{ID: "formula_zero_damage", Root: Constant{Value: 0.0}},
		{ID: "formula_thorn_armor_damage", Root: Constant{Value: 25.0}},
		{ID: "formula_mystic_shot_cd", Root: Constant{Value: 350.0}},
		{ID: "formula_arcane_shift_cd", Root: Constant{Value: 450.0}},
		{ID: "formula_generate_shield_cd", Root: Constant{Value: 600.0}},
		{ID: "formula_benchmark_final_kill_cd", Root: Constant{Value: 1000.0}},
		{ID: "formula_enemy_stun_bolt_cd", Root: Constant{Value: 700.0}},
		{
			ID: "formula_generate_shield_amount",
			Root: Product(
				SourceAttr("ability_power"),
				Constant{Value: 0.8},
			),
		},
		{
			ID: "formula_mystic_shot_damage",
			Root: Sum(
				Product(SourceAttr("attack_damage"), Constant{Value: 0.8}),
				Product(SourceAttr("ability_power"), Constant{Value: 0.35}),
				Constant{Value: 40.0},
			),
		},
		{
			ID: "formula_arcane_shift_damage",
			Root: Sum(
				Product(SourceAttr("ability_power"), Constant{Value: 0.9}),
				Constant{Value: 60.0},
			),
		},
		{
			ID: "formula_benchmark_final_kill",
			Root: Sum(
				Product(SourceAttr("attack_damage"), Constant{Value: 1.2}),
				SourceAttr("ability_power"),
				Constant{Value: 1120.0},
			),
		},
	}

	return EngineBundle{
		ActorTemplates: map[string]ActorTemplate{
			"self_template": {
				TemplateID: "self_template",
				Attributes: map[string]float64{
					"max_hp":         1450.0,
					"attack_damage":  92.0,
					"ability_power":  110.0,
					"armor":          38.0,
					"magic_resist":   34.0,
					"armor_pen_flat": 15.0,
				},
				InitialResources: map[string]float64{"mana": 220.0},
				ActionIDs: []string{
					"skill_basic_attack",
					"skill_mystic_shot",
					"skill_arcane_shift",
					"skill_generate_shield",
					"skill_benchmark_final_kill",
				},
			},
			"enemy_template": {
				TemplateID: "enemy_template",
				Attributes: map[string]float64{
					"max_hp":        1650.0,
					"attack_damage": 88.0,
					"ability_power": 45.0,
					"armor":         62.0,
					"magic_resist":  45.0,
				},
				InitialResources: map[string]float64{"mana": 120.0},
				ActionIDs:        []string{"enemy_basic_attack", "enemy_stun_bolt"},
			},
		},
		ActionTemplates: map[string]ActionTemplate{
			"skill_basic_attack": {
				ActionID:          "skill_basic_attack",
				Label:             "Basic Attack",
				DamageProfileID:   physicalProfile,
				FormulaID:         "formula_basic_attack_damage",
				CooldownFormulaID: zeroCooldownFormula,
				ResourceCosts:     map[string]float64{},
			},
			"skill_mystic_shot": {
				ActionID:          "skill_mystic_shot",
				Label:             "Mystic Shot",
				DamageProfileID:   magicalProfile,
				FormulaID:         "formula_mystic_shot_damage",
				CooldownFormulaID: "formula_mystic_shot_cd",
				ResourceCosts:     map[string]float64{"mana": 35.0},
			},
			"skill_arcane_shift": {
				ActionID:          "skill_arcane_shift",
				Label:             "Arcane Shift",
				DamageProfileID:   magicalProfile,
				FormulaID:         "formula_arcane_shift_damage",
				CooldownFormulaID: "formula_arcane_shift_cd",
				ResourceCosts:     map[string]float64{"mana": 45.0},
			},
			"skill_generate_shield": {
				ActionID:          "skill_generate_shield",
				Label:             "Generate Shield",
				DamageProfileID:   trueProfile,
				FormulaID:         "formula_zero_damage",
				CooldownFormulaID: "formula_generate_shield_cd",
				ResourceCosts:     map[string]float64{"mana": 40.0},
				Triggers: []TriggerSubscriptionDef{
					{
						TriggerType:            TriggerTypeOnActionCast,
						OwnerEventRole:         EventActorRoleSource,
						RequiresPositiveDamage: false,
						Effects: []EffectDef{
							ApplyStatusEffect{
								StatusID:        "status_benchmark_barrier",
								SourceActorRole: EventActorRoleSource,
								TargetActorRole: EventActorRoleSource,
							},
						},
					},
				},
			},
			"skill_benchmark_final_kill": {
				ActionID:          "skill_benchmark_final_kill",
				Label:             "Benchmark Final Kill",
				DamageProfileID:   trueProfile,
				FormulaID:         "formula_benchmark_final_kill",
				CooldownFormulaID: "formula_benchmark_final_kill_cd",
				ResourceCosts:     map[string]float64{"mana": 60.0},
			},
			"enemy_basic_attack": {
				ActionID:          "enemy_basic_attack",
				Label:             "Enemy Basic Attack",
				DamageProfileID:   physicalProfile,
				FormulaID:         "formula_enemy_basic_attack_damage",
				CooldownFormulaID: zeroCooldownFormula,
				ResourceCosts:     map[string]float64{},
			},
			"enemy_stun_bolt": {
				ActionID:          "enemy_stun_bolt",
				Label:             "Enemy Stun Bolt",
				DamageProfileID:   trueProfile,
				FormulaID:         "formula_zero_damage",
				CooldownFormulaID: "formula_enemy_stun_bolt_cd",
				ResourceCosts:     map[string]float64{"mana": 20.0},
				Triggers: []TriggerSubscriptionDef{
					{
						TriggerType:            TriggerTypeOnActionCast,
						OwnerEventRole:         EventActorRoleSource,
						RequiresPositiveDamage: false,
						Effects: []EffectDef{
							ApplyStatusEffect{
								StatusID:        "status_benchmark_stun",
								SourceActorRole: EventActorRoleSource,
								TargetActorRole: EventActorRoleTarget,
							},
						},
					},
				},
			},
		},
		ItemTemplates: map[string]ItemTemplate{
			"item_thorn_armor": {
				ItemID: "item_thorn_armor",
				Label:  "Thorn Armor",
				Triggers: []TriggerSubscriptionDef{
					{
						TriggerType:            TriggerTypeOnDamageTaken,
						OwnerEventRole:         EventActorRoleTarget,
						RequiresPositiveDamage: true,
						Effects: []EffectDef{
							DealDamageEffect{
								ActionID:        "thorn_armor_reflect",
								Label:           "Thorn Armor Reflect",
								DamageProfileID: magicalProfile,
								FormulaID:       "formula_thorn_armor_damage",
								SourceActorRole: EventActorRoleTarget,
								TargetActorRole: EventActorRoleSource,
							},
						},
					},
				},
			},
		},
		StatusTemplates: map[string]StatusTemplate{
			"status_benchmark_barrier": {
				StatusID:           "status_benchmark_barrier",
				Label:              "Benchmark Barrier",
				StatusKind:         StatusKindShield,
				DurationMs:         1500,
				RefreshPolicy:      StatusRefreshTakeMax,
				MagnitudeFormulaID: "formula_generate_shield_amount",
			},
			"status_benchmark_stun": {
				StatusID:      "status_benchmark_stun",
				Label:         "Benchmark Stun",
				StatusKind:    StatusKindStun,
				DurationMs:    300,
				RefreshPolicy: StatusRefreshReplace,
			},
		},
		DamageProfiles: map[string]DamageProfile{
			physicalProfile: {
				DamageProfileID:               physicalProfile,
				EffectiveResistanceFormulaID:  physicalResistanceFormula,
				MitigationMultiplierFormulaID: standardMitigationFormula,
			},
			magicalProfile: {
				DamageProfileID:               magicalProfile,
				EffectiveResistanceFormulaID:  magicalResistanceFormula,
				MitigationMultiplierFormulaID: standardMitigationFormula,
			},
			trueProfile: {
				DamageProfileID:               trueProfile,
				EffectiveResistanceFormulaID:  trueResistanceFormula,
				MitigationMultiplierFormulaID: trueMitigationFormula,
			},
		},
		Formulas: formulas,
	}
}

func BenchmarkInput() EngineRunInput {
	return EngineRunInput{
		Seed:          7,
		StopCondition: StopCondition{MaxEvents: 64},
		Self: CombatantRunInit{
			ActorID:          "self",
			TemplateID:       "self_template",
			EquippedItemIDs:  []string{},
			InitialStatusIDs: []string{},
		},
		Enemy: CombatantRunInit{
			ActorID:          "enemy",
			TemplateID:       "enemy_template",
			EquippedItemIDs:  []string{"item_thorn_armor"},
			InitialStatusIDs: []string{},
		},
		InitialActions: []ActionRequest{
			{TriggerAtMs: 0, SourceActorID: "self", TargetActorID: "enemy", ActionID: "skill_basic_attack"},
			{TriggerAtMs: 150, SourceActorID: "enemy", TargetActorID: "self", ActionID: "enemy_basic_attack"},
			{TriggerAtMs: 300, SourceActorID: "self", TargetActorID: "enemy", ActionID: "skill_mystic_shot"},
			{TriggerAtMs: 500, SourceActorID: "enemy", TargetActorID: "self", ActionID: "enemy_stun_bolt"},
			{TriggerAtMs: 900, SourceActorID: "self", TargetActorID: "enemy", ActionID: "skill_generate_shield"},
			{TriggerAtMs: 1000, SourceActorID: "enemy", TargetActorID: "self", ActionID: "enemy_basic_attack"},
			{TriggerAtMs: 1200, SourceActorID: "self", TargetActorID: "enemy", ActionID: "skill_arcane_shift"},
			{TriggerAtMs: 1450, SourceActorID: "enemy", TargetActorID: "self", ActionID: "enemy_basic_attack"},
			{TriggerAtMs: 1600, SourceActorID: "self", TargetActorID: "enemy", ActionID: "skill_basic_attack"},
			{TriggerAtMs: 1900, SourceActorID: "self", TargetActorID: "enemy", ActionID: "skill_benchmark_final_kill"},
		},
	}
}
