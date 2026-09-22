package xyz.game.datamanage.service.character;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.util.List;
import java.util.stream.IntStream;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.AnnotationTransactionAttributeSource;
import org.springframework.transaction.interceptor.TransactionInterceptor;
import org.springframework.transaction.support.AbstractPlatformTransactionManager;
import org.springframework.transaction.support.DefaultTransactionStatus;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.character.CharacterAuthoringCheckMapper;
import xyz.game.datamanage.mapper.character.CharacterMapper;
import xyz.game.datamanage.model.attribute.AttributeValueType;
import xyz.game.datamanage.model.character.*;
import xyz.game.datamanage.model.character.CharacterAuthoringCheckRows.*;
import xyz.game.datamanage.support.error.ApiException;

class CharacterAuthoringCheckServiceTest {
    @Test
    void stableLocationsUseThisReportsRawOrderAndPreserveFindings() {
        String raw = """
            {"lifecycle":null,"results":[
              {"resultKey":"later","name":"后排序","sortOrder":20,"resultType":"DAMAGE","target":"TARGET","detail":{"damageTypeKey":"gone"}},
              {"resultKey":"earlier","name":"先排序","sortOrder":0,"resultType":"DAMAGE","target":"TARGET","detail":{"damageTypeKey":"physical"}}
            ]}
            """;
        when(checks.listObjects("lol", "hero")).thenReturn(List.of(new ObjectRow("skill", "EFFECT", "hit", "命中", 0, raw)));
        when(checks.listReferences("lol", "hero")).thenReturn(List.of(new ReferenceRow("skill", "EFFECT", "hit",
            "results[0].detail.damageTypeKey", "DAMAGE_TYPE", "", "gone", "", false)));
        var response = check();
        var reference = response.references().getFirst();
        assertEquals("results[0].detail.damageTypeKey", reference.fieldPath());
        assertEquals("FIELD", reference.location().precision());
        assertEquals(new AuthoringCheckLocation.AuthoringCheckLocationSegment.KeyedChild("results", "resultKey", "later"),
            reference.location().segments().getFirst());
        var issue = response.issues().stream().filter(i -> i.code().equals("REFERENCE_TARGET_MISSING")).findFirst().orElseThrow();
        assertEquals(reference.location(), issue.location());
        assertTrue(response.issues().stream().allMatch(i -> i.location() != null));
        assertEquals(1, response.summary().errorCount());
        verify(checks, times(1)).listObjects("lol", "hero");
    }

    private final GamesMapper games = mock(GamesMapper.class);
    private final CharacterMapper characters = mock(CharacterMapper.class);
    private final CharacterAuthoringCheckMapper checks = mock(CharacterAuthoringCheckMapper.class);
    private CharacterAuthoringCheckService service;

    @BeforeEach
    void setup() {
        service = new CharacterAuthoringCheckService(games, characters, checks, new ObjectMapper());
        when(games.countGames("lol")).thenReturn(1L);
        when(characters.findById("lol", "hero")).thenReturn(new CharacterResponse("lol", "hero", "测试角色", null, null, null));
        when(characters.findLevelConfig("lol")).thenReturn(new LevelConfigResponse("lol", 1, 2));
        when(characters.findLevelValuesJson("lol", "hero")).thenReturn("{\"1\":{},\"2\":{}}");
        when(characters.listAttributeDefinitions("lol")).thenReturn(List.of(
            new CharacterAttributeDefinition("hp", AttributeValueType.DECIMAL, BigDecimal.ZERO, BigDecimal.valueOf(100)),
            new CharacterAttributeDefinition("stacks", AttributeValueType.INTEGER, BigDecimal.ZERO, BigDecimal.valueOf(5))));
        when(checks.listAttachedSkills("lol", "hero")).thenReturn(List.of(skill("skill", "ENABLED", true)));
        when(checks.listObjects("lol", "hero")).thenReturn(List.of());
        when(checks.listReferences("lol", "hero")).thenReturn(List.of());
    }

    @Test
    void completeEmptyGraphAndArbitrarySkillCountAreValidButDoNotVerifyMechanicsOrRuntime() {
        when(checks.listAttachedSkills("lol", "hero")).thenReturn(IntStream.range(0, 7).mapToObj(i -> skill("skill_" + i, "ENABLED", true)).toList());
        var response = check();
        assertEquals(7, response.summary().attachedSkillCount());
        assertEquals(0, response.summary().configuredAttributeCount());
        assertEquals(new CharacterAuthoringCheckResponse.Conclusions("NO_ERRORS", "NOT_CHECKED", "NOT_RUN"), response.conclusions());
        assertTrue(response.issues().isEmpty());
        assertNotNull(response.checkedAt());
    }

    @ParameterizedTest
    @NullSource
    @ValueSource(strings = {"{}", "[]", "not-json", "{\"1\":{}}", "{\"1\":{},\"2\":{},\"3\":{}}",
        "{\"01\":{},\"2\":{}}", "{\"1\":null,\"2\":{}}", "{\"1\":{},\"2\":[]}",
        "{\"1\":{\"hp\":0},\"2\":{}}", "{\"1\":{\"unknown\":0},\"2\":{\"unknown\":0}}",
        "{\"1\":{\"hp\":\"0\"},\"2\":{\"hp\":0}}", "{\"1\":{\"hp\":null},\"2\":{\"hp\":0}}",
        "{\"1\":{\"stacks\":0.1},\"2\":{\"stacks\":0}}", "{\"1\":{\"hp\":-1},\"2\":{\"hp\":0}}",
        "{\"1\":{\"hp\":101},\"2\":{\"hp\":0}}"})
    void missingRawRowsAndMalformedOrIncompleteLevelGraphsCannotLookValid(String json) {
        when(characters.findLevelValuesJson("lol", "hero")).thenReturn(json);
        var response = check();
        assertEquals("HAS_ERRORS", response.conclusions().structure());
        assertTrue(response.issues().stream().anyMatch(i -> i.code().equals("LEVEL_VALUES_INVALID") && i.fieldPath().startsWith("levelValues")));
    }

    @Test
    void fullRowsAllowZeroAndIntegerDecimalNotation() {
        when(characters.findLevelValuesJson("lol", "hero")).thenReturn("{\"1\":{\"hp\":0,\"stacks\":0},\"2\":{\"hp\":1.25,\"stacks\":5.0}}");
        assertTrue(check().issues().isEmpty());
        assertEquals(2, check().summary().configuredAttributeCount());
    }

    @Test
    void decimalBoundsAreComparedWithoutBinaryFloatingPointRounding() {
        var maximum = new BigDecimal("0.100000000000000000000000000000000001");
        when(characters.listAttributeDefinitions("lol")).thenReturn(List.of(new CharacterAttributeDefinition("hp", AttributeValueType.DECIMAL, BigDecimal.ZERO, maximum)));
        when(characters.findLevelValuesJson("lol", "hero")).thenReturn("{\"1\":{\"hp\":" + maximum + "},\"2\":{\"hp\":0}}");
        assertTrue(check().issues().isEmpty());
        when(characters.findLevelValuesJson("lol", "hero")).thenReturn("{\"1\":{\"hp\":0.100000000000000000000000000000000002},\"2\":{\"hp\":0}}");
        assertEquals("LEVEL_VALUES_INVALID", check().issues().getFirst().code());
    }

    @Test
    void missingOrInvalidGameLevelConfigurationIsAnIssueWithoutDefaulting() {
        when(characters.findLevelConfig("lol")).thenReturn(null);
        assertEquals("BASIC_FIELD_INVALID", check().issues().getFirst().code());
        when(characters.findLevelConfig("lol")).thenReturn(new LevelConfigResponse("lol", 2, 101));
        assertEquals("HAS_ERRORS", check().conclusions().structure());
    }

    @Test
    void missingSkillsRemainVisibleAndDisabledSkillsAreOnlyReviewItems() {
        when(checks.listAttachedSkills("lol", "hero")).thenReturn(List.of(skill("disabled", "DISABLED", true), skill("missing", null, false)));
        var response = check();
        assertEquals(2, response.skills().size());
        assertNull(response.skills().get(1).name());
        assertNull(response.skills().get(1).maxLevel());
        assertEquals(1, response.summary().errorCount());
        assertEquals(1, response.summary().reviewCount());
        assertEquals(List.of("ATTACHED_SKILL_MISSING", "ATTACHED_SKILL_DISABLED"), response.issues().stream().map(CharacterAuthoringCheckResponse.Issue::code).toList());
        when(checks.listAttachedSkills("lol", "hero")).thenReturn(List.of());
        assertEquals("NO_ATTACHED_SKILL", check().issues().getFirst().code());
        assertEquals("NO_ERRORS", check().conclusions().structure());
    }

    @Test
    void invalidBasicFieldsProduceLocatedErrors() {
        when(checks.listAttachedSkills("lol", "hero")).thenReturn(List.of(new AttachedSkill("skill", "", "ENABLED", 0, -1, true, 0, 0, 0)));
        assertEquals(3, check().summary().errorCount());
        assertTrue(check().issues().stream().allMatch(i -> i.code().equals("BASIC_FIELD_INVALID") && i.skillKey().equals("skill")));
    }

    @Test
    void conditionsAndLifecycleRemovalDoNotConnectEffectsAndFailureDoesNotStartProcesses() {
        when(checks.listObjects("lol", "hero")).thenReturn(List.of(effect("mark"), process("passive", "PASSIVE", "[]"),
            process("active", "ACTIVE", "[]"), process("consumable", "CONSUMABLE", "[]"),
            trigger("[" + action("fail", "FAIL_PROCESS", "{\"processKey\":\"passive\",\"failureReason\":\"EVENT_ABORTED\"}") + ","
                + action("advance", "ADVANCE_PROCESS", "{\"processKey\":\"passive\",\"stepKey\":\"step\"}") + "]")));
        when(checks.listReferences("lol", "hero")).thenReturn(List.of(ref("LIFECYCLE", "mark", "", true), ref("PROCESS", "passive", "", true)));
        var response = check();
        assertEquals("NO_ERRORS", response.conclusions().structure());
        assertEquals(List.of("EFFECT_NOT_CONNECTED", "PASSIVE_PROCESS_NOT_STARTED"), response.issues().stream().map(CharacterAuthoringCheckResponse.Issue::code).toList());
    }

    @Test
    void advanceProcessIsAcceptedAndDoesNotCountAsAStart() {
        when(checks.listObjects("lol", "hero")).thenReturn(List.of(
            process("passive", "PASSIVE", "[]"),
            trigger("[" + action("advance", "ADVANCE_PROCESS", "{\"processKey\":\"passive\",\"stepKey\":\"step\"}") + "]")));
        var response = check();
        assertEquals("NO_ERRORS", response.conclusions().structure());
        assertEquals(List.of("PASSIVE_PROCESS_NOT_STARTED"), response.issues().stream().map(CharacterAuthoringCheckResponse.Issue::code).toList());
    }

    @Test
    void onlyDirectExecuteAndProcessBindingsCountAsEffectEntryPointsAndStartCountsAsStart() {
        when(checks.listObjects("lol", "hero")).thenReturn(List.of(effect("mark"), effect("hit"),
            process("passive", "PASSIVE", "[{\"bindingKey\":\"apply\",\"effectKey\":\"mark\",\"sortOrder\":0,\"moment\":{\"momentType\":\"PROCESS_START\",\"stepKey\":null}}]"),
            trigger("[" + action("hit", "EXECUTE_EFFECT", "{\"effectKey\":\"hit\"}") + ","
                + action("start", "START_PROCESS", "{\"processKey\":\"passive\"}") + "]")));
        assertTrue(check().issues().isEmpty());
    }

    @ParameterizedTest
    @ValueSource(strings = {"ATTRIBUTE", "SKILL", "CATEGORY", "DAMAGE_TYPE", "MODIFIER_ZONE", "STATUS", "PARAMETER", "FORMULA", "EFFECT", "STATE", "PROCESS", "LIFECYCLE", "RESULT", "STEP", "OPTION", "ACTION"})
    void missingReferenceTargetsKeepCompleteSourceLocationAndAllTargetFields(String type) {
        when(checks.listReferences("lol", "hero")).thenReturn(List.of(ref(type, "root", "child", false)));
        var response = check();
        assertEquals("REFERENCE_TARGET_MISSING", response.issues().getFirst().code());
        assertEquals("conditionGroups[0].conditions[0].detail.effectKey", response.issues().getFirst().fieldPath());
        assertEquals(type, response.references().getFirst().targetType());
        assertEquals("child", response.references().getFirst().targetSubKey());
    }

    @ParameterizedTest
    @NullSource
    @ValueSource(strings = {"null", "[]", "broken", "{}", "{\"results\":null,\"lifecycle\":null}", "{\"results\":[],\"lifecycle\":null}",
        "{\"results\":[{\"resultKey\":\"same\"},{\"resultKey\":\"same\"}],\"lifecycle\":null}"})
    void malformedRootObjectsCannotBeReportedAsStructurallyValid(String json) {
        when(checks.listObjects("lol", "hero")).thenReturn(List.of(new ObjectRow("skill", "EFFECT", "effect", "效果", 0, json)));
        assertEquals("HAS_ERRORS", check().conclusions().structure());
    }

    @ParameterizedTest
    @MethodSource("brokenObjectShapes")
    void incompleteAstAndUnknownOrMissingKindsCannotReportNoErrors(ObjectRow row) {
        when(checks.listObjects("lol", "hero")).thenReturn(List.of(row));
        assertEquals("HAS_ERRORS", check().conclusions().structure());
        assertTrue(check().issues().stream().anyMatch(issue -> issue.code().equals("BASIC_FIELD_INVALID")));
    }

    static Stream<ObjectRow> brokenObjectShapes() {
        var rule = trigger("[" + action("hit", "EXECUTE_EFFECT", "{\"effectKey\":\"hit\"}") + "]");
        var process = process("cast", "ACTIVE", "[]");
        var effect = effect("hit");
        return Stream.of(
            new ObjectRow("skill", "FORMULA", "empty", "公式", 0, "{\"expression\":{}}"),
            new ObjectRow("skill", "FORMULA", "parameter", "公式", 0, "{\"expression\":{\"nodeType\":\"PARAMETER\"}}"),
            new ObjectRow("skill", "FORMULA", "operation", "公式", 0, "{\"expression\":{\"nodeType\":\"OPERATION\",\"operation\":\"ADD\",\"operands\":[]}}"),
            new ObjectRow("skill", "FORMULA", "nested", "公式", 0, "{\"expression\":{\"nodeType\":\"OPERATION\",\"operation\":\"ADD\",\"operands\":[{}]}}"),
            new ObjectRow("skill", "FORMULA", "attribute", "公式", 0, "{\"expression\":{\"nodeType\":\"ATTRIBUTE\",\"attributeKey\":\"hp\",\"attributeOwner\":\"UNKNOWN\",\"attributeValueKind\":\"TOTAL\"}}"),
            replace(rule, "\"SKILL_HIT\"", "\"UNKNOWN\""),
            replace(rule, "\"TARGET_CATEGORY_CHECK\"", "\"UNKNOWN\""),
            replace(rule, "\"conditionType\":\"TARGET_CATEGORY_CHECK\",", ""),
            replace(rule, "\"EXECUTE_EFFECT\"", "\"UNKNOWN\""),
            replace(process, "\"IMMEDIATE\"", "\"UNKNOWN\""),
            replace(process, "\"detail\":{}", "\"detail\":[]"),
            replace(effect, "\"DIRECT_HEAL\"", "\"UNKNOWN\""),
            replace(effect, "\"resultType\":\"DIRECT_HEAL\",", ""),
            replace(effect, "\"target\":\"SOURCE\"", "\"target\":null"),
            replace(effect, "\"sortOrder\":0", "\"sortOrder\":null"),
            replace(effect, "\"name\":\"结果\"", "\"name\":\"\""));
    }

    @Test
    void validFormulaTreeIsOnlyStructurallyCheckedWithoutExecutingIt() {
        when(checks.listObjects("lol", "hero")).thenReturn(List.of(new ObjectRow("skill", "FORMULA", "sum", "公式", 0,
            "{\"expression\":{\"nodeType\":\"OPERATION\",\"operation\":\"ADD\",\"operands\":[{\"nodeType\":\"PARAMETER\",\"parameterKey\":\"base\"},"
            + "{\"nodeType\":\"ATTRIBUTE\",\"attributeKey\":\"hp\",\"attributeOwner\":\"SOURCE\",\"attributeValueKind\":\"TOTAL\"}]}}")));
        assertTrue(check().issues().isEmpty());
        assertEquals("NOT_RUN", check().conclusions().runtime());
    }

    @Test
    void missingResourcesKeepExistingErrorsAndQueryFailuresPropagate() {
        when(games.countGames("lol")).thenReturn(0L);
        assertEquals("404.GAME_NOT_FOUND", assertThrows(ApiException.class, this::check).getCode());
        when(games.countGames("lol")).thenReturn(1L);
        when(characters.findById("lol", "hero")).thenReturn(null);
        assertEquals("404.CHARACTER_NOT_FOUND", assertThrows(ApiException.class, this::check).getCode());
        when(characters.findById("lol", "hero")).thenReturn(new CharacterResponse("lol", "hero", "角色", null, null, null));
        when(checks.listReferences("lol", "hero")).thenThrow(new IllegalStateException("query failed"));
        assertThrows(IllegalStateException.class, this::check);
    }

    @Test
    void allReadsShareAnActualRepeatableReadReadOnlyTransactionAndNoWritesAreCalled() {
        var transactions = new RecordingTransactions();
        ProxyFactory factory = new ProxyFactory(service);
        factory.setProxyTargetClass(true);
        factory.addAdvice(new TransactionInterceptor(transactions, new AnnotationTransactionAttributeSource()));
        when(checks.listReferences("lol", "hero")).thenAnswer(invocation -> {
            assertTrue(TransactionSynchronizationManager.isActualTransactionActive());
            assertTrue(TransactionSynchronizationManager.isCurrentTransactionReadOnly());
            assertEquals(TransactionDefinition.ISOLATION_REPEATABLE_READ, TransactionSynchronizationManager.getCurrentTransactionIsolationLevel());
            return List.of();
        });
        ((CharacterAuthoringCheckService) factory.getProxy()).check("lol", "hero");
        assertEquals(1, transactions.commits);
        verify(characters).findById("lol", "hero");
        verify(characters).findLevelConfig("lol");
        verify(characters).findLevelValuesJson("lol", "hero");
        verify(characters).listAttributeDefinitions("lol");
        verifyNoMoreInteractions(characters);
        verify(games).countGames("lol");
        verifyNoMoreInteractions(games);
    }

    private CharacterAuthoringCheckResponse check() { return service.check("lol", "hero"); }
    private static AttachedSkill skill(String key, String status, boolean exists) { return new AttachedSkill(key, exists ? "技能" : null, status, exists ? 5 : null, 0, exists, 0, 0, 0); }
    private static ObjectRow effect(String key) { return new ObjectRow("skill", "EFFECT", key, "效果", 0,
        "{\"results\":[{\"resultKey\":\"heal\",\"name\":\"结果\",\"sortOrder\":0,\"resultType\":\"DIRECT_HEAL\",\"target\":\"SOURCE\",\"detail\":{},"
        + "\"valueRule\":{\"value\":{\"kind\":\"FIXED\",\"value\":100},\"fixedMultiplier\":1,\"fixedMinValue\":null,\"fixedMaxValue\":null},"
        + "\"description\":null,\"lifecycleBehavior\":null,\"spellShieldBlockScope\":null}],\"lifecycle\":null}"); }
    private static ObjectRow process(String key, String activation, String bindings) { return new ObjectRow("skill", "PROCESS", key, "过程", 0,
        "{\"activationType\":\"" + activation + "\",\"steps\":[{\"stepKey\":\"step\",\"name\":\"步骤\",\"sortOrder\":0,\"stepType\":\"IMMEDIATE\",\"detail\":{},\"description\":null}],"
        + "\"cooldown\":null,\"stateOperations\":[],\"effectBindings\":" + bindings + "}"); }
    private static ObjectRow trigger(String actions) { return new ObjectRow("skill", "TRIGGER", "rule", "规则", 0,
        "{\"eventSource\":{\"eventType\":\"SKILL_HIT\",\"detail\":{\"sourceSkillKey\":\"skill\",\"useKind\":\"ANY\"}},"
        + "\"limits\":{\"perTargetCooldown\":null,\"maxTriggersPerProcess\":null},\"conditionGroups\":[{\"groupKey\":\"group\",\"name\":\"条件组\",\"sortOrder\":0,"
        + "\"conditions\":[{\"conditionKey\":\"present\",\"conditionType\":\"TARGET_CATEGORY_CHECK\",\"sortOrder\":0,\"detail\":{\"categories\":[\"CHAMPION\"]}}]}],\"actions\":" + actions + "}"); }
    private static String action(String key, String type, String detail) { return "{\"actionKey\":\"" + key + "\",\"name\":\"动作\",\"sortOrder\":0,\"actionType\":\"" + type
        + "\",\"targetContext\":" + ("EXECUTE_EFFECT".equals(type) ? "\"CURRENT_TARGET\"" : "null") + ",\"detail\":" + detail + ",\"runtimeInputBindings\":[],\"resultModifiers\":[]}"; }
    private static ObjectRow replace(ObjectRow row, String from, String to) { return new ObjectRow(row.skillKey(), row.objectType(), row.objectKey(), row.name(), row.sortOrder(), row.dataJson().replace(from, to)); }
    private static ReferenceRow ref(String type, String key, String subKey, boolean exists) { return new ReferenceRow("skill", "TRIGGER", "rule", "conditionGroups[0].conditions[0].detail.effectKey", type, "skill", key, subKey, exists); }

    static class RecordingTransactions extends AbstractPlatformTransactionManager {
        int commits;
        @Override protected Object doGetTransaction() { return new Object(); }
        @Override protected void doBegin(Object transaction, TransactionDefinition definition) {
            assertTrue(definition.isReadOnly());
            assertEquals(TransactionDefinition.ISOLATION_REPEATABLE_READ, definition.getIsolationLevel());
        }
        @Override protected void doCommit(DefaultTransactionStatus status) { commits++; }
        @Override protected void doRollback(DefaultTransactionStatus status) { fail("Unexpected rollback"); }
    }
}
