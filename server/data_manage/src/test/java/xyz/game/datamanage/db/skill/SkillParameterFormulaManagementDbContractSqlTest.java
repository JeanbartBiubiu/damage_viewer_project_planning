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

/** 参数整张等级图、公式聚合存储及引用保护的静态契约；不连接数据库。 */
class SkillParameterFormulaManagementDbContractSqlTest {
    private static String schemaSql;
    private static String schemaNormalized;
    private static String migrationNormalized;

    @BeforeAll
    static void loadArtifacts() throws IOException {
        schemaSql = readRelative("db/game_manage/schema.sql");
        schemaNormalized = normalize(schemaSql);
        migrationNormalized = normalize(stripLineComments(readRelative(
            "db/game_manage/migrations/breaking/aggregate_parts/formulas.sql")));
    }

    @Test
    void schemaKeepsParametersAndFormulasWithOneOwnedExpression() {
        assertTrue(schemaNormalized.contains("create table public.skill_parameters"));
        assertTrue(schemaNormalized.contains("create table public.skill_formulas"));
        assertFalse(schemaNormalized.contains("create table public.skill_formula_nodes"));
        String formulas = normalize(extractCreateTable(schemaSql, "skill_formulas"));
        assertTrue(formulas.contains("expression jsonb not null"));
        assertTrue(schemaNormalized.contains("ck_skill_formulas_expression check (jsonb_typeof(expression) = 'object')"));
        assertTrue(migrationNormalized.contains("alter table public.skill_formulas add column expression jsonb"));
        assertTrue(migrationNormalized.contains("alter column expression set not null"));
    }

    @Test
    void metadataRetainsCompositeKeysIndexesAndNonCascadingSkillReferences() {
        String parameters = normalize(extractCreateTable(schemaSql, "skill_parameters"));
        String formulas = normalize(extractCreateTable(schemaSql, "skill_formulas"));
        for (String table : List.of("skill_parameters", "skill_formulas")) {
            String body = normalize(extractCreateTable(schemaSql, table));
            String key = table.equals("skill_parameters") ? "parameter_key" : "formula_key";
            assertTrue(body.contains("primary key (game_id, skill_key, " + key + ")"));
            assertTrue(body.contains("foreign key (game_id, skill_key) references public.skills (game_id, skill_key)"));
            assertFalse(body.contains("on delete cascade"));
            assertTrue(body.contains("check (" + key + " ~ '^[a-z][a-z0-9_]{0,63}$')"));
            assertTrue(body.contains("check (btrim(name) <> '')"));
            assertTrue(body.contains("check (sort_order >= 0)"));
            assertTrue(schemaNormalized.contains("create index ix_" + table + "_list on public." + table
                + " (game_id, skill_key, sort_order, name, " + key + ")"));
        }
        assertTrue(parameters.contains("fixed_value numeric"));
        assertTrue(parameters.contains("level_values jsonb"));
        assertTrue(parameters.contains("value_type in ('decimal', 'integer')"));
        assertTrue(formulas.contains("description varchar(2000)"));
    }

    @Test
    void parameterValueShapeCoversFourModesAndPreservesWholeLevelMaps() {
        String parameters = normalize(extractCreateTable(schemaSql, "skill_parameters"));
        String shape = extractConstraint(parameters, "ck_skill_parameters_value_shape");
        assertTrue(shape.contains("value_mode = 'fixed'"));
        assertTrue(shape.contains("fixed_value is not null"));
        assertTrue(shape.contains("level_values is null"));
        assertTrue(shape.contains("value_mode in ('skill_level', 'character_level')"));
        assertTrue(shape.contains("fixed_value is null"));
        assertTrue(shape.contains("level_values is not null"));
        assertTrue(shape.contains("jsonb_typeof(level_values) = 'object'"));
        assertTrue(Pattern.compile("value_mode\\s*=\\s*'runtime_input'\\s+and\\s+fixed_value\\s+is\\s+null\\s+and\\s+level_values\\s+is\\s+null")
            .matcher(shape).find());
        assertTrue(normalize(extractCreateTable(schemaSql, "character_attributes")).contains("level_values jsonb not null"));
        assertTrue(normalize(extractCreateTable(schemaSql, "equipment_attributes")).contains("attribute_values jsonb not null"));
        assertFalse(Pattern.compile("(?i)\\b(update|alter table|delete from)\\s+public\\.skill_parameters\\b")
            .matcher(migrationNormalized).find());
    }

    @Test
    void formulaValidationAndReadbackUseTheOrderedApiExpression() throws IOException {
        String service = readRelative("server/data_manage/src/main/java/xyz/game/datamanage/service/skillformula/SkillFormulaService.java");
        String mapper = readRelative("server/data_manage/src/main/resources/mapper/skillformula/SkillFormulaMapper.xml");
        assertTrue(service.contains("MAX_DEPTH = 32"));
        assertTrue(service.contains("MAX_NODES = 256"));
        assertTrue(service.contains("validateForeignFields(node, path, issues)"));
        assertTrue(service.contains("\"FIELD_MUTEX\""));
        assertTrue(service.contains("\"OPERAND_COUNT\""));
        assertTrue(service.contains("walkValidate(operands.get(0)"));
        assertTrue(service.contains("walkValidate(operands.get(1)"));
        assertTrue(service.contains("validateAttributeEnabled(gameId, refs, existingRefs)"));
        assertTrue(service.contains("400.INVALID_FORMULA_REFERENCE"));
        assertTrue(service.contains("AggregateJson.write(values.expression())"));
        assertTrue(service.contains("AggregateJson.read(row.expression(), SkillFormulaExpressionNode.class)"));
        assertFalse(service.contains("SkillFormulaNodeRow"));
        assertFalse(mapper.contains("public.skill_formula_nodes"));
        assertTrue(mapper.contains("CAST(#{expression} AS jsonb)"));
        assertTrue(mapper.contains("WITH RECURSIVE"));
        assertTrue(mapper.contains("parent.node->'operands'"));
        assertTrue(mapper.contains("node->>'nodeType' = 'ATTRIBUTE'"));
    }

    @Test
    void parameterAndFormulaDeletionRequireGameLockAndExplicitReferenceProtection() throws IOException {
        for (String kind : List.of("Parameter", "Formula")) {
            String service = readRelative("server/data_manage/src/main/java/xyz/game/datamanage/service/skill"
                + kind.toLowerCase() + "/Skill" + kind + "Service.java");
            int delete = service.indexOf("public void delete(");
            int lock = service.indexOf("configurationWrites.begin(gameId)", delete);
            int guard = service.indexOf("configurationWrites.assertNotReferenced(gameId, \"" + kind.toUpperCase() + "\"", delete);
            int write = service.indexOf(kind.toLowerCase() + "Mapper.delete(", delete);
            assertTrue(delete >= 0 && lock > delete && guard > lock && write > guard, kind);
            assertTrue(service.contains("409.SKILL_" + kind.toUpperCase() + "_IN_USE"));
        }
        String guard = readRelative("server/data_manage/src/main/java/xyz/game/datamanage/support/authoring/GameConfigurationWriteGuard.java");
        assertTrue(guard.contains("isActualTransactionActive()"));
        assertTrue(guard.contains("beforeCommit(boolean readOnly)"));
        assertTrue(guard.contains("SkillObjectReferences.extractAndValidate"));
        assertTrue(guard.contains("validateAndReplace(gameId)"));
    }

    @Test
    void formulaMigrationRejectsMissingRootsCyclesOrLimitsBeforeWriting() {
        assertTrue(migrationNormalized.contains("count(n.node_id) not between 1 and 256"));
        assertTrue(migrationNormalized.contains("filter (where n.parent_node_id is null) <> 1"));
        assertTrue(migrationNormalized.contains("count(c.node_id) <> 2"));
        assertTrue(migrationNormalized.contains("min(c.child_order) <> 0 or max(c.child_order) <> 1"));
        assertTrue(migrationNormalized.contains("with recursive reachable as"));
        assertTrue(migrationNormalized.contains("not c.node_id = any(p.visited)"));
        assertTrue(migrationNormalized.contains("r.node_id is null or r.depth > 32"));
        assertTrue(migrationNormalized.indexOf("raise exception") < migrationNormalized.indexOf("add column expression jsonb"));
    }

    @Test
    void formulaMigrationPreservesOperandOrderWithoutCompatibilityTablesOrDataDeletion() {
        assertTrue(migrationNormalized.contains("create function pg_temp.damage_formula_expression"));
        assertTrue(migrationNormalized.contains("order by n.child_order"));
        assertTrue(migrationNormalized.contains("'operation', current_node.operation, 'operands', children"));
        assertTrue(migrationNormalized.contains("'parameterkey', current_node.parameter_key"));
        assertTrue(migrationNormalized.contains("'attributevaluekind', current_node.attribute_value_kind"));
        assertFalse(Pattern.compile("\\b(create table|create view|delete from|drop table|commit)\\b").matcher(migrationNormalized).find());
        assertFalse(migrationNormalized.contains("updated_at ="));
        assertFalse(migrationNormalized.contains("provider_formulas"));
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
