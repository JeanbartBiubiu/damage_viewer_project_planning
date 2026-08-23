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
 * Static contract for {@code lol_generic_kaisa_supercharge_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericKaisaSuperchargeSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_kaisa_supercharge_seed.sql";

    private static final List<String> STABLE_IDS = List.of(
        "hero_kaisa",
        "provider_hero_kaisa_supercharge",
        "ability_hero_kaisa_e_supercharge",
        "supercharge",
        "cooldown_hero_kaisa_e_supercharge",
        "listener_hero_kaisa_e_supercharge_ability_started",
        "sequence_hero_kaisa_e_supercharge_arm",
        "step_hero_kaisa_e_supercharge_active_arm",
        "modifier_hero_kaisa_supercharge_attack_speed",
        "supercharge_active",
        "supercharge_active_arm",
        "supercharge_attack_speed",
        "e_mana_cost",
        "e_cooldown_ms");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20100, 20110, 20120, 20130, 20160, 20172, 20173, 20181, 20190, 20205,
        20212, 20250);

    private static final String AS_BONUS =
        "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.80},"
            + "{\"op\":\"read\",\"path\":\"provider.state.supercharge_active\"}]}";

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
            "supercharge seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoLineComments).find(),
            "supercharge seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoLineComments).find(),
            "supercharge seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "supercharge seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "supercharge seed must not CREATE TABLE");
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
    void validatesBatchBHeroKaisaAndRequiredAttrsWithoutRecreatingBaseline() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("missing attribute_definitions");
        assertContains("Batch-B prerequisite");
        assertTrue(
            Pattern.compile("(?is)entity_id\\s*=\\s*'hero_kaisa'")
                .matcher(sqlNoLineComments)
                .find(),
            "must preflight game_entities hero_kaisa");
        for (String attr : List.of("mana", "attack_speed")) {
            assertTrue(
                Pattern.compile("(?is)attr_key\\s*=\\s*'" + attr + "'")
                    .matcher(sqlNoLineComments)
                    .find()
                    || sql.contains("'" + attr + "'"),
                "must preflight attr_key=" + attr);
        }
        for (int typeId : REQUIRED_RESERVED) {
            assertContains(Integer.toString(typeId));
        }
        assertContains("INSERT INTO public.types");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.game_entities\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not recreate hero_kaisa / game_entities");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.entity_attribute_values\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write entity_attribute_values");
    }

    @Test
    void projectsManaResourceAndMountsIndependentSuperchargeProvider() {
        assertContains("provider_hero_kaisa_supercharge");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_kaisa'\\s*,\\s*'provider_hero_kaisa_supercharge'")
                .matcher(sql)
                .find(),
            "must mount supercharge provider to hero_kaisa");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_kaisa_supercharge'[\\s\\S]{0,80}20120")
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
    void seedsActiveAbilityManaCostAndTenSecondCooldown() {
        assertContains("ability_hero_kaisa_e_supercharge");
        assertTrue(
            Pattern.compile(
                    "(?s)'ability_hero_kaisa_e_supercharge'\\s*,\\s*"
                        + "'provider_hero_kaisa_supercharge'\\s*,\\s*"
                        + "'supercharge'\\s*,\\s*20130")
                .matcher(sql)
                .find(),
            "E must be active ability with stable key supercharge");
        assertContains("e_mana_cost");
        assertContains("{\"op\":\"const\",\"value\":30}");
        assertContains("cooldown_hero_kaisa_e_supercharge");
        assertContains("INSERT INTO public.ability_cooldowns");
        assertContains("e_cooldown_ms");
        assertContains("{\"op\":\"const\",\"value\":10000}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cooldown_hero_kaisa_e_supercharge'\\s*,\\s*"
                        + "'ability_hero_kaisa_e_supercharge'\\s*,\\s*"
                        + "'e_cooldown_ms'\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "E cooldown must be 10000ms via ability_cooldowns");
    }

    @Test
    void definesTimedSuperchargeActiveAndStateDrivenAttackSpeedPercentAdd() {
        assertTrue(
            Pattern.compile(
                    "(?s)'supercharge_active'[\\s\\S]{0,40}20100[\\s\\S]{0,20}1"
                        + "[\\s\\S]{0,20}4000[\\s\\S]{0,20}20190")
                .matcher(sql)
                .find(),
            "supercharge_active max1 / 4000ms / refresh_duration");
        assertFalse(
            Pattern.compile("(?i)default_value").matcher(sqlNoLineComments).find(),
            "seed must not write default_value");
        assertContains(AS_BONUS);
        assertContains("\"value\":0.80");
        assertContains("20173");
        assertTrue(
            Pattern.compile(
                    "(?s)'modifier_hero_kaisa_supercharge_attack_speed'[\\s\\S]{0,300}"
                        + "'attack_speed'[\\s\\S]{0,120}20173\\s*,\\s*"
                        + "'supercharge_attack_speed'\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "AS modifier must be percent_add with NULL condition_formula_key");
    }

    @Test
    void abilityStartedListenerArmsSuperchargeForSameAbilityAndSourceOwner() {
        assertContains("listener_hero_kaisa_e_supercharge_ability_started");
        assertContains("sequence_hero_kaisa_e_supercharge_arm");
        assertContains("step_hero_kaisa_e_supercharge_active_arm");
        assertTrue(
            sql.contains("充能完成") || sql.contains("charge"),
            "seed must document ability_started as charge-complete approximation");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_hero_kaisa_e_supercharge_ability_started'\\s*,\\s*"
                        + "'provider_hero_kaisa_supercharge'\\s*,\\s*"
                        + "'supercharge_on_ability_started'\\s*,\\s*20205\\s*,\\s*"
                        + "'ability_hero_kaisa_e_supercharge'")
                .matcher(sql)
                .find(),
            "listener must bind ability_started to the same E ability");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_hero_kaisa_e_supercharge_ability_started'\\s*,\\s*"
                        + "20181\\s*,\\s*20205")
                .matcher(sql)
                .find(),
            "ability_started listener must ALL-match 20205");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_hero_kaisa_e_supercharge_ability_started'\\s*,\\s*"
                        + "20181\\s*,\\s*20212")
                .matcher(sql)
                .find(),
            "ability_started listener must ALL-match 20212 source_owner");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_kaisa_e_supercharge_active_arm'\\s*,\\s*20250\\s*,\\s*"
                        + "'supercharge_active'\\s*,\\s*'supercharge_active_arm'\\s*,\\s*"
                        + "20172")
                .matcher(sql)
                .find(),
            "listener sequence must arm supercharge_active=1");
        assertTrue(
            sql.contains("exactly-one-detail") || sql.contains("exactly one detail")
                || sql.contains("deferred exactly-one-detail"),
            "seed must document deferred exactly-one-detail pairing");
        assertTrue(
            countOccurrences(sql, "'step_hero_kaisa_e_supercharge_active_arm'") >= 2,
            "arm step must appear in effect_steps and state_effect_details");
    }

    @Test
    void excludesMoveGhostWindupAaRefundStealthDamageOtherRanksAndCastScheduler() {
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.ability_phases\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write ability_phases / cast-time scheduler");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.damage_effect_details\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write damage_effect_details");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.event_effect_details\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write event_effect_details");
        assertFalse(
            Pattern.compile(
                    "(?i)move_speed|移速|ghost|幽灵|attack.?windup|windup|"
                        + "cooldown.?refund|普攻减\\s*CD|aa.?cd|attack.?speed.?refund|"
                        + "stealth|隐身|evolve|进化|"
                        + "shred|击碎|cast.?time|charge.?scheduler|充能定时|"
                        + "ability_hero_kaisa_[qwr]|基本攻击减")
                .matcher(sqlNoLineComments)
                .find(),
            "must not model excluded Supercharge surfaces");
        assertFalse(
            Pattern.compile("(?i)rank\\s*[1-4]\\b|ranks?\\s*=\\s*\\[|maxrank")
                .matcher(sqlNoLineComments)
                .find(),
            "must not model other ranks / rank tables");
        assertFalse(
            Pattern.compile("(?i)migration|live\\s+migration")
                .matcher(sqlNoLineComments)
                .find(),
            "must not include live migration");
        assertFalse(
            Pattern.compile("(?i)basic_attack|provider_hero_kaisa_basic")
                .matcher(sqlNoLineComments)
                .find(),
            "must not recreate Kai'Sa basic attack");
    }

    @Test
    void citesWikiRevisionHashAndValidatesStableIds() {
        assertContains("Template:Data Kai'Sa/Supercharge");
        assertContains("4038391");
        assertContains("327dc441e84bf2b320dccbe9099b4e98bf42562529e95facd417fbbc27d99e24");
        assertContains(
            "数据参考/lol-wiki-current-champions/normalized/generic/kaisa-e.json");
        assertFalse(
            Pattern.compile("(?i)merakianalytics|Kaisa\\.json|ddragon|Data Dragon")
                .matcher(sqlNoLineComments)
                .find(),
            "must not cite Meraki/DDragon as active numeric provenance");
        assertFalse(
            Pattern.compile("(?i)merakianalytics|Kaisa\\.json")
                .matcher(sql)
                .find(),
            "seed comments must not retain Meraki/Kaisa.json provenance");
        assertFalse(
            Pattern.compile("(?i)Data Dragon")
                .matcher(sql)
                .find(),
            "seed comments must not cite Data Dragon as numeric provenance");
        assertContains("missing reserved_type");
        Set<String> seen = new HashSet<>();
        for (String id : STABLE_IDS) {
            assertTrue(seen.add(id), "stable id list itself must be unique: " + id);
            assertContains(id);
        }
        assertContains("ON CONFLICT");
        assertContains("IS DISTINCT FROM");
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
