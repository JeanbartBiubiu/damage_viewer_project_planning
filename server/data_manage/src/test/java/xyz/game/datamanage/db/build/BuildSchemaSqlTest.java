package xyz.game.datamanage.db.build;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

class BuildSchemaSqlTest {
    private static final List<String> SLOT_ROWS = List.of(
        "('rune_path_8100', 0, '基石', 'KEYSTONE', 'keystone')",
        "('rune_path_8100', 1, '预谋', 'MINOR', 'minor_1')",
        "('rune_path_8100', 2, '追踪', 'MINOR', 'minor_2')",
        "('rune_path_8100', 3, '狩猎', 'MINOR', 'minor_3')",
        "('rune_path_8300', 0, '基石', 'KEYSTONE', 'keystone')",
        "('rune_path_8300', 1, '巧具', 'MINOR', 'minor_1')",
        "('rune_path_8300', 2, '未来', 'MINOR', 'minor_2')",
        "('rune_path_8300', 3, '超越', 'MINOR', 'minor_3')",
        "('rune_path_8000', 0, '基石', 'KEYSTONE', 'keystone')",
        "('rune_path_8000', 1, '英武', 'MINOR', 'minor_1')",
        "('rune_path_8000', 2, '传说', 'MINOR', 'minor_2')",
        "('rune_path_8000', 3, '战斗', 'MINOR', 'minor_3')",
        "('rune_path_8400', 0, '基石', 'KEYSTONE', 'keystone')",
        "('rune_path_8400', 1, '蛮力', 'MINOR', 'minor_1')",
        "('rune_path_8400', 2, '抵抗', 'MINOR', 'minor_2')",
        "('rune_path_8400', 3, '生机', 'MINOR', 'minor_3')",
        "('rune_path_8200', 0, '基石', 'KEYSTONE', 'keystone')",
        "('rune_path_8200', 1, '宝物', 'MINOR', 'minor_1')",
        "('rune_path_8200', 2, '卓越', 'MINOR', 'minor_2')",
        "('rune_path_8200', 3, '威能', 'MINOR', 'minor_3')",
        "('rune_shards', 0, '进攻', 'SHARD', 'offense')",
        "('rune_shards', 1, '灵活', 'SHARD', 'flex')",
        "('rune_shards', 2, '防御', 'SHARD', 'defense')");

    @Test
    void schemaReplacesRuneTablesWithTwentyNineBuildTables() throws Exception {
        String schema = Files.readString(root().resolve("db/game_manage/schema.sql"));
        assertTrue(schema.startsWith("-- 当前管理数据：29 张业务逻辑表"));
        assertEquals(29, Pattern.compile("(?i)CREATE TABLE public\\.").matcher(schema).results().count());
        for (String table : List.of("build_systems", "build_options", "build_groups", "build_option_skill_relations")) {
            assertTrue(schema.contains("CREATE TABLE public." + table), table);
        }
        assertFalse(Pattern.compile("(?i)CREATE TABLE public\\.runes\\b").matcher(schema).find());
        assertFalse(schema.contains("CREATE TABLE public.rune_paths"));
        assertFalse(schema.contains("CREATE TABLE public.rune_skill_relations"));
        assertTrue(schema.contains("'BUILD_OPTION', 'BUILD_GROUP'"));
        assertTrue(schema.contains("source_type IN ('SKILL_EFFECT', 'BUILD_OPTION', 'BUILD_GROUP')"));
        assertTrue(schema.contains("CHECK (jsonb_typeof(selection_rules) = 'object')"));
        assertTrue(schema.contains("CHECK (jsonb_typeof(slots) = 'array')"));
        assertTrue(schema.contains("CHECK (jsonb_typeof(rank_costs) = 'array')"));
        assertTrue(schema.contains("skill_level_mode = 'FIXED' AND fixed_skill_level IS NOT NULL AND fixed_skill_level >= 1"));
        assertTrue(schema.contains("skill_level_mode = 'SAME_AS_OPTION' AND fixed_skill_level IS NULL"));
        assertTrue(schema.contains("ON DELETE RESTRICT"));
        assertTrue(schema.contains("ix_build_option_skill_relations_skill"));
        String integrity = Files.readString(root().resolve("db/game_manage/checks/image_relations_integrity.sql"));
        assertTrue(integrity.contains("'BUILD_OPTION'"));
        assertTrue(integrity.contains("'BUILD_GROUP'"));
        assertFalse(integrity.contains("'RUNE'"));
        assertFalse(integrity.contains("'RUNE_PATH'"));
    }

    @Test
    void migrationUsesTheExplicitSlotMapAndDropsTheOldTablesWithoutCommitting() throws Exception {
        String sql = Files.readString(root().resolve("db/game_manage/migrations/build_system_management.sql"));
        assertFalse(Pattern.compile("(?im)^\\s*begin\\s*;").matcher(sql).find());
        assertFalse(Pattern.compile("(?im)^\\s*commit\\s*;").matcher(sql).find());
        assertFalse(Pattern.compile("(?im)^\\s*rollback\\s*;").matcher(sql).find());
        assertEquals(23, SLOT_ROWS.size());
        int mapStart = sql.indexOf("INSERT INTO build_slot_key_map");
        int mapEnd = sql.indexOf(";", mapStart);
        String map = sql.substring(mapStart, mapEnd);
        for (String row : SLOT_ROWS) {
            assertTrue(map.contains(row), row);
        }
        assertEquals(23, Pattern.compile("\\('rune_").matcher(map).results().count());
        assertFalse(map.contains("||"));
        assertTrue(sql.contains("jsonb_build_object"));
        assertTrue(sql.contains("'slotKey', m.slot_key"));
        assertTrue(sql.contains("'runes', '符文', NULL, 'SLOT_SELECTION', 0"));
        assertTrue(sql.contains("\"groupRoles\":[],\"budget\":null,\"prerequisites\":[],\"exclusions\":[]"));
        assertTrue(sql.contains("1, '[0]'::jsonb"));
        assertTrue(sql.contains("1, 'FIXED', 1, sort_order"));
        assertTrue(sql.contains("skill_level_mode = 'FIXED' AND fixed_skill_level IS NOT NULL AND fixed_skill_level >= 1"));
        assertTrue(sql.contains("SET source_type = 'BUILD_OPTION', source_parent_key = 'runes'"));
        assertTrue(sql.contains("SET source_type = 'BUILD_GROUP', source_parent_key = 'runes'"));
        assertTrue(sql.contains("EXCEPT"));
        assertTrue(sql.contains("DROP TABLE public.rune_skill_relations;"));
        assertTrue(sql.contains("DROP TABLE public.rune_paths;"));
        assertTrue(sql.contains("DROP TABLE public.runes;"));
        assertFalse(Pattern.compile("(?i)DROP TABLE public\\.runes\\s+CASCADE").matcher(sql).find());
        assertFalse(sql.contains("ON COMMIT DROP;") && sql.contains("COMMIT;"));
    }

    @Test
    void oldRuneTypesAreGone() {
        for (String name : List.of(
            "xyz.game.datamanage.service.rune.RuneService",
            "xyz.game.datamanage.controller.adminapi.rune.RuneAdminController",
            "xyz.game.datamanage.controller.adminapi.rune.RunePathAdminController",
            "xyz.game.datamanage.controller.adminapi.skillrelation.RuneSkillRelationAdminController",
            "xyz.game.datamanage.service.skillrelation.RuneRelationService",
            "xyz.game.datamanage.mapper.rune.RuneMapper"
        )) {
            assertThrows(ClassNotFoundException.class, () -> Class.forName(name), name);
        }
    }

    private static Path root() {
        Path root = Path.of("").toAbsolutePath();
        while (root != null && !Files.exists(root.resolve("server/data_manage/pom.xml"))) {
            root = root.getParent();
        }
        assertNotNull(root);
        return root;
    }
}
