package xyz.game.datamanage.db;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Locale;
import org.junit.jupiter.api.Test;

class RelationManagementDbContractSqlTest {
    private static final List<String> TABLES = List.of(
        "character_skill_relations", "equipment_skill_relations", "image_relations");

    @Test
    void freshSchemaKeepsHistoricalRelationsApartFromExplicitRuneSourceAddition() throws Exception {
        String fresh = read("db/game_manage/schema.sql");
        String migration = read("db/game_manage/migrations/breaking/relation_management_migration.sql");
        for (String table : TABLES) {
            String current = table(fresh, table);
            if ("image_relations".equals(table)) {
                assertTrue(current.contains("'status', 'rune', 'rune_path'"));
                // 历史阶段 9 迁移保持原七类；本次追加由 rune_management.sql 独立完成。
                current = current.replace("'status', 'rune', 'rune_path'", "'status'");
            }
            assertEquals(current, table(migration, table), table);
        }
        assertFalse(table(fresh, "games").contains("game_img_url"));
        for (String source : List.of("character", "equipment")) {
            String definition = table(fresh, source + "_skill_relations");
            assertTrue(definition.contains("primary key (game_id, " + source + "_key, skill_key)"));
            assertTrue(definition.contains("foreign key (game_id, " + source + "_key)"));
            assertTrue(definition.contains("on delete cascade"));
            assertTrue(definition.contains("foreign key (game_id, skill_key) references public.skills (game_id, skill_key) on delete restrict"));
            assertTrue(definition.contains("check (sort_order >= 0)"));
        }
        String image = table(fresh, "image_relations");
        assertFalse(image.contains("foreign key"));
        assertFalse(image.contains("references"));
        assertTrue(image.contains("primary key (game_id, source_type, source_parent_key, source_key)"));
        assertTrue(image.contains("source_parent_key varchar(64) not null"));
        assertTrue(image.contains("source_type <> 'skill_effect' and source_parent_key = ''"));
        assertTrue(image.contains("source_type <> 'game' or source_key = game_id"));
    }

    @Test
    void migrationRejectsUnknownDataBeforeCreatingTablesAndDropsOldColumnOnlyAfterReadback() throws Exception {
        String sql = read("db/game_manage/migrations/breaking/relation_management_migration.sql");
        for (String table : TABLES) {
            assertTrue(sql.indexOf("to_regclass('public." + table + "')") < sql.indexOf("create table public." + table));
        }
        assertTrue(sql.indexOf("lock table public.games") < sql.indexOf("do $validate$"));
        assertTrue(sql.indexOf("do $validate$") < sql.indexOf("create table public.image_relations"));
        assertTrue(sql.contains("i.game_id = g.game_id and i.image_key = g.game_img_url"));
        assertFalse(sql.contains("i.image_key = btrim(g.game_img_url)"));
        assertFalse(sql.contains("update public.games"));
        assertFalse(sql.contains("delete from"));
        assertTrue(sql.indexOf("is distinct from g.game_img_url") < sql.indexOf("drop column game_img_url"));
        assertTrue(sql.startsWith("begin;"));
        assertTrue(sql.endsWith("commit;"));
    }

    @Test
    void integrityQueryChecksAllSourcesAndGameScopedImageTargetsWithoutWriting() throws Exception {
        String sql = read("db/game_manage/checks/image_relations_integrity.sql");
        for (String source : List.of("game", "character", "attribute", "equipment", "skill", "skill_effect", "status", "rune", "rune_path")) {
            assertTrue(sql.contains("'" + source + "'"), source);
        }
        assertTrue(sql.contains("s.source_parent_key = r.source_parent_key"));
        assertTrue(sql.contains("i.game_id = r.game_id and i.image_key = r.image_key"));
        assertTrue(sql.contains("g.game_id is null or s.source_key is null or i.image_key is null"));
        assertFalse(sql.matches("(?s).*\\b(insert|update|delete|drop|alter)\\b.*"));
    }

    private static String table(String sql, String name) {
        int start = sql.indexOf("create table public." + name + " (");
        assertTrue(start >= 0, name);
        return sql.substring(start, sql.indexOf(';', start));
    }

    private static String read(String relative) throws Exception {
        Path root = Path.of("").toAbsolutePath();
        while (root != null && !Files.exists(root.resolve("server/data_manage/pom.xml"))) root = root.getParent();
        assertNotNull(root);
        return Files.readString(root.resolve(relative)).replaceAll("(?m)--[^\\r\\n]*", "")
            .toLowerCase(Locale.ROOT).replaceAll("\\s+", " ").trim();
    }
}
