package xyz.game.datamanage.db;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

class GameCalculationRuleSchemaSqlTest {
    @Test void migrationOnlyCreatesTheSameIsolatedGameTableWithoutBusinessDefaults() throws Exception {
        Path root = Path.of("").toAbsolutePath();
        while (root != null && !Files.isRegularFile(root.resolve("db/game_manage/schema.sql"))) root = root.getParent();
        assertNotNull(root);
        String schema = Files.readString(root.resolve("db/game_manage/schema.sql"));
        String migration = Files.readString(root.resolve("db/game_manage/migrations/game_calculation_rules.sql"));
        String ddl = migration.substring(migration.indexOf("CREATE TABLE public.game_calculation_rules"));
        assertTrue(schema.contains(ddl.stripTrailing()));
        assertEquals(1, Pattern.compile("CREATE TABLE public\\.").matcher(migration).results().count());
        assertTrue(ddl.contains("PRIMARY KEY (game_id)"));
        assertTrue(ddl.contains("REFERENCES public.games (game_id)"));
        assertTrue(ddl.contains("configuration jsonb NOT NULL"));
        assertFalse(ddl.contains("DEFAULT '{}'"));
        String executable = migration.replaceAll("(?m)--[^\\n]*", "");
        assertFalse(Pattern.compile("(?im)^\\s*(DROP|DELETE|UPDATE|INSERT|TRUNCATE|COMMIT|ROLLBACK)\\b").matcher(executable).find());
        assertFalse(executable.contains("critical_strike_chance") || executable.contains("bonus_attack_speed_percent"));
        assertFalse(executable.contains("skill_object_references"));
    }
}
