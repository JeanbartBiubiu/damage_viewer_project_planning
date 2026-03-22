use crate::model::{
    AttributeDefinition, CombatantInit, CombatantOverride, EngineActionPlan, EngineConfig, EngineError, EngineInitPayload,
    EngineRunInput, EngineRunOutput, EngineRunResult, EngineSamplePoint, ErrorCode, GameDataBundle, Hero, Item, Skill,
    StopReason,
};
use std::collections::{HashMap, HashSet};

#[derive(Clone)]
pub struct EngineSession {
    catalog: Catalog,
    hp_attr_key: String,
}

#[derive(Clone)]
struct Catalog {
    attribute_keys: HashSet<String>,
    default_stats: HashMap<String, f64>,
    heroes_by_id: HashMap<String, Hero>,
    items_by_id: HashMap<String, Item>,
    skills_by_id: HashMap<String, Skill>,
}

#[derive(Clone)]
struct CombatantState {
    stats: HashMap<String, f64>,
    base_hero_stats: HashMap<String, f64>,
    hp: f64,
}

#[derive(Clone, Copy)]
enum DamageType {
    Physical,
    Magic,
    True,
}

pub fn init_session(payload: EngineInitPayload) -> Result<EngineSession, EngineError> {
    let hp_attr_key = payload
        .engine_config
        .as_ref()
        .and_then(|config: &EngineConfig| config.hp_attr_key.clone())
        .unwrap_or_else(|| "hp".to_string());

    let catalog = build_catalog(payload.bundle)?;

    if !catalog.attribute_keys.contains(&hp_attr_key) {
        return Err(semantic_error(format!("Unknown hp attr key: {hp_attr_key}")));
    }

    Ok(EngineSession { catalog, hp_attr_key })
}

pub fn run(session: &EngineSession, input: EngineRunInput) -> Result<EngineRunOutput, EngineError> {
    validate_input(&session.catalog, &input)?;

    let self_override = input.overrides.as_ref().and_then(|overrides| overrides.self_actor.as_ref());
    let enemy_override = input.overrides.as_ref().and_then(|overrides| overrides.enemy.as_ref());

    let self_actor = resolve_combatant(
        &session.catalog,
        &input.initial.self_actor,
        self_override,
        &session.hp_attr_key,
    )?;
    let mut enemy = resolve_combatant(
        &session.catalog,
        &input.initial.enemy,
        enemy_override,
        &session.hp_attr_key,
    )?;
    let max_duration_ms = (input.stop.max_seconds.max(0.001) * 1000.0).round() as u32;

    let mut t_ms: u32 = 0;
    let mut executed_hits: u32 = 0;
    let mut cumulative_damage_to_enemy = 0.0;
    let cumulative_damage_to_self = 0.0;
    let mut stop_reason = StopReason::Completed;
    let mut time_to_kill_enemy = None;
    let mut samples: Vec<EngineSamplePoint> = Vec::new();

    let push_sample = |samples: &mut Vec<EngineSamplePoint>,
                       t_ms: u32,
                       self_hp: f64,
                       enemy_hp: f64,
                       cumulative_damage_to_enemy: f64,
                       cumulative_damage_to_self: f64| {
        samples.push(EngineSamplePoint {
            t_ms,
            self_hp: round_number(self_hp),
            enemy_hp: round_number(enemy_hp),
            cumulative_damage_to_enemy: round_number(cumulative_damage_to_enemy),
            cumulative_damage_to_self: round_number(cumulative_damage_to_self),
        });
    };

    match input.plan {
        EngineActionPlan::BasicAttack { count, skill_id } => {
            let attack_speed = self_actor.stats.get("attack_speed").copied().unwrap_or(0.0).max(0.1);
            let interval_ms = 1000.0 / attack_speed;
            let skill = skill_id
                .as_ref()
                .and_then(|id| session.catalog.skills_by_id.get(id));
            let attack_ratio = skill
                .and_then(|skill| skill.params.attack_ratio)
                .unwrap_or(1.0);
            let damage_type = skill
                .and_then(|skill| skill.params.damage_type.as_deref())
                .map(parse_damage_type)
                .unwrap_or(DamageType::Physical);

            for hit_index in 0..count {
                t_ms = (((hit_index + 1) as f64) * interval_ms).round() as u32;
                if t_ms > max_duration_ms {
                    stop_reason = StopReason::MaxSeconds;
                    break;
                }
                let raw_damage = self_actor.stats.get("ad").copied().unwrap_or(0.0) * attack_ratio;
                apply_enemy_damage(
                    raw_damage,
                    damage_type,
                    t_ms,
                    &self_actor,
                    &mut enemy,
                    &mut executed_hits,
                    &mut cumulative_damage_to_enemy,
                    cumulative_damage_to_self,
                    &mut samples,
                    &mut stop_reason,
                    &mut time_to_kill_enemy,
                    &push_sample,
                );
                if enemy.hp <= 0.0 {
                    break;
                }
            }
        }
        EngineActionPlan::CastSkill {
            skill_id,
            skill_level,
            cast_count,
        } => {
            let skill = session
                .catalog
                .skills_by_id
                .get(&skill_id)
                .ok_or_else(|| semantic_error(format!("Skill not found: {skill_id}")))?;

            let resolved_skill_level = clamp_skill_level(skill_level.unwrap_or(skill.params.default_skill_level.unwrap_or(1)));
            let hits_per_cast = skill.params.hit_count.unwrap_or(1).max(1);
            let total_hits = hits_per_cast * cast_count.unwrap_or(1).max(1);
            let hit_interval_ms = skill.params.hit_interval_ms.unwrap_or(100).max(1);
            let base_damage = resolve_base_damage(skill, resolved_skill_level);
            let ad_ratio = skill.params.ad_ratio.unwrap_or(0.0);
            let ap_ratio = skill.params.ap_ratio.unwrap_or(0.0);
            let bonus_attack_speed_ratio = skill.params.bonus_attack_speed_ratio.unwrap_or(0.0);
            let damage_type = parse_damage_type(skill.params.damage_type.as_deref().unwrap_or("magic"));
            let bonus_attack_speed = (self_actor.stats.get("attack_speed").copied().unwrap_or(0.0)
                - self_actor.base_hero_stats.get("attack_speed").copied().unwrap_or(0.0))
                .max(0.0);

            for hit_index in 0..total_hits {
                t_ms = if hit_index == 0 {
                    0
                } else {
                    hit_index * hit_interval_ms
                };
                if t_ms > max_duration_ms {
                    stop_reason = StopReason::MaxSeconds;
                    break;
                }
                let raw_damage = base_damage
                    + self_actor.stats.get("ad").copied().unwrap_or(0.0)
                        * ad_ratio
                        * (1.0 + bonus_attack_speed * bonus_attack_speed_ratio)
                    + self_actor.stats.get("ap").copied().unwrap_or(0.0) * ap_ratio;
                apply_enemy_damage(
                    raw_damage,
                    damage_type,
                    t_ms,
                    &self_actor,
                    &mut enemy,
                    &mut executed_hits,
                    &mut cumulative_damage_to_enemy,
                    cumulative_damage_to_self,
                    &mut samples,
                    &mut stop_reason,
                    &mut time_to_kill_enemy,
                    &push_sample,
                );
                if enemy.hp <= 0.0 {
                    break;
                }
            }

            if stop_reason == StopReason::Completed {
                let channel_duration_ms = skill
                    .params
                    .channel_duration_ms
                    .unwrap_or(hit_interval_ms.saturating_mul(total_hits));
                t_ms = t_ms.max(channel_duration_ms);
                if t_ms > max_duration_ms {
                    t_ms = max_duration_ms;
                    stop_reason = StopReason::MaxSeconds;
                }
            }
        }
    }

    let last_sample = samples.last().cloned();
    Ok(EngineRunOutput {
        result: EngineRunResult {
            stop_reason,
            time_to_kill_enemy_ms: time_to_kill_enemy,
            time_to_die_ms: None,
            total_damage_to_enemy: round_number(cumulative_damage_to_enemy),
            total_damage_to_self: round_number(cumulative_damage_to_self),
            executed_hits,
            action_duration_ms: t_ms,
            action_label: build_action_label(&session.catalog.skills_by_id, &input.plan),
            last_sample,
        },
        samples,
    })
}

#[allow(clippy::too_many_arguments)]
fn apply_enemy_damage<F>(
    raw_damage: f64,
    damage_type: DamageType,
    t_ms: u32,
    self_actor: &CombatantState,
    enemy: &mut CombatantState,
    executed_hits: &mut u32,
    cumulative_damage_to_enemy: &mut f64,
    cumulative_damage_to_self: f64,
    samples: &mut Vec<EngineSamplePoint>,
    stop_reason: &mut StopReason,
    time_to_kill_enemy: &mut Option<u32>,
    push_sample: &F,
) where
    F: Fn(&mut Vec<EngineSamplePoint>, u32, f64, f64, f64, f64),
{
    let reduced_damage = apply_mitigation(raw_damage, damage_type, &enemy.stats);
    enemy.hp = (enemy.hp - reduced_damage).max(0.0);
    *executed_hits += 1;
    *cumulative_damage_to_enemy += reduced_damage;
    push_sample(
        samples,
        t_ms,
        self_actor.hp,
        enemy.hp,
        *cumulative_damage_to_enemy,
        cumulative_damage_to_self,
    );
    if enemy.hp <= 0.0 && time_to_kill_enemy.is_none() {
        *time_to_kill_enemy = Some(t_ms);
        *stop_reason = StopReason::EnemyDead;
    }
}

fn build_catalog(bundle: GameDataBundle) -> Result<Catalog, EngineError> {
    let attribute_keys: HashSet<String> = bundle
        .attribute_definitions
        .iter()
        .map(|attribute| attribute.attr_key.clone())
        .collect();
    let default_stats = build_default_stats(&bundle.attribute_definitions);
    let heroes_by_id = bundle
        .heroes
        .into_iter()
        .map(|hero| (hero.hero_id.clone(), hero))
        .collect();
    let items_by_id = bundle
        .items
        .into_iter()
        .map(|item| (item.item_id.clone(), item))
        .collect();
    let skills_by_id = bundle
        .skills
        .into_iter()
        .map(|skill| (skill.skill_id.clone(), skill))
        .collect();

    if attribute_keys.is_empty() {
        return Err(invalid_input("bundle.attributeDefinitions cannot be empty"));
    }

    Ok(Catalog {
        attribute_keys,
        default_stats,
        heroes_by_id,
        items_by_id,
        skills_by_id,
    })
}

fn validate_input(catalog: &Catalog, input: &EngineRunInput) -> Result<(), EngineError> {
    if input.stop.max_seconds <= 0.0 {
        return Err(invalid_input("stop.maxSeconds must be greater than 0"));
    }
    validate_combatant_ref(catalog, &input.initial.self_actor)?;
    validate_combatant_ref(catalog, &input.initial.enemy)?;
    validate_override(catalog, input.overrides.as_ref().and_then(|overrides| overrides.self_actor.as_ref()))?;
    validate_override(catalog, input.overrides.as_ref().and_then(|overrides| overrides.enemy.as_ref()))?;

    match &input.plan {
        EngineActionPlan::BasicAttack { count, skill_id } => {
            if *count == 0 {
                return Err(invalid_input("basic_attack.count must be greater than 0"));
            }
            if let Some(skill_id) = skill_id {
                if !catalog.skills_by_id.contains_key(skill_id) {
                    return Err(semantic_error(format!("Skill not found: {skill_id}")));
                }
            }
        }
        EngineActionPlan::CastSkill { skill_id, .. } => {
            if !catalog.skills_by_id.contains_key(skill_id) {
                return Err(semantic_error(format!("Skill not found: {skill_id}")));
            }
        }
    }

    Ok(())
}

fn validate_combatant_ref(catalog: &Catalog, combatant: &CombatantInit) -> Result<(), EngineError> {
    if !catalog.heroes_by_id.contains_key(&combatant.hero_id) {
        return Err(semantic_error(format!("Hero not found: {}", combatant.hero_id)));
    }
    for item_id in &combatant.item_ids {
        if !catalog.items_by_id.contains_key(item_id) {
            return Err(semantic_error(format!("Item not found: {item_id}")));
        }
    }
    Ok(())
}

fn validate_override(catalog: &Catalog, override_input: Option<&CombatantOverride>) -> Result<(), EngineError> {
    let Some(override_input) = override_input else {
        return Ok(());
    };

    for attr_key in override_input.base_stats.keys() {
        if !catalog.attribute_keys.contains(attr_key) {
            return Err(semantic_error(format!("Unknown attribute override: {attr_key}")));
        }
    }

    for item_id in override_input
        .add_item_ids
        .iter()
        .chain(override_input.remove_item_ids.iter())
    {
        if !catalog.items_by_id.contains_key(item_id) {
            return Err(semantic_error(format!("Item not found: {item_id}")));
        }
    }

    Ok(())
}

fn resolve_combatant(
    catalog: &Catalog,
    init: &CombatantInit,
    override_input: Option<&CombatantOverride>,
    hp_attr_key: &str,
) -> Result<CombatantState, EngineError> {
    let hero = catalog
        .heroes_by_id
        .get(&init.hero_id)
        .ok_or_else(|| semantic_error(format!("Hero not found: {}", init.hero_id)))?;

    let mut base_hero_stats = catalog.default_stats.clone();
    merge_stats(&mut base_hero_stats, &hero.base_stats);

    let mut effective_item_ids: Vec<String> = init.item_ids.clone();
    if let Some(override_input) = override_input {
        let remove_item_ids: HashSet<&str> = override_input.remove_item_ids.iter().map(String::as_str).collect();
        effective_item_ids.retain(|item_id| !remove_item_ids.contains(item_id.as_str()));
        effective_item_ids.extend(override_input.add_item_ids.clone());
    }

    let mut item_stats = HashMap::new();
    for item_id in &effective_item_ids {
        let item = catalog
            .items_by_id
            .get(item_id)
            .ok_or_else(|| semantic_error(format!("Item not found: {item_id}")))?;
        merge_stats(&mut item_stats, &item.stats_modifier);
    }

    let mut stats = base_hero_stats.clone();
    merge_stats(&mut stats, &item_stats);
    if let Some(override_input) = override_input {
        merge_stats(&mut stats, &override_input.base_stats);
    }

    let hp = stats.get(hp_attr_key).copied().unwrap_or(0.0);

    Ok(CombatantState {
        stats,
        base_hero_stats,
        hp,
    })
}

fn build_default_stats(attribute_definitions: &[AttributeDefinition]) -> HashMap<String, f64> {
    attribute_definitions
        .iter()
        .map(|attribute| (attribute.attr_key.clone(), attribute.default_value.unwrap_or(0.0)))
        .collect()
}

fn merge_stats(target: &mut HashMap<String, f64>, source: &HashMap<String, f64>) {
    for (key, value) in source {
        *target.entry(key.clone()).or_insert(0.0) += value;
    }
}

fn parse_damage_type(raw: &str) -> DamageType {
    match raw {
        "magic" => DamageType::Magic,
        "true" => DamageType::True,
        _ => DamageType::Physical,
    }
}

fn apply_mitigation(raw_damage: f64, damage_type: DamageType, stats: &HashMap<String, f64>) -> f64 {
    if matches!(damage_type, DamageType::True) {
        return round_number(raw_damage);
    }
    let resistance_key = if matches!(damage_type, DamageType::Physical) {
        "armor"
    } else {
        "magic_resist"
    };
    let resistance = stats.get(resistance_key).copied().unwrap_or(0.0);
    let reduced = if resistance >= 0.0 {
        raw_damage * (100.0 / (100.0 + resistance))
    } else {
        raw_damage * (2.0 - 100.0 / (100.0 - resistance))
    };
    round_number(reduced)
}

fn resolve_base_damage(skill: &Skill, skill_level: u32) -> f64 {
    if !skill.params.base_damage_by_skill_level.is_empty() {
        let index = (skill_level.saturating_sub(1) as usize).min(skill.params.base_damage_by_skill_level.len() - 1);
        return skill.params.base_damage_by_skill_level[index];
    }
    skill.params.base_damage.unwrap_or(0.0)
}

fn build_action_label(skills_by_id: &HashMap<String, Skill>, plan: &EngineActionPlan) -> String {
    match plan {
        EngineActionPlan::BasicAttack { count, .. } => format!("\u{5e73}A x{count}"),
        EngineActionPlan::CastSkill {
            skill_id,
            cast_count,
            ..
        } => {
            let skill_name = skills_by_id
                .get(skill_id)
                .and_then(|skill| skill.name.clone())
                .unwrap_or_else(|| skill_id.clone());
            match cast_count {
                Some(count) if *count > 1 => format!("{skill_name} x{count}"),
                _ => skill_name,
            }
        }
    }
}

fn clamp_skill_level(value: u32) -> u32 {
    value.clamp(1, 5)
}

fn round_number(value: f64) -> f64 {
    (value * 1000.0).round() / 1000.0
}

fn invalid_input(message: impl Into<String>) -> EngineError {
    EngineError {
        code: ErrorCode::InvalidInput,
        message: message.into(),
    }
}

fn semantic_error(message: impl Into<String>) -> EngineError {
    EngineError {
        code: ErrorCode::SemanticError,
        message: message.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{BundleMeta, CombatantOverrides, EngineMeta, InitialCombatants, SkillParams, StopCondition};

    fn base_bundle() -> GameDataBundle {
        GameDataBundle {
            meta: BundleMeta {
                game_id: "lol".into(),
                version_id: 69,
                version_code: "mvp_katarina_001".into(),
                data_hash: "hash".into(),
                generated_at: "2026-03-22T08:22:06Z".into(),
            },
            attribute_definitions: vec![
                AttributeDefinition { attr_key: "hp".into(), default_value: Some(0.0) },
                AttributeDefinition { attr_key: "ad".into(), default_value: Some(0.0) },
                AttributeDefinition { attr_key: "ap".into(), default_value: Some(0.0) },
                AttributeDefinition { attr_key: "attack_speed".into(), default_value: Some(0.0) },
                AttributeDefinition { attr_key: "armor".into(), default_value: Some(0.0) },
                AttributeDefinition { attr_key: "magic_resist".into(), default_value: Some(0.0) },
            ],
            heroes: vec![
                Hero {
                    hero_id: "hero_katarina".into(),
                    name: "Katarina".into(),
                    title: None,
                    base_stats: HashMap::from([
                        ("hp".into(), 2508.0),
                        ("ad".into(), 112.4),
                        ("ap".into(), 0.0),
                        ("attack_speed".into(), 0.66),
                        ("armor".into(), 107.9),
                        ("magic_resist".into(), 66.85),
                    ]),
                },
                Hero {
                    hero_id: "hero_dummy".into(),
                    name: "Dummy".into(),
                    title: None,
                    base_stats: HashMap::from([
                        ("hp".into(), 10000.0),
                        ("ad".into(), 0.0),
                        ("ap".into(), 0.0),
                        ("attack_speed".into(), 0.0),
                        ("armor".into(), 100.0),
                        ("magic_resist".into(), 100.0),
                    ]),
                },
            ],
            items: vec![
                Item {
                    item_id: "item_blade_of_the_ruined_king".into(),
                    name: Some("BORK".into()),
                    stats_modifier: HashMap::from([
                        ("ad".into(), 55.0),
                        ("attack_speed".into(), 0.3),
                    ]),
                },
                Item {
                    item_id: "item_nashors_tooth".into(),
                    name: Some("Nashor".into()),
                    stats_modifier: HashMap::from([
                        ("ap".into(), 90.0),
                        ("attack_speed".into(), 0.5),
                    ]),
                },
            ],
            skills: vec![
                Skill {
                    skill_id: "skill_katarina_basic_attack".into(),
                    name: Some("Basic Attack".into()),
                    params: SkillParams {
                        damage_type: Some("physical".into()),
                        attack_ratio: Some(1.0),
                        ..Default::default()
                    },
                },
                Skill {
                    skill_id: "skill_katarina_r".into(),
                    name: Some("Death Lotus".into()),
                    params: SkillParams {
                        damage_type: Some("magic".into()),
                        hit_count: Some(15),
                        hit_interval_ms: Some(167),
                        channel_duration_ms: Some(2500),
                        base_damage_by_skill_level: vec![25.0, 37.5, 50.0],
                        ad_ratio: Some(0.16),
                        ap_ratio: Some(0.19),
                        bonus_attack_speed_ratio: Some(0.5),
                        default_skill_level: Some(3),
                        ..Default::default()
                    },
                },
            ],
        }
    }

    fn base_input(plan: EngineActionPlan, item_ids: Vec<String>) -> EngineRunInput {
        EngineRunInput {
            seed: None,
            stop: StopCondition { max_seconds: 10.0 },
            initial: InitialCombatants {
                self_actor: CombatantInit {
                    hero_id: "hero_katarina".into(),
                    level: Some(18),
                    item_ids,
                },
                enemy: CombatantInit {
                    hero_id: "hero_dummy".into(),
                    level: Some(1),
                    item_ids: vec![],
                },
            },
            overrides: Some(CombatantOverrides::default()),
            plan,
        }
    }

    fn session() -> EngineSession {
        init_session(EngineInitPayload {
            meta: EngineMeta {
                game_id: "lol".into(),
                version_id: 69,
                data_hash: "hash".into(),
            },
            bundle: base_bundle(),
            engine_config: None,
        })
        .unwrap()
    }

    #[test]
    fn item_stats_are_added_not_overwritten() {
        let session = session();

        let resolved = resolve_combatant(
            &session.catalog,
            &CombatantInit {
                hero_id: "hero_katarina".into(),
                level: Some(18),
                item_ids: vec![
                    "item_blade_of_the_ruined_king".into(),
                    "item_nashors_tooth".into(),
                ],
            },
            None,
            "hp",
        )
        .unwrap();

        assert_eq!(round_number(*resolved.stats.get("ad").unwrap()), 167.4);
        assert_eq!(round_number(*resolved.stats.get("ap").unwrap()), 90.0);
        assert_eq!(round_number(*resolved.stats.get("attack_speed").unwrap()), 1.46);
    }

    #[test]
    fn dual_items_increase_basic_attack_damage() {
        let session = session();

        let no_items = run(
            &session,
            base_input(
                EngineActionPlan::BasicAttack {
                    count: 10,
                    skill_id: Some("skill_katarina_basic_attack".into()),
                },
                vec![],
            ),
        )
        .unwrap();

        let dual_items = run(
            &session,
            base_input(
                EngineActionPlan::BasicAttack {
                    count: 10,
                    skill_id: Some("skill_katarina_basic_attack".into()),
                },
                vec![
                    "item_blade_of_the_ruined_king".into(),
                    "item_nashors_tooth".into(),
                ],
            ),
        )
        .unwrap();

        assert!(dual_items.result.total_damage_to_enemy > no_items.result.total_damage_to_enemy);
    }

    #[test]
    fn dual_items_increase_death_lotus_damage() {
        let session = session();

        let no_items = run(
            &session,
            base_input(
                EngineActionPlan::CastSkill {
                    skill_id: "skill_katarina_r".into(),
                    skill_level: Some(3),
                    cast_count: None,
                },
                vec![],
            ),
        )
        .unwrap();

        let dual_items = run(
            &session,
            base_input(
                EngineActionPlan::CastSkill {
                    skill_id: "skill_katarina_r".into(),
                    skill_level: Some(3),
                    cast_count: None,
                },
                vec![
                    "item_blade_of_the_ruined_king".into(),
                    "item_nashors_tooth".into(),
                ],
            ),
        )
        .unwrap();

        assert!(dual_items.result.total_damage_to_enemy > no_items.result.total_damage_to_enemy);
    }
}
