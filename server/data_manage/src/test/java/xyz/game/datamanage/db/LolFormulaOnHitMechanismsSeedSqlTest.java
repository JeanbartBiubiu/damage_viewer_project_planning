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
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * Static contract for {@code lol_formula_on_hit_mechanisms_seed.sql}.
 * Does not connect to a live database.
 */
class LolFormulaOnHitMechanismsSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_formula_on_hit_mechanisms_seed.sql";

    private static final List<String> PROVIDERS = List.of(
        "provider_hero_kogmaw_bio_arcane_barrage",
        "provider_hero_teemo_toxic_shot",
        "provider_item_3115_nashors",
        "provider_item_3302_terminus",
        "provider_item_3181_hullbreaker",
        "provider_item_3748_titanic_hydra");

    private static final List<String> LISTENERS = List.of(
        "listener_hero_kogmaw_bio_arcane_barrage",
        "listener_hero_teemo_toxic_shot",
        "listener_item_3115_nashors",
        "listener_item_3302_terminus",
        "listener_item_3181_hullbreaker",
        "listener_item_3748_titanic_hydra");

    private static final List<String> SEQUENCES = List.of(
        "sequence_hero_kogmaw_bio_arcane_barrage",
        "sequence_hero_teemo_toxic_shot",
        "sequence_item_3115_nashors",
        "sequence_item_3302_terminus",
        "sequence_item_3181_hullbreaker",
        "sequence_item_3748_titanic_hydra");

    private static final List<String> STABLE_IDS = List.of(
        "provider_hero_kogmaw_bio_arcane_barrage",
        "listener_hero_kogmaw_bio_arcane_barrage",
        "sequence_hero_kogmaw_bio_arcane_barrage",
        "step_hero_kogmaw_bio_arcane_barrage_damage",
        "kogmaw_bio_arcane_barrage_damage",
        "provider_hero_teemo_toxic_shot",
        "listener_hero_teemo_toxic_shot",
        "sequence_hero_teemo_toxic_shot",
        "step_hero_teemo_toxic_shot_damage",
        "teemo_toxic_shot_impact_damage",
        "provider_item_3115_nashors",
        "listener_item_3115_nashors",
        "sequence_item_3115_nashors",
        "step_item_3115_nashors_damage",
        "nashors_on_hit_damage",
        "provider_item_3302_terminus",
        "listener_item_3302_terminus",
        "sequence_item_3302_terminus",
        "step_item_3302_terminus_damage",
        "terminus_on_hit_damage",
        "provider_item_3181_hullbreaker",
        "listener_item_3181_hullbreaker",
        "sequence_item_3181_hullbreaker",
        "step_item_3181_hullbreaker_hit_add",
        "step_item_3181_hullbreaker_proc_damage",
        "step_item_3181_hullbreaker_hit_reset",
        "hullbreaker_hits",
        "hullbreaker_hit_add",
        "hullbreaker_proc_condition",
        "hullbreaker_proc_damage",
        "hullbreaker_hit_reset",
        "provider_item_3748_titanic_hydra",
        "listener_item_3748_titanic_hydra",
        "sequence_item_3748_titanic_hydra",
        "step_item_3748_titanic_hydra_damage",
        "titanic_hydra_primary_damage");

    private static String sql;

    @BeforeAll
    static void loadSeedSql() throws IOException {
        Path seedPath = resolveRelative(SEED_RELATIVE);
        assertTrue(Files.isRegularFile(seedPath), "seed sql missing: " + seedPath);
        sql = Files.readString(seedPath, StandardCharsets.UTF_8);
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
        assertContains("v_candidate := v_locked_current + 1");
        assertContains("IF v_changed THEN");
        assertContains("current_revision = v_candidate");
        assertContains("IS DISTINCT FROM");
        assertContains("ON CONFLICT");
        assertFalse(sql.contains("versions:publish"), "seed must not auto-publish");
        assertFalse(
            Pattern.compile("(?i)\\bpublish_version\\b").matcher(sql).find(),
            "seed must not call publish helpers");
    }

    @Test
    void doesNotDeleteRows() {
        assertFalse(
            Pattern.compile("(?is)\\bDELETE\\s+FROM\\b").matcher(sql).find(),
            "formula on-hit mechanisms seed must not DELETE");
    }

    @Test
    void validatesEntityEmitReservedAndAttributePrerequisites() {
        assertContains("missing reserved_type");
        assertContains("RAISE EXCEPTION");
        assertContains("INSERT INTO public.types");
        for (String entity : List.of(
            "hero_kogmaw", "hero_teemo", "item_3115", "item_3302", "item_3181", "item_3748")) {
            assertContains(entity);
        }
        assertContains("step_hero_teemo_basic_attack_emit_hit");
        assertContains("step_hero_kogmaw_basic_attack_emit_hit");
        assertContains("missing hero_teemo basic_attack_hit emit");
        assertContains("missing hero_kogmaw basic_attack_hit emit");
        assertContains("attr_key");
        assertTrue(
            sql.contains("'hp'") && sql.contains("'ad'") && sql.contains("'ap'"),
            "must guard hp/ad/ap attribute_definitions");
        for (int typeId : List.of(
            20100, 20110, 20111, 20120, 20150, 20160, 20170, 20172, 20181,
            20211, 20212, 20220, 20221, 20252)) {
            assertContains(Integer.toString(typeId));
        }
    }

    @Test
    void coreCountsAreSixProvidersMountsListenersTwelveMatchersSixSequences() {
        assertEquals(6, PROVIDERS.size());
        assertEquals(6, LISTENERS.size());
        assertEquals(6, SEQUENCES.size());
        for (String id : PROVIDERS) {
            assertContains(id);
        }
        for (String id : LISTENERS) {
            assertContains(id);
        }
        for (String id : SEQUENCES) {
            assertContains(id);
        }
        assertEquals(6, countOccurrences(sql, "INSERT INTO public.entity_provider_mounts"));
        assertEquals(6, countOccurrences(sql, "INSERT INTO public.provider_listeners"));
        assertEquals(6, countOccurrences(sql, "INSERT INTO public.listener_effect_sequences"));
        assertEquals(6, countOccurrences(sql, "INSERT INTO public.effect_sequences"));
        // 12 ALL matchers = six listeners × (20211 + 20212)
        assertEquals(12, countMatcherRows());
        // 8 steps: 5 single-damage + hullbreaker 3
        assertEquals(8, countAuthoredEffectSteps());
        assertEquals(1, countOccurrences(sql, "INSERT INTO public.provider_state_fields"));
        assertEquals(9, countProviderFormulaKeys());
    }

    @Test
    void mountsHeroProvidersToHeroesAndItemProvidersToItemsOnly() {
        assertTrue(
            Pattern.compile("(?s)'hero_kogmaw'\\s*,\\s*'provider_hero_kogmaw_bio_arcane_barrage'")
                .matcher(sql)
                .find(),
            "must mount kog provider to hero_kogmaw");
        assertTrue(
            Pattern.compile("(?s)'hero_teemo'\\s*,\\s*'provider_hero_teemo_toxic_shot'")
                .matcher(sql)
                .find(),
            "must mount teemo provider to hero_teemo");
        assertTrue(
            Pattern.compile("(?s)'item_3115'\\s*,\\s*'provider_item_3115_nashors'")
                .matcher(sql)
                .find(),
            "must mount nashors to item_3115");
        assertTrue(
            Pattern.compile("(?s)'item_3302'\\s*,\\s*'provider_item_3302_terminus'")
                .matcher(sql)
                .find(),
            "must mount terminus to item_3302");
        assertTrue(
            Pattern.compile("(?s)'item_3181'\\s*,\\s*'provider_item_3181_hullbreaker'")
                .matcher(sql)
                .find(),
            "must mount hullbreaker to item_3181");
        assertTrue(
            Pattern.compile("(?s)'item_3748'\\s*,\\s*'provider_item_3748_titanic_hydra'")
                .matcher(sql)
                .find(),
            "must mount titanic to item_3748");

        assertFalse(
            Pattern.compile("(?s)'hero_kogmaw'\\s*,\\s*'provider_item_")
                .matcher(sql)
                .find(),
            "must not mount item providers to hero_kogmaw");
        assertFalse(
            Pattern.compile("(?s)'hero_teemo'\\s*,\\s*'provider_item_")
                .matcher(sql)
                .find(),
            "must not mount item providers to hero_teemo");
        assertFalse(
            Pattern.compile("(?s)'item_3115'\\s*,\\s*'provider_hero_")
                .matcher(sql)
                .find(),
            "must not mount hero providers to item_3115");
    }

    @Test
    void sixListenersAllMatchBasicAttackHitAndSourceOwnerWithMaxTriggersOne() {
        for (String listener : LISTENERS) {
            assertTrue(
                Pattern.compile("(?s)'" + listener + "'\\s*,\\s*20181\\s*,\\s*20211")
                    .matcher(sql)
                    .find(),
                listener + " must ALL-match event/basic_attack_hit (20211)");
            assertTrue(
                Pattern.compile("(?s)'" + listener + "'\\s*,\\s*20181\\s*,\\s*20212")
                    .matcher(sql)
                    .find(),
                listener + " must ALL-match event/source_owner (20212)");
            assertTrue(
                Pattern.compile(
                        "(?s)'" + listener + "'\\s*,\\s*'[^']+'\\s*,\\s*'[^']+'\\s*,\\s*20211\\s*,\\s*NULL\\s*,\\s*1")
                    .matcher(sql)
                    .find(),
                listener + " must set max_triggers_per_event=1");
        }
    }

    @Test
    void kogmawUsesExactEntryTargetMaxHpMagicFormula() {
        String formula =
            "{\"op\":\"mul\",\"args\":[{\"op\":\"read\",\"path\":\"event.entry_target.attr.hp.max\"},{\"op\":\"const\",\"value\":0.06}]}";
        assertContains(formula);
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_kogmaw_bio_arcane_barrage_damage'\\s*,\\s*"
                        + "'kogmaw_bio_arcane_barrage_damage'\\s*,\\s*20221\\s*,\\s*20170")
                .matcher(sql)
                .find(),
            "kog damage detail must be magic with add policy");
    }

    @Test
    void teemoUsesExactSixtyFiveMagicWithoutDotOrApRatio() {
        assertContains("{\"op\":\"const\",\"value\":65}");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_teemo_toxic_shot_damage'\\s*,\\s*"
                        + "'teemo_toxic_shot_impact_damage'\\s*,\\s*20221\\s*,\\s*20170")
                .matcher(sql)
                .find(),
            "teemo damage detail must be magic with add policy");
        assertFalse(
            sql.contains("toxic_shot_dot")
                || sql.contains("toxic_shot_tick")
                || sql.contains("toxic_shot_refresh"),
            "must not declare toxic shot DoT/tick/refresh keys");
        assertFalse(
            Pattern.compile(
                    "(?s)'provider_hero_teemo_toxic_shot'\\s*,\\s*"
                        + "'teemo_toxic_shot_impact_damage'\\s*,\\s*'\\{[^']*ap")
                .matcher(sql)
                .find(),
            "teemo impact formula must not include AP");
    }

    @Test
    void nashorsUsesExactFifteenPlusApResolvedMagicFormula() {
        String formula =
            "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":15},{\"op\":\"mul\",\"args\":[{\"op\":\"read\",\"path\":\"event.entry_source.attr.ap.resolved\"},{\"op\":\"const\",\"value\":0.15}]}]}";
        assertContains(formula);
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3115_nashors_damage'\\s*,\\s*"
                        + "'nashors_on_hit_damage'\\s*,\\s*20221\\s*,\\s*20170")
                .matcher(sql)
                .find(),
            "nashors damage detail must be magic with add policy");
    }

    @Test
    void terminusUsesExactThirtyMagicWithoutLightDarkPenetration() {
        assertContains("{\"op\":\"const\",\"value\":30}");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3302_terminus_damage'\\s*,\\s*"
                        + "'terminus_on_hit_damage'\\s*,\\s*20221\\s*,\\s*20170")
                .matcher(sql)
                .find(),
            "terminus damage detail must be magic with add policy");
        assertFalse(
            sql.contains("terminus_light")
                || sql.contains("terminus_dark")
                || sql.contains("terminus_penetration")
                || sql.contains("terminus_shred")
                || sql.contains("light_dark"),
            "terminus batch must not encode light/dark/penetration/shred keys");
    }

    @Test
    void hullbreakerCountsEveryFifthHitWithRemoteApproxPhysicalFormula() {
        assertContains("provider_state_fields");
        assertContains("hullbreaker_hits");
        assertContains("provider.target_state.hullbreaker_hits");
        assertContains("DataDragon 16.9.1");
        assertContains("不宣称版本精确");

        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3181_hullbreaker_hit_add'\\s*,\\s*"
                        + "'sequence_item_3181_hullbreaker'\\s*,\\s*0\\s*,\\s*20160\\s*,\\s*20110")
                .matcher(sql)
                .find(),
            "hullbreaker hit_add must be order 0 state_change targeting self");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3181_hullbreaker_proc_damage'\\s*,\\s*"
                        + "'sequence_item_3181_hullbreaker'\\s*,\\s*1\\s*,\\s*20150\\s*,\\s*20111\\s*,\\s*"
                        + "'hullbreaker_proc_condition'")
                .matcher(sql)
                .find(),
            "hullbreaker proc damage must be order 1 damage with condition");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3181_hullbreaker_hit_reset'\\s*,\\s*"
                        + "'sequence_item_3181_hullbreaker'\\s*,\\s*2\\s*,\\s*20160\\s*,\\s*20110\\s*,\\s*"
                        + "'hullbreaker_proc_condition'")
                .matcher(sql)
                .find(),
            "hullbreaker hit_reset must be order 2 state_change with same condition");

        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3181_hullbreaker_hit_add'\\s*,\\s*20252\\s*,\\s*"
                        + "'hullbreaker_hits'\\s*,\\s*'hullbreaker_hit_add'\\s*,\\s*20170")
                .matcher(sql)
                .find(),
            "hullbreaker hit_add detail must use provider_target scope, add policy");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3181_hullbreaker_hit_reset'\\s*,\\s*20252\\s*,\\s*"
                        + "'hullbreaker_hits'\\s*,\\s*'hullbreaker_hit_reset'\\s*,\\s*20172")
                .matcher(sql)
                .find(),
            "hullbreaker hit_reset detail must use provider_target scope, override policy");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3181_hullbreaker_proc_damage'\\s*,\\s*"
                        + "'hullbreaker_proc_damage'\\s*,\\s*20220\\s*,\\s*20170")
                .matcher(sql)
                .find(),
            "hullbreaker proc damage detail must be physical with add policy");

        String procCondition =
            "{\"op\":\"gte\",\"args\":[{\"op\":\"read\",\"path\":\"provider.target_state.hullbreaker_hits\"},{\"op\":\"const\",\"value\":5}]}";
        assertContains(procCondition);
        String damage =
            "{\"op\":\"add\",\"args\":[{\"op\":\"mul\",\"args\":[{\"op\":\"read\",\"path\":\"event.entry_source.attr.ad.base\"},{\"op\":\"const\",\"value\":0.84}]},{\"op\":\"mul\",\"args\":[{\"op\":\"read\",\"path\":\"event.entry_source.attr.hp.max\"},{\"op\":\"const\",\"value\":0.035}]}]}";
        assertContains(damage);
    }

    @Test
    void titanicUsesExactSourceMaxHpRemotePrimaryPhysicalWithoutConeAoe() {
        String formula =
            "{\"op\":\"mul\",\"args\":[{\"op\":\"read\",\"path\":\"event.entry_source.attr.hp.max\"},{\"op\":\"const\",\"value\":0.005}]}";
        assertContains(formula);
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3748_titanic_hydra_damage'\\s*,\\s*"
                        + "'titanic_hydra_primary_damage'\\s*,\\s*20220\\s*,\\s*20170")
                .matcher(sql)
                .find(),
            "titanic damage detail must be physical with add policy");
        assertFalse(
            sql.contains("titanic_cone")
                || sql.contains("titanic_aoe")
                || sql.contains("titanic_cleave")
                || sql.contains("titanic_active_reset"),
            "titanic batch must not encode cone/AOE/active-reset mechanism keys");
    }

    @Test
    void liveFormulasUseOnlyAdApHpRoots() {
        assertContains("event.entry_source.attr.ad.base");
        assertContains("event.entry_source.attr.ap.resolved");
        assertContains("event.entry_source.attr.hp.max");
        assertContains("event.entry_target.attr.hp.max");
        // live formula paths must stay on ad/ap/hp roots (not legacy full names / ability params)
        assertFalse(
            Pattern.compile("\"path\":\"[^\"]*attack_damage[^\"]*\"").matcher(sql).find(),
            "formulas must not read attack_damage paths");
        assertFalse(
            Pattern.compile("\"path\":\"[^\"]*ability_power[^\"]*\"").matcher(sql).find(),
            "formulas must not read ability_power paths");
        assertFalse(
            Pattern.compile("\"path\":\"[^\"]*ability\\.param[^\"]*\"").matcher(sql).find(),
            "formulas must not read ability.param paths");
        assertFalse(sql.contains("ability_power"), "must not mention ability_power");
        assertFalse(sql.contains("ability.param"), "must not mention ability.param");
    }

    @Test
    void preservesExactlyOneDetailLayoutByConstruction() {
        assertTrue(
            sql.contains("exactly-one-detail") || sql.contains("exactly one detail")
                || sql.contains("deferred exactly-one-detail"),
            "seed must document deferred exactly-one-detail pairing");
        assertTrue(
            countOccurrences(sql, "'step_hero_kogmaw_bio_arcane_barrage_damage'") >= 2,
            "kog damage must pair step + damage detail");
        assertTrue(
            countOccurrences(sql, "'step_hero_teemo_toxic_shot_damage'") >= 2,
            "teemo damage must pair step + damage detail");
        assertTrue(
            countOccurrences(sql, "'step_item_3115_nashors_damage'") >= 2,
            "nashors damage must pair step + damage detail");
        assertTrue(
            countOccurrences(sql, "'step_item_3302_terminus_damage'") >= 2,
            "terminus damage must pair step + damage detail");
        assertTrue(
            countOccurrences(sql, "'step_item_3181_hullbreaker_hit_add'") >= 2,
            "hullbreaker hit_add must pair step + state detail");
        assertTrue(
            countOccurrences(sql, "'step_item_3181_hullbreaker_proc_damage'") >= 2,
            "hullbreaker proc_damage must pair step + damage detail");
        assertTrue(
            countOccurrences(sql, "'step_item_3181_hullbreaker_hit_reset'") >= 2,
            "hullbreaker hit_reset must pair step + state detail");
        assertTrue(
            countOccurrences(sql, "'step_item_3748_titanic_hydra_damage'") >= 2,
            "titanic damage must pair step + damage detail");
        assertTrue(sql.contains("state_effect_details"));
        assertTrue(sql.contains("damage_effect_details"));
        assertFalse(sql.contains("heal_effect_details"), "must not mix unrelated detail families");
    }

    @Test
    void relationRowsDoNotBumpRevisionOnContentlessConflict() {
        assertTrue(
            Pattern.compile(
                    "(?s)listener_match_types.*?WHERE public\\.listener_match_types\\.change_revision > v_locked_current")
                .matcher(sql)
                .find(),
            "listener_match_types must guard contentless conflict updates");
        assertTrue(
            Pattern.compile(
                    "(?s)listener_effect_sequences.*?WHERE public\\.listener_effect_sequences\\.change_revision > v_locked_current")
                .matcher(sql)
                .find(),
            "listener_effect_sequences must guard contentless conflict updates");
        assertTrue(
            Pattern.compile(
                    "(?s)entity_provider_mounts.*?WHERE public\\.entity_provider_mounts\\.change_revision > v_locked_current")
                .matcher(sql)
                .find(),
            "entity_provider_mounts must guard contentless conflict updates");
    }

    @Test
    void stableIdsAreUniqueEnoughToRerunSafely() {
        Set<String> seen = new HashSet<>();
        for (String id : STABLE_IDS) {
            assertTrue(seen.add(id), "stable id list itself must be unique: " + id);
            assertContains(id);
        }
        assertContains("ON CONFLICT");
        assertContains("IS DISTINCT FROM");
    }

    private static int countMatcherRows() {
        int count = 0;
        Matcher m =
            Pattern.compile(
                    "'listener_[^']+'\\s*,\\s*20181\\s*,\\s*2021[12]\\s*,\\s*v_candidate")
                .matcher(sql);
        while (m.find()) {
            count++;
        }
        return count;
    }

    private static int countAuthoredEffectSteps() {
        int count = 0;
        for (String stepId : List.of(
            "step_hero_kogmaw_bio_arcane_barrage_damage",
            "step_hero_teemo_toxic_shot_damage",
            "step_item_3115_nashors_damage",
            "step_item_3302_terminus_damage",
            "step_item_3181_hullbreaker_hit_add",
            "step_item_3181_hullbreaker_proc_damage",
            "step_item_3181_hullbreaker_hit_reset",
            "step_item_3748_titanic_hydra_damage")) {
            if (sql.contains("'" + stepId + "'")) {
                count++;
            }
        }
        return count;
    }

    private static int countProviderFormulaKeys() {
        int count = 0;
        for (String key : List.of(
            "kogmaw_bio_arcane_barrage_damage",
            "teemo_toxic_shot_impact_damage",
            "nashors_on_hit_damage",
            "terminus_on_hit_damage",
            "hullbreaker_hit_add",
            "hullbreaker_proc_condition",
            "hullbreaker_proc_damage",
            "hullbreaker_hit_reset",
            "titanic_hydra_primary_damage")) {
            if (sql.contains("'" + key + "'")) {
                count++;
            }
        }
        return count;
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
