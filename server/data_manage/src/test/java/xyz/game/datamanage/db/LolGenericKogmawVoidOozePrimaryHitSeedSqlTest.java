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
 * Static contract for {@code lol_generic_kogmaw_void_ooze_primary_hit_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericKogmawVoidOozePrimaryHitSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_kogmaw_void_ooze_primary_hit_seed.sql";

    private static final List<String> STABLE_IDS = List.of(
        "hero_kogmaw",
        "provider_hero_kogmaw_e_void_ooze_primary_hit",
        "ability_hero_kogmaw_e_void_ooze_primary_hit",
        "void_ooze",
        "phase_hero_kogmaw_e_void_ooze_primary_hit_impact",
        "sequence_hero_kogmaw_e_void_ooze_primary_hit_impact",
        "step_hero_kogmaw_e_void_ooze_primary_hit_damage",
        "cooldown_hero_kogmaw_e_void_ooze_primary_hit",
        "void_ooze_damage",
        "e_mana_cost",
        "e_cooldown_ms");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20111, 20120, 20130, 20142, 20150, 20170, 20221, 20260);

    private static final List<String> REQUIRED_ATTRS = List.of(
        "hp", "mana", "ad", "ap", "attack_speed", "armor", "magic_resist",
        "hp_regen", "mana_regen");

    private static final String VOID_OOZE_DAMAGE =
        "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":230},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.65},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ap.resolved\"}]}]}";

    private static final String FROZEN_BOUNDARY =
        "rank5_primary_target_single_hit; immediate_impact_scaffold; "
            + "magic_230_plus_0_65_ap; "
            + "no_projectile_geometry_multitarget_slow_field_or_duration";

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
        assertContains("hero_skill|hero_kogmaw|E|虚空淤泥");
        assertContains("kogmaw-e-void-ooze-primary-hit-phase-a-v1");
        assertContains("Template:Data Kog'Maw/E");
        assertContains("Template:Data Kog'Maw/Void Ooze");
        assertContains("1307961");
        assertContains("3965135");
        assertContains("2025-11-11T17:05:55Z");
        assertContains("1356");
        assertContains("1dd448ea1985237f002dec43e2bf93d860eb976f7c98e75883254cb3cf70794b");
        assertContains("normalized/generic/kogmaw-e.json");
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
            "void ooze primary-hit seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoLineComments).find(),
            "void ooze primary-hit seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoLineComments).find(),
            "void ooze primary-hit seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "void ooze primary-hit seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "void ooze primary-hit seed must not CREATE TABLE");
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
    void validatesExactlyNineAttrPreflightIncludingApAndProjectsReservedTypes() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("missing attribute_definitions");
        assertContains("INSERT INTO public.types");
        assertEquals(9, REQUIRED_ATTRS.size(), "contract expects exactly nine attrs");
        Matcher attrsArray = Pattern.compile(
                "(?is)v_required_attrs\\s+text\\[\\]\\s*:=\\s*ARRAY\\[(.*?)]")
            .matcher(sqlNoLineComments);
        assertTrue(attrsArray.find(), "must declare v_required_attrs array");
        String attrsBlock = attrsArray.group(1);
        for (String attr : REQUIRED_ATTRS) {
            assertTrue(
                attrsBlock.contains("'" + attr + "'"),
                "attr preflight must include exactly-nine key: " + attr);
        }
        assertTrue(
            Pattern.compile("(?i)'ap'").matcher(attrsBlock).find(),
            "attr preflight must require AP");
        assertEquals(
            9,
            countOccurrences(attrsBlock, "'") / 2,
            "attr preflight array must list exactly nine keys");
        for (int typeId : REQUIRED_RESERVED) {
            assertContains(Integer.toString(typeId));
        }
    }

    @Test
    void ensuresSelfContainedHeroWithAp0Mana325WithoutOverwritingExistingProviders() {
        assertContains("hero_kogmaw");
        assertContains("INSERT INTO public.game_entities");
        assertContains("INSERT INTO public.entity_attribute_values");
        assertTrue(
            Pattern.compile(
                    "(?is)ON\\s+CONFLICT\\s*\\(\\s*game_id\\s*,\\s*entity_id\\s*\\)\\s*DO\\s+NOTHING")
                .matcher(sqlNoLineComments)
                .find(),
            "game_entities ensure must DO NOTHING on conflict (do not overwrite existing Kog'Maw)");
        assertTrue(
            sql.contains("635") && sql.contains("325") && sql.contains("61")
                && sql.contains("0.665") && sql.contains("24") && sql.contains("30")
                && sql.contains("0.75") && sql.contains("1.75"),
            "must seed Kog'Maw level-1 panel numbers aligned with Batch-B");
        assertTrue(
            Pattern.compile("(?s)'hero_kogmaw'\\s*,\\s*'ap'\\s*,\\s*0")
                .matcher(sql)
                .find(),
            "must seed ap base 0 (baseline resolved 0; AP100 is fixture-only)");
        assertFalse(
            Pattern.compile("(?s)'hero_kogmaw'\\s*,\\s*'ap'\\s*,\\s*100")
                .matcher(sqlNoLineComments)
                .find(),
            "seed must not write AP100 fixture value");
        assertFalse(
            Pattern.compile("(?is)'attack_range'|'move_speed'|'crit_chance'|'crit_damage'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not overwrite unrelated Batch-B attributes");
        assertTrue(
            sql.contains("provider_hero_kogmaw_basic_attack")
                && sql.contains("provider_hero_kogmaw_bio_arcane_barrage")
                && sql.contains("provider_hero_kogmaw_caustic_spittle"),
            "seed must document coexistence with basic / Bio-Arcane / Caustic Spittle providers");
        assertFalse(
            Pattern.compile("(?is)'provider_hero_kogmaw_basic_attack'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write / replace basic attack provider identity rows");
        assertFalse(
            Pattern.compile("(?is)'provider_hero_kogmaw_bio_arcane_barrage'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write / replace Bio-Arcane Barrage provider identity rows");
        assertFalse(
            Pattern.compile("(?is)'provider_hero_kogmaw_caustic_spittle'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write / replace Caustic Spittle provider identity rows");
        assertFalse(
            Pattern.compile(
                    "(?is)'ability_hero_kogmaw_basic_attack'|"
                        + "'ability_hero_kogmaw_q_caustic_spittle'|"
                        + "'listener_hero_kogmaw_bio_arcane_barrage'|"
                        + "'step_hero_kogmaw_bio_arcane_barrage_damage'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write basic/Q/W ability or effect rows");
        assertFalse(
            Pattern.compile("(?is)Batch-B.*prerequisite|missing game_entities hero_kogmaw")
                .matcher(sqlNoLineComments)
                .find(),
            "must not depend on prior Kog'Maw provider publication / Batch-B hard prerequisite");
    }

    @Test
    void mountsDedicatedVoidOozePrimaryHitProviderToHeroKogmaw() {
        assertContains("provider_hero_kogmaw_e_void_ooze_primary_hit");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_kogmaw_e_void_ooze_primary_hit'[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "Void Ooze primary-hit provider kind must be passive 20120");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_kogmaw'\\s*,\\s*'provider_hero_kogmaw_e_void_ooze_primary_hit'")
                .matcher(sql)
                .find(),
            "must mount Void Ooze primary-hit provider to hero_kogmaw");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.entity_provider_mounts"),
            "must mount exactly one dedicated Void Ooze primary-hit provider");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_definitions"),
            "must define exactly one provider (E Void Ooze primary-hit only)");
        Set<String> seen = new HashSet<>();
        for (String id : STABLE_IDS) {
            assertTrue(seen.add(id), "stable id list itself must be unique: " + id);
            assertContains(id);
        }
    }

    @Test
    void seedsActiveVoidOozeWithMana100AndCooldown12000Ms() {
        assertContains("ability_hero_kogmaw_e_void_ooze_primary_hit");
        assertTrue(
            Pattern.compile(
                    "(?s)'ability_hero_kogmaw_e_void_ooze_primary_hit'\\s*,\\s*"
                        + "'provider_hero_kogmaw_e_void_ooze_primary_hit'\\s*,\\s*"
                        + "'void_ooze'\\s*,\\s*20130")
                .matcher(sql)
                .find(),
            "E must be active ability with stable key void_ooze");
        assertContains("e_mana_cost");
        assertContains("{\"op\":\"const\",\"value\":100}");
        assertContains("INSERT INTO public.ability_cooldowns");
        assertContains("cooldown_hero_kogmaw_e_void_ooze_primary_hit");
        assertContains("e_cooldown_ms");
        assertContains("{\"op\":\"const\",\"value\":12000}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cooldown_hero_kogmaw_e_void_ooze_primary_hit'\\s*,\\s*"
                        + "'ability_hero_kogmaw_e_void_ooze_primary_hit'\\s*,\\s*"
                        + "'e_cooldown_ms'\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "E cooldown must be 12000ms via ability_cooldowns");
    }

    @Test
    void seedsExactlyOneNullDurationImpactPhaseAndMagicDamage() {
        assertContains(VOID_OOZE_DAMAGE);
        assertContains("source.attr.ap.resolved");
        assertContains("\"value\":230");
        assertContains("\"value\":0.65");
        assertContains("phase_hero_kogmaw_e_void_ooze_primary_hit_impact");
        assertContains("sequence_hero_kogmaw_e_void_ooze_primary_hit_impact");
        assertContains("step_hero_kogmaw_e_void_ooze_primary_hit_damage");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.ability_phases"),
            "must define exactly one ability phase (null-duration impact)");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_kogmaw_e_void_ooze_primary_hit_impact'\\s*,\\s*"
                        + "'ability_hero_kogmaw_e_void_ooze_primary_hit'\\s*,\\s*0\\s*,\\s*"
                        + "20142\\s*,\\s*NULL\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "impact phase must be order 0 / type 20142 / null duration");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_kogmaw_e_void_ooze_primary_hit_impact'\\s*,\\s*20260\\s*,\\s*"
                        + "'sequence_hero_kogmaw_e_void_ooze_primary_hit_impact'")
                .matcher(sql)
                .find(),
            "impact phase must bind on_enter 20260 sequence");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_kogmaw_e_void_ooze_primary_hit_damage'\\s*,\\s*"
                        + "'sequence_hero_kogmaw_e_void_ooze_primary_hit_impact'\\s*,\\s*0\\s*,\\s*"
                        + "20150\\s*,\\s*20111\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "Void Ooze damage must be sole step order 0 to opponent");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_kogmaw_e_void_ooze_primary_hit_damage'\\s*,\\s*"
                        + "'void_ooze_damage'\\s*,\\s*20221\\s*,\\s*20170\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "Void Ooze damage must be magic 20221 add policy copyable_on_hit=false");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.damage_effect_details"),
            "must have exactly one damage_effect_details insert block");
        assertEquals(
            2,
            countOccurrences(sql, "'step_hero_kogmaw_e_void_ooze_primary_hit_damage'"),
            "damage step must appear in effect_steps and damage_effect_details only");
        assertFalse(
            Pattern.compile("(?i)crit_eligible\\s*=\\s*true").matcher(sqlNoLineComments).find(),
            "Void Ooze primary-hit must not enable crit eligibility");
        assertTrue(
            sql.contains("exactly-one-detail") || sql.contains("exactly one detail")
                || sql.contains("deferred exactly-one-detail"),
            "seed must document deferred exactly-one-detail pairing");
    }

    @Test
    void excludesProjectileGeometrySlowFieldDurationCastAndCoupling() {
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
            Pattern.compile(
                    "(?i)cast.?duration|cast.?delay|cast.?time|"
                        + "phase_hero_kogmaw_e_void_ooze_primary_hit_cast|"
                        + "\"value\":\\s*0\\.25\\b|const\",\"value\":0\\.25")
                .matcher(sqlNoLineComments)
                .find(),
            "must not invent cast-delay phase or encode 0.25s cast/tick formulas");
        assertFalse(
            Pattern.compile(
                    "(?i)projectile|missile|travel|collision|geometry|"
                        + "\\bwidth\\b|missile.?speed|projectile.?speed|"
                        + "path.?blob|ooze.?field|every.?125|\"value\":\\s*125\\b|"
                        + "\"value\":\\s*3000\\b|3s duration|\\bslow\\b|60%|linger|"
                        + "multi.?target|多目标|all.?enemies|\\brepeat\\b|"
                        + "basic_attack_hit|emit_event|equipment|loadout|"
                        + "bio.?arcane.?link|caustic.?spittle.?link|on.?hit.?coupl")
                .matcher(sqlNoLineComments)
                .find(),
            "must not model excluded projectile/geometry/field/slow/multi-target/"
                + "listener/equipment coupling surfaces");
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
            "must not destructively replace existing Kog'Maw providers");
        assertTrue(
            sql.contains("projectile") || sql.contains("missile") || sql.contains("geometry"),
            "seed comments must document exclusion of projectile/geometry");
        assertTrue(
            sql.contains("slow") || sql.contains("60%") || sql.contains("0.25s"),
            "seed comments must document exclusion of slow/tick surfaces");
        assertTrue(
            sql.contains("3s") || sql.contains("ooze field") || sql.contains("125"),
            "seed comments must document exclusion of ooze field/duration");
        assertTrue(
            sql.contains("cast-delay") || sql.contains("cast time start")
                || sql.contains("Effect at cast time start"),
            "seed comments must note cast-time-start compatibility without inventing delay");
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
