package xyz.game.datamanage.db.character;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Locale;
import org.junit.jupiter.api.Test;

class CharacterSchemaSqlTest {

    @Test
    void schemaDefinesIndependentCharacterTablesAndOneJsonMapPerCharacter() throws IOException {
        String sql = normalized(read("db/game_manage/schema.sql"));

        assertTrue(sql.contains("create table public.game_level_configs"));
        assertTrue(sql.contains("create table public.characters"));
        assertTrue(sql.contains("create table public.character_attributes"));
        assertTrue(sql.contains("primary key (game_id, character_key)"));
        assertTrue(sql.contains("level_values jsonb not null"));
        assertTrue(sql.contains("on delete cascade"));
        assertTrue(sql.contains("jsonb_typeof(level_values) = 'object'"));
        assertTrue(sql.contains("create unique index uq_characters_name"));
        assertFalse(tableBody(sql, "public.characters").contains("provider"));
        assertFalse(tableBody(sql, "public.characters").contains("entity"));
        assertFalse(tableBody(sql, "public.character_attributes").contains("attribute_key"));
        assertFalse(tableBody(sql, "public.character_attributes").contains("level_number"));
    }

    @Test
    void compatibilityMigrationIsAdditiveAndSeedsLolLevelRange() throws IOException {
        String sql = normalized(read(
            "db/game_manage/migrations/compatibility/character_management_compatibility_migration.sql"
        ));
        assertTrue(sql.contains("create table if not exists public.game_level_configs"));
        assertTrue(sql.contains("create table if not exists public.characters"));
        assertTrue(sql.contains("create table if not exists public.character_attributes"));
        assertTrue(sql.contains("select 'lol', 1, 18"));
        assertTrue(sql.contains("on conflict (game_id) do nothing"));
        assertFalse(sql.contains("drop table"));
        assertFalse(sql.contains("game_entities"));
    }

    @Test
    void sparseCompatibilityMigrationOnlyClearsWholeZeroMaps() throws IOException {
        String sql = normalized(read(
            "db/game_manage/migrations/compatibility/character_attributes_sparse_compatibility_migration.sql"
        ));
        assertTrue(sql.contains("update public.character_attributes"));
        assertTrue(sql.contains("where not exists"));
        assertTrue(sql.contains("attribute_entry.value <> '0'::jsonb"));
        assertTrue(sql.contains("jsonb_object_agg(level_entry.key, '{}'::jsonb)"));
        assertFalse(sql.contains("delete from"));
        assertFalse(sql.contains("drop table"));
    }

    private static String tableBody(String sql, String table) {
        int start = sql.indexOf("create table " + table);
        int end = sql.indexOf(";", start);
        assertTrue(start >= 0 && end > start, "missing " + table);
        return sql.substring(start, end);
    }

    private static String read(String relative) throws IOException {
        return Files.readString(resolveRepositoryRoot().resolve(relative), StandardCharsets.UTF_8);
    }

    private static String normalized(String value) {
        return value.toLowerCase(Locale.ROOT).replaceAll("\\s+", " ").trim();
    }

    private static Path resolveRepositoryRoot() {
        Path current = Paths.get("").toAbsolutePath().normalize();
        for (Path candidate = current; candidate != null; candidate = candidate.getParent()) {
            if (Files.isRegularFile(candidate.resolve("server/data_manage/pom.xml"))) {
                return candidate;
            }
        }
        throw new IllegalStateException("cannot resolve repository root from " + current);
    }
}
