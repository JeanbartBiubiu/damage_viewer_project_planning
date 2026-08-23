package xyz.game.datamanage.db.attribute;

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
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;

class AttributeSchemaSqlTest {

    private static final Path SCHEMA = Path.of("db/game_manage/schema.sql");
    private static final Path MAPPER_XML = Path.of(
        "server/data_manage/src/main/resources/mapper/attribute/AttributeMapper.xml"
    );

    private static final List<String> EXACT_COLUMNS = List.of(
        "game_id",
        "attribute_key",
        "name",
        "value_type",
        "min_value",
        "max_value",
        "description",
        "status",
        "sort_order",
        "created_at",
        "updated_at"
    );

    private static final List<String> EXACT_CONSTRAINTS = List.of(
        "pk_attributes",
        "fk_attributes_game",
        "ck_attributes_key",
        "ck_attributes_name",
        "ck_attributes_value_type",
        "ck_attributes_status",
        "ck_attributes_bounds",
        "ck_attributes_sort_order"
    );

    @Test
    void definesThePlainAttributesTable() throws IOException {
        String sql = executableSql(resolveRepositoryRoot().resolve(SCHEMA));
        String table = tableBody(sql);
        String normalizedTable = normalize(table);

        List<String> actualColumns = Pattern.compile(
                "(?im)^\\s*([a-z][a-z0-9_]*)\\s+(?:varchar\\s*\\(|numeric\\b|text\\b|integer\\b|timestamptz\\b)"
            )
            .matcher(table)
            .results()
            .map(result -> result.group(1).toLowerCase(Locale.ROOT))
            .toList();
        assertEquals(EXACT_COLUMNS, actualColumns);

        List<String> actualConstraints = Pattern.compile("(?i)\\bconstraint\\s+([a-z0-9_]+)")
            .matcher(table)
            .results()
            .map(result -> result.group(1).toLowerCase(Locale.ROOT))
            .toList();
        assertEquals(EXACT_CONSTRAINTS, actualConstraints);

        assertContains(normalizedTable, "game_id varchar(64) not null");
        assertContains(normalizedTable, "attribute_key varchar(64) not null");
        assertContains(normalizedTable, "name varchar(100) not null");
        assertContains(normalizedTable, "value_type varchar(16) not null");
        assertContains(normalizedTable, "status varchar(16) not null default 'enabled'");
        assertContains(normalizedTable, "sort_order integer not null default 0");
        assertContains(normalizedTable, "created_at timestamptz not null default now()");
        assertContains(normalizedTable, "updated_at timestamptz not null default now()");
        assertContains(
            normalize(sql),
            "create unique index uq_attributes_name on public.attributes (game_id, lower(btrim(name)));"
        );

        for (String forbidden : List.of(
            "display_unit",
            "displayunit",
            "default_value",
            "value_kind",
            "rate_target_attr_key",
            "image_uri",
            "change_revision",
            "resource_definitions",
            "entity_resource_values",
            "entity_resource_stage_values",
            "ability_costs",
            "resource_effect_details",
            "_log",
            "partition by",
            "create trigger"
        )) {
            assertFalse(normalizedTable.contains(forbidden), () -> "attributes table contains " + forbidden);
        }
    }

    @Test
    void mapperUsesOnlyPublicAttributes() throws IOException {
        String xml = Files.readString(resolveRepositoryRoot().resolve(MAPPER_XML), StandardCharsets.UTF_8);
        String normalized = normalize(xml);

        assertTrue(normalized.contains("public.attributes"));
        assertFalse(normalized.contains("public.attribute_definitions"));
        assertFalse(normalized.contains("displayunit"));
        assertFalse(normalized.contains("display_unit"));
        assertContains(normalized, "order by sort_order asc, name asc, attribute_key asc");
        assertContains(normalized, "for update");
        assertContains(normalized, "updated_at = now()");
    }

    @Test
    void attributeCrudCodeUsesPlainNames() throws IOException {
        Path root = resolveRepositoryRoot();
        List<Path> implementationRoots = List.of(
            root.resolve("server/data_manage/src/main/java/xyz/game/datamanage/controller/adminapi/attribute"),
            root.resolve("server/data_manage/src/main/java/xyz/game/datamanage/service/attribute"),
            root.resolve("server/data_manage/src/main/java/xyz/game/datamanage/mapper/attribute"),
            root.resolve("server/data_manage/src/main/java/xyz/game/datamanage/model/attribute"),
            root.resolve("server/data_manage/src/main/resources/mapper/attribute")
        );
        List<String> forbidden = List.of(
            "public.attribute_definitions",
            "resource_definitions",
            "entity_resource_values",
            "entity_resource_stage_values",
            "ability_costs",
            "resource_effect_details",
            "displayunit",
            "display_unit",
            "change_revision"
        );

        for (Path implementationRoot : implementationRoots) {
            assertTrue(Files.isDirectory(implementationRoot), () -> "missing " + implementationRoot);
            try (Stream<Path> paths = Files.walk(implementationRoot)) {
                for (Path path : paths.filter(Files::isRegularFile).toList()) {
                    String content = Files.readString(path, StandardCharsets.UTF_8)
                        .toLowerCase(Locale.ROOT);
                    for (String token : forbidden) {
                        assertFalse(content.contains(token), () -> path + " contains " + token);
                    }
                }
            }
        }
    }

    private static String tableBody(String sql) {
        Matcher matcher = Pattern.compile(
            "(?is)create\\s+table\\s+public\\.attributes\\s*\\((.*?)\\)\\s*;"
        ).matcher(sql);
        assertTrue(matcher.find(), "missing CREATE TABLE public.attributes");
        return matcher.group(1);
    }

    private static void assertContains(String normalized, String expected) {
        assertTrue(normalized.contains(expected), () -> "missing SQL fragment: " + expected);
    }

    private static String executableSql(Path path) throws IOException {
        assertTrue(Files.isRegularFile(path), () -> "missing repository artifact: " + path);
        String sql = Files.readString(path, StandardCharsets.UTF_8);
        String noBlockComments = Pattern.compile("(?s)/\\*.*?\\*/").matcher(sql).replaceAll("");
        return Pattern.compile("(?m)--[^\\n]*").matcher(noBlockComments).replaceAll("");
    }

    private static String normalize(String value) {
        return value.toLowerCase(Locale.ROOT).replaceAll("\\s+", " ").trim();
    }

    private static Path resolveRepositoryRoot() {
        Path current = Paths.get("").toAbsolutePath().normalize();
        for (Path candidate = current; candidate != null; candidate = candidate.getParent()) {
            if (Files.isRegularFile(candidate.resolve("server/data_manage/pom.xml"))
                && Files.isDirectory(candidate.resolve("db/game_manage"))) {
                return candidate;
            }
        }
        throw new IllegalStateException("cannot resolve repository root from " + current);
    }
}
