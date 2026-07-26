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
        "item_3143",
        "item_2051",
        "item_3036",
        "provider_item_2523_hexoptics_magnification",
        "provider_item_3082_wardens_mail_rock_solid",
        "provider_item_3143_randuins_omen_resilience",
        "provider_item_2051_guardians_horn_undaunted",
        "provider_item_3036_giant_slayer",
        "modifier_item_2523_hexoptics_magnification",
        "modifier_item_3082_wardens_mail_rock_solid",
        "modifier_item_3143_randuins_omen_resilience",
        "modifier_item_2051_guardians_horn_undaunted_ordinary",
        "modifier_item_2051_guardians_horn_undaunted_dot",
        "modifier_item_3036_giant_slayer",
        "magnification_basic_damage",
        "rock_solid_first_basic",
        "resilience_incoming_crit",
        "undaunted_ordinary_value",
        "undaunted_ordinary_condition",
        "undaunted_dot_value",
        "undaunted_dot_condition",
        "undaunted_ordinary",
        "undaunted_dot",
        "giant_slayer_outgoing_multiplier",
        "giant_slayer_outgoing_damage");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20110, 20122, 20171, 20172, 20176, 20264, 20265, 20266, 20267, 20268, 20269, 20270,
        20271, 20272);

    private static final String ROCK_SOLID_FORMULA =
        "{\"op\":\"max\",\"args\":[{\"op\":\"sub\",\"args\":["
            + "{\"op\":\"read\",\"path\":\"damage.amount\"},{\"op\":\"const\",\"value\":15}]},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"read\",\"path\":\"damage.amount\"},"
            + "{\"op\":\"const\",\"value\":0.8}]}]}";

    private static final String GIANT_SLAYER_FORMULA =
        "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":1},{\"op\":\"min\",\"args\":["
            + "{\"op\":\"const\",\"value\":0.15},{\"op\":\"mul\",\"args\":["
            + "{\"op\":\"const\",\"value\":0.0001},{\"op\":\"max\",\"args\":["
            + "{\"op\":\"const\",\"value\":0},{\"op\":\"sub\",\"args\":["
            + "{\"op\":\"read\",\"path\":\"target.attr.hp.max\"},"
            + "{\"op\":\"read\",\"path\":\"target.attr.hp.base\"}]}]}]}]}]}";

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
        assertTrue(reservedSql.contains("'stage/incoming_crit_part_post_mitigation'"));
        assertTrue(reservedSql.contains("'channel/all_damage'"));
        assertTrue(reservedSql.contains("'value_policy/max'"));
        assertTrue(reservedSql.contains("'value_policy/subtract'"));
        assertTrue(reservedSql.contains("(20176,"));
        assertTrue(reservedSql.contains("(20176, 10016)"));
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
        assertTrue(reservedSql.contains("(20271,"));
        assertTrue(reservedSql.contains("(20272,"));
        assertTrue(reservedSql.contains("(10031,"));
        assertTrue(reservedSql.contains("(20273,"));
        assertTrue(reservedSql.contains("(20274,"));
        assertTrue(reservedSql.contains("(20275,"));
        assertTrue(reservedSql.contains("(20276,"));
        assertTrue(reservedSql.contains("(20216, 10019)"));
        assertTrue(reservedSql.contains("(20264, 10026)"));
        assertTrue(reservedSql.contains("(20265, 10027)"));
        assertTrue(reservedSql.contains("(20266, 10028)"));
        assertTrue(reservedSql.contains("(20267, 10029)"));
        assertTrue(reservedSql.contains("(20268, 10029)"));
        assertTrue(reservedSql.contains("(20269, 10030)"));
        assertTrue(reservedSql.contains("(20270, 10030)"));
        assertTrue(reservedSql.contains("(20271, 10029)"));
        assertTrue(reservedSql.contains("(20272, 10028)"));
        assertTrue(reservedSql.contains("(20273, 10031)"));
        assertTrue(reservedSql.contains("(20274, 10031)"));
        assertTrue(reservedSql.contains("(20275, 10031)"));
        assertTrue(reservedSql.contains("(20276, 10031)"));
        assertTrue(reservedSql.contains("'cast_origin'"));
        assertTrue(reservedSql.contains("'cast_origin/champion'"));
        assertTrue(reservedSql.contains("'cast_origin/item'"));
        assertTrue(reservedSql.contains("'cast_origin/pet'"));
        assertTrue(reservedSql.contains("'cast_origin/innate'"));
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
    void seedsRanduinsOmenResilienceIncomingCritPartMultiply() {
        assertContains("item_3143");
        assertContains("provider_item_3143_randuins_omen_resilience");
        assertContains("modifier_item_3143_randuins_omen_resilience");
        assertTrue(
            sql.contains("75") && sql.contains("350"),
            "must seed Randuin's Omen armor 75 / hp 350");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_item_3143_randuins_omen_resilience'[\\s\\S]{0,80}20122")
                .matcher(sql)
                .find(),
            "3143 provider kind must be equipment 20122");
        assertContains("{\"op\":\"const\",\"value\":0.70}");
        assertTrue(
            Pattern.compile(
                    "(?s)'modifier_item_3143_randuins_omen_resilience'\\s*,\\s*"
                        + "'provider_item_3143_randuins_omen_resilience'\\s*,\\s*"
                        + "'resilience_incoming_crit'\\s*,\\s*"
                        + "20264\\s*,\\s*20110\\s*,\\s*'hp'\\s*,\\s*"
                        + "20265\\s*,\\s*20272\\s*,\\s*20269\\s*,\\s*20271\\s*,\\s*"
                        + "0\\s*,\\s*20171\\s*,\\s*'resilience_incoming_crit'")
                .matcher(sql)
                .find(),
            "3143 modifier must be pipeline/damage/all_damage/all_instances/"
                + "incoming_crit_part_post_mitigation multiply 0.70 with hp FK anchor");
        assertTrue(
            Pattern.compile(
                    "(?s)'item_3143'\\s*,\\s*'provider_item_3143_randuins_omen_resilience'")
                .matcher(sql)
                .find(),
            "must mount Resilience provider to item_3143");
        assertFalse(
            Pattern.compile(
                    "(?s)'modifier_item_3143_randuins_omen_resilience'[\\s\\S]{0,200}20113")
                .matcher(sql)
                .find(),
            "3143 must not use selector/target 20113; owner-self 20110 only");
    }

    @Test
    void seedsGuardiansHornUndauntedIncomingPostMitigationSubtract() {
        assertContains("item_2051");
        assertContains("provider_item_2051_guardians_horn_undaunted");
        assertContains("modifier_item_2051_guardians_horn_undaunted_ordinary");
        assertContains("modifier_item_2051_guardians_horn_undaunted_dot");
        assertContains("20176");
        assertTrue(
            reservedSql.contains("'value_policy/subtract'"),
            "reserved vocabulary must define value_policy/subtract");
        assertTrue(
            reservedSql.contains("(20176, 10016)"),
            "20176 must relate to value_policy parent 10016");
        assertContains("type_id=62004 already bound");
        assertContains("type_key=damage_trait/dot already bound");
        assertTrue(
            Pattern.compile(
                    "(?is)62004[\\s\\S]{0,400}damage_trait/dot[\\s\\S]{0,400}NULL")
                .matcher(sql)
                .find(),
            "type 62004 must set reserved_type_id NULL");
        assertFalse(
            Pattern.compile("(?is)\\(62004\\s*,").matcher(reservedSql).find(),
            "reserved seed must not claim type_id 62004");
        assertFalse(
            reservedSql.contains("damage_trait/dot"),
            "reserved seed must not define damage_trait/dot");
        assertTrue(
            Pattern.compile(
                    "(?s)'item_2051'\\s*,\\s*'hp'\\s*,\\s*150")
                .matcher(sql)
                .find(),
            "must seed Guardian's Horn hp 150");
        assertFalse(
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.entity_attribute_values[\\s\\S]{0,400}"
                        + "'item_2051'[\\s\\S]{0,200}hp5flat")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write hp5flat attribute for item_2051");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_item_2051_guardians_horn_undaunted'[\\s\\S]{0,80}20122")
                .matcher(sql)
                .find(),
            "2051 provider kind must be equipment 20122");
        assertContains("{\"op\":\"const\",\"value\":15}");
        assertContains("{\"op\":\"const\",\"value\":3.75}");
        assertContains(
            "{\"op\":\"eq\",\"args\":[{\"op\":\"read\",\"path\":\"damage.trait.dot\"},"
                + "{\"op\":\"const\",\"value\":0}]}");
        assertContains(
            "{\"op\":\"eq\",\"args\":[{\"op\":\"read\",\"path\":\"damage.trait.dot\"},"
                + "{\"op\":\"const\",\"value\":1}]}");
        assertTrue(
            Pattern.compile(
                    "(?s)'modifier_item_2051_guardians_horn_undaunted_ordinary'\\s*,\\s*"
                        + "'provider_item_2051_guardians_horn_undaunted'\\s*,\\s*"
                        + "'undaunted_ordinary'\\s*,\\s*"
                        + "20264\\s*,\\s*20110\\s*,\\s*'hp'\\s*,\\s*"
                        + "20265\\s*,\\s*20272\\s*,\\s*20269\\s*,\\s*20268\\s*,\\s*"
                        + "0\\s*,\\s*20176\\s*,\\s*"
                        + "'undaunted_ordinary_value'\\s*,\\s*"
                        + "'undaunted_ordinary_condition'")
                .matcher(sql)
                .find(),
            "2051 ordinary modifier must be pipeline/damage/all_damage/all_instances/"
                + "incoming_post_mitigation subtract 15 with DoT=0 condition");
        assertTrue(
            Pattern.compile(
                    "(?s)'modifier_item_2051_guardians_horn_undaunted_dot'\\s*,\\s*"
                        + "'provider_item_2051_guardians_horn_undaunted'\\s*,\\s*"
                        + "'undaunted_dot'\\s*,\\s*"
                        + "20264\\s*,\\s*20110\\s*,\\s*'hp'\\s*,\\s*"
                        + "20265\\s*,\\s*20272\\s*,\\s*20269\\s*,\\s*20268\\s*,\\s*"
                        + "0\\s*,\\s*20176\\s*,\\s*"
                        + "'undaunted_dot_value'\\s*,\\s*"
                        + "'undaunted_dot_condition'")
                .matcher(sql)
                .find(),
            "2051 DoT modifier must be pipeline/damage/all_damage/all_instances/"
                + "incoming_post_mitigation subtract 3.75 with DoT=1 condition");
        assertTrue(
            Pattern.compile(
                    "(?s)'item_2051'\\s*,\\s*'provider_item_2051_guardians_horn_undaunted'")
                .matcher(sql)
                .find(),
            "must mount Undaunted provider to item_2051");
        assertContains("Undaunted");
        assertContains("2051");
        assertContains("damage_trait/dot");
        assertFalse(
            Pattern.compile(
                    "(?s)'modifier_item_2051_guardians_horn_undaunted_ordinary'[\\s\\S]{0,200}20113")
                .matcher(sql)
                .find(),
            "2051 must not use selector/target 20113; owner-self 20110 only");
    }

    @Test
    void seedsLordDominiksRegardsGiantSlayerOutgoingPreMitigationMultiply() {
        assertContains("item_3036");
        assertContains("provider_item_3036_giant_slayer");
        assertContains("modifier_item_3036_giant_slayer");
        assertContains("giant_slayer_outgoing_multiplier");
        assertContains("giant_slayer_outgoing_damage");
        assertContains(GIANT_SLAYER_FORMULA);
        assertContains("target.attr.hp.max");
        assertContains("target.attr.hp.base");
        assertContains("current-items.normalized.json item 3036");
        assertContains("Giant Slayer");
        assertContains("champion-source/target");
        assertContains("bonus health");
        assertTrue(
            Pattern.compile(
                    "(?s)'item_3036'\\s*,\\s*'ad'\\s*,\\s*35")
                .matcher(sql)
                .find(),
            "must seed Lord Dominik's Regards AD 35");
        assertTrue(
            Pattern.compile(
                    "(?s)'item_3036'\\s*,\\s*'crit_chance'\\s*,\\s*0\\.25")
                .matcher(sql)
                .find(),
            "must seed Lord Dominik's Regards crit_chance 0.25");
        assertFalse(
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.entity_attribute_values[\\s\\S]{0,400}"
                        + "'item_3036'[\\s\\S]{0,200}armor_pen_percent")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write armor_pen_percent for item_3036; Batch-C owns that stat");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_item_3036_giant_slayer'[\\s\\S]{0,80}20122")
                .matcher(sql)
                .find(),
            "3036 provider kind must be equipment 20122");
        assertTrue(
            Pattern.compile(
                    "(?s)'modifier_item_3036_giant_slayer'\\s*,\\s*"
                        + "'provider_item_3036_giant_slayer'\\s*,\\s*"
                        + "'giant_slayer_outgoing_damage'\\s*,\\s*"
                        + "20264\\s*,\\s*20110\\s*,\\s*'hp'\\s*,\\s*"
                        + "20265\\s*,\\s*20272\\s*,\\s*20269\\s*,\\s*20267\\s*,\\s*"
                        + "0\\s*,\\s*20171\\s*,\\s*'giant_slayer_outgoing_multiplier'")
                .matcher(sql)
                .find(),
            "3036 modifier must be pipeline/damage/all_damage/all_instances/"
                + "outgoing_pre_mitigation multiply giant_slayer with hp FK anchor");
        assertTrue(
            Pattern.compile(
                    "(?s)'item_3036'\\s*,\\s*'provider_item_3036_giant_slayer'")
                .matcher(sql)
                .find(),
            "must mount Giant Slayer provider to item_3036");
        assertFalse(
            Pattern.compile(
                    "(?s)'modifier_item_3036_giant_slayer'[\\s\\S]{0,200}20113")
                .matcher(sql)
                .find(),
            "3036 must not use selector/target 20113; owner-self 20110 only");
        assertTrue(
            GIANT_SLAYER_FORMULA.contains("\"op\":\"min\"")
                && GIANT_SLAYER_FORMULA.contains("0.15")
                && GIANT_SLAYER_FORMULA.contains("\"op\":\"max\"")
                && GIANT_SLAYER_FORMULA.contains("\"value\":0"),
            "Giant Slayer formula must clamp bonus HP at zero and cap amp at 15%");
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
        assertContains("3143");
        assertContains("2051");
        assertContains("3036");
        assertContains("Resilience");
        assertContains("Undaunted");
        assertContains("Guardian's Horn");
        assertContains("Lord Dominik");
        assertContains("Giant Slayer");
        assertContains("hp5flat");
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
