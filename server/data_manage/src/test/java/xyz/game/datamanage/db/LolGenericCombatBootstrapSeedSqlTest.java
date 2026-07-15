package xyz.game.datamanage.db;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * Static contract for {@code lol_generic_combat_bootstrap_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericCombatBootstrapSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_combat_bootstrap_seed.sql";

    private static String sql;

    @BeforeAll
    static void loadSeedSql() throws IOException {
        Path path = resolveSeedSql();
        assertTrue(Files.isRegularFile(path), "seed sql missing: " + path);
        sql = Files.readString(path, StandardCharsets.UTF_8);
    }

    @Test
    void seedsBothEntitiesAndHpAttributeValues() {
        assertContains("hero_vayne");
        assertContains("target_dummy_fighter");
        assertContains("'hp'");
        assertContains("entity_attribute_values");
        assertContains("550");
        assertContains("3000");
    }

    @Test
    void seedsBasicAttackProviderAbilityPhaseSequenceStepDamageAndMount() {
        assertContains("provider_hero_vayne_basic_attack");
        assertContains("basic_attack_damage");
        assertContains("ability_hero_vayne_basic_attack");
        assertContains("phase_hero_vayne_basic_attack_impact");
        assertContains("sequence_hero_vayne_basic_attack_damage");
        assertContains("step_hero_vayne_basic_attack_damage");
        assertContains("damage_effect_details");
        assertContains("entity_provider_mounts");
        assertContains("ability_phase_effect_sequences");
        assertContains("\"$owner.attr.ad\"");
    }

    @Test
    void requiresReservedTypeKeysAndIds() {
        assertContains("selector/self");
        assertContains("selector/opponent");
        assertContains("provider_kind/passive");
        assertContains("ability_kind/active");
        assertContains("ability_phase/impact");
        assertContains("operation/damage");
        assertContains("value_policy/add");
        assertContains("damage/physical");
        assertContains("phase_trigger/on_enter");

        for (int typeId : List.of(20110, 20111, 20120, 20130, 20142, 20150, 20170, 20220, 20260)) {
            assertContains(Integer.toString(typeId));
        }

        assertFalse(sql.contains("entity/champion"), "must not seed entity/champion");
        assertFalse(sql.contains("entity/target_dummy"), "must not seed entity/target_dummy");
    }

    @Test
    void cleansUpLegacyEntityTypeRelationsExactly() {
        assertTrue(
            Pattern.compile(
                    "(?is)DELETE\\s+FROM\\s+public\\.type_relations\\s+"
                        + "WHERE\\s+game_id\\s*=\\s*v_game_id\\s+"
                        + "AND\\s+type_id\\s*=\\s*63001\\s+"
                        + "AND\\s+target_category\\s*=\\s*'entity'\\s+"
                        + "AND\\s+target_id\\s*=\\s*'hero_vayne'\\s*;")
                .matcher(sql)
                .find(),
            "must precisely DELETE type_relation 63001→hero_vayne");
        assertTrue(
            Pattern.compile(
                    "(?is)DELETE\\s+FROM\\s+public\\.type_relations\\s+"
                        + "WHERE\\s+game_id\\s*=\\s*v_game_id\\s+"
                        + "AND\\s+type_id\\s*=\\s*63002\\s+"
                        + "AND\\s+target_category\\s*=\\s*'entity'\\s+"
                        + "AND\\s+target_id\\s*=\\s*'target_dummy_fighter'\\s*;")
                .matcher(sql)
                .find(),
            "must precisely DELETE type_relation 63002→target_dummy_fighter");
        assertFalse(
            Pattern.compile("(?is)DELETE\\s+FROM\\s+public\\.types\\b").matcher(sql).find(),
            "must not DELETE types rows");
    }

    @Test
    void normalizesOutOfBoundChangeRevisionOnKnownBaselineTables() {
        assertContains("attribute_definitions");
        assertContains("change_revision > v_locked_current");
        assertTrue(
            sql.contains("UPDATE public.types")
                || sql.contains("UPDATE public.types t"),
            "must normalize types change_revision");
        assertTrue(
            sql.contains("UPDATE public.type_relations")
                || sql.contains("UPDATE public.type_relations tr"),
            "must normalize type_relations change_revision");
        assertContains("v_candidate");
        assertContains("current_revision = v_candidate");
        assertContains("IF v_changed THEN");
    }

    @Test
    void usesIdempotentUpsertGuards() {
        assertContains("IS DISTINCT FROM");
        assertContains("ON CONFLICT");
        assertContains("ensure_game_partitions");
        assertContains("FOR UPDATE");
        assertFalse(sql.contains("versions:publish"), "seed must not auto-publish");
        assertFalse(
            Pattern.compile("(?i)\\bpublish_version\\b").matcher(sql).find(),
            "seed must not call publish helpers");
    }

    @Test
    void doesNotReferenceLegacyOrBundleCatalogSurfaces() {
        assertNotContainsIgnoreCase("public.heroes");
        assertNotContainsIgnoreCase("public.items");
        assertNotContainsIgnoreCase("public.skills");
        assertNotContainsIgnoreCase("owner_categories");
        assertNotContainsIgnoreCase("bundle");
        assertNotContainsIgnoreCase("catalog");
        assertNotContainsIgnoreCase("single_attacker_dps");

        // Only the two precise type_relations cleanups may DELETE; no broad deletes.
        var deleteMatcher = Pattern.compile("(?is)\\bDELETE\\s+FROM\\b").matcher(sql);
        int deleteCount = 0;
        while (deleteMatcher.find()) {
            deleteCount++;
        }
        assertTrue(deleteCount == 2, "seed may only contain exactly 2 DELETE statements, found=" + deleteCount);
        assertFalse(
            Pattern.compile(
                    "(?is)DELETE\\s+FROM\\s+(?!public\\.type_relations\\b)\\S+")
                .matcher(sql)
                .find(),
            "DELETE target must be public.type_relations only");
        assertFalse(
            Pattern.compile("(?is)DELETE\\s+FROM\\s+public\\.type_relations\\s*;").matcher(sql).find(),
            "must not use bare DELETE FROM type_relations without exact WHERE");
        assertFalse(
            Pattern.compile(
                    "(?is)DELETE\\s+FROM\\s+public\\.type_relations\\s+"
                        + "WHERE\\s+(?!game_id\\s*=\\s*v_game_id\\s+"
                        + "AND\\s+type_id\\s*=\\s*6300[12]\\s+"
                        + "AND\\s+target_category\\s*=\\s*'entity'\\s+"
                        + "AND\\s+target_id\\s*=)")
                .matcher(sql)
                .find(),
            "type_relations DELETE must use exact PK predicates only");
    }

    private static void assertContains(String needle) {
        assertTrue(sql.contains(needle), "seed sql must contain: " + needle);
    }

    private static void assertNotContainsIgnoreCase(String needle) {
        assertFalse(
            Pattern.compile(Pattern.quote(needle), Pattern.CASE_INSENSITIVE).matcher(sql).find(),
            "seed sql must not contain: " + needle);
    }

    private static Path resolveSeedSql() {
        Path cwd = Paths.get("").toAbsolutePath().normalize();
        List<Path> candidates = List.of(
            cwd.resolve("../../" + SEED_RELATIVE).normalize(),
            cwd.resolve("../" + SEED_RELATIVE).normalize(),
            cwd.resolve(SEED_RELATIVE).normalize());
        for (Path candidate : candidates) {
            if (Files.isRegularFile(candidate)) {
                return candidate;
            }
        }
        fail("unable to resolve " + SEED_RELATIVE + " from cwd=" + cwd);
        return null;
    }
}
