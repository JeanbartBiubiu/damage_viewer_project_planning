package xyz.game.datamanage.db;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;

/** Static repository contract for the destructive removal of the legacy resource model. */
class LegacyResourceRemovalSqlTest {

    private static final List<String> LEGACY_TABLES = List.of(
        "resource_definitions",
        "resource_definitions_log",
        "entity_resource_values",
        "entity_resource_values_log",
        "entity_resource_stage_values",
        "entity_resource_stage_values_log",
        "ability_costs",
        "ability_costs_log",
        "resource_effect_details",
        "resource_effect_details_log"
    );

    private static final List<String> LEGACY_MAPPERS = List.of(
        "CombatResourceDefinitionsMapper",
        "CombatEntityResourceValuesMapper",
        "CombatEntityResourceStageValuesMapper",
        "CombatAbilityCostsMapper",
        "CombatResourceEffectDetailsMapper"
    );

    private static final List<String> BREAKING_DROP_ORDER = List.of(
        "resource_effect_details_log",
        "resource_effect_details",
        "ability_costs_log",
        "ability_costs",
        "entity_resource_stage_values_log",
        "entity_resource_stage_values",
        "entity_resource_values_log",
        "entity_resource_values",
        "resource_definitions_log",
        "resource_definitions"
    );

    private static final List<String> LEGACY_ROUTES_AND_METHODS = List.of(
        "/resource-definitions",
        "/ability-costs",
        "/entity-resources",
        "/entity-resource-stages",
        "/resources/{resourceKey}",
        "listResourceDefinitions",
        "putResourceDefinition",
        "listEntityResources",
        "listEntityResourceStages",
        "putEntityResource",
        "putEntityResourceStage",
        "listCosts",
        "putCost"
    );

    @Test
    void baselineDdlAndTriggersExcludeLegacyResourceTables() throws IOException {
        Path root = resolveRepositoryRoot();
        assertNoLegacyTables(root.resolve("db/game_manage/schema.sql"));
        assertNoLegacyTables(root.resolve("db/game_manage/triggers.sql"));
    }

    @Test
    void compatibilityMigrationsAndSeedsExcludeLegacyResourceTables() throws IOException {
        Path root = resolveRepositoryRoot();
        for (Path path : regularFiles(root.resolve("db/game_manage/migrations/compatibility"), ".sql")) {
            assertNoLegacyTables(path);
        }
        for (Path path : regularFiles(root.resolve("db/game_manage/seeds"), ".sql")) {
            assertNoLegacyTables(path);
        }
    }

    @Test
    void breakingMigrationDropsExactlyTheFrozenLegacyTablesInReverseDependencyOrder() throws IOException {
        Path path = resolveRepositoryRoot().resolve(
            "db/game_manage/migrations/breaking/drop_legacy_resource_tables.sql"
        );
        String sql = read(path);
        String executable = Pattern.compile("(?s)/\\*.*?\\*/")
            .matcher(sql)
            .replaceAll("");
        executable = Pattern.compile("(?m)--[^\\n]*")
            .matcher(executable)
            .replaceAll("");

        assertFalse(
            Pattern.compile("(?i)\\bCASCADE\\b").matcher(executable).find(),
            "breaking migration must not use CASCADE"
        );
        assertEquals(
            10L,
            Pattern.compile("(?i)\\bDROP\\b").matcher(executable).results().count(),
            "breaking migration must not contain any extra DROP statement"
        );

        List<String> actualOrder = Pattern.compile(
                "(?im)^\\s*DROP\\s+TABLE\\s+IF\\s+EXISTS\\s+public\\.([a-z0-9_]+)\\s*;\\s*$"
            )
            .matcher(executable)
            .results()
            .map(result -> result.group(1))
            .toList();
        assertEquals(
            BREAKING_DROP_ORDER,
            actualOrder,
            "breaking migration must keep the frozen reverse dependency order"
        );
    }

    @Test
    void mainJavaAndXmlExcludeLegacyTablesMappersAndRoutes() throws IOException {
        Path root = resolveRepositoryRoot();
        for (Path path : regularFiles(root.resolve("server/data_manage/src/main/java"), ".java")) {
            assertNoLegacyTables(path);
            assertNoTokens(path, LEGACY_MAPPERS);
            assertNoTokens(path, LEGACY_ROUTES_AND_METHODS);
        }
        for (Path path : regularFiles(root.resolve("server/data_manage/src/main/resources"), ".xml")) {
            assertNoLegacyTables(path);
            assertNoTokens(path, LEGACY_MAPPERS);
        }
    }

    private static void assertNoLegacyTables(Path path) throws IOException {
        String content = read(path).toLowerCase(Locale.ROOT);
        for (String table : LEGACY_TABLES) {
            assertFalse(content.contains(table), () -> path + " still references legacy table " + table);
        }
    }

    private static void assertNoTokens(Path path, List<String> tokens) throws IOException {
        String content = read(path);
        for (String token : tokens) {
            assertFalse(content.contains(token), () -> path + " still references legacy symbol or route " + token);
        }
    }

    private static String read(Path path) throws IOException {
        assertTrue(Files.isRegularFile(path), () -> "missing repository artifact: " + path);
        return Files.readString(path, StandardCharsets.UTF_8);
    }

    private static List<Path> regularFiles(Path root, String suffix) throws IOException {
        assertTrue(Files.isDirectory(root), () -> "missing repository directory: " + root);
        try (Stream<Path> paths = Files.walk(root)) {
            return paths
                .filter(Files::isRegularFile)
                .filter(path -> path.getFileName().toString().endsWith(suffix))
                .sorted()
                .toList();
        }
    }

    private static Path resolveRepositoryRoot() {
        Path current = Paths.get("").toAbsolutePath().normalize();
        for (Path candidate = current; candidate != null; candidate = candidate.getParent()) {
            if (Files.isRegularFile(candidate.resolve("db/game_manage/schema.sql"))
                && Files.isDirectory(candidate.resolve("server/data_manage/src/main/java"))) {
                return candidate;
            }
        }
        throw new IllegalStateException("cannot resolve repository root from " + current);
    }
}
