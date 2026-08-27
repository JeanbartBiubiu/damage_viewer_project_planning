package xyz.game.datamanage.db.skill;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * Static SQL contract for skill_parameters / skill_formulas / skill_formula_nodes.
 * Does not connect to a live database.
 */
class SkillParameterFormulaManagementDbContractSqlTest {

    private static final String SCHEMA_RELATIVE = "db/game_manage/schema.sql";
    private static final String MIGRATION_RELATIVE =
        "db/game_manage/migrations/compatibility/skill_parameter_formula_management_migration.sql";

    private static String schemaSql;
    private static String migrationSql;
    private static String schemaNormalized;
    private static String migrationNormalized;

    @BeforeAll
    static void loadArtifacts() throws IOException {
        schemaSql = readRelative(SCHEMA_RELATIVE);
        migrationSql = readRelative(MIGRATION_RELATIVE);
        schemaNormalized = normalize(schemaSql);
        migrationNormalized = normalize(stripLineComments(migrationSql));
    }

    @Test
    void schemaAndMigrationDefineThreeTables() {
        assertTrue(schemaNormalized.contains("create table public.skill_parameters"));
        assertTrue(schemaNormalized.contains("create table public.skill_formulas"));
        assertTrue(schemaNormalized.contains("create table public.skill_formula_nodes"));

        assertTrue(migrationNormalized.contains("create table if not exists public.skill_parameters"));
        assertTrue(migrationNormalized.contains("create table if not exists public.skill_formulas"));
        assertTrue(migrationNormalized.contains("create table if not exists public.skill_formula_nodes"));
    }

    @Test
    void schemaDeclaresPrimaryKeysCompositeFksIndexesAndChecks() {
        String parameters = normalize(extractCreateTable(schemaSql, "skill_parameters"));
        String formulas = normalize(extractCreateTable(schemaSql, "skill_formulas"));
        String nodes = normalize(extractCreateTable(schemaSql, "skill_formula_nodes"));

        assertTrue(parameters.contains("constraint pk_skill_parameters"));
        assertTrue(parameters.contains("primary key (game_id, skill_key, parameter_key)"));
        assertTrue(parameters.contains(
            "foreign key (game_id, skill_key) references public.skills (game_id, skill_key)"
        ));
        assertFalse(parameters.contains("on delete cascade"));

        assertTrue(formulas.contains("constraint pk_skill_formulas"));
        assertTrue(formulas.contains("primary key (game_id, skill_key, formula_key)"));
        assertTrue(formulas.contains(
            "foreign key (game_id, skill_key) references public.skills (game_id, skill_key)"
        ));
        assertFalse(formulas.contains("on delete cascade"));

        assertTrue(nodes.contains("constraint pk_skill_formula_nodes"));
        assertTrue(nodes.contains("primary key (game_id, skill_key, formula_key, node_id)"));
        assertTrue(nodes.contains(
            "foreign key (game_id, skill_key, formula_key) "
                + "references public.skill_formulas (game_id, skill_key, formula_key) "
                + "on delete cascade"
        ));
        assertTrue(nodes.contains(
            "foreign key (game_id, skill_key, formula_key, parent_node_id) "
                + "references public.skill_formula_nodes (game_id, skill_key, formula_key, node_id) "
                + "on delete cascade"
        ));
        assertTrue(nodes.contains(
            "foreign key (game_id, skill_key, parameter_key) "
                + "references public.skill_parameters (game_id, skill_key, parameter_key)"
        ));
        assertFalse(Pattern.compile(
            "(?is)fk_skill_formula_nodes_parameter[^,]*on delete cascade"
        ).matcher(nodes).find());
        assertTrue(nodes.contains(
            "foreign key (game_id, attribute_key) "
                + "references public.attributes (game_id, attribute_key)"
        ));

        assertTrue(nodes.contains("constraint ck_skill_formula_nodes_child_order"));
        assertTrue(nodes.contains("parent_node_id is null and child_order = 0"));
        assertTrue(nodes.contains("parent_node_id is not null and child_order in (0, 1)"));
        assertTrue(nodes.contains("constraint ck_skill_formula_nodes_payload"));

        assertTrue(schemaNormalized.contains(
            "create unique index uq_skill_formula_nodes_root "
                + "on public.skill_formula_nodes (game_id, skill_key, formula_key) "
                + "where parent_node_id is null"
        ));
        assertTrue(schemaNormalized.contains(
            "create index ix_skill_formula_nodes_parameter_ref "
                + "on public.skill_formula_nodes (game_id, skill_key, parameter_key) "
                + "where parameter_key is not null"
        ));
        assertTrue(schemaNormalized.contains(
            "create index ix_skill_formula_nodes_attribute_ref "
                + "on public.skill_formula_nodes (game_id, attribute_key) "
                + "where attribute_key is not null"
        ));
        assertTrue(schemaNormalized.contains(
            "create index ix_skill_parameters_list on public.skill_parameters "
                + "(game_id, skill_key, sort_order, name, parameter_key)"
        ));
        assertTrue(schemaNormalized.contains(
            "create index ix_skill_formulas_list on public.skill_formulas "
                + "(game_id, skill_key, sort_order, name, formula_key)"
        ));
    }

    @Test
    void payloadCheckRequiresNonNullOwnedFieldsToAvoidNullPass() {
        String nodes = normalize(extractCreateTable(schemaSql, "skill_formula_nodes"));
        String payload = extractConstraint(nodes, "ck_skill_formula_nodes_payload");

        assertTrue(payload.contains("node_type = 'operation'"));
        assertTrue(payload.contains("operation is not null"));
        assertTrue(payload.contains("parameter_key is null"));
        assertTrue(payload.contains("attribute_owner is null"));
        assertTrue(payload.contains("attribute_key is null"));
        assertTrue(payload.contains("attribute_value_kind is null"));

        assertTrue(payload.contains("node_type = 'parameter'"));
        assertTrue(payload.contains("operation is null"));
        assertTrue(payload.contains("parameter_key is not null"));

        assertTrue(payload.contains("node_type = 'attribute'"));
        assertTrue(payload.contains("attribute_owner is not null"));
        assertTrue(payload.contains("attribute_key is not null"));
        assertTrue(payload.contains("attribute_value_kind is not null"));
        assertTrue(payload.contains("'source', 'target'"));
        assertTrue(payload.contains("'base', 'bonus', 'total', 'current', 'missing'"));
        assertTrue(payload.contains("'current_ratio', 'missing_ratio'"));

        String migrationNodes = normalize(extractCreateTable(migrationSql, "skill_formula_nodes"));
        String migrationPayload = extractConstraint(migrationNodes, "ck_skill_formula_nodes_payload");
        assertTrue(migrationPayload.contains("operation is not null"));
        assertTrue(migrationPayload.contains("parameter_key is not null"));
        assertTrue(migrationPayload.contains("attribute_owner is not null"));
        assertTrue(migrationPayload.contains("attribute_key is not null"));
        assertTrue(migrationPayload.contains("attribute_value_kind is not null"));
    }

    @Test
    void parameterValueShapeCoversFourModes() {
        String parameters = normalize(extractCreateTable(schemaSql, "skill_parameters"));
        String shape = extractConstraint(parameters, "ck_skill_parameters_value_shape");

        assertTrue(shape.contains("value_mode = 'fixed'"));
        assertTrue(shape.contains("fixed_value is not null"));
        assertTrue(shape.contains("level_values is null"));

        assertTrue(shape.contains("value_mode in ('skill_level', 'character_level')"));
        assertTrue(shape.contains("fixed_value is null"));
        assertTrue(shape.contains("level_values is not null"));
        assertTrue(shape.contains("jsonb_typeof(level_values) = 'object'"));

        assertTrue(shape.contains("value_mode = 'runtime_input'"));
        assertTrue(Pattern.compile(
            "(?is)value_mode\\s*=\\s*'runtime_input'\\s+and\\s+fixed_value\\s+is\\s+null\\s+"
                + "and\\s+level_values\\s+is\\s+null"
        ).matcher(shape).find());

        String migrationParameters = normalize(extractCreateTable(migrationSql, "skill_parameters"));
        String migrationShape = extractConstraint(migrationParameters, "ck_skill_parameters_value_shape");
        assertTrue(migrationShape.contains("value_mode = 'runtime_input'"));
        assertTrue(migrationShape.contains("fixed_value is null"));
        assertTrue(migrationShape.contains("level_values is null"));
    }

    @Test
    void deleteSemanticsKeepParameterFkNonCascadeAndSkillNonBypass() {
        String parameters = normalize(extractCreateTable(schemaSql, "skill_parameters"));
        String formulas = normalize(extractCreateTable(schemaSql, "skill_formulas"));
        String nodes = normalize(extractCreateTable(schemaSql, "skill_formula_nodes"));

        assertFalse(parameters.contains("on delete cascade"));
        assertFalse(formulas.contains("on delete cascade"));
        assertTrue(nodes.contains(
            "references public.skill_formulas (game_id, skill_key, formula_key) on delete cascade"
        ));
        assertFalse(Pattern.compile(
            "(?is)references public\\.skill_parameters[^)]*\\)\\s*on delete cascade"
        ).matcher(nodes).find());
    }

    @Test
    void compatibilityMigrationPreflightsSameStructureAndStaysIdempotent() {
        assertTrue(migrationNormalized.contains("information_schema.columns"));
        assertTrue(migrationNormalized.contains("information_schema.tables"));
        assertTrue(migrationNormalized.contains("pg_constraint"));
        assertTrue(migrationNormalized.contains("pg_indexes"));
        assertTrue(migrationNormalized.contains("raise exception"));
        assertTrue(migrationNormalized.contains("create table if not exists public.skill_parameters"));
        assertTrue(migrationNormalized.contains("create table if not exists public.skill_formulas"));
        assertTrue(migrationNormalized.contains("create table if not exists public.skill_formula_nodes"));
        assertTrue(migrationNormalized.contains("create index if not exists ix_skill_parameters_list"));
        assertTrue(migrationNormalized.contains(
            "create unique index if not exists uq_skill_formula_nodes_root"
        ));

        int catalogCheckPos = migrationNormalized.indexOf("do $$");
        int createParametersPos = migrationNormalized.indexOf(
            "create table if not exists public.skill_parameters"
        );
        assertTrue(catalogCheckPos >= 0 && catalogCheckPos < createParametersPos);

        assertFalse(migrationNormalized.contains("calculation_variables"));
        assertFalse(migrationNormalized.contains("provider_formulas"));
        assertFalse(Pattern.compile("(?is)\\bdelete\\s+from\\b").matcher(migrationNormalized).find());
        assertFalse(Pattern.compile("(?is)\\bdrop\\s+table\\b").matcher(migrationNormalized).find());
        assertFalse(Pattern.compile("(?is)\\bdrop\\s+cascade\\b").matcher(migrationNormalized).find());
        assertFalse(Pattern.compile("(?is)\\binsert\\s+into\\b").matcher(migrationNormalized).find());
    }

    @Test
    void compatibilityMigrationChecksConstraintAndIndexDefinitionsNotJustNames() {
        String catalogChecks = normalize(stripLineComments(extractDoBlock(migrationSql)));

        assertTrue(catalogChecks.contains("pg_get_constraintdef"));
        assertTrue(catalogChecks.contains("pg_indexes"));
        assertTrue(catalogChecks.contains("pg_index") || catalogChecks.contains("indkey"));
        assertTrue(catalogChecks.contains("pk_skill_parameters"));
        assertTrue(catalogChecks.contains("array['game_id', 'skill_key', 'parameter_key']"));
        assertTrue(catalogChecks.contains("fk_skill_parameters_skill"));
        assertTrue(catalogChecks.contains("confdeltype <> 'c'") || catalogChecks.contains("confdeltype<>'c'"));
        assertTrue(catalogChecks.contains("pk_skill_formulas"));
        assertTrue(catalogChecks.contains("fk_skill_formulas_skill"));
        assertTrue(catalogChecks.contains("pk_skill_formula_nodes"));
        assertTrue(catalogChecks.contains("fk_skill_formula_nodes_formula"));
        assertTrue(catalogChecks.contains("confdeltype = 'c'"));
        assertTrue(catalogChecks.contains("fk_skill_formula_nodes_parameter"));
        assertTrue(catalogChecks.contains("fk_skill_formula_nodes_attribute"));
        assertTrue(catalogChecks.contains("ck_skill_parameters_value_shape"));
        assertTrue(catalogChecks.contains("ck_skill_formula_nodes_payload"));
        assertTrue(catalogChecks.contains("ck_skill_formula_nodes_child_order"));
        assertTrue(catalogChecks.contains("uq_skill_formula_nodes_root"));
        assertTrue(catalogChecks.contains("ix_skill_formula_nodes_parameter_ref"));
        assertTrue(catalogChecks.contains("ix_skill_formula_nodes_attribute_ref"));
        assertTrue(catalogChecks.contains("runtime_input"));
        assertTrue(catalogChecks.contains("operation is not null"));
        assertTrue(catalogChecks.contains("parameter_key is not null"));
        assertTrue(catalogChecks.contains("attribute_value_kind is not null"));
    }

    private static String extractConstraint(String createTableNormalized, String constraintName) {
        Matcher matcher = Pattern.compile(
            "(?is)constraint\\s+"
                + Pattern.quote(constraintName)
                + "\\s+check\\s*\\("
        ).matcher(createTableNormalized);
        assertTrue(matcher.find(), "constraint " + constraintName + " missing");
        int depth = 0;
        boolean inParens = false;
        for (int i = matcher.end() - 1; i < createTableNormalized.length(); i++) {
            char ch = createTableNormalized.charAt(i);
            if (ch == '(') {
                depth++;
                inParens = true;
            } else if (ch == ')') {
                depth--;
                if (inParens && depth == 0) {
                    return createTableNormalized.substring(matcher.start(), i + 1);
                }
            }
        }
        fail("unable to extract CHECK body for " + constraintName);
        return "";
    }

    private static String extractCreateTable(String sql, String tableName) {
        Matcher matcher = Pattern.compile(
            "(?is)CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+public\\."
                + Pattern.quote(tableName)
                + "\\s*\\("
        ).matcher(sql);
        assertTrue(matcher.find(), "CREATE TABLE public." + tableName + " missing");
        int depth = 0;
        boolean inParens = false;
        for (int i = matcher.end() - 1; i < sql.length(); i++) {
            char ch = sql.charAt(i);
            if (ch == '(') {
                depth++;
                inParens = true;
            } else if (ch == ')') {
                depth--;
                if (inParens && depth == 0) {
                    int end = i + 1;
                    while (end < sql.length() && sql.charAt(end) != ';') {
                        end++;
                    }
                    return sql.substring(matcher.start(), Math.min(end + 1, sql.length()));
                }
            }
        }
        fail("unable to extract CREATE TABLE body for " + tableName);
        return "";
    }

    private static String extractDoBlock(String sql) {
        Matcher matcher = Pattern.compile("(?is)DO\\s+\\$\\$.*?END\\s+\\$\\$").matcher(sql);
        assertTrue(matcher.find(), "DO $$ catalog check block missing");
        return matcher.group();
    }

    private static String stripLineComments(String raw) {
        return Pattern.compile("(?m)--[^\\n]*").matcher(raw).replaceAll("");
    }

    private static String normalize(String value) {
        return value.toLowerCase().replaceAll("\\s+", " ").trim();
    }

    private static String readRelative(String relative) throws IOException {
        return Files.readString(resolveRelative(relative), StandardCharsets.UTF_8);
    }

    private static Path resolveRelative(String relative) {
        Path cwd = Paths.get("").toAbsolutePath().normalize();
        List<Path> candidates = List.of(
            cwd.resolve("../../" + relative).normalize(),
            cwd.resolve("../" + relative).normalize(),
            cwd.resolve(relative).normalize()
        );
        for (Path candidate : candidates) {
            if (Files.isRegularFile(candidate)) {
                return candidate;
            }
        }
        fail("unable to resolve " + relative + " from cwd=" + cwd);
        return null;
    }
}
