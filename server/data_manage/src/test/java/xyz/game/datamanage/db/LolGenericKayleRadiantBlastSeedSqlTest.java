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
 * Static contract for {@code lol_generic_kayle_radiant_blast_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericKayleRadiantBlastSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_kayle_radiant_blast_seed.sql";

    private static final List<String> STABLE_IDS = List.of(
        "hero_kayle",
        "provider_hero_kayle_radiant_blast",
        "modifier_hero_kayle_radiant_blast_armor",
        "modifier_hero_kayle_radiant_blast_mr",
        "kayle_q_sundered",
        "radiant_blast_armor_percent",
        "radiant_blast_mr_percent",
        "radiant_blast_damage",
        "sundered_arm",
        "q_mana_cost",
        "q_cooldown_ms",
        "ability_hero_kayle_q_radiant_blast",
        "radiant_blast",
        "cost_hero_kayle_q_radiant_blast_mana",
        "cooldown_hero_kayle_q_radiant_blast",
        "phase_hero_kayle_q_radiant_blast_impact",
        "sequence_hero_kayle_q_radiant_blast_impact",
        "step_hero_kayle_q_radiant_blast_damage",
        "step_hero_kayle_q_radiant_blast_sunder");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20100, 20110, 20111, 20113, 20120, 20130, 20142, 20150, 20160, 20170,
        20172, 20173, 20190, 20221, 20252, 20260);

    private static final String DAMAGE_FORMULA =
        "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":180},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.60},"
            + "{\"op\":\"sub\",\"args\":["
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.resolved\"},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.base\"}]}]},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.50},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ap.resolved\"}]}]}";

    private static final String SHRED_FORMULA =
        "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":-0.15},"
            + "{\"op\":\"read\",\"path\":\"provider.target_state.kayle_q_sundered\"}]}";

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
            "mount/link idempotent guard must use change_revision > v_locked_current");
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
            "radiant blast seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoLineComments).find(),
            "radiant blast seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoLineComments).find(),
            "radiant blast seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "radiant blast seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "radiant blast seed must not CREATE TABLE");
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
    void validatesPrerequisitesAndRequiredAttrsTypes() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("missing attribute_definitions");
        assertContains("INSERT INTO public.types");
        for (String attr : List.of(
            "hp", "mana", "ad", "ap", "attack_speed", "armor", "magic_resist",
            "hp_regen", "mana_regen")) {
            assertTrue(
                Pattern.compile("(?is)'" + attr + "'").matcher(sqlNoLineComments).find(),
                "must preflight or write attr_key=" + attr);
        }
        for (int typeId : REQUIRED_RESERVED) {
            assertContains(Integer.toString(typeId));
        }
        assertTrue(
            sql.contains("already bound to provider_id")
                || sql.contains("fail-closed")
                || Pattern.compile("(?i)conflict").matcher(sql).find(),
            "must fail closed on conflicting existing bindings");
    }

    @Test
    void projectsRequiredReservedTypesFailClosedWithoutMetadataOverwrite() {
        assertTrue(
            Pattern.compile("(?i)conflicting types by type_id").matcher(sql).find(),
            "must fail closed when required type_id identity conflicts");
        assertTrue(
            Pattern.compile("(?i)conflicting types by type_key").matcher(sql).find(),
            "must fail closed when required type_key identity conflicts");
        assertTrue(
            Pattern.compile(
                    "(?is)t\\.type_id\\s*=\\s*ANY\\s*\\(\\s*v_required_reserved\\s*\\)[\\s\\S]{0,400}"
                        + "t\\.type_key\\s+IS\\s+DISTINCT\\s+FROM\\s+rt\\.type_key[\\s\\S]{0,200}"
                        + "t\\.reserved_type_id\\s+IS\\s+DISTINCT\\s+FROM\\s+rt\\.type_id")
                .matcher(sqlNoLineComments)
                .find(),
            "type_id direction must compare both type_key and reserved_type_id");
        assertTrue(
            Pattern.compile(
                    "(?is)rt\\.type_key\\s*=\\s*t\\.type_key[\\s\\S]{0,400}"
                        + "rt\\.type_id\\s*=\\s*ANY\\s*\\(\\s*v_required_reserved\\s*\\)[\\s\\S]{0,400}"
                        + "t\\.type_id\\s+IS\\s+DISTINCT\\s+FROM\\s+rt\\.type_id[\\s\\S]{0,200}"
                        + "t\\.reserved_type_id\\s+IS\\s+DISTINCT\\s+FROM\\s+rt\\.type_id")
                .matcher(sqlNoLineComments)
                .find(),
            "type_key direction must compare both type_id and reserved_type_id");

        String reservedProjection = extractRequiredReservedTypesProjection(sqlNoLineComments);
        assertTrue(
            Pattern.compile(
                    "(?is)ON\\s+CONFLICT\\s*\\(\\s*game_id\\s*,\\s*type_id\\s*\\)\\s*DO\\s+NOTHING")
                .matcher(reservedProjection)
                .find(),
            "required reserved-type projection must use scoped DO NOTHING");
        assertFalse(
            Pattern.compile("(?is)DO\\s+UPDATE").matcher(reservedProjection).find(),
            "required reserved-type projection must not overwrite existing metadata");
        assertFalse(
            Pattern.compile("(?is)\\bEXCLUDED\\.(name|description|change_revision|updated_at)\\b")
                .matcher(reservedProjection)
                .find(),
            "reserved-type block must not assign excluded metadata onto existing rows");
        assertTrue(
            Pattern.compile("(?is)GET\\s+DIAGNOSTICS\\s+v_rowcount\\s*=\\s*ROW_COUNT")
                .matcher(reservedProjection)
                .find(),
            "reserved-type insert must measure rowcount for v_changed");
        assertTrue(
            Pattern.compile("(?is)IF\\s+v_rowcount\\s*>\\s*0\\s+THEN[\\s\\S]{0,80}v_changed\\s*:=\\s*true")
                .matcher(reservedProjection)
                .find(),
            "only newly inserted reserved-type rows may count as a change");
        assertFalse(
            sql.contains("已批准边界"),
            "seed header must not claim this Kayle Q boundary was user-approved");
        assertTrue(
            sql.contains("本任务冻结的边界") || sql.contains("冻结的边界"),
            "seed header must describe the frozen Kayle Q boundary");
    }

    @Test
    void ensuresSelfContainedHeroPanelAndManaResource() {
        assertContains("hero_kayle");
        assertContains("INSERT INTO public.game_entities");
        assertContains("INSERT INTO public.entity_attribute_values");
        assertTrue(
            Pattern.compile(
                    "(?is)ON\\s+CONFLICT\\s*\\(\\s*game_id\\s*,\\s*entity_id\\s*\\)\\s*DO\\s+NOTHING")
                .matcher(sqlNoLineComments)
                .find(),
            "game_entities ensure must DO NOTHING on conflict");
        assertTrue(
            sql.contains("670") && sql.contains("330") && sql.contains("50")
                && sql.contains(", 0,") && sql.contains("0.625") && sql.contains("26")
                && sql.contains("22") && sql.contains(", 5,") && sql.contains(", 8,"),
            "must seed Kayle level-1 panel numbers");
        assertTrue(
            Pattern.compile("(?s)'mana'\\s*,\\s*'法力'\\s*,\\s*0\\s*,\\s*0")
                .matcher(sql)
                .find(),
            "must project resource_definitions.mana");
        assertTrue(
            Pattern.compile("(?s)'hero_kayle'\\s*,\\s*'mana'\\s*,\\s*330\\s*,\\s*330")
                .matcher(sql)
                .find(),
            "must seed entity_resource_values mana 330/330");
        assertContains("INSERT INTO public.resource_definitions");
        assertContains("INSERT INTO public.entity_resource_values");
    }

    @Test
    void mountsOnlyRadiantBlastProviderOnHeroKayle() {
        assertContains("provider_hero_kayle_radiant_blast");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_kayle'\\s*,\\s*'provider_hero_kayle_radiant_blast'")
                .matcher(sql)
                .find(),
            "must mount radiant blast provider to hero_kayle");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_kayle_radiant_blast'[\\s\\S]{0,80}20120")
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
    void seedsProviderTargetSunderStateAndTwoFifteenPercentTargetModifiers() {
        assertContains("INSERT INTO public.provider_state_fields");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_kayle_radiant_blast'\\s*,\\s*"
                        + "'kayle_q_sundered'\\s*,\\s*"
                        + "20100\\s*,\\s*"
                        + "1\\s*,\\s*"
                        + "4000\\s*,\\s*"
                        + "20190")
                .matcher(sql)
                .find(),
            "state field must be max1 / 4000ms / refresh_on_write 20190");
        assertContains(SHRED_FORMULA);
        assertContains("provider.target_state.kayle_q_sundered");
        assertContains("\"value\":-0.15");
        assertTrue(
            Pattern.compile(
                    "(?s)'modifier_hero_kayle_radiant_blast_armor'\\s*,\\s*"
                        + "'provider_hero_kayle_radiant_blast'\\s*,\\s*"
                        + "'radiant_blast_armor_percent'\\s*,\\s*"
                        + "NULL\\s*,\\s*"
                        + "20113\\s*,\\s*"
                        + "'armor'[\\s\\S]*?"
                        + "20173\\s*,\\s*"
                        + "'radiant_blast_armor_percent'")
                .matcher(sql)
                .find(),
            "armor shred modifier must use selector/target 20113 and percent_add");
        assertTrue(
            Pattern.compile(
                    "(?s)'modifier_hero_kayle_radiant_blast_mr'\\s*,\\s*"
                        + "'provider_hero_kayle_radiant_blast'\\s*,\\s*"
                        + "'radiant_blast_mr_percent'\\s*,\\s*"
                        + "NULL\\s*,\\s*"
                        + "20113\\s*,\\s*"
                        + "'magic_resist'[\\s\\S]*?"
                        + "20173\\s*,\\s*"
                        + "'radiant_blast_mr_percent'")
                .matcher(sql)
                .find(),
            "MR shred modifier must use selector/target 20113 and percent_add");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_modifiers"),
            "must define modifiers in exactly one provider_modifiers insert");
    }

    @Test
    void seedsActiveQWithMana100Cooldown8000DamageBeforeStateAndExactlyOneDetail() {
        assertContains("INSERT INTO public.ability_definitions");
        assertTrue(
            Pattern.compile(
                    "(?s)'ability_hero_kayle_q_radiant_blast'\\s*,\\s*"
                        + "'provider_hero_kayle_radiant_blast'\\s*,\\s*"
                        + "'radiant_blast'\\s*,\\s*20130")
                .matcher(sql)
                .find(),
            "Q must be active ability with stable key radiant_blast");
        assertContains("INSERT INTO public.ability_costs");
        assertContains("{\"op\":\"const\",\"value\":100}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cost_hero_kayle_q_radiant_blast_mana'\\s*,\\s*"
                        + "'ability_hero_kayle_q_radiant_blast'\\s*,\\s*NULL\\s*,\\s*"
                        + "'mana'\\s*,\\s*'q_mana_cost'\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "Q mana cost must be ability-level 100 via ability_costs");
        assertContains("INSERT INTO public.ability_cooldowns");
        assertContains("{\"op\":\"const\",\"value\":8000}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cooldown_hero_kayle_q_radiant_blast'\\s*,\\s*"
                        + "'ability_hero_kayle_q_radiant_blast'\\s*,\\s*"
                        + "'q_cooldown_ms'\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "Q cooldown must be 8000ms via ability_cooldowns");
        assertContains(DAMAGE_FORMULA);
        assertContains("source.attr.ad.resolved");
        assertContains("source.attr.ad.base");
        assertContains("source.attr.ap.resolved");
        assertContains("\"value\":180");
        assertContains("\"value\":0.60");
        assertContains("\"value\":0.50");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_kayle_q_radiant_blast_damage'\\s*,\\s*"
                        + "'sequence_hero_kayle_q_radiant_blast_impact'\\s*,\\s*0\\s*,\\s*"
                        + "20150\\s*,\\s*20111\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "damage must be step_order 0 to opponent");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_kayle_q_radiant_blast_sunder'\\s*,\\s*"
                        + "'sequence_hero_kayle_q_radiant_blast_impact'\\s*,\\s*1\\s*,\\s*"
                        + "20160\\s*,\\s*20110\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "state override must be step_order 1 after damage");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_kayle_q_radiant_blast_damage'\\s*,\\s*"
                        + "'radiant_blast_damage'\\s*,\\s*20221\\s*,\\s*20170\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "Q damage must be magic 20221 add policy copyable_on_hit=false");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_kayle_q_radiant_blast_sunder'\\s*,\\s*"
                        + "20252\\s*,\\s*"
                        + "'kayle_q_sundered'\\s*,\\s*"
                        + "'sundered_arm'\\s*,\\s*"
                        + "20172")
                .matcher(sql)
                .find(),
            "state detail must override provider_target kayle_q_sundered to 1");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.damage_effect_details"),
            "must have exactly one damage_effect_details insert");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.state_effect_details"),
            "must have exactly one state_effect_details insert");
        assertTrue(
            sql.contains("exactly-one-detail") || sql.contains("deferred exactly-one-detail"),
            "seed must document deferred exactly-one-detail pairing");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.provider_listeners\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write provider_listeners");
        assertFalse(
            Pattern.compile("(?i)probe|production.?probe").matcher(sqlNoLineComments).find(),
            "must not include production probe ability");
    }

    @Test
    void citesWikiRevisionShaSeparatesBootstrapRevisionAndForbidsForbiddenProvenance() {
        assertContains("Template:Data Kayle/Radiant Blast");
        assertContains("4005105");
        assertContains("ded516de4861d88de21ba54de9a8723b654f424f1cc3f9dac30d06382ee1a87c");
        assertContains(
            "数据参考/lol-wiki-current-champions/normalized/generic/kayle-q.json");
        assertContains("hero_skill|hero_kayle|Q|耀焰冲击");
        assertContains("4042886");
        assertContains("Module:ChampionData/data");
        assertTrue(
            sql.contains("分离") || sql.contains("separate") || sql.contains("不作 Q 完成"),
            "must document bootstrap revision separation from Q Wiki truth");
        assertTrue(
            Pattern.compile("(?i)不 invent|不 claim|不 invent / 不 claim|Do not invent|不 claim 本地")
                .matcher(sql)
                .find()
                || (sql.contains("不 invent") || sql.contains("不 claim")),
            "must not invent or claim a local Module content hash");
        assertFalse(
            Pattern.compile(
                    "(?i)Module:ChampionData/data[\\s\\S]{0,200}content\\s*SHA256\\s+[0-9a-f]{64}")
                .matcher(sql)
                .find(),
            "must not claim a Module content hash");
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
            Pattern.compile("(?i)ddragon|data.?dragon|champion-static|Kayle\\.json")
                .matcher(sqlNoLineComments)
                .find(),
            "must not use DDragon/champion-static numeric provenance");
        assertFalse(
            Pattern.compile("(?i)rank\\s*[1-4]\\b|ranks?\\s*=\\s*\\[|maxrank")
                .matcher(sqlNoLineComments)
                .find(),
            "must not model other ranks / rank tables");
        assertFalse(
            Pattern.compile(
                    "(?i)slow|减速|projectile|弹道|cast.?delay|施法延迟|"
                        + "multi.?target|多目标|cross|十字|death.?persist|死亡后")
                .matcher(sqlNoLineComments)
                .find(),
            "must not model excluded slow/projectile/multi-target/death surfaces");
        Set<String> seen = new HashSet<>();
        for (String id : STABLE_IDS) {
            assertTrue(seen.add(id), "stable id list itself must be unique: " + id);
            assertContains(id);
        }
        assertContains("ON CONFLICT");
        assertContains("IS DISTINCT FROM");
    }

    private static String extractRequiredReservedTypesProjection(String body) {
        java.util.regex.Matcher start = Pattern.compile(
                "(?is)INSERT\\s+INTO\\s+public\\.types\\b[\\s\\S]*?"
                    + "FROM\\s+public\\.reserved_type\\s+rt\\b[\\s\\S]*?"
                    + "WHERE\\s+rt\\.type_id\\s*=\\s*ANY\\s*\\(\\s*v_required_reserved\\s*\\)")
            .matcher(body);
        assertTrue(start.find(), "must contain required reserved-type INSERT projection");
        int from = start.start();
        java.util.regex.Matcher end = Pattern.compile("(?is)GET\\s+DIAGNOSTICS\\s+v_rowcount\\s*=\\s*ROW_COUNT")
            .matcher(body);
        assertTrue(
            end.find(from),
            "reserved-type projection must be followed by GET DIAGNOSTICS v_rowcount");
        java.util.regex.Matcher changed = Pattern.compile(
                "(?is)IF\\s+v_rowcount\\s*>\\s*0\\s+THEN[\\s\\S]*?v_changed\\s*:=\\s*true\\s*;\\s*END\\s+IF\\s*;")
            .matcher(body);
        assertTrue(
            changed.find(end.start()),
            "reserved-type projection must update v_changed from insert rowcount");
        return body.substring(from, changed.end());
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
