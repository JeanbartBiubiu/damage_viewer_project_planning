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
 * Static contract for {@code lol_generic_teemo_blinding_dart_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericTeemoBlindingDartSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_teemo_blinding_dart_seed.sql";

    private static final List<String> STABLE_IDS = List.of(
        "hero_teemo",
        "provider_hero_teemo_q_blinding_dart",
        "ability_hero_teemo_q_blinding_dart",
        "blinding_dart",
        "phase_hero_teemo_q_blinding_dart_impact",
        "sequence_hero_teemo_q_blinding_dart_impact",
        "step_hero_teemo_q_blinding_dart_damage",
        "cost_hero_teemo_q_blinding_dart_mana",
        "cooldown_hero_teemo_q_blinding_dart",
        "blinding_dart_damage",
        "q_mana_cost",
        "q_cooldown_ms");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20111, 20120, 20130, 20142, 20150, 20170, 20221, 20260);

    private static final String BLINDING_DART_DAMAGE =
        "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":260},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.70},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ap.resolved\"}]}]}";

    private static final String FROZEN_BOUNDARY =
        "rank5_primary_target_single_hit; immediate_impact_scaffold; "
            + "magic_260_plus_0_70_ap; no_blind_cast_time_projectile_or_geometry";

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
    void documentsSourceIdentityRevisionHashAndFrozenBoundary() {
        assertContains("hero_skill|hero_teemo|Q|致盲吹箭");
        assertContains("teemo-q-blinding-dart-phase-a-v1");
        assertContains("Template:Data Teemo/Q");
        assertContains("Template:Data Teemo/Blinding Dart");
        assertContains("1308208");
        assertContains("3948425");
        assertContains("2025-08-19T15:37:23Z");
        assertContains("1639");
        assertContains("4e3c475ed55ec865f6a9060c8ad0b2665e5379b3ae7e9e5cb644f83212b240a7");
        assertContains("normalized/generic/teemo-q.json");
        assertContains(FROZEN_BOUNDARY);
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
            Pattern.compile("(?i)ddragon|data.?dragon").matcher(sqlNoLineComments).find(),
            "must not add DDragon provenance in executable SQL");
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
            "blinding dart seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoLineComments).find(),
            "blinding dart seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoLineComments).find(),
            "blinding dart seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "blinding dart seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "blinding dart seed must not CREATE TABLE");
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
            "hp", "mana", "ad", "ap", "attack_speed", "armor", "magic_resist",
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
    void ensuresSelfContainedHeroWithAp0Mana334WithoutOverwritingExistingProviders() {
        assertContains("hero_teemo");
        assertContains("INSERT INTO public.game_entities");
        assertContains("INSERT INTO public.entity_attribute_values");
        assertTrue(
            Pattern.compile(
                    "(?is)ON\\s+CONFLICT\\s*\\(\\s*game_id\\s*,\\s*entity_id\\s*\\)\\s*DO\\s+NOTHING")
                .matcher(sqlNoLineComments)
                .find(),
            "game_entities ensure must DO NOTHING on conflict (do not overwrite existing Teemo)");
        assertTrue(
            sql.contains("615") && sql.contains("334") && sql.contains("54")
                && sql.contains("0.69") && sql.contains("24") && sql.contains("30")
                && sql.contains("1.1") && sql.contains("1.92"),
            "must seed Teemo level-1 panel numbers aligned with Batch-B");
        assertTrue(
            Pattern.compile("(?s)'hero_teemo'\\s*,\\s*'ap'\\s*,\\s*0")
                .matcher(sql)
                .find(),
            "must seed ap base 0 (baseline resolved 0)");
        assertTrue(
            Pattern.compile("(?s)'mana'\\s*,\\s*'法力'\\s*,\\s*0\\s*,\\s*0")
                .matcher(sql)
                .find(),
            "must project resource_definitions.mana");
        assertTrue(
            Pattern.compile("(?s)'hero_teemo'\\s*,\\s*'mana'\\s*,\\s*334\\s*,\\s*334")
                .matcher(sql)
                .find(),
            "must seed entity_resource_values mana 334/334");
        assertFalse(
            Pattern.compile("(?is)'attack_range'|'move_speed'|'crit_chance'|'crit_damage'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not overwrite unrelated Batch-B attributes");
        assertTrue(
            sql.contains("provider_hero_teemo_basic_attack")
                && sql.contains("provider_hero_teemo_toxic_shot"),
            "seed must document coexistence with basic attack / Toxic Shot providers");
        assertFalse(
            Pattern.compile("(?is)'provider_hero_teemo_basic_attack'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write / replace basic attack provider identity rows");
        assertFalse(
            Pattern.compile("(?is)'provider_hero_teemo_toxic_shot'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write / replace Toxic Shot provider identity rows");
        assertFalse(
            Pattern.compile(
                    "(?is)'ability_hero_teemo_basic_attack'|"
                        + "'listener_hero_teemo_toxic_shot'|"
                        + "'step_hero_teemo_toxic_shot_damage'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write basic/Toxic Shot ability or effect rows");
    }

    @Test
    void mountsDedicatedBlindingDartProviderToHeroTeemo() {
        assertContains("provider_hero_teemo_q_blinding_dart");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_teemo_q_blinding_dart'[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "Blinding Dart provider kind must be passive 20120");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_teemo'\\s*,\\s*'provider_hero_teemo_q_blinding_dart'")
                .matcher(sql)
                .find(),
            "must mount Blinding Dart provider to hero_teemo");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.entity_provider_mounts"),
            "must mount exactly one dedicated Blinding Dart provider");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_definitions"),
            "must define exactly one provider (Q Blinding Dart only)");
    }

    @Test
    void seedsActiveBlindingDartWithMana90AndCooldown7000Ms() {
        assertContains("ability_hero_teemo_q_blinding_dart");
        assertTrue(
            Pattern.compile(
                    "(?s)'ability_hero_teemo_q_blinding_dart'\\s*,\\s*"
                        + "'provider_hero_teemo_q_blinding_dart'\\s*,\\s*"
                        + "'blinding_dart'\\s*,\\s*20130")
                .matcher(sql)
                .find(),
            "Q must be active ability with stable key blinding_dart");
        assertContains("cost_hero_teemo_q_blinding_dart_mana");
        assertContains("INSERT INTO public.ability_costs");
        assertContains("q_mana_cost");
        assertContains("{\"op\":\"const\",\"value\":90}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cost_hero_teemo_q_blinding_dart_mana'\\s*,\\s*"
                        + "'ability_hero_teemo_q_blinding_dart'\\s*,\\s*NULL\\s*,\\s*"
                        + "'mana'\\s*,\\s*'q_mana_cost'\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "Q mana cost must be ability-level 90 via ability_costs");
        assertContains("INSERT INTO public.ability_cooldowns");
        assertContains("cooldown_hero_teemo_q_blinding_dart");
        assertContains("q_cooldown_ms");
        assertContains("{\"op\":\"const\",\"value\":7000}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cooldown_hero_teemo_q_blinding_dart'\\s*,\\s*"
                        + "'ability_hero_teemo_q_blinding_dart'\\s*,\\s*"
                        + "'q_cooldown_ms'\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "Q cooldown must be 7000ms via ability_cooldowns");
    }

    @Test
    void seedsExactlyOneNullDurationImpactPhaseAndMagicDamage() {
        assertContains(BLINDING_DART_DAMAGE);
        assertContains("source.attr.ap.resolved");
        assertContains("\"value\":260");
        assertContains("\"value\":0.70");
        assertContains("phase_hero_teemo_q_blinding_dart_impact");
        assertContains("sequence_hero_teemo_q_blinding_dart_impact");
        assertContains("step_hero_teemo_q_blinding_dart_damage");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.ability_phases"),
            "must define exactly one ability phase (null-duration impact)");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_teemo_q_blinding_dart_impact'\\s*,\\s*"
                        + "'ability_hero_teemo_q_blinding_dart'\\s*,\\s*0\\s*,\\s*"
                        + "20142\\s*,\\s*NULL\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "impact phase must be order 0 / type 20142 / null duration");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_teemo_q_blinding_dart_impact'\\s*,\\s*20260\\s*,\\s*"
                        + "'sequence_hero_teemo_q_blinding_dart_impact'")
                .matcher(sql)
                .find(),
            "impact phase must bind on_enter 20260 sequence");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_teemo_q_blinding_dart_damage'\\s*,\\s*"
                        + "'sequence_hero_teemo_q_blinding_dart_impact'\\s*,\\s*0\\s*,\\s*"
                        + "20150\\s*,\\s*20111\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "Blinding Dart damage must be sole step order 0 to opponent");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_teemo_q_blinding_dart_damage'\\s*,\\s*"
                        + "'blinding_dart_damage'\\s*,\\s*20221\\s*,\\s*20170\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "Blinding Dart damage must be magic 20221 add policy copyable_on_hit=false");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.damage_effect_details"),
            "must have exactly one damage_effect_details insert block");
        assertEquals(
            2,
            countOccurrences(sql, "'step_hero_teemo_q_blinding_dart_damage'"),
            "damage step must appear in effect_steps and damage_effect_details only");
        assertFalse(
            Pattern.compile("(?i)crit_eligible\\s*=\\s*true").matcher(sqlNoLineComments).find(),
            "Blinding Dart must not enable crit eligibility");
        assertTrue(
            sql.contains("exactly-one-detail") || sql.contains("exactly one detail")
                || sql.contains("deferred exactly-one-detail"),
            "seed must document deferred exactly-one-detail pairing");
        Set<String> seen = new HashSet<>();
        for (String id : STABLE_IDS) {
            assertTrue(seen.add(id), "stable id list itself must be unique: " + id);
            assertContains(id);
        }
    }

    @Test
    void excludesBlindControlCastProjectileGeometryAndDestructiveHandling() {
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
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.modifier_definitions\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write modifier_definitions");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.event_effect_details\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write event_effect_details");
        assertFalse(
            Pattern.compile(
                    "(?i)cast.?duration|cast.?time|\"value\":\\s*0\\.25\\b|"
                        + "const\",\"value\":0\\.25|phase_hero_teemo_q_blinding_dart_cast")
                .matcher(sqlNoLineComments)
                .find(),
            "must not encode 0.25s cast phase or cast-duration formula");
        assertFalse(
            Pattern.compile(
                    "(?i)\\bblind\\b|致盲态|control|crowd.?control|\\bcc\\b|"
                        + "basic_attack_hit|emit_event|projectile|2500|"
                        + "geometry|collision|selection|multi.?target|多目标|"
                        + "repeat|equipment|loadout|toxic.?shot.?link|"
                        + "on.?hit.?coupl")
                .matcher(sqlNoLineComments)
                .find(),
            "must not model excluded blind/control/cast/projectile/geometry/"
                + "listener/equipment/Toxic Shot linkage surfaces");
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
            Pattern.compile("(?is)\\bDELETE\\s+FROM\\b").matcher(sqlNoLineComments).find(),
            "must not destructively replace basic/Toxic Shot rows");
        assertTrue(
            sql.contains("0.25") || sql.contains("250ms") || sql.contains("cast time"),
            "seed comments must document exclusion of Wiki 0.25s cast time");
        assertTrue(
            sql.contains("blind") || sql.contains("致盲") || sql.contains("2–3")
                || sql.contains("2-3"),
            "seed comments must document exclusion of blind/control duration");
        assertTrue(
            sql.contains("2500") || sql.contains("projectile"),
            "seed comments must document exclusion of projectile speed 2500");
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
