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
 * Static contract for {@code lol_generic_ashe_volley_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericAsheVolleySeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_ashe_volley_seed.sql";

    private static final List<String> STABLE_IDS = List.of(
        "hero_ashe",
        "provider_hero_ashe_w_volley",
        "ability_hero_ashe_w_volley",
        "volley",
        "phase_hero_ashe_w_volley_impact",
        "sequence_hero_ashe_w_volley_impact",
        "step_hero_ashe_w_volley_damage",
        "cost_hero_ashe_w_volley_mana",
        "cooldown_hero_ashe_w_volley",
        "volley_damage",
        "w_mana_cost",
        "w_cooldown_ms");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20111, 20120, 20130, 20142, 20150, 20170, 20220, 20260);

    private static final String VOLLEY_DAMAGE =
        "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":200},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":1.0},"
            + "{\"op\":\"sub\",\"args\":["
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.resolved\"},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.base\"}]}]}]}";

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
            "volley seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoLineComments).find(),
            "volley seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoLineComments).find(),
            "volley seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "volley seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "volley seed must not CREATE TABLE");
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
    void validatesPrerequisitesAndProjectsRequiredReservedTypes() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("missing attribute_definitions");
        assertContains("INSERT INTO public.types");
        assertContains("INSERT INTO public.resource_definitions");
        for (String attr : List.of(
            "hp", "mana", "ad", "attack_speed", "armor", "magic_resist",
            "hp_regen", "mana_regen")) {
            assertTrue(
                Pattern.compile("(?is)attr_key\\s*=\\s*'" + attr + "'")
                    .matcher(sqlNoLineComments)
                    .find()
                    || sql.contains("'" + attr + "'"),
                "must preflight or write attr_key=" + attr);
        }
        for (int typeId : REQUIRED_RESERVED) {
            assertContains(Integer.toString(typeId));
        }
    }

    @Test
    void ensuresSelfContainedHeroWithoutOverwritingRangersFocusGraph() {
        assertContains("hero_ashe");
        assertContains("INSERT INTO public.game_entities");
        assertContains("INSERT INTO public.entity_attribute_values");
        assertTrue(
            Pattern.compile(
                    "(?is)ON\\s+CONFLICT\\s*\\(\\s*game_id\\s*,\\s*entity_id\\s*\\)\\s*DO\\s+NOTHING")
                .matcher(sqlNoLineComments)
                .find(),
            "game_entities ensure must DO NOTHING on conflict (do not overwrite existing Ashe)");
        assertTrue(
            sql.contains("610") && sql.contains("280") && sql.contains("59")
                && sql.contains("0.658") && sql.contains("26") && sql.contains("30")
                && sql.contains("3.5") && sql.contains(", 7,"),
            "must seed Ashe level-1 panel numbers");
        assertTrue(
            Pattern.compile("(?s)'mana'\\s*,\\s*'法力'\\s*,\\s*0\\s*,\\s*0")
                .matcher(sql)
                .find(),
            "must project resource_definitions.mana");
        assertTrue(
            Pattern.compile("(?s)'hero_ashe'\\s*,\\s*'mana'\\s*,\\s*280\\s*,\\s*280")
                .matcher(sql)
                .find(),
            "must seed entity_resource_values mana 280/280");
        assertFalse(
            Pattern.compile("(?is)'provider_hero_ashe_rangers_focus'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write / update Ranger's Focus provider identity rows");
        assertFalse(
            Pattern.compile(
                    "(?is)'ability_hero_ashe_q_rangers_focus'|'ability_hero_ashe_basic_attack'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write Ranger's Focus / basic-attack ability rows");
        assertFalse(
            Pattern.compile("(?is)'focus_[1-4]'|'flurry_active'|'flurry_first'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write Focus/Flurry state keys");
    }

    @Test
    void mountsDedicatedVolleyProviderToHeroAshe() {
        assertContains("provider_hero_ashe_w_volley");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_ashe_w_volley'[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "Volley provider kind must be passive 20120");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_ashe'\\s*,\\s*'provider_hero_ashe_w_volley'")
                .matcher(sql)
                .find(),
            "must mount Volley provider to hero_ashe");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.entity_provider_mounts"),
            "must mount exactly one dedicated Volley provider");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_definitions"),
            "must define exactly one provider (W Volley only)");
    }

    @Test
    void seedsActiveVolleyWithMana55AndCooldown4000Ms() {
        assertContains("ability_hero_ashe_w_volley");
        assertTrue(
            Pattern.compile(
                    "(?s)'ability_hero_ashe_w_volley'\\s*,\\s*"
                        + "'provider_hero_ashe_w_volley'\\s*,\\s*"
                        + "'volley'\\s*,\\s*20130")
                .matcher(sql)
                .find(),
            "W must be active ability with stable key volley");
        assertContains("cost_hero_ashe_w_volley_mana");
        assertContains("INSERT INTO public.ability_costs");
        assertContains("w_mana_cost");
        assertContains("{\"op\":\"const\",\"value\":55}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cost_hero_ashe_w_volley_mana'\\s*,\\s*"
                        + "'ability_hero_ashe_w_volley'\\s*,\\s*NULL\\s*,\\s*"
                        + "'mana'\\s*,\\s*'w_mana_cost'\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "W mana cost must be ability-level 55 via ability_costs");
        assertContains("INSERT INTO public.ability_cooldowns");
        assertContains("cooldown_hero_ashe_w_volley");
        assertContains("w_cooldown_ms");
        assertContains("{\"op\":\"const\",\"value\":4000}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cooldown_hero_ashe_w_volley'\\s*,\\s*"
                        + "'ability_hero_ashe_w_volley'\\s*,\\s*"
                        + "'w_cooldown_ms'\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "W cooldown must be 4000ms via ability_cooldowns");
    }

    @Test
    void seedsExactlyOnePhysicalVolleyDamageWithBonusAdFormula() {
        assertContains(VOLLEY_DAMAGE);
        assertContains("source.attr.ad.resolved");
        assertContains("source.attr.ad.base");
        assertContains("\"value\":200");
        assertContains("\"value\":1.0");
        assertContains("phase_hero_ashe_w_volley_impact");
        assertContains("sequence_hero_ashe_w_volley_impact");
        assertContains("step_hero_ashe_w_volley_damage");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_ashe_w_volley_damage'\\s*,\\s*"
                        + "'sequence_hero_ashe_w_volley_impact'\\s*,\\s*0\\s*,\\s*"
                        + "20150\\s*,\\s*20111\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "Volley damage must be sole step order 0 to opponent");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_ashe_w_volley_damage'\\s*,\\s*"
                        + "'volley_damage'\\s*,\\s*20220\\s*,\\s*20170\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "Volley damage must be physical 20220 add policy copyable_on_hit=false");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.damage_effect_details"),
            "must have exactly one damage_effect_details insert block");
        assertEquals(
            2,
            countOccurrences(sql, "'step_hero_ashe_w_volley_damage'"),
            "damage step must appear in effect_steps and damage_effect_details only");
        assertFalse(
            Pattern.compile("(?i)crit_eligible\\s*=\\s*true").matcher(sqlNoLineComments).find(),
            "Volley must not enable crit eligibility");
        assertTrue(
            sql.contains("exactly-one-detail") || sql.contains("exactly one detail")
                || sql.contains("deferred exactly-one-detail"),
            "seed must document deferred exactly-one-detail pairing");
    }

    @Test
    void excludesSlowProjectileMultiTargetPerArrowOtherRanksAndMigration() {
        assertFalse(
            Pattern.compile(
                    "(?i)frost.?shot|冰霜射击|slow|减速|crowd.?control|控制态|"
                        + "projectile|飞行|cone|锥形|collision|碰撞|distance|距离|"
                        + "multi.?target|多目标|per.?arrow|arrow.?loop|箭矢循环")
                .matcher(sqlNoLineComments)
                .find(),
            "must not model excluded slow/projectile/multi-target/per-arrow surfaces");
        assertFalse(
            Pattern.compile("(?i)rank\\s*[1-4]\\b|ranks?\\s*=\\s*\\[|maxrank")
                .matcher(sqlNoLineComments)
                .find(),
            "must not model other ranks / rank tables");
        assertFalse(
            Pattern.compile(
                    "(?i)ability_hero_ashe_[qer]|rangers_focus|鹰击长空|魔法水晶箭|"
                        + "ability_hero_ashe_basic_attack")
                .matcher(sqlNoLineComments)
                .find(),
            "must not implement Q/E/R or rewrite basic-attack graph");
        assertFalse(
            Pattern.compile("(?i)migration|ALTER\\s+TABLE|live\\s+migration")
                .matcher(sqlNoLineComments)
                .find(),
            "must not include live migration");
    }

    @Test
    void citesWikiRevisionHashAndReviewedContractWithoutScreenshotOcr() {
        assertContains("Template:Data Ashe/Volley");
        assertContains("4007430");
        assertContains("7e12c2b27533ff696411e2eff05d7f5b5c9e3b1ad45f09e017df2a764abb5e28");
        assertContains(
            "数据参考/lol-wiki-current-champions/normalized/reviewed-contracts.json#ashe-w");
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
