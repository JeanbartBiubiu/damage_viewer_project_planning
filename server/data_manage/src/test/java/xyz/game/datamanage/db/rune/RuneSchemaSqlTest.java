package xyz.game.datamanage.db.rune;

import static org.junit.jupiter.api.Assertions.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

class RuneSchemaSqlTest {
    @Test
    void additiveMigrationMatchesFreshSchemaAndCannotDeleteExistingBusinessRows() throws Exception {
        String schema = Files.readString(root().resolve("db/game_manage/schema.sql"));
        String migration = Files.readString(root().resolve("db/game_manage/migrations/rune_management.sql"));
        String ddl = migration.substring(migration.indexOf("CREATE TABLE"), migration.indexOf("ALTER TABLE"));
        assertTrue(schema.contains(ddl.stripTrailing()));
        String executable = migration.replaceAll("(?m)--[^\\n]*", "");
        assertFalse(Pattern.compile("(?im)^\\s*(UPDATE|DELETE|INSERT|TRUNCATE|COMMIT|ROLLBACK)\\b").matcher(executable).find());
        assertFalse(Pattern.compile("(?i)DROP\\s+TABLE").matcher(executable).find());
        assertEquals(3, Pattern.compile("CREATE TABLE public\\.").matcher(executable).results().count());
        assertTrue(executable.contains("DROP CONSTRAINT ck_image_relations_source_type"));
        for (String source : List.of("GAME", "CHARACTER", "ATTRIBUTE", "EQUIPMENT", "SKILL", "SKILL_EFFECT", "STATUS", "RUNE", "RUNE_PATH")) {
            assertTrue(executable.contains("'" + source + "'"));
        }
        assertFalse(executable.contains("DROP CONSTRAINT ck_image_relations_parent"));
    }

    @Test
    void threeTablesKeepIdentityUniquenessArrayShapeAndDeletionDirection() throws Exception {
        String ddl = Files.readString(root().resolve("db/game_manage/migrations/rune_management.sql")).replaceAll("\\s+", " ");
        assertTrue(ddl.contains("PRIMARY KEY (game_id, rune_key)"));
        assertTrue(ddl.contains("CREATE UNIQUE INDEX uq_runes_name ON public.runes (game_id, lower(btrim(name)))"));
        assertTrue(ddl.contains("CREATE UNIQUE INDEX uq_rune_paths_name ON public.rune_paths (game_id, lower(btrim(name)))"));
        assertTrue(ddl.contains("CHECK (category IN ('KEYSTONE', 'MINOR', 'SHARD'))"));
        assertTrue(ddl.contains("CHECK (kind IN ('RUNE_PATH', 'SHARD_GROUP'))"));
        assertTrue(ddl.contains("CHECK (jsonb_typeof(slots) = 'array')"));
        assertTrue(ddl.contains("REFERENCES public.runes (game_id, rune_key) ON DELETE CASCADE"));
        assertTrue(ddl.contains("REFERENCES public.skills (game_id, skill_key) ON DELETE RESTRICT"));
        assertTrue(ddl.contains("ON public.rune_skill_relations (game_id, skill_key, rune_key)"));
        assertFalse(ddl.contains("enabled"));
        assertFalse(ddl.contains("status"));
    }

    private Path root() {
        Path current = Path.of("").toAbsolutePath();
        while (current != null && !Files.isRegularFile(current.resolve("db/game_manage/schema.sql"))) {
            current = current.getParent();
        }
        assertNotNull(current);
        return current;
    }
}
