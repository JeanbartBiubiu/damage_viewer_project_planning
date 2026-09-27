package xyz.game.datamanage.db.damagetype;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

class DamageTypeFormulaSchemaSqlTest {

    @Test
    void schemaAddsNullableObjectFormulaWithoutIndexOrFormulaTable() throws IOException {
        String schema = read("db/game_manage/schema.sql");
        String normalized = normalized(schema);
        String damageTypes = tableBody(normalized, "public.damage_types");

        assertTrue(damageTypes.contains("calculation_formula jsonb"));
        assertFalse(damageTypes.contains("calculation_formula jsonb not null"));
        assertTrue(damageTypes.contains("ck_damage_types_calculation_formula"));
        assertTrue(damageTypes.contains(
            "calculation_formula is null or jsonb_typeof(calculation_formula) = 'object'"
        ));
        assertTrue(schema.contains("COMMENT ON COLUMN public.damage_types.calculation_formula"));
        assertFalse(normalized.contains("create table public.damage_type_formulas"));
        assertFalse(Pattern.compile("create\\s+(unique\\s+)?index\\s+\\S+\\s+on\\s+public\\.damage_types\\s*\\([^)]*calculation_formula")
            .matcher(normalized).find());
        assertFalse(normalized.contains("using gin"));
    }

    @Test
    void migrationOnlyAddsColumnConstraintAndComment() throws IOException {
        String sql = read("db/game_manage/migrations/damage_type_calculation_formula.sql");
        String executable = sql.replaceAll("(?m)--[^\\n]*", "");
        String normalized = normalized(executable);

        assertTrue(sql.contains("BEGIN;"));
        assertTrue(sql.contains("COMMIT;"));
        assertTrue(sql.contains("禁止重放"));
        assertTrue(sql.contains("ADD COLUMN calculation_formula jsonb"));
        assertTrue(sql.contains("ADD CONSTRAINT ck_damage_types_calculation_formula"));
        assertTrue(sql.contains("jsonb_typeof(calculation_formula) = 'object'"));
        assertTrue(sql.contains("COMMENT ON COLUMN public.damage_types.calculation_formula"));
        assertTrue(sql.contains("damage_type_formula_rows_before"));
        assertTrue(sql.contains("damage_type_formula_refs_before"));
        assertTrue(sql.contains("EXCEPT ALL"));
        assertTrue(sql.contains("迁移写入了结算公式"));
        assertTrue(sql.contains("迁移改变了现有伤害类型"));
        assertTrue(sql.contains("迁移改变了技能对象引用"));
        assertFalse(normalized.contains("cascade"));
        assertFalse(normalized.contains("create index"));
        assertFalse(normalized.contains("create table public.damage_type"));
        assertFalse(normalized.contains("drop table"));
        assertFalse(normalized.contains("insert into public.damage_types"));
        assertFalse(normalized.contains("delete from public.damage_types"));
        assertFalse(Pattern.compile("update\\s+public\\.damage_types").matcher(normalized).find());
        assertFalse(normalized.contains("skill_object_references") && normalized.contains("insert into public.skill_object_references"));
    }

    @Test
    void mapperStatementsMatchAndBasicUpdateDoesNotOverwriteFormula() throws IOException {
        String xml = read("server/data_manage/src/main/resources/mapper/damagetype/DamageTypeMapper.xml");
        String java = read("server/data_manage/src/main/java/xyz/game/datamanage/mapper/damagetype/DamageTypeMapper.java");
        for (String id : new String[] {
            "findFormulaById", "findFormulaForUpdate", "updateFormula", "clearFormula", "findAttributesByKeys"
        }) {
            assertTrue(xml.contains("id=\"" + id + "\""), id);
            assertTrue(java.contains(id + "("), id);
        }
        String basicUpdate = statement(xml, "update");
        assertFalse(basicUpdate.contains("calculation_formula"));
        assertTrue(basicUpdate.contains("updated_at = now()"));
        String formulaUpdate = statement(xml, "updateFormula");
        assertTrue(formulaUpdate.contains("calculation_formula"));
        assertTrue(formulaUpdate.contains("updated_at = now()"));
        assertFalse(formulaUpdate.contains("name ="));
        String clear = statement(xml, "clearFormula");
        assertTrue(clear.contains("calculation_formula = NULL"));
        assertTrue(clear.contains("calculation_formula IS NOT NULL"));
        assertTrue(xml.contains("<sql id=\"responseColumns\">"));
        assertTrue(xml.contains("(calculation_formula IS NOT NULL) AS formula_configured"));
        assertTrue(xml.contains("<arg column=\"formula_configured\" javaType=\"_boolean\"/>"));
        assertTrue(statement(xml, "list").contains("responseColumns"));
        assertTrue(statement(xml, "findById").contains("responseColumns"));
        assertFalse(statement(xml, "list").contains("calculation_formula::text"));
        assertTrue(statement(xml, "findFormulaForUpdate").contains("FOR UPDATE"));
        assertTrue(statement(xml, "findAttributesByKeys").contains("game_id = #{gameId}"));
        assertTrue(statement(xml, "insert").contains("sort_order"));
        assertFalse(statement(xml, "insert").contains("calculation_formula"));
    }

    private static String statement(String xml, String id) {
        Matcher matcher = Pattern.compile(
            "<(select|update|insert|delete) id=\"" + id + "\"[\\s\\S]*?</\\1>",
            Pattern.CASE_INSENSITIVE
        ).matcher(xml);
        assertTrue(matcher.find(), id);
        return matcher.group();
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
