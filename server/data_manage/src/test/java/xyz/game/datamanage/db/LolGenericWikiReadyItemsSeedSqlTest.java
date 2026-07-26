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
import java.util.List;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * Static contract for {@code lol_generic_wiki_ready_items_seed.sql}.
 * Does not connect to a live database.
 *
 * <p>Covers Wiki-ready mechanisms:
 * <ul>
 *   <li>item_2501 Tyranny — owner-self AD from bonus HP (add@0)</li>
 *   <li>item_2501 Retribution — owner-self AD multiply from missing HP (multiply@100)</li>
 *   <li>item_3097 Bolt — precharge window only (charge@100 → damage → consume 0)</li>
 *   <li>item_3075 Thorns — target-owned source_opponent reflect</li>
 * </ul>
 */
class LolGenericWikiReadyItemsSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_wiki_ready_items_seed.sql";

    private static final List<String> STABLE_IDS = List.of(
        "item_2501",
        "item_3097",
        "item_3075",
        "provider_item_2501_tyranny",
        "modifier_item_2501_tyranny_ad",
        "tyranny_bonus_ad",
        "modifier_item_2501_retribution_ad",
        "retribution_ad_multiplier",
        "provider_item_3097_bolt",
        "listener_item_3097_bolt",
        "sequence_item_3097_bolt",
        "step_item_3097_bolt_damage",
        "step_item_3097_bolt_consume",
        "energized_charge",
        "energized_ready",
        "bolt_damage",
        "energized_consume",
        "provider_item_3075_thorns",
        "listener_item_3075_thorns",
        "sequence_item_3075_thorns",
        "step_item_3075_thorns_damage",
        "thorns_damage",
        "bonus_armor");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20100, 20110, 20111, 20113, 20120, 20150, 20160, 20170, 20171, 20172, 20181,
        20211, 20212, 20213, 20221, 20250);

    private static final String TYRANNY_FORMULA =
        "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.025},"
            + "{\"op\":\"max\",\"args\":[{\"op\":\"const\",\"value\":0},"
            + "{\"op\":\"sub\",\"args\":[{\"op\":\"read\",\"path\":\"$owner.attr.hp.max\"},"
            + "{\"op\":\"read\",\"path\":\"$owner.attr.hp.base\"}]}]}]}";

    private static final String RETRIBUTION_FORMULA =
        "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":1},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"clamp\",\"expr\":{\"op\":\"div\",\"args\":["
            + "{\"op\":\"max\",\"args\":[{\"op\":\"const\",\"value\":0},"
            + "{\"op\":\"sub\",\"args\":[{\"op\":\"read\",\"path\":\"$owner.attr.hp.max\"},"
            + "{\"op\":\"read\",\"path\":\"$owner.attr.hp.current\"}]}]},"
            + "{\"op\":\"max\",\"args\":[{\"op\":\"const\",\"value\":1},"
            + "{\"op\":\"read\",\"path\":\"$owner.attr.hp.max\"}]}]},"
            + "\"min\":{\"op\":\"const\",\"value\":0},\"max\":{\"op\":\"const\",\"value\":0.70}},"
            + "{\"op\":\"div\",\"args\":[{\"op\":\"const\",\"value\":0.12},"
            + "{\"op\":\"const\",\"value\":0.70}]}]}]}";

    private static final String THORNS_FORMULA =
        "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":20},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.10},"
            + "{\"op\":\"read\",\"path\":\"$owner.attr.bonus_armor.resolved\"}]}]}";

    private static final String BOLT_READY =
        "{\"op\":\"gte\",\"args\":[{\"op\":\"read\",\"path\":\"provider.state.energized_charge\"},"
            + "{\"op\":\"const\",\"value\":100}]}";

    private static final String WIKI_MANIFEST_PATH =
        "数据参考/lol-wiki-current-items/manifest.json";
    private static final String WIKI_CONTENT_SHA256 =
        "e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d";
    private static final String WIKI_REVID = "4030984";

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
            "wiki-ready items seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoLineComments).find(),
            "wiki-ready items seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoLineComments).find(),
            "wiki-ready items seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "wiki-ready items seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "wiki-ready items seed must not CREATE TABLE");
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
        assertFalse(
            Pattern.compile("(?i)single_attacker_dps").matcher(sqlNoLineComments).find(),
            "must not reference single_attacker_dps");
        assertFalse(
            Pattern.compile("(?i)energized_charge_and_consume").matcher(sqlNoLineComments).find(),
            "must not revive legacy energized triggerKind");
        assertFalse(
            Pattern.compile("(?i)live\\s*migration|migration\\.sql|compatibility_migration")
                .matcher(sqlNoLineComments)
                .find(),
            "must not encode live migration behavior");
        assertFalse(
            Pattern.compile("(?i)migrations/").matcher(sqlNoLineComments).find(),
            "must not reference migration paths");
    }

    @Test
    void validatesPrerequisitesAndEnsuresBonusArmor() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("missing attribute_definitions");
        assertTrue(
            Pattern.compile(
                    "(?is)ARRAY\\s*\\[\\s*'hp'\\s*,\\s*'ad'\\s*,\\s*'armor'\\s*,\\s*"
                        + "'attack_speed'\\s*,\\s*'crit_chance'\\s*\\]")
                .matcher(sqlNoLineComments)
                .find(),
            "must preflight hp/ad/armor/attack_speed/crit_chance");
        assertTrue(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.attribute_definitions\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must ensure bonus_armor attribute_definition");
        assertContains("'bonus_armor'");
        assertFalse(
            Pattern.compile("(?is)'bonus_magic_resist'").matcher(sqlNoLineComments).find(),
            "this seed must not ensure unrelated bonus_magic_resist");
        for (int typeId : REQUIRED_RESERVED) {
            assertContains(Integer.toString(typeId));
        }
        for (String id : STABLE_IDS) {
            assertContains(id);
        }
    }

    @Test
    void ensuresThreeItemsWithMinimalStaticAttrsOnly() {
        assertTrue(
            Pattern.compile("(?s)'item_2501'\\s*,\\s*'ad'\\s*,\\s*30").matcher(sql).find(),
            "item_2501 must ensure ad=30");
        assertTrue(
            Pattern.compile("(?s)'item_2501'\\s*,\\s*'hp'\\s*,\\s*550").matcher(sql).find(),
            "item_2501 must ensure hp=550");
        assertTrue(
            Pattern.compile("(?s)'item_3097'\\s*,\\s*'ad'\\s*,\\s*50").matcher(sql).find(),
            "item_3097 must ensure ad=50");
        assertTrue(
            Pattern.compile("(?s)'item_3097'\\s*,\\s*'attack_speed'\\s*,\\s*0\\.2")
                .matcher(sql)
                .find(),
            "item_3097 must ensure attack_speed=0.2");
        assertTrue(
            Pattern.compile("(?s)'item_3097'\\s*,\\s*'crit_chance'\\s*,\\s*0\\.25")
                .matcher(sql)
                .find(),
            "item_3097 must ensure crit_chance=0.25");
        assertTrue(
            Pattern.compile("(?s)'item_3075'\\s*,\\s*'armor'\\s*,\\s*75").matcher(sql).find(),
            "item_3075 must ensure armor=75");
        assertTrue(
            Pattern.compile("(?s)'item_3075'\\s*,\\s*'hp'\\s*,\\s*150").matcher(sql).find(),
            "item_3075 must ensure hp=150");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.game_entities"),
            "must ensure entities in a single insert block");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.entity_attribute_values"),
            "must ensure static attrs in a single insert block");
        assertFalse(sql.contains("item_3087"), "must not touch Statikk Shiv item_3087");
        assertFalse(sql.contains("item_6665"), "must not touch Jak'Sho item_6665");
        assertFalse(sql.contains("item_3004"), "must not touch Manamune item_3004");
    }

    @Test
    void tyrannyOwnerSelfAdModifierUsesBonusHpClamp() {
        assertContains(TYRANNY_FORMULA);
        assertContains("0.025");
        assertContains("$owner.attr.hp.max");
        assertContains("$owner.attr.hp.base");
        assertContains("\"op\":\"max\"");
        assertContains("\"op\":\"sub\"");
        assertTrue(
            Pattern.compile(
                    "(?s)'item_2501'\\s*,\\s*'provider_item_2501_tyranny'")
                .matcher(sql)
                .find(),
            "must mount Tyranny provider to item_2501");
        assertTrue(
            Pattern.compile(
                    "(?s)'modifier_item_2501_tyranny_ad'\\s*,\\s*"
                        + "'provider_item_2501_tyranny'\\s*,\\s*"
                        + "'tyranny_bonus_ad'\\s*,\\s*"
                        + "NULL\\s*,\\s*"
                        + "20110\\s*,\\s*"
                        + "'ad'[\\s\\S]*?"
                        + "20170\\s*,\\s*"
                        + "'tyranny_bonus_ad'")
                .matcher(sql)
                .find(),
            "Tyranny modifier must be owner-self add to ad");
        assertTrue(
            Pattern.compile(
                    "(?s)'modifier_item_2501_tyranny_ad'[\\s\\S]*?"
                        + "NULL\\s*,\\s*"
                        + "0\\s*,\\s*"
                        + "20170")
                .matcher(sql)
                .find(),
            "Tyranny must keep add priority 0 with stage NULL");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.provider_listeners\\b[\\s\\S]*?"
                    + "provider_item_2501_tyranny")
                .matcher(sqlNoLineComments)
                .find(),
            "Tyranny must not use listeners");
        assertFalse(
            Pattern.compile(
                    "(?s)tyranny_bonus_ad[\\s\\S]{0,400}"
                        + "\\$owner\\.attr\\.hp\\.resolved")
                .matcher(sqlNoLineComments)
                .find(),
            "Tyranny must read hp.max/hp.base, not hp.resolved");
    }

    @Test
    void retributionMultiplyModifierUsesMissingHpAndWikiProvenance() {
        assertContains(RETRIBUTION_FORMULA);
        assertContains(WIKI_MANIFEST_PATH);
        assertContains(WIKI_CONTENT_SHA256);
        assertContains(WIKI_REVID);
        assertContains("$owner.attr.hp.current");
        assertContains("0.12");
        assertContains("0.70");
        assertContains("\"op\":\"clamp\"");
        assertTrue(
            Pattern.compile(
                    "(?s)'modifier_item_2501_retribution_ad'\\s*,\\s*"
                        + "'provider_item_2501_tyranny'\\s*,\\s*"
                        + "'retribution_ad_multiplier'\\s*,\\s*"
                        + "NULL\\s*,\\s*"
                        + "20110\\s*,\\s*"
                        + "'ad'[\\s\\S]*?"
                        + "NULL\\s*,\\s*"
                        + "100\\s*,\\s*"
                        + "20171\\s*,\\s*"
                        + "'retribution_ad_multiplier'")
                .matcher(sql)
                .find(),
            "Retribution must be owner-self multiply to ad with priority 100 / policy 20171");
        assertTrue(
            Pattern.compile(
                    "(?s)'modifier_item_2501_retribution_ad'[\\s\\S]*?"
                        + "100\\s*,\\s*20171")
                .matcher(sql)
                .find(),
            "Retribution priority must exceed Tyranny add priority 0");
        assertTrue(
            Pattern.compile("(?is)20171\\s*,\\s*--\\s*value_policy/multiply")
                .matcher(sql)
                .find(),
            "required reserved types must include 20171 value_policy/multiply");
        assertFalse(
            Pattern.compile(
                    "(?s)retribution_ad_multiplier[\\s\\S]{0,800}"
                        + "\\$owner\\.attr\\.ad\\.resolved")
                .matcher(sqlNoLineComments)
                .find(),
            "Retribution formula must not read $owner.attr.ad.resolved");
        assertFalse(
            Pattern.compile("(?i)ddragon|data.?dragon").matcher(sql).find(),
            "must not cite DDragon / Data Dragon as numeric provenance");
        assertFalse(
            Pattern.compile(
                    "(?s)'modifier_item_2501_retribution_ad'[\\s\\S]{0,200}"
                        + "stage_type_id\\s*=\\s*(?!NULL)\\d+")
                .matcher(sqlNoLineComments)
                .find(),
            "Retribution must leave stage NULL; no new stage");
    }

    @Test
    void boltPrechargeWindowDamageThenConsumeWithoutChargeAdd() {
        assertTrue(
            sql.contains("assumes_charge_at_threshold_before_dps_window"),
            "Bolt must document assumes_charge_at_threshold_before_dps_window");
        assertTrue(
            Pattern.compile("(?i)remaining\\s+gap").matcher(sql).find(),
            "Bolt must document charge recovery as remaining gap");
        assertContains(BOLT_READY);
        assertContains("{\"op\":\"const\",\"value\":100}");
        assertContains("{\"op\":\"const\",\"value\":0}");
        assertTrue(
            Pattern.compile(
                    "(?s)'energized_charge'[\\s\\S]{0,120}20100[\\s\\S]{0,40}100"
                        + "[\\s\\S]{0,40}NULL[\\s\\S]{0,40}NULL")
                .matcher(sql)
                .find(),
            "Bolt charge state must be number / max 100 / untimed");
        assertFalse(
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.provider_state_fields\\b[\\s\\S]*?"
                        + "default_value")
                .matcher(sqlNoLineComments)
                .find(),
            "provider_state_fields has no default column; seed must not invent one");
        assertTrue(
            Pattern.compile(
                    "(?s)'item_3097'\\s*,\\s*'provider_item_3097_bolt'")
                .matcher(sql)
                .find(),
            "must mount Bolt provider to item_3097");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_3097_bolt'[\\s\\S]{0,200}20211[\\s\\S]{0,80}1")
                .matcher(sql)
                .find(),
            "Bolt listener must be basic_attack_hit 20211 with max_triggers_per_event=1");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_3097_bolt'\\s*,\\s*20181\\s*,\\s*20211")
                .matcher(sql)
                .find(),
            "Bolt listener must ALL-match 20211");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_3097_bolt'\\s*,\\s*20181\\s*,\\s*20212")
                .matcher(sql)
                .find(),
            "Bolt listener must ALL-match source_owner 20212");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3097_bolt_damage'\\s*,\\s*"
                        + "'sequence_item_3097_bolt'\\s*,\\s*0\\s*,\\s*20150\\s*,"
                        + "\\s*20111\\s*,\\s*'energized_ready'")
                .matcher(sql)
                .find(),
            "Bolt step 0 must be damage to opponent gated by energized_ready");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3097_bolt_consume'\\s*,\\s*"
                        + "'sequence_item_3097_bolt'\\s*,\\s*1\\s*,\\s*20160\\s*,"
                        + "\\s*20110\\s*,\\s*'energized_ready'")
                .matcher(sql)
                .find(),
            "Bolt step 1 must be consume state_change gated by energized_ready");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3097_bolt_damage'\\s*,\\s*"
                        + "'bolt_damage'\\s*,\\s*20221\\s*,\\s*20170")
                .matcher(sql)
                .find(),
            "Bolt damage must be magic 20221 with add policy");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3097_bolt_damage'[\\s\\S]{0,200}false")
                .matcher(sql)
                .find(),
            "Bolt copyable_on_hit must be explicit false");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3097_bolt_consume'[\\s\\S]{0,200}"
                        + "20250[\\s\\S]{0,40}'energized_charge'[\\s\\S]{0,40}"
                        + "'energized_consume'[\\s\\S]{0,40}20172")
                .matcher(sql)
                .find(),
            "Bolt consume must override charge to 0 via provider scope / policy 20172");
        assertFalse(
            Pattern.compile("(?i)charge_add|energized_charge_add").matcher(sqlNoLineComments).find(),
            "Bolt must not write fictional charge_add");
        assertFalse(
            Pattern.compile("(?i)step_item_3097_bolt_charge").matcher(sql).find(),
            "Bolt must not define a charge-add step");
        assertFalse(
            Pattern.compile("(?i)movement|distance\\s*charge|move(?:ment)?\\s*charge")
                .matcher(sqlNoLineComments)
                .find(),
            "Bolt must not model movement/distance charge rates");
        assertFalse(
            Pattern.compile("(?i)provider_lifecycles").matcher(sqlNoLineComments).find(),
            "Bolt must not use lifecycle for untimed precharge");
    }

    @Test
    void thornsTargetOwnedOpponentSourceReadsOwnerBonusArmor() {
        assertContains(THORNS_FORMULA);
        assertContains("0.10");
        assertContains("$owner.attr.bonus_armor.resolved");
        assertTrue(
            Pattern.compile(
                    "(?s)'item_3075'\\s*,\\s*'provider_item_3075_thorns'")
                .matcher(sql)
                .find(),
            "must mount Thorns provider to item_3075");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_3075_thorns'\\s*,\\s*20181\\s*,\\s*20211")
                .matcher(sql)
                .find(),
            "Thorns listener must ALL-match basic_attack_hit 20211");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_3075_thorns'\\s*,\\s*20181\\s*,\\s*20213")
                .matcher(sql)
                .find(),
            "Thorns listener must ALL-match source_opponent 20213");
        assertFalse(
            Pattern.compile(
                    "(?s)'listener_item_3075_thorns'\\s*,\\s*20181\\s*,\\s*20212")
                .matcher(sql)
                .find(),
            "Thorns must not match source_owner");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3075_thorns_damage'\\s*,\\s*"
                        + "'sequence_item_3075_thorns'\\s*,\\s*0\\s*,\\s*20150\\s*,"
                        + "\\s*20113\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "Thorns damage must target owner-relative selector/target 20113");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3075_thorns_damage'\\s*,\\s*"
                        + "'thorns_damage'\\s*,\\s*20221\\s*,\\s*20170")
                .matcher(sql)
                .find(),
            "Thorns damage must be magic 20221 with add policy");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3075_thorns_damage'[\\s\\S]{0,200}false")
                .matcher(sql)
                .find(),
            "Thorns copyable_on_hit must be explicit false");
        assertFalse(
            Pattern.compile(
                    "(?s)thorns_damage[\\s\\S]{0,400}"
                        + "(?:\\$opponent|event\\.(?:entry_)?source)\\.attr\\."
                        + "(?:armor|bonus_armor)")
                .matcher(sqlNoLineComments)
                .find(),
            "Thorns formula must read owner bonus_armor, not attacker armor");
        assertFalse(
            Pattern.compile("(?i)grievous|重伤|healing\\s*reduction")
                .matcher(sqlNoLineComments)
                .find(),
            "Thorns grievous/重伤 branch must not be implemented this batch");
    }

    @Test
    void mountsExactlyThreeProvidersAndNoUnrelatedItems() {
        assertEquals(
            3,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_definitions"),
            "must define exactly three providers");
        assertEquals(
            3,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.entity_provider_mounts"),
            "must mount exactly three provider mounts");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_item_2501_tyranny'[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "Tyranny provider kind must be passive 20120");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_item_3097_bolt'[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "Bolt provider kind must be passive 20120");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_item_3075_thorns'[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "Thorns provider kind must be passive 20120");
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
