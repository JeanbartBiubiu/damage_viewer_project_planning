package xyz.game.datamanage.db;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * Static contract for {@code lol_generic_varus_chain_of_corruption_primary_hit_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericVarusChainOfCorruptionPrimaryHitSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_varus_chain_of_corruption_primary_hit_seed.sql";

    private static final String README_RELATIVE = "server/data_manage/README.md";

    private static final List<String> STABLE_IDS = List.of(
        "hero_varus",
        "provider_hero_varus_r_chain_of_corruption_primary_hit",
        "ability_hero_varus_r_chain_of_corruption_primary_hit",
        "chain_of_corruption",
        "phase_hero_varus_r_chain_of_corruption_primary_hit_impact",
        "sequence_hero_varus_r_chain_of_corruption_primary_hit_impact",
        "step_hero_varus_r_chain_of_corruption_primary_hit_damage",
        "cooldown_hero_varus_r_chain_of_corruption_primary_hit",
        "chain_of_corruption_damage",
        "r_mana_cost",
        "r_cooldown_ms",
        "hero_varus_r_chain_of_corruption_primary_hit");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20111, 20120, 20130, 20142, 20150, 20170, 20221, 20260);

    private static final List<String> FORBIDDEN_IDENTITY_PANEL_WRITES = List.of(
        "games",
        "game_entities",
        "attribute_definitions",
        "entity_attribute_values");

    private static final List<String> PRESERVED_PROVIDER_IDS = List.of(
        "provider_hero_varus_basic_attack",
        "provider_hero_varus_w_blighted_quiver_phase_a",
        "provider_hero_varus_e_hail_of_arrows_primary_hit");

    private static final String CHAIN_OF_CORRUPTION_DAMAGE =
        "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":350},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":1.00},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ap.resolved\"}]}]}";

    private static final String FROZEN_BOUNDARY =
        "rank3_primary_champion_single_hit; immediate_impact_scaffold; "
            + "magic_350_plus_1_00_ap; "
            + "no_cast_delay_projectile_travel_collision_geometry_direction_"
            + "root_reveal_blight_stack_schedule_tendril_seek_spread_or_multitarget";

    private static final String CANONICAL_SHA =
        "62b397cc7133a767427e00a1a5b435fcb3fd94b4ec5021be4a7869837683e4ed";

    private static final String LOCAL_RAW_SHA =
        "aa50685e07a4a974baa7f4a3bf43689f930dd20ac144fa03b72886daf8242207";

    private static final String TRIM_LF_SHA =
        "a5b638836ce4976afc3e79852655826b82ecb357f2c54d36a0c885202129b585";

    private static String sql;
    private static String sqlNoLineComments;
    private static String readme;

    @BeforeAll
    static void loadSeedSql() throws IOException {
        Path seedPath = resolveRelative(SEED_RELATIVE);
        assertTrue(Files.isRegularFile(seedPath), "seed sql missing: " + seedPath);
        sql = Files.readString(seedPath, StandardCharsets.UTF_8);
        sqlNoLineComments = stripLineComments(sql);
        Path readmePath = resolveRelative(README_RELATIVE);
        assertTrue(Files.isRegularFile(readmePath), "README missing: " + readmePath);
        readme = Files.readString(readmePath, StandardCharsets.UTF_8);
    }

    @Test
    void documentsSourceIdentityBoundaryTaskKeyAndLocalRawCaveat() {
        assertContains("hero_skill|hero_varus|R|腐败锁链");
        assertContains("wasm-generic-varus-chain-of-corruption-primary-hit");
        assertContains("varus-r-chain-of-corruption-primary-hit-phase-a-v1");
        assertContains("Template:Data Varus/R");
        assertContains("Template:Data Varus/Chain of Corruption");
        assertContains("1309977");
        assertContains("4008213");
        assertContains("2026-04-14T05:44:24Z");
        assertContains("5223");
        assertContains(CANONICAL_SHA);
        assertContains("5222");
        assertContains(LOCAL_RAW_SHA);
        assertContains("5221");
        assertContains(TRIM_LF_SHA);
        assertContains("local raw materialization caveat");
        assertTrue(
            sql.contains("trim") || sql.contains("末端 LF") || sql.contains("LF"),
            "seed comments must record trim-LF local raw materialization");
        assertTrue(
            sql.contains("sidecar/pages") || sql.contains("canonical 身份以"),
            "seed comments must record that sidecar/pages own canonical identity");
        assertTrue(
            sql.contains("不断言") || sql.contains("不等价") || sql.contains("no equivalence")
                || sql.contains("亦不主张源矛盾"),
            "seed comments must disclaim local-raw equivalence and source contradiction");
        assertContains("normalized/generic/varus-r.json");
        assertContains(FROZEN_BOUNDARY);
        assertTrue(
            sql.contains("raw550") && (sql.contains("mitigated275") || sql.contains("275")),
            "seed comments must document fixture raw550 / mitigated275");
        assertTrue(
            sql.contains("t0") && sql.contains("t59999") && sql.contains("t60000"),
            "seed comments must document cooldown timeline t0/t59999/t60000");
        assertTrue(
            sql.contains("mana300->100")
                || (sql.contains("mana300") && sql.contains("100")),
            "seed comments must document mana300->100");
        assertTrue(
            sql.contains("HP1000->450")
                || (sql.contains("1000") && sql.contains("450")),
            "seed comments must document HP1000->450");
        assertTrue(
            Pattern.compile("(?i)无截图|无.*OCR|screenshot|OCR").matcher(sql).find()
                && Pattern.compile("(?i)无截图|不含截图|无.*OCR|不.*OCR|without.*screenshot|"
                    + "no screenshot|无截图 / OCR")
                    .matcher(sql)
                    .find(),
            "seed comments must explicitly disclaim screenshot/OCR provenance");
        assertFalse(
            Pattern.compile("(?i)screenshot|ocr|截图识别|光学字符")
                .matcher(sqlNoLineComments)
                .find(),
            "executable SQL must not cite screenshot/OCR provenance");
        assertFalse(
            Pattern.compile("(?i)ddragon|data.?dragon")
                .matcher(sqlNoLineComments)
                .find(),
            "must not add DDragon provenance in executable SQL");
        assertContains("20260723");
    }

    @Test
    void usesTransactionLockCandidateAndIdempotentRevisionGuard() {
        assertTrue(sql.trim().startsWith("BEGIN;") || sql.contains("\nBEGIN;\n"), "must BEGIN");
        assertTrue(
            sql.trim().endsWith("COMMIT;")
                || sql.contains("\nCOMMIT;\n")
                || sql.endsWith("COMMIT;\n"),
            "must COMMIT");
        assertContains("DO $$");
        assertContains("ensure_game_partitions");
        assertContains("FOR UPDATE");
        assertContains("game_data_state");
        assertTrue(
            Pattern.compile("v_candidate\\s*:=\\s*v_locked_current\\s*\\+\\s*1")
                .matcher(sqlNoLineComments)
                .find(),
            "candidate must be locked current_revision + 1");
        assertTrue(
            Pattern.compile("(?is)IF\\s+v_changed\\s+THEN").matcher(sqlNoLineComments).find(),
            "must guard current_revision bump with v_changed");
        assertTrue(
            Pattern.compile("current_revision\\s*=\\s*v_candidate")
                .matcher(sqlNoLineComments)
                .find(),
            "must advance current_revision to candidate when changed");
        assertContains("ON CONFLICT");
        assertContains("IS DISTINCT FROM");
        assertTrue(
            Pattern.compile("change_revision\\s*>\\s*v_locked_current")
                .matcher(sqlNoLineComments)
                .find(),
            "match/link/mount idempotent guards must use change_revision > v_locked_current");
        assertFalse(sql.contains("versions:publish"), "seed must not auto-publish");
        assertFalse(
            Pattern.compile("(?i)\\bpublish_version\\b").matcher(sql).find(),
            "seed must not call publish helpers");
        assertFalse(
            Pattern.compile("(?i)\\bpublish\\s*\\(").matcher(sqlNoLineComments).find(),
            "seed must not call publish API markers");
        assertFalse(
            Pattern.compile("(?is)\\bcurrent_revision\\s*=\\s*\\d+")
                .matcher(sqlNoLineComments)
                .find(),
            "seed must not hardcode revision numbers");
    }

    @Test
    void rejectsDestructivePublishAndLegacySurfaces() {
        assertFalse(
            Pattern.compile("(?is)\\bDELETE\\s+FROM\\b").matcher(sqlNoLineComments).find(),
            "chain of corruption primary-hit seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoLineComments).find(),
            "chain of corruption primary-hit seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoLineComments).find(),
            "chain of corruption primary-hit seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "chain of corruption primary-hit seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "chain of corruption primary-hit seed must not CREATE TABLE");
        assertFalse(
            Pattern.compile("(?i)\\bbundle\\b").matcher(sqlNoLineComments).find(),
            "must not write Bundle surfaces");
        assertFalse(
            Pattern.compile("(?i)\\bcatalog\\b").matcher(sqlNoLineComments).find(),
            "must not write Catalog surfaces");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.(heroes|items|skills)\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write legacy heroes/items/skills tables");
    }

    @Test
    void validatesBatchBPrerequisitesWithoutRequiringEWAndEnsuresMana320() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("missing game_entities hero_varus");
        assertContains("missing attribute_definitions");
        assertContains("attr_key=ap");
        assertContains("missing entity_attribute_values hero_varus/ap");
        assertContains("lol_batch_b_adc_entities_seed.sql");
        assertTrue(
            sql.contains("Batch-B") || sql.contains("Batch-B prerequisite"),
            "seed must document Batch-B prerequisite");
        assertTrue(
            sql.contains("E / W seed **不是** 前置")
                || sql.contains("E/W 非前置")
                || sql.contains("不是** 前置")
                || (sql.contains("E / W") && sql.contains("不是") && sql.contains("前置")),
            "seed must state Varus E/W are not prerequisites");
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.game_entities\\b[\\s\\S]{0,200}"
                        + "entity_id\\s*=\\s*'hero_varus'")
                .matcher(sqlNoLineComments)
                .find(),
            "must SELECT/EXISTS-check game_entities hero_varus before graph writes");
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.attribute_definitions\\b[\\s\\S]{0,200}"
                        + "attr_key\\s*=\\s*'ap'")
                .matcher(sqlNoLineComments)
                .find(),
            "must SELECT/EXISTS-check attribute_definitions ap");
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.entity_attribute_values\\b[\\s\\S]{0,240}"
                        + "attr_key\\s*=\\s*'ap'")
                .matcher(sqlNoLineComments)
                .find(),
            "must SELECT/EXISTS-check entity_attribute_values hero_varus/ap");
        for (String table : FORBIDDEN_IDENTITY_PANEL_WRITES) {
            assertFalse(
                Pattern.compile(
                        "(?is)(?:INSERT\\s+INTO|UPDATE|MERGE\\s+INTO|DELETE\\s+FROM)\\s+"
                            + "public\\." + table + "\\b")
                    .matcher(sqlNoLineComments)
                    .find(),
                "must not INSERT/UPDATE/MERGE/DELETE public." + table
                    + " (SELECT/EXISTS checks are allowed)");
        }
        assertContains("INSERT INTO public.types");
        for (int typeId : REQUIRED_RESERVED) {
            assertContains(Integer.toString(typeId));
        }
        assertFalse(
            Pattern.compile(
                    "(?is)missing provider_hero_varus_e_hail_of_arrows|"
                        + "missing provider_hero_varus_w_blighted|"
                        + "hail_of_arrows.*prerequisite|"
                        + "blighted_quiver.*prerequisite|"
                        + "missing.*hail_of_arrows_primary_hit|"
                        + "missing.*blighted_quiver")
                .matcher(sqlNoLineComments)
                .find(),
            "must not require Varus E/W providers as hard prerequisites");
    }

    @Test
    void mountsDedicatedChainOfCorruptionPrimaryHitWithoutMutatingBasicWE() {
        assertContains("provider_hero_varus_r_chain_of_corruption_primary_hit");
        assertContains("hero_varus_r_chain_of_corruption_primary_hit");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_varus_r_chain_of_corruption_primary_hit'"
                        + "[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "Chain of Corruption primary-hit provider kind must be passive 20120");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_varus'\\s*,\\s*"
                        + "'provider_hero_varus_r_chain_of_corruption_primary_hit'")
                .matcher(sql)
                .find(),
            "must mount Chain of Corruption primary-hit provider to hero_varus");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.entity_provider_mounts"),
            "must mount exactly one dedicated Chain of Corruption primary-hit provider");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_definitions"),
            "must define exactly one provider (R Chain of Corruption primary-hit only)");
        Set<String> seen = new HashSet<>();
        for (String id : STABLE_IDS) {
            assertTrue(seen.add(id), "stable id list itself must be unique: " + id);
            assertContains(id);
        }
        for (String preserved : PRESERVED_PROVIDER_IDS) {
            assertTrue(
                sql.contains(preserved),
                "seed comments/guards must mention preserved provider: " + preserved);
            assertFalse(
                Pattern.compile("(?is)'" + Pattern.quote(preserved) + "'")
                    .matcher(sqlNoLineComments)
                    .find(),
                "must not write / replace preserved provider identity rows: " + preserved);
        }
        assertFalse(
            Pattern.compile(
                    "(?is)'ability_hero_varus_e_hail_of_arrows|"
                        + "'ability_hero_varus_w_blighted|"
                        + "'phase_hero_varus_e_|"
                        + "'phase_hero_varus_w_|"
                        + "'step_hero_varus_e_|"
                        + "'step_hero_varus_w_|"
                        + "'step_hero_varus_basic_attack|"
                        + "'listener_hero_varus")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write basic/W/E ability/listener/effect rows");
    }

    @Test
    void seedsActiveChainOfCorruptionWithMana100AndCooldown60000Ms() {
        assertContains("ability_hero_varus_r_chain_of_corruption_primary_hit");
        assertTrue(
            Pattern.compile(
                    "(?s)'ability_hero_varus_r_chain_of_corruption_primary_hit'\\s*,\\s*"
                        + "'provider_hero_varus_r_chain_of_corruption_primary_hit'\\s*,\\s*"
                        + "'chain_of_corruption'\\s*,\\s*20130")
                .matcher(sql)
                .find(),
            "R must be active ability with stable key chain_of_corruption");
        assertContains("r_mana_cost");
        assertContains("{\"op\":\"const\",\"value\":100}");
        assertContains("INSERT INTO public.ability_cooldowns");
        assertContains("cooldown_hero_varus_r_chain_of_corruption_primary_hit");
        assertContains("r_cooldown_ms");
        assertContains("{\"op\":\"const\",\"value\":60000}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cooldown_hero_varus_r_chain_of_corruption_primary_hit'\\s*,\\s*"
                        + "'ability_hero_varus_r_chain_of_corruption_primary_hit'\\s*,\\s*"
                        + "'r_cooldown_ms'\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "R cooldown must be 60000ms via ability_cooldowns");
    }

    @Test
    void seedsExactlyOneNullDurationImpactPhaseAndMagicApDamage() {
        assertContains(CHAIN_OF_CORRUPTION_DAMAGE);
        assertContains("source.attr.ap.resolved");
        assertContains("\"value\":350");
        assertContains("\"value\":1.00");
        assertFalse(
            Pattern.compile("(?is)source\\.attr\\.ad\\.(resolved|base)")
                .matcher(sqlNoLineComments)
                .find(),
            "executable formula must not use AD paths");
        assertFalse(
            Pattern.compile("(?is)source\\.attr\\.hp\\.")
                .matcher(sqlNoLineComments)
                .find(),
            "executable formula must not use HP paths");
        assertFalse(
            Pattern.compile("(?is)\\b20220\\b").matcher(sqlNoLineComments).find(),
            "executable SQL must not use physical damage type 20220");
        assertContains("phase_hero_varus_r_chain_of_corruption_primary_hit_impact");
        assertContains("sequence_hero_varus_r_chain_of_corruption_primary_hit_impact");
        assertContains("step_hero_varus_r_chain_of_corruption_primary_hit_damage");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.ability_phases"),
            "must define exactly one ability phase (null-duration impact)");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_varus_r_chain_of_corruption_primary_hit_impact'\\s*,\\s*"
                        + "'ability_hero_varus_r_chain_of_corruption_primary_hit'\\s*,\\s*"
                        + "0\\s*,\\s*20142\\s*,\\s*NULL\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "impact phase must be order 0 / type 20142 / null duration");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_varus_r_chain_of_corruption_primary_hit_impact'\\s*,\\s*"
                        + "20260\\s*,\\s*"
                        + "'sequence_hero_varus_r_chain_of_corruption_primary_hit_impact'")
                .matcher(sql)
                .find(),
            "impact phase must bind on_enter 20260 sequence");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_varus_r_chain_of_corruption_primary_hit_damage'\\s*,\\s*"
                        + "'sequence_hero_varus_r_chain_of_corruption_primary_hit_impact'\\s*,\\s*"
                        + "0\\s*,\\s*20150\\s*,\\s*20111\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "Chain of Corruption damage must be sole step order 0 to opponent");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_varus_r_chain_of_corruption_primary_hit_damage'\\s*,\\s*"
                        + "'chain_of_corruption_damage'\\s*,\\s*20221\\s*,\\s*20170\\s*,\\s*"
                        + "false")
                .matcher(sql)
                .find(),
            "Chain of Corruption damage must be magic 20221 add policy copyable_on_hit=false");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.damage_effect_details"),
            "must have exactly one damage_effect_details insert block");
        assertEquals(
            2,
            countOccurrences(
                sql, "'step_hero_varus_r_chain_of_corruption_primary_hit_damage'"),
            "damage step must appear in effect_steps and damage_effect_details only");
        assertFalse(
            Pattern.compile("(?i)crit_eligible\\s*=\\s*true").matcher(sqlNoLineComments).find(),
            "Chain of Corruption primary-hit must not enable crit eligibility");
        assertTrue(
            sql.contains("exactly-one-detail") || sql.contains("exactly one detail")
                || sql.contains("deferred exactly-one-detail"),
            "seed must document deferred exactly-one-detail pairing");
    }

    @Test
    void excludesRootRevealBlightTendrilSpreadAndForbiddenExecutableSurfaces() {
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.provider_listeners\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write provider_listeners");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.provider_state_fields\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write provider_state_fields");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.state_effect_details\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write state_effect_details");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.event_effect_details\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write event_effect_details");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.modifier_effect_details\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write modifier_effect_details");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.modifier_definitions\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write modifier_definitions");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.provider_modifiers\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write provider_modifiers");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.repeat_effect_details\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write repeat_effect_details");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.control_effect_details\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write control_effect_details");
        assertFalse(
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.(projectile|aoe)_effect_details\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write projectile/AOE effect detail surfaces");
        assertFalse(
            Pattern.compile(
                    "(?i)blight_stacks|blighted_quiver_active|tendril|"
                        + "root_duration|reveal_duration|"
                        + "cast.?duration|cast.?delay|"
                        + "phase_hero_varus_r_chain_of_corruption_primary_hit_cast|"
                        + "projectile|missile|travel|collision|geometry|direction|"
                        + "spell.?shield|interception|untargetable|"
                        + "basic_attack_hit|emit_event|equipment|loadout|runes|"
                        + "secondary.?infection|spread|"
                        + "\\brepeat\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "executable topology must not encode excluded R-scoped "
                + "listener/state/control/root/reveal/Blight/tendril/repeat/AOE surfaces");
        assertFalse(
            Pattern.compile("(?i)rank\\s*[12]\\b|ranks?\\s*=\\s*\\[|maxrank")
                .matcher(sqlNoLineComments)
                .find(),
            "must not model other ranks / rank tables");
        assertFalse(
            Pattern.compile("(?i)migration|live\\s+migration")
                .matcher(sqlNoLineComments)
                .find(),
            "must not include live migration");
        // Comments must still document the full exclusion wording.
        assertTrue(
            sql.contains("cast delay") || sql.contains("cast-delay")
                || sql.contains("Effect at cast time end"),
            "seed comments must document exclusion of cast delay / Effect at cast time end");
        assertTrue(
            sql.contains("projectile") || sql.contains("travel") || sql.contains("collision"),
            "seed comments must document exclusion of projectile/travel/collision");
        assertTrue(
            sql.contains("root") && sql.contains("reveal"),
            "seed comments must document exclusion of root/reveal");
        assertTrue(
            sql.contains("Blight") || sql.contains("blight"),
            "seed comments must document exclusion of Blight stack/schedule");
        assertTrue(
            sql.contains("0.65") && sql.contains("1.2") && sql.contains("1.75"),
            "seed comments must document Blight schedule 0.65/1.2/1.75s exclusion");
        assertTrue(
            sql.contains("tendril") || sql.contains("Tendril"),
            "seed comments must document exclusion of tendril seeking/spread");
        assertTrue(
            sql.contains("multitarget") || sql.contains("multi-target")
                || sql.contains("多目标"),
            "seed comments must document exclusion of multitarget");
        assertTrue(
            sql.contains("ranks 1–2") || sql.contains("ranks 1-2") || sql.contains("ranks1-2")
                || sql.contains("ranks 1–2"),
            "seed comments must document exclusion of ranks 1-2");
    }

    @Test
    void readmeEntryDocumentsBatchBPrereqManaEnsureAndNoEWDependency() {
        assertTrue(
            readme.contains("lol_generic_varus_chain_of_corruption_primary_hit_seed.sql"),
            "README must list the Varus R Chain of Corruption primary-hit seed");
        assertTrue(
            readme.contains("LolGenericVarusChainOfCorruptionPrimaryHitSeedSqlTest"),
            "README must list the focused JUnit class");
        int seedIdx =
            readme.indexOf("lol_generic_varus_chain_of_corruption_primary_hit_seed.sql");
        assertTrue(seedIdx >= 0, "seed path must appear in README");
        int sectionStart = readme.lastIndexOf("### ", seedIdx);
        int sectionEnd = readme.indexOf("\n### ", seedIdx);
        if (sectionEnd < 0) {
            sectionEnd = readme.length();
        }
        String section = readme.substring(sectionStart, sectionEnd);
        assertTrue(
            Pattern.compile("(?i)Batch-B|lol_batch_b_adc_entities_seed")
                .matcher(section)
                .find(),
            "README entry must list Batch-B prerequisite");
        assertTrue(
            Pattern.compile("(?i)reserved_types_seed").matcher(section).find(),
            "README entry must list reserved types prerequisite");
        assertTrue(
            Pattern.compile("(?i)E\\s*/\\s*W|E/W|Hail of Arrows|Blighted Quiver")
                .matcher(section)
                .find()
                && Pattern.compile("(?i)不是前置|非前置|不.*前置|not.*prerequisite|untouched|不触碰|保留")
                    .matcher(section)
                    .find(),
            "README entry must state Varus E/W are not prerequisites / remain untouched");
        assertTrue(
            Pattern.compile("(?i)不自动 publish|不会\\*\\*自动 publish|不负责 publish|no.*publish")
                .matcher(section)
                .find(),
            "README entry must not imply live execution or publication");
        assertTrue(
            section.contains(FROZEN_BOUNDARY) || section.contains("magic_350_plus_1_00_ap"),
            "README entry must document frozen Phase-A boundary");
    }

    private static String stripLineComments(String raw) {
        return Pattern.compile("(?m)--[^\\n]*").matcher(raw).replaceAll("");
    }

    private static int countOccurrences(String haystack, String needle) {
        int count = 0;
        int from = 0;
        while (true) {
            int idx = haystack.indexOf(needle, from);
            if (idx < 0) {
                return count;
            }
            count++;
            from = idx + needle.length();
        }
    }

    private static void assertContains(String needle) {
        assertTrue(sql.contains(needle), "seed sql must contain: " + needle);
    }

    private static Path resolveRelative(String relative) {
        Path cwd = Paths.get("").toAbsolutePath().normalize();
        List<Path> candidates = List.of(
            cwd.resolve("../../" + relative).normalize(),
            cwd.resolve("../" + relative).normalize(),
            cwd.resolve(relative).normalize());
        for (Path candidate : candidates) {
            if (Files.isRegularFile(candidate)) {
                return candidate;
            }
        }
        fail("unable to resolve " + relative + " from cwd=" + cwd);
        return null;
    }
}
