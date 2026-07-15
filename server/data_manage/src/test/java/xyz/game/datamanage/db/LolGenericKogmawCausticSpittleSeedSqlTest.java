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
 * Static contract for {@code lol_generic_kogmaw_caustic_spittle_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericKogmawCausticSpittleSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_kogmaw_caustic_spittle_seed.sql";

    private static final List<String> STABLE_IDS = List.of(
        "provider_hero_kogmaw_caustic_spittle",
        "modifier_hero_kogmaw_caustic_spittle_attack_speed",
        "caustic_spittle_attack_speed");

    private static final List<Integer> REQUIRED_RESERVED = List.of(20110, 20120, 20173);

    private static final String AS_FORMULA = "{\"op\":\"const\",\"value\":0.25}";

    private static String sql;
    private static String sqlNoLineComments;

    @BeforeAll
    static void loadSeedSql() throws IOException {
        Path seedPath = resolveRelative(SEED_RELATIVE);
        assertTrue(Files.isRegularFile(seedPath), "seed sql missing: " + seedPath);
        sql = Files.readString(seedPath, StandardCharsets.UTF_8);
        sqlNoLineComments = stripLineComments(sql);
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
            "mount idempotent guard must use change_revision > v_locked_current");
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
            "caustic spittle seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoLineComments).find(),
            "caustic spittle seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoLineComments).find(),
            "caustic spittle seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "caustic spittle seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "caustic spittle seed must not CREATE TABLE");
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
    void validatesPrerequisitesWithoutRecreatingKogmawBaseline() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("hero_kogmaw");
        assertTrue(
            Pattern.compile("(?is)entity_id\\s*=\\s*'hero_kogmaw'")
                .matcher(sqlNoLineComments)
                .find(),
            "must preflight game_entities hero_kogmaw");
        assertTrue(
            Pattern.compile("(?is)attr_key\\s*=\\s*'attack_speed'")
                .matcher(sqlNoLineComments)
                .find(),
            "must preflight attribute_definitions attack_speed");
        for (int typeId : REQUIRED_RESERVED) {
            assertContains(Integer.toString(typeId));
        }
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.game_entities\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not recreate hero_kogmaw / game_entities");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.entity_attribute_values\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write entity_attribute_values");
        assertFalse(
            Pattern.compile("(?i)provider_hero_kogmaw_bio_arcane_barrage|bio_arcane|bio-arcane")
                .matcher(sqlNoLineComments)
                .find(),
            "must not touch W Bio-Arcane Barrage");
        assertFalse(
            Pattern.compile("(?i)provider_hero_kogmaw_basic_attack|basic_attack")
                .matcher(sqlNoLineComments)
                .find(),
            "must not recreate KogMaw basic attack");
    }

    @Test
    void mountsOnlyCausticSpittleProviderOnHeroKogmaw() {
        assertContains("provider_hero_kogmaw_caustic_spittle");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_kogmaw'\\s*,\\s*'provider_hero_kogmaw_caustic_spittle'")
                .matcher(sql)
                .find(),
            "must mount caustic spittle provider to hero_kogmaw");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_kogmaw_caustic_spittle'[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "provider kind must be passive 20120");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.entity_provider_mounts"),
            "must mount exactly once via entity_provider_mounts");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_definitions"),
            "must define exactly one provider");
    }

    @Test
    void rank5PassiveAttackSpeedUsesConst025AndPercentAdd() {
        assertContains(AS_FORMULA);
        assertContains("\"value\":0.25");
        assertContains("0.25");
        assertTrue(
            Pattern.compile(
                    "(?s)'modifier_hero_kogmaw_caustic_spittle_attack_speed'\\s*,\\s*"
                        + "'provider_hero_kogmaw_caustic_spittle'\\s*,\\s*"
                        + "'caustic_spittle_attack_speed'\\s*,\\s*"
                        + "NULL\\s*,\\s*"
                        + "20110\\s*,\\s*"
                        + "'attack_speed'[\\s\\S]*?"
                        + "20173\\s*,\\s*"
                        + "'caustic_spittle_attack_speed'")
                .matcher(sql)
                .find(),
            "modifier must target attack_speed with selector/self 20110 and percent_add 20173");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_formulas"),
            "must define exactly one provider_formulas insert");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_modifiers"),
            "must define exactly one provider_modifiers insert");
        for (String id : STABLE_IDS) {
            assertContains(id);
        }
    }

    @Test
    void excludesQActiveShredAbilityListenerStateEffectAndDamage() {
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.ability_definitions\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write ability_definitions");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.ability_phases\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write ability_phases");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.ability_costs\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write ability_costs");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.provider_state_fields\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write provider_state_fields");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.provider_listeners\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write provider_listeners");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.effect_sequences\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write effect_sequences");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.effect_steps\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write effect_steps");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.damage_effect_details\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write damage_effect_details");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.state_effect_details\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write state_effect_details");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.listener_match_types\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write listener_match_types");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.listener_effect_sequences\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write listener_effect_sequences");
        assertFalse(
            Pattern.compile(
                    "(?i)shred|击碎|magic.?damage|魔法伤害|cooldown|cast_condition|"
                        + "ability_hero_kogmaw_q|caustic_spittle_active|armor_shred|mr_shred")
                .matcher(sqlNoLineComments)
                .find(),
            "must not implement Q active / shred / cast / cooldown semantics");
        assertFalse(
            Pattern.compile("(?i)\\brng\\b|random|伪随机|概率").matcher(sqlNoLineComments).find(),
            "must not implement random/RNG semantics");
    }

    private static void assertEquals(int expected, int actual, String message) {
        org.junit.jupiter.api.Assertions.assertEquals(expected, actual, message);
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
