package xyz.game.datamanage.db;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * Self-contained static SQL contract for {@code lol_batch_c_adc_items_seed.sql}.
 * Asserts SQL-internal consistency and retained historical provenance metadata; does not read
 * deleted Data Dragon / Batch-C JSON oracles. Does not connect to a live database.
 */
class LolBatchCAdcItemsSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_batch_c_adc_items_seed.sql";

    private static final int EXPECTED_ITEMS = 53;
    private static final int EXPECTED_MODIFIERS = 151;
    private static final int EXPECTED_ATTR_KEYS = 16;

    private static final List<String> REQUIRED_ATTRS = List.of(
        "ad",
        "ap",
        "hp",
        "mana",
        "armor",
        "magic_resist",
        "ability_haste",
        "attack_speed",
        "crit_chance",
        "crit_damage",
        "life_steal",
        "omnivamp",
        "armor_pen_flat",
        "armor_pen_percent",
        "ms_pct",
        "tenacity");

    private static final Pattern ENTITY_ROW =
        Pattern.compile(
            "\\(v_game_id,\\s*'(item_\\d+)',\\s*'[^']*',\\s*NULL,\\s*v_candidate,\\s*NOW\\(\\)\\)");
    private static final Pattern ATTR_ROW =
        Pattern.compile(
            "\\(v_game_id,\\s*'(item_\\d+)',\\s*'([a-z_]+)',\\s*([0-9.]+),\\s*v_candidate,\\s*NOW\\(\\)\\)");
    private static final Pattern RELATION_ROW =
        Pattern.compile(
            "\\(v_game_id,\\s*62002,\\s*'entity',\\s*'(item_\\d+)',\\s*'(\\{.*?\\})'::jsonb,\\s*v_candidate,\\s*NOW\\(\\)\\)");

    private static String sql;

    @BeforeAll
    static void loadSeedSql() throws IOException {
        Path seedPath = resolveRelative(SEED_RELATIVE);
        assertTrue(Files.isRegularFile(seedPath), "seed sql missing: " + seedPath);
        sql = Files.readString(seedPath, StandardCharsets.UTF_8);
    }

    @Test
    void sqlEntityRelationAndAttributeSetsAreInternallyConsistent() {
        Set<String> entityIds = new LinkedHashSet<>();
        Matcher entityMatcher = ENTITY_ROW.matcher(sql);
        while (entityMatcher.find()) {
            assertTrue(entityIds.add(entityMatcher.group(1)), "duplicate entity row: " + entityMatcher.group(1));
        }
        assertEquals(EXPECTED_ITEMS, entityIds.size(), "must seed 53 unique game_entities");

        Set<String> relationTargets = new LinkedHashSet<>();
        Matcher relationMatcher = RELATION_ROW.matcher(sql);
        while (relationMatcher.find()) {
            assertTrue(
                relationTargets.add(relationMatcher.group(1)),
                "duplicate type_relation: " + relationMatcher.group(1));
        }
        assertEquals(EXPECTED_ITEMS, relationTargets.size(), "must seed 53 unique type_relations");
        assertEquals(entityIds, relationTargets, "relation targets must equal entity set");

        Set<String> sqlTuples = new HashSet<>();
        Set<String> usedAttrs = new HashSet<>();
        Matcher attrMatcher = ATTR_ROW.matcher(sql);
        while (attrMatcher.find()) {
            String entityId = attrMatcher.group(1);
            assertTrue(entityIds.contains(entityId), "attr tuple owned by unknown entity: " + entityId);
            double attrValue = Double.parseDouble(attrMatcher.group(3));
            assertTrue(
                attrValue != 0.0d,
                "attr value must be non-zero: " + entityId + "|" + attrMatcher.group(2) + "|" + attrMatcher.group(3));
            String tuple =
                entityId + "|" + attrMatcher.group(2) + "|" + normalizeNumber(attrMatcher.group(3));
            assertTrue(sqlTuples.add(tuple), "duplicate attr tuple: " + tuple);
            usedAttrs.add(attrMatcher.group(2));
        }
        assertEquals(EXPECTED_MODIFIERS, sqlTuples.size(), "must seed 151 unique non-zero attribute tuples");
        assertEquals(EXPECTED_ATTR_KEYS, usedAttrs.size(), "must use exactly 16 attr keys");
        assertEquals(new HashSet<>(REQUIRED_ATTRS), usedAttrs, "used attr keys must equal REQUIRED_ATTRS");
    }

    @Test
    void anchorsBorkGuinsooKrakenFirstAndLast() {
        assertContains("(v_game_id, 'item_2501', '霸王血铠', NULL, v_candidate, NOW())");
        assertContains("(v_game_id, 'item_2501', 'ad', 30, v_candidate, NOW())");
        assertContains("(v_game_id, 'item_2501', 'hp', 550, v_candidate, NOW())");

        assertContains("(v_game_id, 'item_3124', '鬼索的狂暴之刃', NULL, v_candidate, NOW())");
        assertContains("(v_game_id, 'item_3124', 'ad', 30, v_candidate, NOW())");
        assertContains("(v_game_id, 'item_3124', 'ap', 30, v_candidate, NOW())");
        assertContains("(v_game_id, 'item_3124', 'attack_speed', 0.25, v_candidate, NOW())");

        assertContains("(v_game_id, 'item_3153', '破败王者之刃', NULL, v_candidate, NOW())");
        assertContains("(v_game_id, 'item_3153', 'ad', 40, v_candidate, NOW())");
        assertContains("(v_game_id, 'item_3153', 'attack_speed', 0.25, v_candidate, NOW())");
        assertContains("(v_game_id, 'item_3153', 'life_steal', 0.1, v_candidate, NOW())");

        assertContains("(v_game_id, 'item_6672', '海妖杀手', NULL, v_candidate, NOW())");
        assertContains("(v_game_id, 'item_6672', 'ad', 45, v_candidate, NOW())");
        assertContains("(v_game_id, 'item_6672', 'attack_speed', 0.4, v_candidate, NOW())");
        assertContains("(v_game_id, 'item_6672', 'ms_pct', 0.04, v_candidate, NOW())");

        assertContains("(v_game_id, 'item_6699', '电震涡流剑', NULL, v_candidate, NOW())");
        assertContains("(v_game_id, 'item_6699', 'ability_haste', 10, v_candidate, NOW())");
        assertContains("(v_game_id, 'item_6699', 'ad', 55, v_candidate, NOW())");
        assertContains("(v_game_id, 'item_6699', 'armor_pen_flat', 10, v_candidate, NOW())");

        assertContains("\"sourceItemId\":\"2501\"");
        assertContains("\"sourceItemId\":\"3124\"");
        assertContains("\"sourceItemId\":\"3153\"");
        assertContains("\"sourceItemId\":\"6672\"");
        assertContains("\"sourceItemId\":\"6699\"");
    }

    @Test
    void typeIdKeyCategoryAndExtendContract() {
        assertContains("62002");
        assertContains("tag/adc_completed_item");
        assertContains("ADC completed item");
        assertContains("NULL");
        assertTrue(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.types\\b").matcher(sql).find(),
            "must INSERT public.types");
        assertContains("'entity'");
        assertFalse(
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.type_relations\\b[\\s\\S]*?'equipment'")
                .matcher(sql)
                .find(),
            "final type_relations INSERT must not use legacy target_category=equipment");
        assertFalse(
            Pattern.compile("(?i)type_key\\s*=\\s*'entity/").matcher(sql).find()
                || sql.contains("'entity/"),
            "must not use type_key in entity/* domain");
        assertContains("\"batch\":\"V2-Batch-C\"");
        assertContains("\"role\":\"adc_completed_item\"");
        // Retained historical provenance in SQL extend metadata (not an active Data Dragon read).
        assertContains("\"source\":\"数据参考/item.json\"");
        assertContains("\"sourceVersion\":\"16.9.1\"");
        assertContains("\"sourceItemId\"");
        assertContains("\"sourceTags\"");
        assertContains("\"goldCost\"");
        assertContains("\"iconUrl\"");
        assertContains("\"statKeys\"");
        assertContains(
            "\"selectionRule\":\"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats\"");
        assertContains("::jsonb");
    }

    @Test
    void requiresSixteenAttributeDefinitionsAndCollisionGuards() {
        assertEquals(16, REQUIRED_ATTRS.size());
        assertContains("v_required_attrs");
        for (String attr : REQUIRED_ATTRS) {
            assertTrue(sql.contains("'" + attr + "'"), "required attrs must include " + attr);
        }
        assertContains("missing attribute_definitions");
        assertContains("RAISE EXCEPTION");
        assertContains("type_id=62002 already bound to type_key");
        assertContains("type_key=tag/adc_completed_item already bound to type_id");
        assertContains("type/62002");
        assertContains("adc_completed_item");
        assertContains("known placeholder");
        assertFalse(sql.contains("v_required_reserved"), "must not invent/require reserved types");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.reserved_type\\b").matcher(sql).find(),
            "must not insert reserved_type rows");
    }

    @Test
    void usesTransactionLockEnsureAndIdempotentRevisionGuard() {
        assertTrue(sql.trim().startsWith("BEGIN;") || sql.contains("\nBEGIN;\n"), "must BEGIN");
        assertTrue(
            sql.trim().endsWith("COMMIT;")
                || sql.contains("\nCOMMIT;\n")
                || sql.endsWith("COMMIT;\n"),
            "must COMMIT");
        assertContains("ensure_game_partitions");
        assertContains("FOR UPDATE");
        assertContains("v_candidate := v_locked_current + 1");
        assertContains("IF v_changed THEN");
        assertContains("current_revision = v_candidate");
        assertContains("IS DISTINCT FROM");
        assertContains("ON CONFLICT");
        assertTrue(
            sql.contains("change_revision > v_locked_current"),
            "type_relations upsert must guard stale out-of-bound revision");
        assertFalse(sql.contains("versions:publish"), "seed must not auto-publish");
        assertFalse(
            Pattern.compile("(?i)\\bpublish_version\\b").matcher(sql).find(),
            "seed must not call publish helpers");
    }

    @Test
    void permitsOnlyKnownPlaceholderTypeUpgrade() {
        assertTrue(
            Pattern.compile(
                    "(?is)t\\.type_key\\s*=\\s*'type/62002'\\s+AND\\s+t\\.reserved_type_id\\s+IS\\s+NULL\\s+AND\\s+t\\.name\\s+IN\\s*\\(\\s*'adc_completed_item'\\s*,\\s*'ADC completed item'\\s*\\)")
                .matcher(sql)
                .find(),
            "must allow only type/62002 + reserved NULL + known name as placeholder");
        assertTrue(
            Pattern.compile(
                    "(?is)AND\\s+t\\.type_key\\s+IS\\s+DISTINCT\\s+FROM\\s+'tag/adc_completed_item'\\s+AND\\s+NOT\\s*\\(")
                .matcher(sql)
                .find(),
            "non-final type_id=62002 rows outside the placeholder predicate must still raise");
        assertContains("'tag/adc_completed_item'");
        assertContains("type_key=tag/adc_completed_item already bound to type_id");
    }

    @Test
    void deletesOnlyExactFiftyThreeLegacyEquipmentRelationsMatchingParsedEntities() {
        Matcher deleteMatcher =
            Pattern.compile(
                    "(?is)DELETE\\s+FROM\\s+public\\.type_relations\\s+WHERE\\s+game_id\\s*=\\s*v_game_id\\s+AND\\s+type_id\\s*=\\s*62002\\s+AND\\s+target_category\\s*=\\s*'equipment'\\s+AND\\s+target_id\\s+IN\\s*\\(([^)]+)\\)")
                .matcher(sql);
        assertTrue(deleteMatcher.find(), "must DELETE only legacy equipment relations for type 62002");
        String deletedIdList = deleteMatcher.group(1);
        assertFalse(deleteMatcher.find(), "must have exactly one narrow equipment DELETE");

        Set<String> deletedIds = new LinkedHashSet<>();
        Matcher idMatcher = Pattern.compile("'(\\d+)'").matcher(deletedIdList);
        while (idMatcher.find()) {
            assertTrue(deletedIds.add(idMatcher.group(1)), "duplicate delete target_id: " + idMatcher.group(1));
        }
        assertEquals(EXPECTED_ITEMS, deletedIds.size(), "DELETE must list exactly 53 numeric target ids");

        Set<String> entityNumericIds = new LinkedHashSet<>();
        Matcher entityMatcher = ENTITY_ROW.matcher(sql);
        while (entityMatcher.find()) {
            String entityId = entityMatcher.group(1);
            assertTrue(entityId.startsWith("item_"), "entity id must start with item_");
            entityNumericIds.add(entityId.substring("item_".length()));
        }
        assertEquals(entityNumericIds, deletedIds, "DELETE target_id set must equal parsed entity ids without item_");

        int deleteBlockStart = sql.toLowerCase().indexOf("delete from public.type_relations");
        int insertRelationsStart = sql.toLowerCase().indexOf("insert into public.type_relations");
        assertTrue(deleteBlockStart >= 0 && insertRelationsStart > deleteBlockStart,
            "legacy DELETE must run before final type_relations INSERT");

        // deleted rows count as material change; exact rerun hits 0 rows and skips revision
        assertTrue(
            Pattern.compile(
                    "(?is)DELETE\\s+FROM\\s+public\\.type_relations[\\s\\S]{0,800}?GET\\s+DIAGNOSTICS\\s+v_rowcount\\s*=\\s*ROW_COUNT;\\s*IF\\s+v_rowcount\\s*>\\s*0\\s+THEN\\s+v_changed\\s*:=\\s*true;")
                .matcher(sql)
                .find(),
            "DELETE rowcount > 0 must set v_changed for revision advancement");
        assertContains("IF v_changed THEN");
        assertContains("current_revision = v_candidate");
    }

    @Test
    void rejectsBroadDeleteAndLeavesUnrelatedLegacyAlone() {
        assertEquals(
            1,
            Pattern.compile("(?is)\\bDELETE\\s+FROM\\b").matcher(sql).results().count(),
            "seed may contain exactly one DELETE (narrow legacy cleanup)");
        assertFalse(
            Pattern.compile("(?is)DELETE\\s+FROM\\s+public\\.type_relations\\s+WHERE\\s+game_id\\s*=\\s*v_game_id\\s*;")
                .matcher(sql)
                .find(),
            "must not broad-delete all type_relations for the game");
        assertFalse(
            Pattern.compile("(?is)DELETE\\s+FROM\\s+public\\.type_relations\\s+WHERE\\s+game_id\\s*=\\s*v_game_id\\s+AND\\s+type_id\\s*=\\s*62002\\s*;")
                .matcher(sql)
                .find(),
            "must not delete all type_id=62002 relations without category/id filters");
        assertFalse(
            Pattern.compile("(?is)DELETE\\s+FROM\\s+public\\.types\\b").matcher(sql).find(),
            "must not delete types rows");
        assertFalse(
            Pattern.compile("(?is)target_category\\s*<>\\s*'equipment'|target_category\\s+NOT\\s+IN")
                .matcher(sql)
                .find(),
            "must not broaden cleanup beyond equipment");
        assertNotContainsIgnoreCase("public.heroes");
        assertNotContainsIgnoreCase("public.items");
        assertNotContainsIgnoreCase("public.skills");
        assertNotContainsIgnoreCase("owner_categories");
        assertNotContainsIgnoreCase("ownerCategories");
        assertFalse(
            Pattern.compile("(?i)\\bbundle\\b").matcher(sql).find(),
            "must not reference bundle");
        assertFalse(
            Pattern.compile("(?i)\\bcatalog\\b").matcher(sql).find(),
            "must not reference catalog");
    }

    @Test
    void relationExtendRetainsHistoricalProvenanceShapeForEveryParsedEntity() throws IOException {
        ObjectMapper mapper = new ObjectMapper();
        Map<String, Set<String>> attrsByEntity = new HashMap<>();
        Matcher attrMatcher = ATTR_ROW.matcher(sql);
        while (attrMatcher.find()) {
            attrsByEntity
                .computeIfAbsent(attrMatcher.group(1), ignored -> new LinkedHashSet<>())
                .add(attrMatcher.group(2));
        }

        Matcher relationMatcher = RELATION_ROW.matcher(sql);
        Set<String> seen = new HashSet<>();
        int parsedExtends = 0;
        while (relationMatcher.find()) {
            String entityId = relationMatcher.group(1);
            JsonNode extend = mapper.readTree(relationMatcher.group(2));
            seen.add(entityId);
            parsedExtends++;
            String sourceItemId = entityId.substring("item_".length());
            assertEquals("V2-Batch-C", extend.path("batch").asText());
            assertEquals("adc_completed_item", extend.path("role").asText());
            assertEquals("数据参考/item.json", extend.path("source").asText());
            assertEquals("16.9.1", extend.path("sourceVersion").asText());
            assertEquals(sourceItemId, extend.path("sourceItemId").asText());
            assertTrue(extend.path("sourceTags").isArray());
            assertTrue(extend.path("goldCost").isNumber());
            assertEquals("item_" + sourceItemId, extend.path("iconUrl").asText());
            assertTrue(extend.path("statKeys").isArray());
            assertEquals(
                "sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats",
                extend.path("selectionRule").asText());

            Set<String> expectedKeys =
                attrsByEntity.getOrDefault(entityId, Set.of()).stream()
                    .sorted()
                    .collect(Collectors.toCollection(LinkedHashSet::new));
            Set<String> actualKeys = new LinkedHashSet<>();
            Iterator<JsonNode> it = extend.path("statKeys").elements();
            while (it.hasNext()) {
                actualKeys.add(it.next().asText());
            }
            assertEquals(expectedKeys, actualKeys, "statKeys must derive from SQL attrs for " + entityId);
            assertEquals(
                "item_" + extend.path("sourceItemId").asText(),
                extend.path("iconUrl").asText(),
                "iconUrl must stay consistent with sourceItemId for " + entityId);
        }
        assertEquals(EXPECTED_ITEMS, seen.size(), "must parse 53 unique relation targets");
        assertEquals(EXPECTED_ITEMS, parsedExtends, "must parse 53 relation extend objects");
    }

    private static String normalizeNumber(String raw) {
        double value = Double.parseDouble(raw);
        if (Math.rint(value) == value) {
            return Long.toString((long) value);
        }
        return Double.toString(value);
    }

    private static void assertContains(String needle) {
        assertTrue(sql.contains(needle), "seed sql must contain: " + needle);
    }

    private static void assertNotContainsIgnoreCase(String needle) {
        assertFalse(
            Pattern.compile(Pattern.quote(needle), Pattern.CASE_INSENSITIVE).matcher(sql).find(),
            "seed sql must not contain: " + needle);
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
