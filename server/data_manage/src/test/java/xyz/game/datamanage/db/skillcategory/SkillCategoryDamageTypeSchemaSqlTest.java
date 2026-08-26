package xyz.game.datamanage.db.skillcategory;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Locale;
import org.junit.jupiter.api.Test;

class SkillCategoryDamageTypeSchemaSqlTest {

    @Test
    void schemaDefinesTwoFlatIndependentTables() throws IOException {
        String sql = normalized(read("db/game_manage/schema.sql"));
        String categories = tableBody(sql, "public.skill_categories");
        String damageTypes = tableBody(sql, "public.damage_types");

        assertTrue(categories.contains("primary key (game_id, skill_category_key)"));
        assertTrue(categories.contains("foreign key (game_id) references public.games (game_id)"));
        assertTrue(categories.contains("status in ('enabled', 'disabled')"));
        assertTrue(categories.contains("sort_order >= 0"));
        assertTrue(sql.contains("create unique index uq_skill_categories_name"));
        assertFalse(categories.contains("group"));
        assertFalse(categories.contains("jsonb"));

        assertTrue(damageTypes.contains("primary key (game_id, damage_type_key)"));
        assertTrue(damageTypes.contains("foreign key (game_id) references public.games (game_id)"));
        assertTrue(damageTypes.contains("status in ('enabled', 'disabled')"));
        assertTrue(damageTypes.contains("sort_order >= 0"));
        assertTrue(sql.contains("create unique index uq_damage_types_name"));
        assertFalse(damageTypes.contains("formula"));
        assertFalse(damageTypes.contains("crit"));
    }

    @Test
    void compatibilityMigrationIsIdempotentAndDoesNotTouchOldTypeTables() throws IOException {
        String sql = normalized(read(
            "db/game_manage/migrations/compatibility/skill_category_damage_type_management_compatibility_migration.sql"
        ));

        assertTrue(sql.contains("create table if not exists public.skill_categories"));
        assertTrue(sql.contains("create table if not exists public.damage_types"));
        assertTrue(sql.contains("create unique index if not exists uq_skill_categories_name"));
        assertTrue(sql.contains("create unique index if not exists uq_damage_types_name"));
        assertFalse(sql.contains("drop table"));
        assertFalse(sql.contains("delete from"));
        assertFalse(sql.contains("type_relations"));
        assertFalse(sql.contains("reserved_type"));
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
