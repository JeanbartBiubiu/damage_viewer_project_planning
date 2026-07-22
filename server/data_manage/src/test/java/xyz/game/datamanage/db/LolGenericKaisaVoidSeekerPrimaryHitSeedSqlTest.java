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
 * Static contract for {@code lol_generic_kaisa_void_seeker_primary_hit_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericKaisaVoidSeekerPrimaryHitSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_kaisa_void_seeker_primary_hit_seed.sql";

    private static final List<String> STABLE_IDS = List.of(
        "hero_kaisa",
        "provider_hero_kaisa_w_void_seeker_primary_hit",
        "ability_hero_kaisa_w_void_seeker_primary_hit",
        "void_seeker",
        "phase_hero_kaisa_w_void_seeker_primary_hit_impact",
        "sequence_hero_kaisa_w_void_seeker_primary_hit_impact",
        "step_hero_kaisa_w_void_seeker_primary_hit_damage",
        "cost_hero_kaisa_w_void_seeker_primary_hit_mana",
        "cooldown_hero_kaisa_w_void_seeker_primary_hit",
        "void_seeker_damage",
        "w_mana_cost",
        "w_cooldown_ms");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20111, 20120, 20130, 20142, 20150, 20170, 20221, 20260);

    private static final List<String> REQUIRED_ATTRS = List.of(
        "hp", "mana", "ad", "ap", "attack_speed", "armor", "magic_resist",
        "hp_regen", "mana_regen");

    private static final String VOID_SEEKER_DAMAGE =
        "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":130},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":1.30},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.resolved\"}]},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.45},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ap.resolved\"}]}]}";

    private static final String FROZEN_BOUNDARY =
        "rank5_primary_target_single_hit; immediate_impact_scaffold; "
            + "magic_130_plus_1_30_total_ad_plus_0_45_ap; "
            + "no_cast_delay_projectile_geometry_sight_reveal_plasma_evolution_or_cooldown_refund";

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
        assertContains("hero_skill|hero_kaisa|W|虚空索敌");
        assertContains("kaisa-w-void-seeker-primary-hit-phase-a-v2");
        assertContains("Template:Data Kai'Sa/W");
        assertContains("Template:Data Kai'Sa/Void Seeker");
        assertContains("1353553");
        assertContains("4034696");
        assertContains("2026-06-23T21:14:14Z");
        assertContains("1843");
        assertContains("aa4ba76c6fa345c711651fa56d9b914d4ea8b7eb3ddfae79d7feb25470d7e3d1");
        assertContains("normalized/generic/kaisa-w.json");
        assertContains(FROZEN_BOUNDARY);
        assertTrue(
            Pattern.compile("(?i)magic|魔法").matcher(sql).find()
                && (sql.contains("130 + 130% AD + 45% AP")
                    || sql.contains("130 + 1.30")
                    || sql.contains("magic 130")),
            "seed comments must document source magic wording and rank5 130 +130% AD +45% AP");
        assertTrue(
            sql.contains("total AD") || sql.contains("source.attr.ad.resolved"),
            "seed must document total-AD read path");
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
            "void seeker primary-hit seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoLineComments).find(),
            "void seeker primary-hit seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoLineComments).find(),
            "void seeker primary-hit seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "void seeker primary-hit seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "void seeker primary-hit seed must not CREATE TABLE");
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
        assertContains("INSERT INTO public.resource_definitions");
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
    void ensuresSelfContainedHeroWithAp0Mana345WithoutDependingOnBasicOrSupercharge() {
        assertContains("hero_kaisa");
        assertContains("INSERT INTO public.game_entities");
        assertContains("INSERT INTO public.entity_attribute_values");
        assertTrue(
            Pattern.compile(
                    "(?is)ON\\s+CONFLICT\\s*\\(\\s*game_id\\s*,\\s*entity_id\\s*\\)\\s*DO\\s+NOTHING")
                .matcher(sqlNoLineComments)
                .find(),
            "game_entities ensure must DO NOTHING on conflict (do not overwrite existing Kai'Sa)");
        assertTrue(
            sql.contains("640") && sql.contains("345") && sql.contains("59")
                && sql.contains("0.644") && sql.contains("25") && sql.contains("30")
                && sql.contains("0.8") && sql.contains("1.64"),
            "must seed Kai'Sa level-1 panel numbers aligned with Batch-B");
        assertTrue(
            Pattern.compile("(?s)'hero_kaisa'\\s*,\\s*'ap'\\s*,\\s*0")
                .matcher(sql)
                .find(),
            "must seed ap base 0");
        assertTrue(
            Pattern.compile("(?s)'mana'\\s*,\\s*'法力'\\s*,\\s*0\\s*,\\s*0")
                .matcher(sql)
                .find(),
            "must project resource_definitions.mana");
        assertTrue(
            Pattern.compile("(?s)'hero_kaisa'\\s*,\\s*'mana'\\s*,\\s*345\\s*,\\s*345")
                .matcher(sql)
                .find(),
            "must seed entity_resource_values mana 345/345");
        assertFalse(
            Pattern.compile("(?is)'attack_range'|'move_speed'|'crit_chance'|'crit_damage'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not overwrite unrelated Batch-B attributes");
        assertTrue(
            sql.contains("provider_hero_kaisa_basic_attack")
                && sql.contains("provider_hero_kaisa_supercharge"),
            "seed must document coexistence with basic/Second Skin and Supercharge providers");
        assertFalse(
            Pattern.compile("(?is)'provider_hero_kaisa_basic_attack'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write / replace basic attack provider identity rows");
        assertFalse(
            Pattern.compile("(?is)'provider_hero_kaisa_supercharge'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write / replace Supercharge provider identity rows");
        assertFalse(
            Pattern.compile(
                    "(?is)'ability_hero_kaisa_basic_attack'|"
                        + "'ability_hero_kaisa_e_supercharge'|"
                        + "'listener_hero_kaisa_e_supercharge_ability_started'|"
                        + "'step_hero_kaisa_plasma_stacks_add'|"
                        + "'step_hero_kaisa_caustic_wounds_damage'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write basic/Second Skin/Supercharge ability/listener/effect rows");
        assertFalse(
            Pattern.compile(
                    "(?is)missing game_entities hero_kaisa|"
                        + "missing provider_hero_kaisa_basic_attack|"
                        + "Batch-B prerequisite|"
                        + "supercharge.*prerequisite")
                .matcher(sqlNoLineComments)
                .find(),
            "must not depend on prior basic/Second Skin/Supercharge provider publication");
        assertFalse(
            Pattern.compile(
                    "(?is)plasma_stacks|caustic_wounds|supercharge_active")
                .matcher(sqlNoLineComments)
                .find(),
            "must not read/write Plasma / Caustic Wounds / Supercharge state in executable SQL");
    }

    @Test
    void mountsDedicatedVoidSeekerPrimaryHitProviderToHeroKaisa() {
        assertContains("provider_hero_kaisa_w_void_seeker_primary_hit");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_kaisa_w_void_seeker_primary_hit'[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "Void Seeker primary-hit provider kind must be passive 20120");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_kaisa'\\s*,\\s*"
                        + "'provider_hero_kaisa_w_void_seeker_primary_hit'")
                .matcher(sql)
                .find(),
            "must mount Void Seeker primary-hit provider to hero_kaisa");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.entity_provider_mounts"),
            "must mount exactly one dedicated Void Seeker primary-hit provider");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_definitions"),
            "must define exactly one provider (W Void Seeker primary-hit only)");
        Set<String> seen = new HashSet<>();
        for (String id : STABLE_IDS) {
            assertTrue(seen.add(id), "stable id list itself must be unique: " + id);
            assertContains(id);
        }
    }

    @Test
    void seedsActiveVoidSeekerWithMana75AndCooldown14000Ms() {
        assertContains("ability_hero_kaisa_w_void_seeker_primary_hit");
        assertTrue(
            Pattern.compile(
                    "(?s)'ability_hero_kaisa_w_void_seeker_primary_hit'\\s*,\\s*"
                        + "'provider_hero_kaisa_w_void_seeker_primary_hit'\\s*,\\s*"
                        + "'void_seeker'\\s*,\\s*20130")
                .matcher(sql)
                .find(),
            "W must be active ability with stable key void_seeker");
        assertContains("cost_hero_kaisa_w_void_seeker_primary_hit_mana");
        assertContains("INSERT INTO public.ability_costs");
        assertContains("w_mana_cost");
        assertContains("{\"op\":\"const\",\"value\":75}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cost_hero_kaisa_w_void_seeker_primary_hit_mana'\\s*,\\s*"
                        + "'ability_hero_kaisa_w_void_seeker_primary_hit'\\s*,\\s*NULL\\s*,\\s*"
                        + "'mana'\\s*,\\s*'w_mana_cost'\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "W mana cost must be ability-level 75 via ability_costs");
        assertContains("INSERT INTO public.ability_cooldowns");
        assertContains("cooldown_hero_kaisa_w_void_seeker_primary_hit");
        assertContains("w_cooldown_ms");
        assertContains("{\"op\":\"const\",\"value\":14000}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cooldown_hero_kaisa_w_void_seeker_primary_hit'\\s*,\\s*"
                        + "'ability_hero_kaisa_w_void_seeker_primary_hit'\\s*,\\s*"
                        + "'w_cooldown_ms'\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "W cooldown must be 14000ms via ability_cooldowns");
    }

    @Test
    void seedsExactlyOneNullDurationImpactPhaseAndMagicTotalAdDamage() {
        assertContains(VOID_SEEKER_DAMAGE);
        assertContains("source.attr.ad.resolved");
        assertContains("source.attr.ap.resolved");
        assertContains("\"value\":130");
        assertContains("\"value\":1.30");
        assertContains("\"value\":0.45");
        assertFalse(
            Pattern.compile("source\\.attr\\.ad\\.base")
                .matcher(sqlNoLineComments)
                .find(),
            "must not interpret total AD as bonus AD via ad.base subtraction");
        assertFalse(
            Pattern.compile("(?is)\\b20220\\b").matcher(sqlNoLineComments).find(),
            "executable SQL must not use physical damage type 20220");
        assertContains("phase_hero_kaisa_w_void_seeker_primary_hit_impact");
        assertContains("sequence_hero_kaisa_w_void_seeker_primary_hit_impact");
        assertContains("step_hero_kaisa_w_void_seeker_primary_hit_damage");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.ability_phases"),
            "must define exactly one ability phase (null-duration impact)");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_kaisa_w_void_seeker_primary_hit_impact'\\s*,\\s*"
                        + "'ability_hero_kaisa_w_void_seeker_primary_hit'\\s*,\\s*0\\s*,\\s*"
                        + "20142\\s*,\\s*NULL\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "impact phase must be order 0 / type 20142 / null duration");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_kaisa_w_void_seeker_primary_hit_impact'\\s*,\\s*"
                        + "20260\\s*,\\s*"
                        + "'sequence_hero_kaisa_w_void_seeker_primary_hit_impact'")
                .matcher(sql)
                .find(),
            "impact phase must bind on_enter 20260 sequence");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_kaisa_w_void_seeker_primary_hit_damage'\\s*,\\s*"
                        + "'sequence_hero_kaisa_w_void_seeker_primary_hit_impact'\\s*,\\s*"
                        + "0\\s*,\\s*20150\\s*,\\s*20111\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "Void Seeker damage must be sole step order 0 to opponent");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_kaisa_w_void_seeker_primary_hit_damage'\\s*,\\s*"
                        + "'void_seeker_damage'\\s*,\\s*20221\\s*,\\s*20170\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "Void Seeker damage must be magic 20221 add policy copyable_on_hit=false");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.damage_effect_details"),
            "must have exactly one damage_effect_details insert block");
        assertEquals(
            2,
            countOccurrences(sql, "'step_hero_kaisa_w_void_seeker_primary_hit_damage'"),
            "damage step must appear in effect_steps and damage_effect_details only");
        assertFalse(
            Pattern.compile("(?i)crit_eligible\\s*=\\s*true").matcher(sqlNoLineComments).find(),
            "Void Seeker primary-hit must not enable crit eligibility");
        assertTrue(
            sql.contains("exactly-one-detail") || sql.contains("exactly one detail")
                || sql.contains("deferred exactly-one-detail"),
            "seed must document deferred exactly-one-detail pairing");
    }

    @Test
    void excludesCastDelayProjectileGeometrySightRevealPlasmaEvolutionAndRefund() {
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
                        + "phase_hero_kaisa_w_void_seeker_primary_hit_cast|"
                        + "\"value\":\\s*0\\.4\\b|"
                        + "projectile|missile|travel|collision|geometry|"
                        + "target.?location|spellshield|"
                        + "\"value\":\\s*3000\\b|\"value\":\\s*1750\\b|"
                        + "\"value\":\\s*200\\b|"
                        + "true.?sight|reveal|trajectory.?sight|"
                        + "plasma_stacks|caustic_wounds|supercharge_active|"
                        + "evolution|cooldown.?refund|75%|"
                        + "multi.?target|多目标|all.?enemies|\\brepeat\\b|"
                        + "basic_attack_hit|emit_event|equipment|loadout")
                .matcher(sqlNoLineComments)
                .find(),
            "must not model excluded cast-delay/projectile/geometry/sight/reveal/"
                + "Plasma/evolution/cooldown-refund/equipment surfaces");
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
            "must not destructively replace existing Kai'Sa providers");
        assertTrue(
            sql.contains("0.4") || sql.contains("cast-delay")
                || sql.contains("Effect at cast time end"),
            "seed comments must document exclusion of Wiki 0.4s cast / cast-time-end");
        assertTrue(
            sql.contains("projectile") || sql.contains("geometry") || sql.contains("1750"),
            "seed comments must document exclusion of projectile/geometry");
        assertTrue(
            sql.contains("Plasma") || sql.contains("plasma") || sql.contains("Second Skin"),
            "seed comments must document exclusion of Plasma/Second Skin coupling");
        assertTrue(
            sql.contains("evolution") || sql.contains("cooldown refund")
                || sql.contains("75%"),
            "seed comments must document exclusion of evolution/cooldown refund");
        assertTrue(
            sql.contains("reveal") || sql.contains("true sight") || sql.contains("sight"),
            "seed comments must document exclusion of sight/reveal");
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
