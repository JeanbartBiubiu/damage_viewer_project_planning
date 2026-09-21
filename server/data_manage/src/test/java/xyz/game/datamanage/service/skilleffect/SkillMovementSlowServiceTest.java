package xyz.game.datamanage.service.skilleffect;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.ValueSource;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.imagerelation.ImageRelationMapper;
import xyz.game.datamanage.mapper.skill.SkillMapper;
import xyz.game.datamanage.mapper.skilleffect.SkillEffectMapper;
import xyz.game.datamanage.model.skill.SkillRow;
import xyz.game.datamanage.model.skill.SkillStatus;
import xyz.game.datamanage.model.skilleffect.*;
import xyz.game.datamanage.model.status.StatusKind;
import xyz.game.datamanage.support.authoring.AggregateJson;
import xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard;
import xyz.game.datamanage.support.error.ApiException;

class SkillMovementSlowServiceTest {
    private final SkillEffectMapper mapper = mock(SkillEffectMapper.class);
    private SkillEffectService service;
    private SkillEffectRow stored;

    @BeforeEach
    void setup() {
        GamesMapper games = mock(GamesMapper.class);
        SkillMapper skills = mock(SkillMapper.class);
        when(games.countGames("lol")).thenReturn(1L);
        var time = OffsetDateTime.parse("2026-09-19T00:00:00Z");
        var skill = new SkillRow("lol", "skill", "技能", null, 5, SkillStatus.ENABLED, 0, time, time);
        when(skills.findByIdForUpdate("lol", "skill")).thenReturn(skill);
        when(skills.findById("lol", "skill")).thenReturn(skill);
        when(mapper.lockStatuses(eq("lol"), anyCollection())).thenReturn(List.of(
            new SkillEffectStatusLockRow("control", "ENABLED", StatusKind.MOVEMENT_SLOW)));
        when(mapper.lockFormulas(eq("lol"), eq("skill"), anyCollection())).thenAnswer(i ->
            List.copyOf((Collection<String>) i.getArgument(2)));
        when(mapper.insertEffect(any(), any(), any(), any(), any(), any(), any(), any())).thenAnswer(i -> {
            stored = new SkillEffectRow("lol", "skill", "slow", i.getArgument(3), i.getArgument(4),
                i.getArgument(5), i.getArgument(6), i.getArgument(7), time, time);
            return 1;
        });
        when(mapper.findEffect("lol", "skill", "slow")).thenAnswer(i -> stored);
        service = new SkillEffectService(games, skills, mapper, null, mock(ImageRelationMapper.class),
            mock(GameConfigurationWriteGuard.class));
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "{\"kind\":\"FIXED\",\"value\":0.3}",
        "{\"kind\":\"PARAMETER\",\"parameterKey\":\"slow_percent\"}",
        "{\"kind\":\"FORMULA\",\"formulaKey\":\"slow_formula\"}"
    })
    void roundTripsEveryValueSourceAndPercentPointMultiplier(String value) {
        ObjectNode body = body();
        rule(body).set("value", AggregateJson.tree(value));
        rule(body).put("fixedMultiplier", value.contains("PARAMETER") ? 0.01 : 1);
        var created = create(body);
        var read = service.get("lol", "skill", "slow");
        assertEquals(created, read);
        assertEquals(AggregateJson.read(value, xyz.game.datamanage.model.value.SkillNumericValue.class), read.results().getFirst().valueRule().value());
        assertEquals(0, read.results().getFirst().valueRule().fixedMinValue().intValue());
        assertEquals(1, read.results().getFirst().valueRule().fixedMaxValue().intValue());
        assertEquals(SkillEffectLifecycleMoment.PERSISTENT, read.results().getFirst().lifecycleBehavior().moment());
    }

    @ParameterizedTest
    @CsvSource({"fixedMinValue,-1", "fixedMinValue,0.1", "fixedMaxValue,100", "fixedMaxValue,0.9"})
    void rejectsBoundsThatDoNotClampToZeroAndOne(String field, double value) {
        ObjectNode body = body();
        rule(body).put(field, value);
        rejects(body, "results[0].valueRule." + field);
    }

    @ParameterizedTest
    @ValueSource(strings = {"fixedMinValue", "fixedMaxValue", "value", "fixedMultiplier"})
    void requiresCompleteStrengthRule(String field) {
        ObjectNode body = body();
        rule(body).putNull(field);
        rejects(body, "results[0].valueRule." + field);
    }

    @Test
    void rejectsMissingStrengthAndMissingExpiry() {
        ObjectNode body = body();
        result(body).putNull("valueRule");
        result(body).set("lifecycleBehavior", AggregateJson.tree("{\"moment\":\"PERSISTENT\"}"));
        rejects(body, "results[0].valueRule");
        body = body();
        ((ObjectNode) body.get("lifecycle")).putNull("durationValue");
        ((ObjectNode) body.get("lifecycle")).put("expiryMode", "EXPLICIT_ONLY");
        ((ObjectNode) body.get("lifecycle")).putNull("reapplicationDurationMode");
        rejects(body, "lifecycle.durationValue");
        body = body();
        body.putNull("lifecycle");
        result(body).putNull("lifecycleBehavior");
        rejects(body, "lifecycle.durationValue");
    }

    @ParameterizedTest
    @CsvSource({"moment,APPLICATION", "valueReadMode,MOMENT_EVALUATION", "stackValueMode,PER_STACK",
        "reapplicationValueMode,ADD", "periodicExecutionMode,ONCE_PER_INSTANCE"})
    void rejectsInvalidPersistentBehavior(String field, String value) {
        ObjectNode body = body();
        ((ObjectNode) result(body).get("lifecycleBehavior")).put(field, value);
        // Generic lifecycle checks may reject the dependent combination before the kind-specific check.
        assertThrows(ApiException.class, () -> create(body));
        verify(mapper, never()).insertEffect(any(), any(), any(), any(), any(), any(), any(), any());
    }

    @ParameterizedTest
    @CsvSource({"STUN,APPLY", "ROOT,APPLY", "SILENCE,APPLY", "CHARM,APPLY", "AIRBORNE,APPLY",
        "STUN,REMOVE", "ROOT,REMOVE", "SILENCE,REMOVE", "CHARM,REMOVE", "AIRBORNE,REMOVE", "MOVEMENT_SLOW,REMOVE"})
    void keepsNonSlowApplicationAndAllRemovalValueless(StatusKind kind, String operation) {
        ObjectNode body = body();
        useKind(kind);
        if (operation.equals("REMOVE")) {
            ((ObjectNode) result(body).get("detail")).put("operation", operation);
            body.putNull("lifecycle");
            result(body).putNull("lifecycleBehavior");
        }
        rejects(body, "results[0].valueRule");
        result(body).putNull("valueRule");
        if (operation.equals("APPLY")) result(body).set("lifecycleBehavior", AggregateJson.tree("{\"moment\":\"PERSISTENT\"}"));
        assertNull(create(body).results().getFirst().valueRule());
    }

    @ParameterizedTest
    @EnumSource(value = StatusKind.class, names = {"ROOT", "SILENCE", "CHARM", "AIRBORNE"})
    void roundTripsValuelessControlWithDurationAndNoValueModes(StatusKind kind) {
        useKind(kind);
        ObjectNode body = valuelessBody();
        var created = create(body);
        var read = service.get("lol", "skill", "slow");
        assertEquals(created, read);
        assertEquals(AggregateJson.read("{\"kind\":\"FIXED\",\"value\":1000}",
            xyz.game.datamanage.model.value.SkillNumericValue.class), read.lifecycle().durationValue());
        assertEquals(SkillEffectLifecycleInstanceScope.SOURCE_TARGET, read.lifecycle().instanceScope());
        assertEquals(SkillEffectLifecycleExpiryMode.ALL_AT_ONCE, read.lifecycle().expiryMode());
        var result = read.results().getFirst();
        assertNull(result.valueRule());
        assertEquals(new SkillEffectStatusOperationDetail("control", SkillEffectStatusOperation.APPLY), result.detail());
        assertEquals(SkillEffectLifecycleMoment.PERSISTENT, result.lifecycleBehavior().moment());
        assertNull(result.lifecycleBehavior().valueReadMode());
        assertNull(result.lifecycleBehavior().stackValueMode());
        assertNull(result.lifecycleBehavior().reapplicationValueMode());
        assertNull(result.lifecycleBehavior().periodicExecutionMode());
        assertNull(result.spellShieldBlockScope());
    }

    @ParameterizedTest
    @CsvSource({"valueReadMode,APPLICATION_SNAPSHOT", "stackValueMode,SHARED",
        "reapplicationValueMode,REPLACE", "periodicExecutionMode,ONCE_PER_INSTANCE"})
    void rejectsValuelessControlValueModes(String field, String value) {
        for (StatusKind kind : List.of(StatusKind.ROOT, StatusKind.SILENCE, StatusKind.CHARM, StatusKind.AIRBORNE)) {
            useKind(kind);
            ObjectNode body = valuelessBody();
            ((ObjectNode) result(body).get("lifecycleBehavior")).put(field, value);
            assertThrows(ApiException.class, () -> create(body));
            verify(mapper, never()).insertEffect(any(), any(), any(), any(), any(), any(), any(), any());
        }
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void airborneDoesNotRequireTypeSpecificDuration(boolean persistent) {
        useKind(StatusKind.AIRBORNE);
        ObjectNode body = valuelessBody();
        if (persistent) {
            ObjectNode lifecycle = (ObjectNode) body.get("lifecycle");
            lifecycle.putNull("durationValue");
            lifecycle.putNull("reapplicationDurationMode");
            lifecycle.put("expiryMode", "EXPLICIT_ONLY");
        } else {
            body.putNull("lifecycle");
            result(body).putNull("lifecycleBehavior");
        }

        var created = create(body);
        var read = service.get("lol", "skill", "slow");
        assertEquals(created, read);
        assertNull(read.results().getFirst().valueRule());
        if (persistent) {
            assertNull(read.lifecycle().durationValue());
            assertEquals(SkillEffectLifecycleExpiryMode.EXPLICIT_ONLY, read.lifecycle().expiryMode());
            assertEquals(SkillEffectLifecycleMoment.PERSISTENT, read.results().getFirst().lifecycleBehavior().moment());
        } else {
            assertNull(read.lifecycle());
            assertNull(read.results().getFirst().lifecycleBehavior());
        }
    }

    @ParameterizedTest
    @EnumSource(StatusKind.class)
    void acceptsResultSpellShieldScopeAndRejectsOtherPersistentScopes(StatusKind kind) {
        useKind(kind);
        ObjectNode body = kind == StatusKind.MOVEMENT_SLOW ? body() : valuelessBody();
        result(body).put("spellShieldBlockScope", "RESULT");
        assertEquals(SkillEffectSpellShieldBlockScope.RESULT, create(body).results().getFirst().spellShieldBlockScope());
        for (String scope : List.of("SKILL", "DAMAGE_INSTANCE")) {
            ObjectNode invalid = body.deepCopy();
            result(invalid).put("spellShieldBlockScope", scope);
            ApiException error = assertThrows(ApiException.class, () -> create(invalid));
            assertTrue(error.getDetails().toString().contains("spellShieldBlockScope"));
        }
    }

    private void useKind(StatusKind kind) {
        when(mapper.lockStatuses(eq("lol"), anyCollection())).thenReturn(List.of(
            new SkillEffectStatusLockRow("control", "ENABLED", kind)));
    }

    private static ObjectNode valuelessBody() {
        ObjectNode body = body();
        result(body).putNull("valueRule");
        result(body).set("lifecycleBehavior", AggregateJson.tree("{\"moment\":\"PERSISTENT\"}"));
        return body;
    }

    private SkillEffectDetailResponse create(ObjectNode body) {
        return service.create("lol", "skill", AggregateJson.read(body.toString(), SkillEffectCreateRequest.class));
    }

    private void rejects(ObjectNode body, String path) {
        ApiException error = assertThrows(ApiException.class, () -> create(body));
        @SuppressWarnings("unchecked")
        List<Map<String, String>> issues = (List<Map<String, String>>) error.getDetails().get("fieldIssues");
        assertTrue(issues.stream().anyMatch(issue -> path.equals(issue.get("field"))), issues.toString());
        verify(mapper, never()).insertEffect(any(), any(), any(), any(), any(), any(), any(), any());
    }

    private static ObjectNode result(ObjectNode body) { return (ObjectNode) body.get("results").get(0); }
    private static ObjectNode rule(ObjectNode body) { return (ObjectNode) result(body).get("valueRule"); }
    private static ObjectNode body() {
        return (ObjectNode) AggregateJson.tree("""
            {"effectKey":"slow","name":"减速","sortOrder":0,
             "lifecycle":{"durationValue":{"kind":"FIXED","value":1000},
               "maxStacksValue":{"kind":"FIXED","value":1},"applicationStacksValue":{"kind":"FIXED","value":1},
               "instanceScope":"SOURCE_TARGET","reapplicationStackMode":"KEEP",
               "reapplicationDurationMode":"REFRESH_ALL","expiryMode":"ALL_AT_ONCE"},
             "results":[{"resultKey":"strength","name":"减速比例","resultType":"STATUS_OPERATION","target":"TARGET","sortOrder":0,
               "detail":{"statusKey":"control","operation":"APPLY"},"spellShieldBlockScope":null,
               "valueRule":{"value":{"kind":"FIXED","value":0.3},"fixedMultiplier":1,"fixedMinValue":0,"fixedMaxValue":1},
               "lifecycleBehavior":{"moment":"PERSISTENT","valueReadMode":"APPLICATION_SNAPSHOT","stackValueMode":"SHARED",
                 "reapplicationValueMode":"REPLACE","periodicExecutionMode":null}}]}
            """);
    }
}
