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
 * Static contract for {@code lol_generic_vayne_condemn_primary_hit_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericVayneCondemnPrimaryHitSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_vayne_condemn_primary_hit_seed.sql";

    private static final List<String> STABLE_IDS = List.of(
        "hero_vayne",
        "provider_hero_vayne_e_condemn_primary_hit",
        "ability_hero_vayne_e_condemn_primary_hit",
        "condemn",
        "phase_hero_vayne_e_condemn_primary_hit_impact",
        "sequence_hero_vayne_e_condemn_primary_hit_impact",
        "step_hero_vayne_e_condemn_primary_hit_damage",
        "cooldown_hero_vayne_e_condemn_primary_hit",
        "condemn_damage",
        "e_mana_cost",
        "e_cooldown_ms");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20111, 20120, 20130, 20142, 20150, 20170, 20220, 20260);

    private static final List<String> REQUIRED_ATTRS = List.of(
        "hp", "mana", "ad", "attack_speed", "armor", "magic_resist",
        "hp_regen", "mana_regen");

    private static final String CONDEMN_DAMAGE =
        "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":190},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.50},"
            + "{\"op\":\"sub\",\"args\":["
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.resolved\"},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.base\"}]}]}]}";

    private static final String FROZEN_BOUNDARY =
        "rank5_primary_target_single_hit; immediate_impact_scaffold; "
            + "physical_190_plus_0_50_bonus_ad; "
            + "no_knockback_terrain_stun_wall_bonus_cast_or_projectile";

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
        assertContains("hero_skill|hero_vayne|E|恶魔审判");
        assertContains("vayne-e-condemn-primary-hit-phase-a-v1");
        assertContains("Template:Data Vayne/E");
        assertContains("Template:Data Vayne/Condemn");
        assertContains("1309990");
        assertContains("4008541");
        assertContains("2026-04-14T23:45:40Z");
        assertContains("2380");
        assertContains("f2b2ba17b90ff5096a9a154f8d1fd4cc43ed3e1be4ebb502cb644acf17712c37");
        assertContains("normalized/generic/vayne-e.json");
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
            "condemn primary-hit seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoLineComments).find(),
            "condemn primary-hit seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoLineComments).find(),
            "condemn primary-hit seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "condemn primary-hit seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "condemn primary-hit seed must not CREATE TABLE");
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
    void validatesExactlyEightAttrPreflightWithoutApAndProjectsReservedTypes() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("missing attribute_definitions");
        assertContains("INSERT INTO public.types");
        assertEquals(8, REQUIRED_ATTRS.size(), "contract expects exactly eight attrs");
        Matcher attrsArray = Pattern.compile(
                "(?is)v_required_attrs\\s+text\\[\\]\\s*:=\\s*ARRAY\\[(.*?)]")
            .matcher(sqlNoLineComments);
        assertTrue(attrsArray.find(), "must declare v_required_attrs array");
        String attrsBlock = attrsArray.group(1);
        for (String attr : REQUIRED_ATTRS) {
            assertTrue(
                attrsBlock.contains("'" + attr + "'"),
                "attr preflight must include exactly-eight key: " + attr);
        }
        assertFalse(
            Pattern.compile("(?i)'ap'").matcher(attrsBlock).find(),
            "attr preflight must not require AP");
        assertFalse(
            Pattern.compile(
                    "(?is)'hero_vayne'\\s*,\\s*'ap'\\s*,")
                .matcher(sqlNoLineComments)
                .find(),
            "must not insert entity_attribute_values for ap");
        for (int typeId : REQUIRED_RESERVED) {
            assertContains(Integer.toString(typeId));
        }
    }

    @Test
    void ensuresSelfContainedHeroWithoutOverwritingExistingVayneProviders() {
        assertContains("hero_vayne");
        assertContains("INSERT INTO public.game_entities");
        assertContains("INSERT INTO public.entity_attribute_values");
        assertTrue(
            Pattern.compile(
                    "(?is)ON\\s+CONFLICT\\s*\\(\\s*game_id\\s*,\\s*entity_id\\s*\\)\\s*DO\\s+NOTHING")
                .matcher(sqlNoLineComments)
                .find(),
            "game_entities ensure must DO NOTHING on conflict (do not overwrite existing Vayne)");
        assertTrue(
            sql.contains("550") && sql.contains("232") && sql.contains("60")
                && sql.contains("0.658") && sql.contains("23") && sql.contains("30")
                && sql.contains("0.7") && sql.contains("1.4"),
            "must seed Vayne level-1 panel numbers");
        assertTrue(
            sql.contains("provider_hero_vayne_basic_attack")
                && sql.contains("provider_hero_vayne_silver_bolts")
                && sql.contains("provider_hero_vayne_tumble"),
            "seed must document coexistence with basic attack / Silver Bolts / tumble providers");
        assertFalse(
            Pattern.compile("(?is)'provider_hero_vayne_basic_attack'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write / replace basic attack provider identity rows");
        assertFalse(
            Pattern.compile("(?is)'provider_hero_vayne_silver_bolts'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write Silver Bolts provider identity rows");
        assertFalse(
            Pattern.compile("(?is)'provider_hero_vayne_tumble'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write tumble provider identity rows");
        assertFalse(
            Pattern.compile(
                    "(?is)'ability_hero_vayne_basic_attack'|"
                        + "'ability_hero_vayne_silver_bolts'|"
                        + "'ability_hero_vayne_tumble'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write basic/Silver Bolts/tumble ability rows");
    }

    @Test
    void mountsDedicatedCondemnPrimaryHitProviderToHeroVayne() {
        assertContains("provider_hero_vayne_e_condemn_primary_hit");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_vayne_e_condemn_primary_hit'[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "Condemn primary-hit provider kind must be passive 20120");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_vayne'\\s*,\\s*'provider_hero_vayne_e_condemn_primary_hit'")
                .matcher(sql)
                .find(),
            "must mount Condemn primary-hit provider to hero_vayne");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.entity_provider_mounts"),
            "must mount exactly one dedicated Condemn primary-hit provider");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_definitions"),
            "must define exactly one provider (E Condemn primary-hit only)");
    }

    @Test
    void seedsActiveCondemnWithMana90AndCooldown12000Ms() {
        assertContains("ability_hero_vayne_e_condemn_primary_hit");
        assertTrue(
            Pattern.compile(
                    "(?s)'ability_hero_vayne_e_condemn_primary_hit'\\s*,\\s*"
                        + "'provider_hero_vayne_e_condemn_primary_hit'\\s*,\\s*"
                        + "'condemn'\\s*,\\s*20130")
                .matcher(sql)
                .find(),
            "E must be active ability with stable key condemn");
        assertContains("e_mana_cost");
        assertContains("{\"op\":\"const\",\"value\":90}");
        assertContains("INSERT INTO public.ability_cooldowns");
        assertContains("cooldown_hero_vayne_e_condemn_primary_hit");
        assertContains("e_cooldown_ms");
        assertContains("{\"op\":\"const\",\"value\":12000}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cooldown_hero_vayne_e_condemn_primary_hit'\\s*,\\s*"
                        + "'ability_hero_vayne_e_condemn_primary_hit'\\s*,\\s*"
                        + "'e_cooldown_ms'\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "E cooldown must be 12000ms via ability_cooldowns");
    }

    @Test
    void seedsExactlyOneNullDurationImpactPhaseAndPhysicalDamage() {
        assertContains(CONDEMN_DAMAGE);
        assertContains("source.attr.ad.resolved");
        assertContains("source.attr.ad.base");
        assertContains("\"value\":190");
        assertContains("\"value\":0.50");
        assertContains("phase_hero_vayne_e_condemn_primary_hit_impact");
        assertContains("sequence_hero_vayne_e_condemn_primary_hit_impact");
        assertContains("step_hero_vayne_e_condemn_primary_hit_damage");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.ability_phases"),
            "must define exactly one ability phase (null-duration impact)");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_vayne_e_condemn_primary_hit_impact'\\s*,\\s*"
                        + "'ability_hero_vayne_e_condemn_primary_hit'\\s*,\\s*0\\s*,\\s*"
                        + "20142\\s*,\\s*NULL\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "impact phase must be order 0 / type 20142 / null duration");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_vayne_e_condemn_primary_hit_impact'\\s*,\\s*20260\\s*,\\s*"
                        + "'sequence_hero_vayne_e_condemn_primary_hit_impact'")
                .matcher(sql)
                .find(),
            "impact phase must bind on_enter 20260 sequence");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_vayne_e_condemn_primary_hit_damage'\\s*,\\s*"
                        + "'sequence_hero_vayne_e_condemn_primary_hit_impact'\\s*,\\s*0\\s*,\\s*"
                        + "20150\\s*,\\s*20111\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "Condemn damage must be sole step order 0 to opponent");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_vayne_e_condemn_primary_hit_damage'\\s*,\\s*"
                        + "'condemn_damage'\\s*,\\s*20220\\s*,\\s*20170\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "Condemn damage must be physical 20220 add policy copyable_on_hit=false");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.damage_effect_details"),
            "must have exactly one damage_effect_details insert block");
        assertEquals(
            2,
            countOccurrences(sql, "'step_hero_vayne_e_condemn_primary_hit_damage'"),
            "damage step must appear in effect_steps and damage_effect_details only");
        assertFalse(
            Pattern.compile("(?i)crit_eligible\\s*=\\s*true").matcher(sqlNoLineComments).find(),
            "Condemn primary-hit must not enable crit eligibility");
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
    void excludesWallBonusKnockbackTerrainStunCastProjectileAndCoupling() {
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
            Pattern.compile(
                    "(?i)\"value\":\\s*285\\b|const\",\"value\":285|"
                        + "\"value\":\\s*0\\.75\\b|const\",\"value\":0\\.75|"
                        + "\"value\":\\s*475\\b|const\",\"value\":475|"
                        + "\"value\":\\s*1\\.25\\b|const\",\"value\":1\\.25")
                .matcher(sqlNoLineComments)
                .find(),
            "must not encode wall bonus 285+0.75 or total 475+1.25 formulas");
        assertFalse(
            Pattern.compile(
                    "(?i)wall.?bonus|totaldamage|empowered.?damage|"
                        + "knockback|knock.?back|terrain|stun|crowd.?control|\\bcc\\b|"
                        + "control|cast.?duration|cast.?time|effect.?at.?cast|"
                        + "projectile|missile|\"value\":\\s*2200\\b|\"value\":\\s*2000\\b|"
                        + "attack_range|geometry|flash.?angle|cancel.?condition|"
                        + "basic_attack_hit|emit_event|multi.?target|多目标|repeat|"
                        + "equipment|loadout|silver_bolts")
                .matcher(sqlNoLineComments)
                .find(),
            "must not model excluded wall/knockback/terrain/stun/cast/projectile/"
                + "geometry/listener/equipment/Silver Bolts surfaces");
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
            "must not destructively replace existing Vayne providers");
        assertTrue(
            sql.contains("wall bonus") || sql.contains("knockback") || sql.contains("1.5s"),
            "seed comments must document exclusion of wall/knockback/stun surfaces");
        assertTrue(
            sql.contains("0.25") || sql.contains("2200") || sql.contains("2000"),
            "seed comments must document exclusion of cast/projectile speeds");
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
