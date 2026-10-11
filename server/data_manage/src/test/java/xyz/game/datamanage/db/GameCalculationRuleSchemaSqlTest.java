package xyz.game.datamanage.db;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

class GameCalculationRuleSchemaSqlTest {
    @Test void historicalInitialMigrationRemainsAnIsolatedFourFieldTableWithoutBusinessDefaults() throws Exception {
        Path root = root();
        String schema = Files.readString(root.resolve("db/game_manage/schema.sql"));
        String migration = Files.readString(root.resolve("db/game_manage/migrations/game_calculation_rules.sql"));
        String ddl = migration.substring(migration.indexOf("CREATE TABLE public.game_calculation_rules"));
        for (String invariant : new String[] {"PRIMARY KEY (game_id)", "REFERENCES public.games (game_id)", "configuration jsonb NOT NULL"}) {
            assertTrue(schema.contains(invariant));
            assertTrue(ddl.contains(invariant));
        }
        assertFalse(ddl.contains("basicAttackCategoryKey"));
        assertFalse(ddl.contains("equipmentPassiveCategoryKey"));
        assertFalse(ddl.contains("ignorableCastCostAttributeKeys"));
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

    @Test void incrementalMigrationAndNewSchemaShareTheCompleteSevenFieldRootConstraint() throws Exception {
        String schema = Files.readString(root().resolve("db/game_manage/schema.sql"));
        String migration = incremental();
        int start = migration.indexOf("CONSTRAINT ck_game_calculation_rules_configuration CHECK (");
        int end = migration.indexOf("\n    )", start) + "\n    )".length();
        assertTrue(start >= 0 && end > start);
        String constraint = migration.substring(start, end);
        assertTrue(schema.replace("\r\n", "\n").contains(constraint));
        for (String field : new String[] {"basicAttackCategoryKey", "equipmentPassiveCategoryKey", "ignorableCastCostAttributeKeys"}) {
            assertTrue(constraint.contains("'" + field + "'"));
        }
        assertTrue(constraint.contains("jsonb_typeof(configuration->'basicAttackCategoryKey') IN ('string', 'null')"));
        assertTrue(constraint.contains("jsonb_typeof(configuration->'equipmentPassiveCategoryKey') IN ('string', 'null')"));
        assertTrue(constraint.contains("jsonb_typeof(configuration->'ignorableCastCostAttributeKeys') = 'array'"));
        assertTrue(constraint.contains("jsonb_array_length(configuration->'ignorableCastCostAttributeKeys') <= 32 ELSE false END"));
        assertTrue(constraint.contains("jsonb_array_length(configuration->'attributeDerivations') <= 4 ELSE false END"));
    }

    @Test void incrementalMigrationLocksAndOnlyPrependsEmptyDefaultsWithoutOverwritingAnyExistingFieldsOrTimestamps() throws Exception {
        String executable = incremental().replaceAll("(?m)--[^\\n]*", "").strip();
        assertTrue(executable.startsWith("BEGIN;"));
        assertTrue(executable.endsWith("COMMIT;"));
        assertEquals(1, Pattern.compile("(?m)^BEGIN;").matcher(executable).results().count());
        assertEquals(1, Pattern.compile("(?m)^COMMIT;").matcher(executable).results().count());
        int lock = executable.indexOf("LOCK TABLE public.game_calculation_rules IN SHARE ROW EXCLUSIVE MODE;");
        int update = executable.indexOf("UPDATE public.game_calculation_rules");
        int alter = executable.indexOf("ALTER TABLE public.game_calculation_rules");
        assertTrue(lock >= 0 && lock < update && update < alter);
        String changes = executable.substring(update, alter);
        assertTrue(changes.contains("'basicAttackCategoryKey', null"));
        assertTrue(changes.contains("'equipmentPassiveCategoryKey', null"));
        assertTrue(changes.contains("'ignorableCastCostAttributeKeys', '[]'::jsonb"));
        assertTrue(changes.contains(") || configuration\nWHERE NOT configuration ?& ARRAY['basicAttackCategoryKey', 'equipmentPassiveCategoryKey', 'ignorableCastCostAttributeKeys'];"));
        assertFalse(changes.contains("updated_at") || changes.contains("criticalChanceAttributeKey")
            || changes.contains("attackSpeedAttributeKey") || changes.contains("attributeDerivations"));
        assertEquals(1, Pattern.compile("(?im)^UPDATE public\\.").matcher(executable).results().count());
        assertFalse(Pattern.compile("(?im)^\\s*(CREATE\\s+TABLE|DROP\\s+TABLE|DELETE|INSERT|TRUNCATE)\\b").matcher(executable).find());
        assertFalse(executable.contains("basic_attack") || executable.contains("'passive'") || executable.contains("'mana'") || executable.contains("skill_object_references"));
    }

    private static String incremental() throws Exception {
        return Files.readString(root().resolve("db/game_manage/migrations/game_calculation_classification_cost_bindings.sql")).replace("\r\n", "\n");
    }

    private static Path root() {
        Path root = Path.of("").toAbsolutePath();
        while (root != null && !Files.isRegularFile(root.resolve("db/game_manage/schema.sql"))) root = root.getParent();
        assertNotNull(root);
        return root;
    }
}
