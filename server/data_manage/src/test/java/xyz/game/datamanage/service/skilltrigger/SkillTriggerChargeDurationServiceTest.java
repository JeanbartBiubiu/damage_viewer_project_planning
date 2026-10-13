package xyz.game.datamanage.service.skilltrigger;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.*;

import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.skill.SkillMapper;
import xyz.game.datamanage.mapper.skilltrigger.SkillTriggerRuleMapper;
import xyz.game.datamanage.model.skillparameter.SkillParameterValueType;
import xyz.game.datamanage.model.skillprocess.SkillProcessMoment;
import xyz.game.datamanage.model.skillprocess.SkillProcessMomentType;
import xyz.game.datamanage.model.skillprocess.SkillProcessStepType;
import xyz.game.datamanage.model.skilltrigger.*;
import xyz.game.datamanage.support.authoring.AggregateJson;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class SkillTriggerChargeDurationServiceTest {
    @Mock private GamesMapper games;
    @Mock private SkillMapper skills;
    @Mock private SkillTriggerRuleMapper mapper;
    private SkillTriggerRuleService service;

    @BeforeEach
    void setup() {
        stubParentAndCatalogs(games, skills, mapper);
        when(mapper.listRuntimeInputParameters(eq(GAME_ID), eq(SKILL_KEY), any()))
            .thenReturn(List.of(runtimeParam("charge_ms", SkillParameterValueType.DECIMAL)));
        when(mapper.lockParameters(eq(GAME_ID), eq(SKILL_KEY), any()))
            .thenReturn(List.of(runtimeParam("charge_ms", SkillParameterValueType.DECIMAL)));
        service = service(games, skills, mapper);
    }

    @Test
    void databaseUnionRowsCombineProcessHeaderAndChargeStepBeforeCheckingHitCapability() {
        when(mapper.listProcessShapes(GAME_ID, SKILL_KEY)).thenReturn(splitProcessShapes());
        when(mapper.listRules(GAME_ID, SKILL_KEY)).thenReturn(List.of(control("INITIAL", "START_PROCESS", "charge"),
            control("CHARGE_RELEASE", "ADVANCE_PROCESS", "charge")));
        when(mapper.findChargeReleaseAtMaximum(GAME_ID, SKILL_KEY, PROCESS_KEY, "charge")).thenReturn(false);
        assertDoesNotThrow(() -> service.create(GAME_ID, SKILL_KEY, request(hit(SKILL_KEY))));
    }

    @ParameterizedTest
    @ValueSource(strings = {"INITIAL", "CHARGE_RELEASE"})
    void unionRowsDoNotGrantChargeDurationWhenEitherRequiredRootIsMissing(String missing) {
        when(mapper.listProcessShapes(GAME_ID, SKILL_KEY)).thenReturn(splitProcessShapes());
        when(mapper.listRules(GAME_ID, SKILL_KEY)).thenReturn(List.of(missing.equals("INITIAL")
            ? control("CHARGE_RELEASE", "ADVANCE_PROCESS", "charge") : control("INITIAL", "START_PROCESS", "charge")));
        when(mapper.findChargeReleaseAtMaximum(GAME_ID, SKILL_KEY, PROCESS_KEY, "charge")).thenReturn(false);
        assertField(thrown(() -> service.create(GAME_ID, SKILL_KEY, request(hit(SKILL_KEY)))),
            "actions[0].runtimeInputBindings[0].detail.eventValueKey", "EVENT_VALUE_NOT_AVAILABLE");
    }

    @ParameterizedTest
    @ValueSource(strings = {"none", "initial", "release"})
    void sameAggregateChecksChargeAndBothRequiredRootsOnlyAfterTheirWrites(String missingRoot) {
        var skillService = mock(xyz.game.datamanage.service.skill.SkillService.class);
        var parameters = mock(xyz.game.datamanage.service.skillparameter.SkillParameterService.class);
        var formulas = mock(xyz.game.datamanage.service.skillformula.SkillFormulaService.class);
        var effects = mock(xyz.game.datamanage.service.skilleffect.SkillEffectService.class);
        var processes = mock(xyz.game.datamanage.service.skillprocess.SkillProcessService.class);
        var states = mock(xyz.game.datamanage.service.skillinternalstate.SkillInternalStateService.class);
        when(skillService.get(GAME_ID, SKILL_KEY)).thenReturn(new xyz.game.datamanage.model.skill.SkillResponse(
            GAME_ID, SKILL_KEY, "独立聚合样例", null, 1, xyz.game.datamanage.model.skill.SkillStatus.ENABLED, 0, List.of(), TS, TS));
        var shapes = new java.util.concurrent.atomic.AtomicReference<List<SkillTriggerProcessShapeRow>>(List.of());
        when(mapper.listProcessShapes(GAME_ID, SKILL_KEY)).thenAnswer(invocation -> shapes.get());
        when(mapper.listRules(GAME_ID, SKILL_KEY)).thenAnswer(invocation -> mapper.listRulesForUpdate(GAME_ID, SKILL_KEY));
        when(mapper.listSummaries(GAME_ID, SKILL_KEY)).thenAnswer(invocation -> mapper.listRulesForUpdate(GAME_ID, SKILL_KEY).stream()
            .map(row -> new SkillTriggerRuleSummaryResponse(row.ruleKey(), row.name(), row.description(), row.eventType(),
                0, 1, false, false, false, row.sortOrder(), row.updatedAt())).toList());
        when(mapper.findStepType(GAME_ID, SKILL_KEY, PROCESS_KEY, "charge")).thenReturn("CHARGE");
        when(mapper.findChargeReleaseAtMaximum(GAME_ID, SKILL_KEY, PROCESS_KEY, "charge")).thenReturn(false);
        var preparedProcess = mock(xyz.game.datamanage.service.skillprocess.SkillProcessService.Prepared.class);
        when(processes.prepareConfigurationCreate(any())).thenReturn(preparedProcess);
        doAnswer(invocation -> { shapes.set(splitProcessShapes()); return null; })
            .when(processes).writePreparedWithinConfiguration(GAME_ID, SKILL_KEY, preparedProcess);
        var aggregate = new xyz.game.datamanage.service.skillconfiguration.SkillConfigurationService(
            mock(xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard.class), skills, skillService,
            parameters, formulas, effects, processes, states, service, new com.fasterxml.jackson.databind.ObjectMapper().findAndRegisterModules(),
            jakarta.validation.Validation.buildDefaultValidatorFactory().getValidator());
        var initial = rule("initial", new SkillTriggerEventSource(SkillTriggerEventType.SKILL_USED,
            new SkillTriggerSkillEventDetail(SKILL_KEY, SkillTriggerEventUseKind.ACTIVE, SkillTriggerCastPhase.INITIAL)),
            List.of(new SkillTriggerAction("start", "首次启动", SkillTriggerActionType.START_PROCESS, 0,
                SkillTriggerTargetContext.CURRENT_TARGET, new SkillTriggerStartProcessActionDetail(PROCESS_KEY), List.of(), List.of())));
        var release = rule("release", new SkillTriggerEventSource(SkillTriggerEventType.SKILL_USED,
            new SkillTriggerSkillEventDetail(SKILL_KEY, SkillTriggerEventUseKind.ACTIVE, SkillTriggerCastPhase.CHARGE_RELEASE)),
            List.of(new SkillTriggerAction("release", "实际释放", SkillTriggerActionType.ADVANCE_PROCESS, 0,
                null, new SkillTriggerAdvanceProcessActionDetail(PROCESS_KEY, "charge"), List.of(), List.of())));
        var process = AggregateJson.tree("""
            {"processKey":"%s","name":"完整过程","activationType":"ACTIVE","description":null,"sortOrder":0,"cooldown":null,
             "steps":[{"stepKey":"start","name":"即时开始","stepType":"IMMEDIATE","sortOrder":0,"occupiesAction":true,"detail":{}},
                      {"stepKey":"charge","name":"充能","stepType":"CHARGE","sortOrder":1,"occupiesAction":true,
                       "detail":{"minimumChargeValue":{"kind":"FIXED","value":0},"maximumChargeValue":{"kind":"FIXED","value":6000},"releaseAtMaximum":false}}],
             "effectBindings":[],"stateOperations":[]}
            """.formatted(PROCESS_KEY));
        var changes = List.of(
            new xyz.game.datamanage.model.skillconfiguration.SkillConfigurationChange("TRIGGER_RULE", "CREATE", "charge_hit", AggregateJson.tree(AggregateJson.write(request(hit(SKILL_KEY))))),
            new xyz.game.datamanage.model.skillconfiguration.SkillConfigurationChange("TRIGGER_RULE", "CREATE", "release", AggregateJson.tree(AggregateJson.write(release))),
            new xyz.game.datamanage.model.skillconfiguration.SkillConfigurationChange("PROCESS", "CREATE", PROCESS_KEY, process),
            new xyz.game.datamanage.model.skillconfiguration.SkillConfigurationChange("TRIGGER_RULE", "CREATE", "initial", AggregateJson.tree(AggregateJson.write(initial))));
        var selectedChanges = changes.stream().filter(change -> !change.key().equals(missingRoot)).toList();
        var submitted = new xyz.game.datamanage.model.skillconfiguration.SkillConfigurationSaveRequest(
            aggregate.get(GAME_ID, SKILL_KEY).baseDigest(), null, selectedChanges);
        if (!missingRoot.equals("none")) {
            var failure = assertThrows(xyz.game.datamanage.support.error.ApiException.class, () -> aggregate.update(GAME_ID, SKILL_KEY, submitted));
            assertEquals("400.INVALID_SKILL_TRIGGER_RULE_REFERENCE", failure.getCode());
            assertTrue(failure.getDetails().toString().contains("EVENT_VALUE_NOT_AVAILABLE"));
            return;
        }
        var saved = assertDoesNotThrow(() -> aggregate.update(GAME_ID, SKILL_KEY, submitted));
        assertEquals(3, saved.triggerRules().size());
        verify(processes).writePreparedWithinConfiguration(GAME_ID, SKILL_KEY, preparedProcess);
        assertEquals(SkillTriggerEventValueKey.CHARGE_DURATION_MS,
            ((SkillTriggerEventValueBindingDetail) saved.triggerRules().stream().filter(rule -> rule.ruleKey().equals("charge_hit"))
                .findFirst().orElseThrow().actions().getFirst().runtimeInputBindings().getFirst().detail()).eventValueKey());
    }

    private static List<SkillTriggerProcessShapeRow> splitProcessShapes() {
        var header = (com.fasterxml.jackson.databind.node.ObjectNode) AggregateJson.tree(AggregateJson.write(chargeStep(PROCESS_KEY, "charge")));
        header.putNull("stepKey"); header.putNull("stepType");
        var step = (com.fasterxml.jackson.databind.node.ObjectNode) AggregateJson.tree(AggregateJson.write(chargeStep(PROCESS_KEY, "charge")));
        step.putNull("activationType");
        return List.of(AggregateJson.read(AggregateJson.write(header), SkillTriggerProcessShapeRow.class),
            AggregateJson.read(AggregateJson.write(step), SkillTriggerProcessShapeRow.class));
    }

    @Test
    void realOwnChargeReleaseSavesAndReadsTheEventBindingWithoutAValueOrDefault() {
        composition();
        var saved = service.create(GAME_ID, SKILL_KEY, request(hit(SKILL_KEY)));
        var binding = saved.actions().getFirst().runtimeInputBindings().getFirst();
        assertEquals(SkillTriggerRuntimeInputSourceType.EVENT_VALUE, binding.sourceType());
        assertEquals("{\"eventValueKey\":\"CHARGE_DURATION_MS\"}", AggregateJson.write(binding.detail()));
        assertEquals(binding, service.get(GAME_ID, SKILL_KEY, "charge_hit").actions().getFirst().runtimeInputBindings().getFirst());
    }

    @Test
    void ordinarySkillAndMissingReleaseCannotReadChargeDuration() {
        assertField(thrown(() -> service.create(GAME_ID, SKILL_KEY, request(hit(SKILL_KEY)))),
            "actions[0].runtimeInputBindings[0].detail.eventValueKey", "EVENT_VALUE_NOT_AVAILABLE");
        when(mapper.listProcessShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(chargeStep(PROCESS_KEY, "charge")));
        when(mapper.listRules(GAME_ID, SKILL_KEY)).thenReturn(List.of(control("INITIAL", "START_PROCESS", "charge")));
        assertField(thrown(() -> service.create(GAME_ID, SKILL_KEY, request(hit(SKILL_KEY)))),
            "actions[0].runtimeInputBindings[0].detail.eventValueKey", "EVENT_VALUE_NOT_AVAILABLE");
    }

    @ParameterizedTest
    @ValueSource(strings = {"foreign_skill", ""})
    void chargeDurationIsNotGrantedToForeignOrUnspecifiedHitSources(String source) {
        composition();
        assertField(thrown(() -> service.create(GAME_ID, SKILL_KEY, request(hit(source.isEmpty() ? null : source)))),
            "actions[0].runtimeInputBindings[0].detail.eventValueKey", "EVENT_VALUE_NOT_AVAILABLE");
    }

    @Test
    void chargeStepExecutionRemainsLegalButAnImmediateStepCannotSupplyIt() {
        composition();
        when(mapper.findStepType(GAME_ID, SKILL_KEY, PROCESS_KEY, "charge")).thenReturn("CHARGE");
        var event = new SkillTriggerEventSource(SkillTriggerEventType.PROCESS_MOMENT,
            new SkillTriggerProcessEventDetail(PROCESS_KEY, new SkillProcessMoment(SkillProcessMomentType.STEP_EXECUTION, "charge", null)));
        assertDoesNotThrow(() -> service.create(GAME_ID, SKILL_KEY, request(event)));
        when(mapper.findStepType(GAME_ID, SKILL_KEY, PROCESS_KEY, "charge")).thenReturn("IMMEDIATE");
        assertField(thrown(() -> service.create(GAME_ID, SKILL_KEY, request(event))),
            "actions[0].runtimeInputBindings[0].detail.eventValueKey", "EVENT_VALUE_NOT_AVAILABLE");
    }

    @Test
    void theGenericCapabilityDoesNotOpenUnqualifiedSkillHits() {
        assertFalse(SkillTriggerEventCapabilities.eventValueAllowed(SkillTriggerEventType.SKILL_HIT,
            SkillTriggerEventValueKey.CHARGE_DURATION_MS, null, null));
        assertTrue(SkillTriggerEventCapabilities.eventValueAllowed(SkillTriggerEventType.SKILL_HIT,
            SkillTriggerEventValueKey.CHARGE_DURATION_MS, null, SkillProcessStepType.CHARGE));
    }

    @Test
    void explicitAutomaticReleaseAllowsTheHitBindingWithOnlyAnInitialRoot() {
        when(mapper.listProcessShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(chargeStep(PROCESS_KEY, "charge")));
        when(mapper.listRules(GAME_ID, SKILL_KEY)).thenReturn(List.of(control("INITIAL", "START_PROCESS", "charge")));
        when(mapper.findChargeReleaseAtMaximum(GAME_ID, SKILL_KEY, PROCESS_KEY, "charge")).thenReturn(true);
        assertDoesNotThrow(() -> service.create(GAME_ID, SKILL_KEY, request(hit(SKILL_KEY))));
    }

    @Test
    void falseAndMissingAutomaticDeclarationStillRequireTheManualReleaseComposition() {
        when(mapper.listProcessShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(chargeStep(PROCESS_KEY, "charge")));
        when(mapper.listRules(GAME_ID, SKILL_KEY)).thenReturn(List.of(control("INITIAL", "START_PROCESS", "charge")));
        for (Boolean declaration : java.util.Arrays.asList(null, false)) {
            when(mapper.findChargeReleaseAtMaximum(GAME_ID, SKILL_KEY, PROCESS_KEY, "charge")).thenReturn(declaration);
            assertField(thrown(() -> service.create(GAME_ID, SKILL_KEY, request(hit(SKILL_KEY)))),
                "actions[0].runtimeInputBindings[0].detail.eventValueKey", "EVENT_VALUE_NOT_AVAILABLE");
        }
    }

    private void composition() {
        when(mapper.listProcessShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(chargeStep(PROCESS_KEY, "charge")));
        when(mapper.listRules(GAME_ID, SKILL_KEY)).thenReturn(List.of(control("INITIAL", "START_PROCESS", "charge"),
            control("CHARGE_RELEASE", "ADVANCE_PROCESS", "charge")));
    }

    private static SkillTriggerRuleRow control(String phase, String type, String step) {
        return new SkillTriggerRuleRow(GAME_ID, SKILL_KEY, phase.toLowerCase(), "过程控制", null, 0, SkillTriggerEventType.SKILL_USED, TS, TS,
            "{\"eventType\":\"SKILL_USED\",\"detail\":{\"sourceSkillKey\":\"" + SKILL_KEY + "\",\"castPhase\":\"" + phase + "\"}}", "[]",
            "[{\"actionType\":\"" + type + "\",\"detail\":{\"processKey\":\"" + PROCESS_KEY + "\",\"stepKey\":\"" + step + "\"}}]", "{}");
    }

    private static SkillTriggerEventSource hit(String source) {
        return new SkillTriggerEventSource(SkillTriggerEventType.SKILL_HIT, new SkillTriggerSkillEventDetail(source, null));
    }

    private static SkillTriggerRuleCreateRequest request(SkillTriggerEventSource event) {
        var binding = new SkillTriggerRuntimeInputBinding("charge_duration", "charge_ms", SkillTriggerRuntimeInputSourceType.EVENT_VALUE,
            new SkillTriggerEventValueBindingDetail(SkillTriggerEventValueKey.CHARGE_DURATION_MS));
        return rule("charge_hit", event, List.of(new SkillTriggerAction("hit", "实际命中", SkillTriggerActionType.EXECUTE_EFFECT, 0,
            SkillTriggerTargetContext.CURRENT_TARGET, new SkillTriggerExecuteEffectActionDetail(EFFECT_KEY), List.of(binding), List.of())));
    }
}
