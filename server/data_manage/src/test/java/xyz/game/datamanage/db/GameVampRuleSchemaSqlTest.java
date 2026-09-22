package xyz.game.datamanage.db;

import static org.junit.jupiter.api.Assertions.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

class GameVampRuleSchemaSqlTest {
    @Test void newSchemaAndMigrationShareOneRuleTableAndConservativeDataConversion() throws Exception {
        String schema = Files.readString(root().resolve("db/game_manage/schema.sql"));
        String migration = Files.readString(root().resolve("db/game_manage/migrations/game_vamp_rules.sql"));
        String ddl = migration.substring(migration.indexOf("CREATE TABLE public.game_vamp_rules"), migration.indexOf("-- 在完整旧行"));
        assertTrue(schema.contains(ddl.stripTrailing()));
        assertEquals(1, Pattern.compile("CREATE TABLE public\\.").matcher(migration).results().count());
        assertTrue(ddl.contains("FOREIGN KEY (game_id, source_attribute_key)"));
        assertTrue(ddl.contains("REFERENCES public.attributes (game_id, attribute_key)"));
        assertTrue(ddl.contains("default_efficiency < 'Infinity'::numeric"));
        assertTrue(migration.indexOf("EXCEPT SELECT * FROM pg_temp.vamp_migration_archive") < migration.indexOf("UPDATE public.skill_effects"));
        assertTrue(migration.contains("PRIOR_ACTION_RESULT") && migration.contains("ACTUAL_HEALING"));
        assertTrue(migration.contains("\"vampQualification\":\"UNRESOLVED\",\"vampOverrides\":[]"));
        assertFalse(migration.contains("SET updated_at"));
        String executable = migration.replaceAll("(?m)--[^\\n]*", "");
        assertFalse(Pattern.compile("(?im)^\\s*(COMMIT|ROLLBACK|TRUNCATE|DROP TABLE)\\b").matcher(executable).find());
        assertFalse(executable.contains("INSERT INTO public.game_vamp_rules"));
        assertFalse(executable.contains("76") || executable.contains("134") || executable.contains("211"));
    }

    private static Path root() {
        Path path = Path.of("").toAbsolutePath();
        while (path != null && !Files.isRegularFile(path.resolve("db/game_manage/schema.sql"))) path = path.getParent();
        assertNotNull(path);
        return path;
    }
}
