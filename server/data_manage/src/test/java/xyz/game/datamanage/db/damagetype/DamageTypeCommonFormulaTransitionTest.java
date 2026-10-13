package xyz.game.datamanage.db.damagetype;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.ByteArrayOutputStream;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.math.BigDecimal;
import java.net.URLClassLoader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Set;
import javax.tools.ToolProvider;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import xyz.game.datamanage.support.formula.FormulaContractValidator;
import xyz.game.datamanage.support.formula.DamageTypeFormulaBindings;

class DamageTypeCommonFormulaTransitionTest {
    private static final ObjectMapper JSON = new ObjectMapper().enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS)
        .setNodeFactory(JsonNodeFactory.withExactBigDecimals(true));
    @TempDir static Path compiled;
    private static Method convert;
    private static Method compare;

    @BeforeAll static void compileToolWithoutDatabaseAccess() throws Exception {
        Path root = root();
        ByteArrayOutputStream diagnostics = new ByteArrayOutputStream();
        int result = ToolProvider.getSystemJavaCompiler().run(null, diagnostics, diagnostics, "-encoding", "UTF-8", "-cp",
            System.getProperty("surefire.test.class.path", System.getProperty("java.class.path")), "-d", compiled.toString(),
            root.resolve("tools/authoring/ApplyDamageTypeCommonFormula.java").toString());
        assertEquals(0, result, diagnostics.toString(StandardCharsets.UTF_8));
        Class<?> tool = Class.forName("ApplyDamageTypeCommonFormula", true, new URLClassLoader(new java.net.URL[]{compiled.toUri().toURL()}, DamageTypeCommonFormulaTransitionTest.class.getClassLoader()));
        convert = tool.getMethod("convert", JsonNode.class, Set.class);
        compare = tool.getMethod("compareArithmetic", JsonNode.class, JsonNode.class);
    }

    @Test void structureMigrationKeepsKeysIndexesAndTwoSourceOwnerForeignKeys() throws Exception {
        String sql = Files.readString(root().resolve("db/game_manage/migrations/damage_type_common_formula_references.sql"));
        String schema = Files.readString(root().resolve("db/game_manage/schema.sql"));
        assertTrue(sql.contains("source_owner_skill_key") && sql.contains("source_owner_damage_type_key"));
        assertTrue(sql.contains("GENERATED ALWAYS") && sql.contains("ck_skill_object_references_source_shape"));
        assertTrue(sql.contains("REFERENCES public.skills") && sql.contains("REFERENCES public.damage_types"));
        assertFalse(sql.toLowerCase().matches("(?s).*drop (table|index).*"));
        assertFalse(sql.contains("pk_skill_object_references") || sql.contains("ix_skill_object_references_target"));
        assertFalse(sql.contains("INSERT INTO") || sql.contains("UPDATE public.") || sql.contains("DELETE FROM"));
        assertTrue(schema.contains("FOREIGN KEY (game_id, source_owner_skill_key)"));
        assertTrue(schema.contains("FOREIGN KEY (game_id, source_owner_damage_type_key)"));
    }

    @Test void exactDecimalAndUnusedDeclaredStagesAreRetained() throws Exception {
        var old = legacy();
        old.set("resistanceBeforePenetration", JSON.readTree("{\"nodeType\":\"FIXED\",\"value\":0.10000000000000000001}"));
        old.set("penetrationPercent", JSON.readTree("{\"nodeType\":\"FIXED\",\"value\":1.2300}"));
        JsonNode formula = converted(old, Set.of());
        assertEquals("0.10000000000000000001", formula.at("/stages/0/expression/value").textValue());
        assertEquals("1.2300", formula.at("/stages/1/expression/value").textValue());
        assertEquals(5, formula.path("stages").size());
        assertEquals("resistanceFactor", formula.path("outputStageKey").textValue());
        assertEquals("0", ((JsonNode) compare.invoke(null, old, formula)).path("maxAbsoluteDifference").textValue());
    }

    @Test void sharedAttributeTriplesDeduplicateAndOldReferencesBecomePlainRefs() throws Exception {
        ObjectNode old = legacy();
        JsonNode attribute = attribute("TARGET", "armor", "TOTAL");
        old.set("resistanceBeforePenetration", attribute);
        old.set("penetrationPercent", attribute);
        old.set("effectiveResistance", operation("ADD", stage("RESISTANCE_BEFORE_PENETRATION"), stage("PENETRATION_PERCENT")));
        JsonNode formula = converted(old, Set.of("armor"));
        assertEquals(1, formula.path("inputs").size());
        assertEquals("read", formula.at("/stages/0/expression/op").textValue());
        assertEquals("ref", formula.at("/stages/3/expression/args/0/op").textValue());
        assertNull(FormulaContractValidator.validate(formula, DamageTypeFormulaBindings.allowed(Set.of("armor"))));
        JsonNode comparisons = (JsonNode) compare.invoke(null, old, formula);
        assertTrue(comparisons.path("cases").asInt() >= 9);
    }

    @Test void resistanceAndPenetrationBoundariesAreCheckedByIndependentInterpreters() throws Exception {
        ObjectNode old = resistance();
        JsonNode formula = converted(old, Set.of("resistance", "percent", "flat"));
        JsonNode comparison = (JsonNode) compare.invoke(null, old, formula);
        assertEquals(730, comparison.path("cases").asInt());
        assertEquals(3650, comparison.path("stageComparisons").asInt());
        assertEquals("0", comparison.path("maxAbsoluteDifference").textValue());
        // 篡改转换结果不能通过算术核对，即使它的共同结构合法。
        ((ObjectNode) formula.at("/stages/4/expression")).put("op", "const").put("value", "1").remove("args");
        assertThrows(InvocationTargetException.class, () -> compare.invoke(null, old, formula));
    }

    @Test void malformedUnknownUnauthorizedDisabledAndForwardLegacyReferencesStop() throws Exception {
        for (JsonNode bad : List.of(JSON.readTree("{\"nodeType\":\"PARAMETER\",\"parameterKey\":\"p\"}"),
            attribute("OWNER", "armor", "TOTAL"), attribute("TARGET", "armor", "MAX"),
            stage("RESISTANCE_FACTOR"), JSON.readTree("{\"nodeType\":\"FIXED\",\"value\":1,\"extra\":true}"))) {
            var old = legacy(); old.set("resistanceBeforePenetration", bad);
            assertThrows(InvocationTargetException.class, () -> converted(old, Set.of("armor")));
        }
        var disabled = legacy(); disabled.set("resistanceBeforePenetration", attribute("TARGET", "armor", "TOTAL"));
        assertThrows(InvocationTargetException.class, () -> converted(disabled, Set.of()));
    }

    private static ObjectNode resistance() {
        ObjectNode old = legacy();
        old.set("resistanceBeforePenetration", attribute("TARGET", "resistance", "TOTAL"));
        old.set("penetrationPercent", operation("MAX", fixed("0"), operation("MIN", fixed("1"), attribute("SOURCE", "percent", "TOTAL"))));
        old.set("penetrationFlat", operation("MAX", fixed("0"), attribute("SOURCE", "flat", "TOTAL")));
        old.set("effectiveResistance", operation("MIN", stage("RESISTANCE_BEFORE_PENETRATION"), operation("MAX", fixed("0"), operation("SUBTRACT",
            operation("MULTIPLY", stage("RESISTANCE_BEFORE_PENETRATION"), operation("SUBTRACT", fixed("1"), stage("PENETRATION_PERCENT"))), stage("PENETRATION_FLAT")))));
        old.set("resistanceFactor", operation("SUBTRACT", operation("DIVIDE", fixed("100"), operation("ADD", fixed("100"), operation("MAX", stage("EFFECTIVE_RESISTANCE"), fixed("0")))),
            operation("DIVIDE", operation("MIN", stage("EFFECTIVE_RESISTANCE"), fixed("0")), operation("SUBTRACT", fixed("100"), operation("MIN", stage("EFFECTIVE_RESISTANCE"), fixed("0"))))));
        return old;
    }
    private static ObjectNode legacy() { ObjectNode result = JSON.createObjectNode(); for (String field : List.of("resistanceBeforePenetration", "penetrationPercent", "penetrationFlat", "effectiveResistance")) result.set(field, fixed("0")); result.set("resistanceFactor", fixed("1")); return result; }
    private static JsonNode fixed(String number) { return JSON.createObjectNode().put("nodeType", "FIXED").put("value", new BigDecimal(number)); }
    private static JsonNode attribute(String owner, String key, String kind) { return JSON.createObjectNode().put("nodeType", "ATTRIBUTE").put("attributeOwner", owner).put("attributeKey", key).put("attributeValueKind", kind); }
    private static JsonNode stage(String key) { return JSON.createObjectNode().put("nodeType", "STAGE_RESULT").put("stageKey", key); }
    private static JsonNode operation(String operation, JsonNode left, JsonNode right) { ObjectNode result = JSON.createObjectNode().put("nodeType", "OPERATION").put("operation", operation); result.putArray("operands").add(left).add(right); return result; }
    private static JsonNode converted(JsonNode old, Set<String> enabled) throws Exception { return (JsonNode) convert.invoke(null, old, enabled); }
    private static Path root() { Path current = Path.of("").toAbsolutePath(); while (current != null && !Files.isRegularFile(current.resolve("server/data_manage/pom.xml"))) current = current.getParent(); return java.util.Objects.requireNonNull(current); }
}
