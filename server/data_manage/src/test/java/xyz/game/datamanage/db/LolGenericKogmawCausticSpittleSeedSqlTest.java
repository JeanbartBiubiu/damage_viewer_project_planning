package xyz.game.datamanage.db;

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
 * Static contract for {@code lol_generic_kogmaw_caustic_spittle_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericKogmawCausticSpittleSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_kogmaw_caustic_spittle_seed.sql";

    private static final List<String> STABLE_IDS = List.of(
        "provider_hero_kogmaw_caustic_spittle",
        "modifier_hero_kogmaw_caustic_spittle_attack_speed",
        "modifier_hero_kogmaw_caustic_spittle_armor",
        "modifier_hero_kogmaw_caustic_spittle_mr",
        "kogmaw_q_resist_reduction",
        "caustic_spittle_attack_speed",
        "caustic_spittle_armor_percent",
        "caustic_spittle_mr_percent",
        "caustic_spittle_damage",
        "resist_reduction_arm",
        "q_mana_cost",
        "q_cooldown_ms",
        "ability_hero_kogmaw_q_caustic_spittle",
        "cooldown_hero_kogmaw_q_caustic_spittle",
        "phase_hero_kogmaw_q_caustic_spittle_impact",
        "sequence_hero_kogmaw_q_caustic_spittle_impact",
        "step_hero_kogmaw_q_caustic_spittle_damage",
        "step_hero_kogmaw_q_caustic_spittle_resist_arm");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20100, 20110, 20111, 20113, 20120, 20130, 20142, 20150, 20160, 20170,
        20172, 20173, 20190, 20221, 20252, 20260);

    private static final String AS_FORMULA = "{\"op\":\"const\",\"value\":0.25}";

    private static final String DAMAGE_FORMULA =
        "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":260},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.90},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ap.resolved\"}]}]}";

    private static final String SHRED_FORMULA =
        "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":-0.32},"
            + "{\"op\":\"read\",\"path\":\"provider.target_state.kogmaw_q_resist_reduction\"}]}";

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
            "mount/link idempotent guard must use change_revision > v_locked_current");
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
        assertContains("missing attribute_definitions");
        assertContains("hero_kogmaw");
        assertTrue(
            Pattern.compile("(?is)entity_id\\s*=\\s*'hero_kogmaw'")
                .matcher(sqlNoLineComments)
                .find(),
            "must preflight game_entities hero_kogmaw");
        for (String attr : List.of(
            "attack_speed", "armor", "magic_resist", "ap", "mana")) {
            assertTrue(
                Pattern.compile("(?is)'" + attr + "'").matcher(sqlNoLineComments).find(),
                "must preflight attribute_definitions attr_key=" + attr);
        }
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
    }

    @Test
    void seedsProviderTargetResistStateAndTwoTargetShredModifiers() {
        assertContains("INSERT INTO public.provider_state_fields");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_kogmaw_caustic_spittle'\\s*,\\s*"
                        + "'kogmaw_q_resist_reduction'\\s*,\\s*"
                        + "20100\\s*,\\s*"
                        + "1\\s*,\\s*"
                        + "4000\\s*,\\s*"
                        + "20190")
                .matcher(sql)
                .find(),
            "state field must be max1 / 4000ms / refresh_on_write 20190");
        assertContains(SHRED_FORMULA);
        assertContains("provider.target_state.kogmaw_q_resist_reduction");
        assertTrue(
            Pattern.compile(
                    "(?s)'modifier_hero_kogmaw_caustic_spittle_armor'\\s*,\\s*"
                        + "'provider_hero_kogmaw_caustic_spittle'\\s*,\\s*"
                        + "'caustic_spittle_armor_percent'\\s*,\\s*"
                        + "NULL\\s*,\\s*"
                        + "20113\\s*,\\s*"
                        + "'armor'[\\s\\S]*?"
                        + "20173\\s*,\\s*"
                        + "'caustic_spittle_armor_percent'")
                .matcher(sql)
                .find(),
            "armor shred modifier must use selector/target 20113 and percent_add");
        assertTrue(
            Pattern.compile(
                    "(?s)'modifier_hero_kogmaw_caustic_spittle_mr'\\s*,\\s*"
                        + "'provider_hero_kogmaw_caustic_spittle'\\s*,\\s*"
                        + "'caustic_spittle_mr_percent'\\s*,\\s*"
                        + "NULL\\s*,\\s*"
                        + "20113\\s*,\\s*"
                        + "'magic_resist'[\\s\\S]*?"
                        + "20173\\s*,\\s*"
                        + "'caustic_spittle_mr_percent'")
                .matcher(sql)
                .find(),
            "MR shred modifier must use selector/target 20113 and percent_add");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_modifiers"),
            "must define modifiers in exactly one provider_modifiers insert");
    }

    @Test
    void seedsActiveQWithMana40Cooldown7000AndDamageThenStateOverride() {
        assertContains("INSERT INTO public.ability_definitions");
        assertTrue(
            Pattern.compile(
                    "(?s)'ability_hero_kogmaw_q_caustic_spittle'\\s*,\\s*"
                        + "'provider_hero_kogmaw_caustic_spittle'\\s*,\\s*"
                        + "'caustic_spittle'\\s*,\\s*20130")
                .matcher(sql)
                .find(),
            "Q must be active ability with stable key caustic_spittle");
        assertContains("{\"op\":\"const\",\"value\":40}");
        assertContains("INSERT INTO public.ability_cooldowns");
        assertContains("{\"op\":\"const\",\"value\":7000}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cooldown_hero_kogmaw_q_caustic_spittle'\\s*,\\s*"
                        + "'ability_hero_kogmaw_q_caustic_spittle'\\s*,\\s*"
                        + "'q_cooldown_ms'\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "Q cooldown must be 7000ms via ability_cooldowns");
        assertContains(DAMAGE_FORMULA);
        assertContains("source.attr.ap.resolved");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_kogmaw_q_caustic_spittle_damage'\\s*,\\s*"
                        + "'sequence_hero_kogmaw_q_caustic_spittle_impact'\\s*,\\s*0\\s*,\\s*"
                        + "20150\\s*,\\s*20111\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "damage must be step_order 0 to opponent");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_kogmaw_q_caustic_spittle_resist_arm'\\s*,\\s*"
                        + "'sequence_hero_kogmaw_q_caustic_spittle_impact'\\s*,\\s*1\\s*,\\s*"
                        + "20160\\s*,\\s*20110\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "state override must be step_order 1 after damage");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_kogmaw_q_caustic_spittle_damage'\\s*,\\s*"
                        + "'caustic_spittle_damage'\\s*,\\s*20221\\s*,\\s*20170\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "Q damage must be magic 20221 add policy copyable_on_hit=false");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_kogmaw_q_caustic_spittle_resist_arm'\\s*,\\s*"
                        + "20252\\s*,\\s*"
                        + "'kogmaw_q_resist_reduction'\\s*,\\s*"
                        + "'resist_reduction_arm'\\s*,\\s*"
                        + "20172")
                .matcher(sql)
                .find(),
            "state detail must override provider_target kogmaw_q_resist_reduction to 1");
        assertTrue(
            sql.contains("exactly-one-detail") || sql.contains("deferred exactly-one-detail"),
            "seed must document deferred exactly-one-detail pairing");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.provider_listeners\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write provider_listeners");
        assertFalse(
            Pattern.compile("(?i)\\brng\\b|random|伪随机|概率").matcher(sqlNoLineComments).find(),
            "must not implement random/RNG semantics");
    }

    @Test
    void citesWikiRevisionHashWithoutDdragonOrChampionStaticProvenance() {
        assertContains("Template:Data Kog'Maw/Caustic Spittle");
        assertContains("3960434");
        assertContains("f651035612e1deeda77df641f5a0e21226ec74aeb4633e0f211780efc3f39a7d");
        assertContains(
            "数据参考/lol-wiki-current-champions/normalized/generic/kogmaw-q.json");
        assertContains("数据参考/lol-wiki-current-champions/raw/kogmaw-q.wikitext");
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
            Pattern.compile("(?i)ddragon|data.?dragon|champion-static|KogMaw\\.json")
                .matcher(sqlNoLineComments)
                .find(),
            "must not use DDragon/champion-static numeric provenance");
        assertFalse(
            Pattern.compile("(?i)rank\\s*[1-4]\\b|ranks?\\s*=\\s*\\[|maxrank")
                .matcher(sqlNoLineComments)
                .find(),
            "must not model other ranks / rank tables");
        Set<String> seen = new HashSet<>();
        for (String id : STABLE_IDS) {
            assertTrue(seen.add(id), "stable id list itself must be unique: " + id);
            assertContains(id);
        }
        assertContains("ON CONFLICT");
        assertContains("IS DISTINCT FROM");
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
