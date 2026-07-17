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
 * Static contract for {@code lol_generic_pipeline_damage_items_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericPipelineDamageItemsSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_pipeline_damage_items_seed.sql";

    private static final String RESERVED_RELATIVE =
        "db/game_manage/seeds/reserved_types_seed.sql";

    private static final List<String> STABLE_IDS = List.of(
        "item_2523",
        "item_3082",
        "provider_item_2523_hexoptics_magnification",
        "provider_item_3082_wardens_mail_rock_solid",
        "modifier_item_2523_hexoptics_magnification",
        "modifier_item_3082_wardens_mail_rock_solid",
        "magnification_basic_damage",
        "rock_solid_first_basic");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20110, 20122, 20171, 20172, 20264, 20265, 20266, 20267, 20268, 20269, 20270);

    private static final String ROCK_SOLID_FORMULA =
        "{\"op\":\"max\",\"args\":[{\"op\":\"sub\",\"args\":["
            + "{\"op\":\"read\",\"path\":\"damage.amount\"},{\"op\":\"const\",\"value\":15}]},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"read\",\"path\":\"damage.amount\"},"
            + "{\"op\":\"const\",\"value\":0.8}]}]}";

    private static String sql;
    private static String sqlNoLineComments;
    private static String reservedSql;

    @BeforeAll
    static void loadSeedSql() throws IOException {
        Path seedPath = resolveRelative(SEED_RELATIVE);
        assertTrue(Files.isRegularFile(seedPath), "seed sql missing: " + seedPath);
        sql = Files.readString(seedPath, StandardCharsets.UTF_8);
        sqlNoLineComments = stripLineComments(sql);
        Path reservedPath = resolveRelative(RESERVED_RELATIVE);
        assertTrue(Files.isRegularFile(reservedPath), "reserved sql missing: " + reservedPath);
        reservedSql = Files.readString(reservedPath, StandardCharsets.UTF_8);
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
            "mount idempotent guards must use change_revision > v_locked_current");
        assertFalse(sql.contains("versions:publish"), "seed must not auto-publish");
        assertFalse(
            Pattern.compile("(?i)\\bpublish_version\\b").matcher(sql).find(),
            "seed must not call publish helpers");
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
            "pipeline items seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoLineComments).find(),
            "pipeline items seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoLineComments).find(),
            "pipeline items seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "pipeline items seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "pipeline items seed must not CREATE TABLE");
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
    void reservedVocabularyDefinesPipelineTokensAndAxeCaught() {
        assertTrue(reservedSql.contains("'modifier_kind'"));
        assertTrue(reservedSql.contains("'command'"));
        assertTrue(reservedSql.contains("'channel'"));
        assertTrue(reservedSql.contains("'stage'"));
        assertTrue(reservedSql.contains("'bucket'"));
        assertTrue(reservedSql.contains("'event/axe_caught'"));
        assertTrue(reservedSql.contains("'modifier_kind/pipeline'"));
        assertTrue(reservedSql.contains("'command/damage'"));
        assertTrue(reservedSql.contains("'channel/basic_damage'"));
        assertTrue(reservedSql.contains("'stage/outgoing_pre_mitigation'"));
        assertTrue(reservedSql.contains("'stage/incoming_post_mitigation'"));
        assertTrue(reservedSql.contains("'bucket/all_instances'"));
        assertTrue(reservedSql.contains("'bucket/first_per_cast'"));
        assertTrue(reservedSql.contains("(10026,"));
        assertTrue(reservedSql.contains("(10027,"));
        assertTrue(reservedSql.contains("(10028,"));
        assertTrue(reservedSql.contains("(10029,"));
        assertTrue(reservedSql.contains("(10030,"));
        assertTrue(reservedSql.contains("(20216,"));
        assertTrue(reservedSql.contains("(20264,"));
        assertTrue(reservedSql.contains("(20265,"));
        assertTrue(reservedSql.contains("(20266,"));
        assertTrue(reservedSql.contains("(20267,"));
        assertTrue(reservedSql.contains("(20268,"));
        assertTrue(reservedSql.contains("(20269,"));
        assertTrue(reservedSql.contains("(20270,"));
        assertTrue(reservedSql.contains("(20216, 10019)"));
        assertTrue(reservedSql.contains("(20264, 10026)"));
        assertTrue(reservedSql.contains("(20265, 10027)"));
        assertTrue(reservedSql.contains("(20266, 10028)"));
        assertTrue(reservedSql.contains("(20267, 10029)"));
        assertTrue(reservedSql.contains("(20268, 10029)"));
        assertTrue(reservedSql.contains("(20269, 10030)"));
        assertTrue(reservedSql.contains("(20270, 10030)"));
    }

    @Test
    void validatesPrerequisitesAndProjectsRequiredReservedTypes() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("missing attribute_definitions");
        assertContains("INSERT INTO public.types");
        for (int typeId : REQUIRED_RESERVED) {
            assertContains(Integer.toString(typeId));
        }
        for (String attr : List.of("hp", "ad", "crit_chance", "armor")) {
            assertTrue(
                sql.contains("'" + attr + "'"),
                "must preflight or write attr_key=" + attr);
        }
    }

    @Test
    void seedsHexopticsMagnificationOutgoingPreMitigationMultiply() {
        assertContains("item_2523");
        assertContains("provider_item_2523_hexoptics_magnification");
        assertContains("modifier_item_2523_hexoptics_magnification");
        assertTrue(
            sql.contains("55") && sql.contains("0.25"),
            "must seed Hexoptics AD 55 / crit 25%");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_item_2523_hexoptics_magnification'[\\s\\S]{0,80}20122")
                .matcher(sql)
                .find(),
            "2523 provider kind must be equipment 20122");
        assertContains("{\"op\":\"const\",\"value\":1.10}");
        assertTrue(
            Pattern.compile(
                    "(?s)'modifier_item_2523_hexoptics_magnification'\\s*,\\s*"
                        + "'provider_item_2523_hexoptics_magnification'\\s*,\\s*"
                        + "'magnification_basic_damage'\\s*,\\s*"
                        + "20264\\s*,\\s*20110\\s*,\\s*'hp'\\s*,\\s*"
                        + "20265\\s*,\\s*20266\\s*,\\s*20269\\s*,\\s*20267\\s*,\\s*"
                        + "0\\s*,\\s*20171\\s*,\\s*'magnification_basic_damage'")
                .matcher(sql)
                .find(),
            "2523 modifier must be pipeline/damage/basic_damage/all_instances/"
                + "outgoing_pre_mitigation multiply 1.10 with hp FK anchor");
        assertTrue(
            Pattern.compile(
                    "(?s)'item_2523'\\s*,\\s*'provider_item_2523_hexoptics_magnification'")
                .matcher(sql)
                .find(),
            "must mount Magnification provider to item_2523");
    }

    @Test
    void seedsWardensMailRockSolidIncomingPostMitigationOverride() {
        assertContains("item_3082");
        assertContains("provider_item_3082_wardens_mail_rock_solid");
        assertContains("modifier_item_3082_wardens_mail_rock_solid");
        assertContains(ROCK_SOLID_FORMULA);
        assertTrue(sql.contains("40"), "must seed Warden's Mail armor 40");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_item_3082_wardens_mail_rock_solid'[\\s\\S]{0,80}20122")
                .matcher(sql)
                .find(),
            "3082 provider kind must be equipment 20122");
        assertTrue(
            Pattern.compile(
                    "(?s)'modifier_item_3082_wardens_mail_rock_solid'\\s*,\\s*"
                        + "'provider_item_3082_wardens_mail_rock_solid'\\s*,\\s*"
                        + "'rock_solid_first_basic'\\s*,\\s*"
                        + "20264\\s*,\\s*20110\\s*,\\s*'hp'\\s*,\\s*"
                        + "20265\\s*,\\s*20266\\s*,\\s*20270\\s*,\\s*20268\\s*,\\s*"
                        + "0\\s*,\\s*20172\\s*,\\s*'rock_solid_first_basic'")
                .matcher(sql)
                .find(),
            "3082 modifier must be pipeline/damage/basic_damage/first_per_cast/"
                + "incoming_post_mitigation override with hp FK anchor");
        assertTrue(
            Pattern.compile(
                    "(?s)'item_3082'\\s*,\\s*'provider_item_3082_wardens_mail_rock_solid'")
                .matcher(sql)
                .find(),
            "must mount Rock Solid provider to item_3082");
        assertContains("damage.amount");
    }

    @Test
    void excludesArcaneAimDistanceScalingListenersAndPublish() {
        assertFalse(
            Pattern.compile("(?i)arcane.?aim|distance|takedown|attack.?range")
                .matcher(sqlNoLineComments)
                .find(),
            "must not model Arcane Aim or distance Magnification");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.provider_listeners\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "pipeline items seed must not write listeners");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.effect_steps\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "pipeline items seed must not write effect steps");
        assertFalse(
            Pattern.compile("(?i)migration|live\\s+migration")
                .matcher(sqlNoLineComments)
                .find(),
            "must not include live migration");
    }

    @Test
    void citesNormalizedJsonAndValidatesStableIds() {
        assertContains("current-items.normalized.json");
        assertContains("2523");
        assertContains("3082");
        Set<String> seen = new HashSet<>();
        for (String id : STABLE_IDS) {
            assertTrue(seen.add(id), "stable id list itself must be unique: " + id);
            assertContains(id);
        }
    }

    private static String stripLineComments(String raw) {
        return Pattern.compile("(?m)--[^\\n]*").matcher(raw).replaceAll("");
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
