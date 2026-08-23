package xyz.game.datamanage.db.equipment;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Locale;
import org.junit.jupiter.api.Test;

class EquipmentSchemaSqlTest {

    @Test
    void schemaDefinesIndependentEquipmentAndAttributeMapTables() throws IOException {
        String sql = normalized(read("db/game_manage/schema.sql"));

        assertTrue(sql.contains("create table public.equipment"));
        assertTrue(sql.contains("create table public.equipment_attributes"));
        assertTrue(sql.contains("primary key (game_id, equipment_key)"));
        assertTrue(sql.contains("attribute_values jsonb not null"));
        assertTrue(sql.contains("jsonb_typeof(attribute_values) = 'object'"));
        assertTrue(sql.contains("create unique index uq_equipment_name"));
        assertTrue(tableBody(sql, "public.equipment_attributes").contains("on delete cascade"));
        assertFalse(tableBody(sql, "public.equipment").contains("provider"));
        assertFalse(tableBody(sql, "public.equipment").contains("ability"));
        assertFalse(tableBody(sql, "public.equipment").contains("price"));
        assertFalse(tableBody(sql, "public.equipment").contains("status"));
        assertFalse(tableBody(sql, "public.equipment_attributes").contains("attribute_key"));
    }

    @Test
    void compatibilityMigrationIsIdempotentAndDoesNotTouchLegacyItems() throws IOException {
        String sql = normalized(read(
            "db/game_manage/migrations/compatibility/equipment_management_compatibility_migration.sql"
        ));

        assertTrue(sql.contains("create table if not exists public.equipment"));
        assertTrue(sql.contains("create table if not exists public.equipment_attributes"));
        assertTrue(sql.contains("create unique index if not exists uq_equipment_name"));
        assertFalse(sql.contains("drop table"));
        assertFalse(sql.contains("delete from"));
        assertFalse(sql.contains("game_entities"));
        assertFalse(sql.contains("item_definitions"));
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
