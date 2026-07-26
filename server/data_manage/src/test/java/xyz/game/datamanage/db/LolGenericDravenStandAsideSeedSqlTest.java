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
 * Static contract for {@code lol_generic_draven_stand_aside_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericDravenStandAsideSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_draven_stand_aside_seed.sql";

    private static final List<String> STABLE_IDS = List.of(
        "hero_draven",
        "provider_hero_draven_e_stand_aside",
        "ability_hero_draven_e_stand_aside",
        "stand_aside",
        "phase_hero_draven_e_stand_aside_impact",
        "sequence_hero_draven_e_stand_aside_impact",
        "step_hero_draven_e_stand_aside_damage",
        "cost_hero_draven_e_stand_aside_mana",
        "cooldown_hero_draven_e_stand_aside",
        "stand_aside_damage",
        "e_mana_cost",
        "e_cooldown_ms");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20111, 20120, 20130, 20142, 20150, 20170, 20220, 20260);

    private static final String STAND_ASIDE_DAMAGE =
        "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":215},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.50},"
            + "{\"op\":\"sub\",\"args\":["
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.resolved\"},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.base\"}]}]}]}";

    private static final String FROZEN_BOUNDARY =
        "rank5_primary_target_single_hit; immediate_impact_scaffold; "
            + "physical_215_plus_0_50_bonus_ad; no_cast_time_control_geometry_or_multitarget";

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
        assertContains("hero_skill|hero_draven|E|开道利斧");
        assertContains("draven-e-stand-aside-phase-a-v2");
        assertContains("Template:Data Draven/Stand Aside");
        assertContains("1307070");
        assertContains("4034694");
        assertContains("2026-06-23T21:12:57Z");
        assertContains("1168");
        assertContains("7bb6ebdc19413ef908e78fea01576d1184a66bc62fd6148120845573c1468e8d");
        assertContains("normalized/generic/draven-e.json");
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
            "stand aside seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoLineComments).find(),
            "stand aside seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoLineComments).find(),
            "stand aside seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "stand aside seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "stand aside seed must not CREATE TABLE");
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
    void ensuresSelfContainedHeroWithoutOverwritingQwOrBasicProviders() {
        assertContains("hero_draven");
        assertContains("INSERT INTO public.game_entities");
        assertContains("INSERT INTO public.entity_attribute_values");
        assertTrue(
            Pattern.compile(
                    "(?is)ON\\s+CONFLICT\\s*\\(\\s*game_id\\s*,\\s*entity_id\\s*\\)\\s*DO\\s+NOTHING")
                .matcher(sqlNoLineComments)
                .find(),
            "game_entities ensure must DO NOTHING on conflict (do not overwrite existing Draven)");
        assertTrue(
            sql.contains("675") && sql.contains("361") && sql.contains("62")
                && sql.contains("0.679") && sql.contains("29") && sql.contains("30")
                && sql.contains("3.75") && sql.contains("8.05"),
            "must seed Draven level-1 panel numbers");
        assertTrue(
            Pattern.compile("(?s)'mana'\\s*,\\s*'法力'\\s*,\\s*0\\s*,\\s*0")
                .matcher(sql)
                .find(),
            "must project resource_definitions.mana");
        assertTrue(
            Pattern.compile("(?s)'hero_draven'\\s*,\\s*'mana'\\s*,\\s*361\\s*,\\s*361")
                .matcher(sql)
                .find(),
            "must seed entity_resource_values mana 361/361");
        assertTrue(
            sql.contains("provider_hero_draven_q_spinning_axe")
                && sql.contains("provider_hero_draven_w_blood_rush")
                && sql.contains("provider_hero_draven_basic_attack"),
            "seed must document coexistence with Q / W / basic attack providers");
        assertFalse(
            Pattern.compile("(?is)'provider_hero_draven_q_spinning_axe'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write Q Spinning Axe provider identity rows");
        assertFalse(
            Pattern.compile("(?is)'provider_hero_draven_w_blood_rush'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write W Blood Rush provider identity rows");
        assertFalse(
            Pattern.compile("(?is)'provider_hero_draven_basic_attack'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write / replace basic attack provider identity rows");
        assertFalse(
            Pattern.compile(
                    "(?is)'ability_hero_draven_q_spinning_axe'|"
                        + "'ability_hero_draven_w_blood_rush'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write Q/W ability rows");
    }

    @Test
    void mountsDedicatedStandAsideProviderToHeroDraven() {
        assertContains("provider_hero_draven_e_stand_aside");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_draven_e_stand_aside'[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "Stand Aside provider kind must be passive 20120");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_draven'\\s*,\\s*'provider_hero_draven_e_stand_aside'")
                .matcher(sql)
                .find(),
            "must mount Stand Aside provider to hero_draven");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.entity_provider_mounts"),
            "must mount exactly one dedicated Stand Aside provider");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_definitions"),
            "must define exactly one provider (E Stand Aside only)");
    }

    @Test
    void seedsActiveStandAsideWithMana70AndCooldown12000Ms() {
        assertContains("ability_hero_draven_e_stand_aside");
        assertTrue(
            Pattern.compile(
                    "(?s)'ability_hero_draven_e_stand_aside'\\s*,\\s*"
                        + "'provider_hero_draven_e_stand_aside'\\s*,\\s*"
                        + "'stand_aside'\\s*,\\s*20130")
                .matcher(sql)
                .find(),
            "E must be active ability with stable key stand_aside");
        assertContains("cost_hero_draven_e_stand_aside_mana");
        assertContains("INSERT INTO public.ability_costs");
        assertContains("e_mana_cost");
        assertContains("{\"op\":\"const\",\"value\":70}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cost_hero_draven_e_stand_aside_mana'\\s*,\\s*"
                        + "'ability_hero_draven_e_stand_aside'\\s*,\\s*NULL\\s*,\\s*"
                        + "'mana'\\s*,\\s*'e_mana_cost'\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "E mana cost must be ability-level 70 via ability_costs");
        assertContains("INSERT INTO public.ability_cooldowns");
        assertContains("cooldown_hero_draven_e_stand_aside");
        assertContains("e_cooldown_ms");
        assertContains("{\"op\":\"const\",\"value\":12000}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cooldown_hero_draven_e_stand_aside'\\s*,\\s*"
                        + "'ability_hero_draven_e_stand_aside'\\s*,\\s*"
                        + "'e_cooldown_ms'\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "E cooldown must be 12000ms via ability_cooldowns");
    }

    @Test
    void seedsExactlyOneNullDurationImpactPhaseAndPhysicalDamage() {
        assertContains(STAND_ASIDE_DAMAGE);
        assertContains("source.attr.ad.resolved");
        assertContains("source.attr.ad.base");
        assertContains("\"value\":215");
        assertContains("\"value\":0.50");
        assertContains("phase_hero_draven_e_stand_aside_impact");
        assertContains("sequence_hero_draven_e_stand_aside_impact");
        assertContains("step_hero_draven_e_stand_aside_damage");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.ability_phases"),
            "must define exactly one ability phase (null-duration impact)");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_draven_e_stand_aside_impact'\\s*,\\s*"
                        + "'ability_hero_draven_e_stand_aside'\\s*,\\s*0\\s*,\\s*"
                        + "20142\\s*,\\s*NULL\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "impact phase must be order 0 / type 20142 / null duration");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_draven_e_stand_aside_impact'\\s*,\\s*20260\\s*,\\s*"
                        + "'sequence_hero_draven_e_stand_aside_impact'")
                .matcher(sql)
                .find(),
            "impact phase must bind on_enter 20260 sequence");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_draven_e_stand_aside_damage'\\s*,\\s*"
                        + "'sequence_hero_draven_e_stand_aside_impact'\\s*,\\s*0\\s*,\\s*"
                        + "20150\\s*,\\s*20111\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "Stand Aside damage must be sole step order 0 to opponent");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_draven_e_stand_aside_damage'\\s*,\\s*"
                        + "'stand_aside_damage'\\s*,\\s*20220\\s*,\\s*20170\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "Stand Aside damage must be physical 20220 add policy copyable_on_hit=false");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.damage_effect_details"),
            "must have exactly one damage_effect_details insert block");
        assertEquals(
            2,
            countOccurrences(sql, "'step_hero_draven_e_stand_aside_damage'"),
            "damage step must appear in effect_steps and damage_effect_details only");
        assertFalse(
            Pattern.compile("(?i)crit_eligible\\s*=\\s*true").matcher(sqlNoLineComments).find(),
            "Stand Aside must not enable crit eligibility");
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
    void excludesCastDelayListenersStateCcGeometryAndDestructiveQwHandling() {
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
            Pattern.compile(
                    "(?i)cast.?duration|duration_formula_key\\s*=\\s*'e_|"
                        + "phase_hero_draven_e_stand_aside_cast|"
                        + "\"value\":\\s*250\\b|const\",\"value\":250")
                .matcher(sqlNoLineComments)
                .find(),
            "must not encode 250ms cast phase or cast-duration formula");
        assertFalse(
            Pattern.compile(
                    "(?i)basic_attack_hit|emit_event|airborne|knock.?aside|knockback|"
                        + "crowd.?control|\\bcc\\b|slow|减速|projectile|飞行|"
                        + "multi.?target|多目标|repeat|equipment|loadout")
                .matcher(sqlNoLineComments)
                .find(),
            "must not model excluded cast-delay/CC/geometry/listener/equipment surfaces");
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
            "must not destructively replace Q/W rows");
        assertTrue(
            sql.contains("250ms") || sql.contains("250 ms") || sql.contains("Effect at cast"),
            "seed comments must document exclusion of Wiki 250ms cast / effect-at-end");
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
