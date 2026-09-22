package xyz.game.datamanage.service.skilltrigger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.GAME_ID;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.PROCESS_KEY;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.SKILL_KEY;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.TS;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.assertField;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.fieldIssues;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.oncePerUse;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.oncePerUseRule;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.ruleRow;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.stubParentAndCatalogs;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.thrown;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.updateFromCreate;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Set;
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
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerOncePerUse;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerOncePerUseScope;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerPerTargetCooldown;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessLimit;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleCreateRequest;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleDetailResponse;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerTargetContext;
import xyz.game.datamanage.model.value.SkillNumericValue;
import xyz.game.datamanage.support.authoring.AggregateJson;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class SkillTriggerOncePerUseServiceTest {

    @Mock private GamesMapper gamesMapper;
    @Mock private SkillMapper skillMapper;
    @Mock private SkillTriggerRuleMapper mapper;

    private SkillTriggerRuleService service;

    @BeforeEach
    void setUp() {
        stubParentAndCatalogs(gamesMapper, skillMapper, mapper);
        service = SkillTriggerRuleTestSupport.service(gamesMapper, skillMapper, mapper);
    }

    @ParameterizedTest
    @ValueSource(strings = {"SKILL_HIT", "BASIC_ATTACK_HIT", "BASIC_ATTACK_START"})
    void createReadUpdateNullAndDisableRoundTrip(String eventName) {
        SkillTriggerEventType eventType = SkillTriggerEventType.valueOf(eventName);
        SkillTriggerPerTargetCooldown cooldown = new SkillTriggerPerTargetCooldown(
            SkillNumericValue.formula("per_target_cd"), SkillTriggerTargetContext.CURRENT_TARGET
        );
        SkillTriggerRuleCreateRequest create = oncePerUseRule(
            "eclipse_proc", eventType, oncePerUse("eclipse", SkillTriggerOncePerUseScope.SKILL), cooldown, null
        );
        SkillTriggerRuleDetailResponse created = service.create(GAME_ID, SKILL_KEY, create);
        assertEquals(oncePerUse("eclipse", SkillTriggerOncePerUseScope.SKILL), created.oncePerUse());
        assertEquals(cooldown, created.perTargetCooldown());
        assertEquals(created, service.get(GAME_ID, SKILL_KEY, "eclipse_proc"));
        var stored = AggregateJson.tree(mapper.findRule(GAME_ID, SKILL_KEY, "eclipse_proc").limitsJson());
        assertEquals("eclipse", stored.path("oncePerUse").path("groupKey").asText());
        assertEquals("SKILL", stored.path("oncePerUse").path("scope").asText());
        assertEquals("FORMULA", stored.path("perTargetCooldown").path("durationValue").path("kind").asText());
        assertTrue(stored.get("maxTriggersPerProcess").isNull());

        SkillTriggerRuleCreateRequest updated = oncePerUseRule("eclipse_proc", eventType, null, cooldown, null);
        SkillTriggerRuleDetailResponse after = service.update(GAME_ID, SKILL_KEY, "eclipse_proc", updateFromCreate(updated));
        assertNull(after.oncePerUse());
        assertEquals(cooldown, after.perTargetCooldown());
        var closed = AggregateJson.tree(mapper.findRule(GAME_ID, SKILL_KEY, "eclipse_proc").limitsJson());
        assertTrue(closed.get("oncePerUse").isNull());
        assertEquals("per_target_cd", closed.path("perTargetCooldown").path("durationValue").path("formulaKey").asText());
    }

    @Test
    void sameGroupSameScopeIsAllowedAndDifferentScopeKeepsTheOtherRule() {
        service.create(GAME_ID, SKILL_KEY, oncePerUseRule(
            "first", SkillTriggerEventType.BASIC_ATTACK_HIT, oncePerUse("eclipse", SkillTriggerOncePerUseScope.SKILL)
        ));
        SkillTriggerRuleDetailResponse second = service.create(GAME_ID, SKILL_KEY, oncePerUseRule(
            "second", SkillTriggerEventType.SKILL_HIT, oncePerUse("eclipse", SkillTriggerOncePerUseScope.SKILL)
        ));
        assertEquals(SkillTriggerOncePerUseScope.SKILL, second.oncePerUse().scope());

        ApiException error = thrown(() -> service.update(
            GAME_ID, SKILL_KEY, "second",
            updateFromCreate(oncePerUseRule(
                "second", SkillTriggerEventType.SKILL_HIT, oncePerUse("eclipse", SkillTriggerOncePerUseScope.TARGET)
            ))
        ));
        assertEquals("409.SKILL_TRIGGER_RULE_ONCE_PER_USE_INVALID", error.getCode());
        List<Map<String, String>> issues = fieldIssues(error);
        assertEquals("oncePerUse.scope", issues.get(0).get("field"));
        assertEquals("ONCE_PER_USE_SCOPE_CONFLICT", issues.get(0).get("code"));
        assertEquals("first", issues.get(0).get("conflictingRuleKey"));
        assertEquals(
            SkillTriggerOncePerUseScope.SKILL,
            service.get(GAME_ID, SKILL_KEY, "second").oncePerUse().scope()
        );
        assertEquals(
            SkillTriggerOncePerUseScope.SKILL,
            service.get(GAME_ID, SKILL_KEY, "first").oncePerUse().scope()
        );
    }

    @Test
    void closingOrDeletingAMemberAllowsTheRemainingRuleToChangeScope() {
        service.create(GAME_ID, SKILL_KEY, oncePerUseRule(
            "first", SkillTriggerEventType.BASIC_ATTACK_HIT, oncePerUse("eclipse", SkillTriggerOncePerUseScope.SKILL)
        ));
        service.create(GAME_ID, SKILL_KEY, oncePerUseRule(
            "second", SkillTriggerEventType.BASIC_ATTACK_START, oncePerUse("eclipse", SkillTriggerOncePerUseScope.SKILL)
        ));
        service.update(
            GAME_ID, SKILL_KEY, "first",
            updateFromCreate(oncePerUseRule("first", SkillTriggerEventType.BASIC_ATTACK_HIT, null))
        );
        assertEquals(
            SkillTriggerOncePerUseScope.TARGET,
            service.update(
                GAME_ID, SKILL_KEY, "second",
                updateFromCreate(oncePerUseRule(
                    "second", SkillTriggerEventType.BASIC_ATTACK_START, oncePerUse("eclipse", SkillTriggerOncePerUseScope.TARGET)
                ))
            ).oncePerUse().scope()
        );

        service.create(GAME_ID, SKILL_KEY, oncePerUseRule(
            "third", SkillTriggerEventType.SKILL_HIT, oncePerUse("eclipse", SkillTriggerOncePerUseScope.TARGET)
        ));
        service.delete(GAME_ID, SKILL_KEY, "third");
        assertEquals(
            SkillTriggerOncePerUseScope.SKILL,
            service.update(
                GAME_ID, SKILL_KEY, "second",
                updateFromCreate(oncePerUseRule(
                    "second", SkillTriggerEventType.BASIC_ATTACK_START, oncePerUse("eclipse", SkillTriggerOncePerUseScope.SKILL)
                ))
            ).oncePerUse().scope()
        );
    }

    @Test
    void rejectedCreateDoesNotWriteAndUnknownFieldsAreBodyErrors() {
        ApiException event = thrown(() -> service.create(
            GAME_ID, SKILL_KEY,
            oncePerUseRule("used", SkillTriggerEventType.SKILL_USED, oncePerUse("eclipse", SkillTriggerOncePerUseScope.SKILL))
        ));
        assertEquals("400.VALIDATION_FAILED", event.getCode());
        assertField(event, "oncePerUse", "ONCE_PER_USE_EVENT_INVALID");

        ApiException unknown = thrown(() -> service.create(
            GAME_ID, SKILL_KEY,
            oncePerUseRule(
                "quota",
                SkillTriggerEventType.BASIC_ATTACK_HIT,
                new SkillTriggerOncePerUse("eclipse", SkillTriggerOncePerUseScope.SKILL, Set.of("quota"))
            )
        ));
        assertEquals("400.INVALID_BODY", unknown.getCode());
        assertField(unknown, "oncePerUse.quota", "UNKNOWN_FIELD");
        verify(mapper, never()).insertRule(
            org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any(),
            org.mockito.ArgumentMatchers.eq("used"), org.mockito.ArgumentMatchers.any(),
            org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any(),
            org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any(),
            org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any(),
            org.mockito.ArgumentMatchers.any()
        );
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "Eclipse", "1bad", "abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklm"})
    void illegalGroupKeysFailValidation(String groupKey) {
        ApiException error = thrown(() -> service.create(
            GAME_ID, SKILL_KEY,
            oncePerUseRule("bad_key", SkillTriggerEventType.BASIC_ATTACK_HIT, oncePerUse(groupKey, SkillTriggerOncePerUseScope.TARGET))
        ));
        assertEquals("400.VALIDATION_FAILED", error.getCode());
        assertField(error, "oncePerUse.groupKey", groupKey.isBlank() ? "REQUIRED" : "KEY_FORMAT_INVALID");
    }

    @Test
    void missingScopeFailsValidation() {
        ApiException error = thrown(() -> service.create(
            GAME_ID, SKILL_KEY,
            oncePerUseRule("no_scope", SkillTriggerEventType.BASIC_ATTACK_HIT, new SkillTriggerOncePerUse("eclipse", null))
        ));
        assertEquals("400.VALIDATION_FAILED", error.getCode());
        assertField(error, "oncePerUse.scope", "REQUIRED");
    }

    @Test
    void processLimitSurvivesOncePerUseNullRewrite() {
        SkillTriggerProcessLimit limit = new SkillTriggerProcessLimit(PROCESS_KEY, SkillNumericValue.fixed(BigDecimal.ONE));
        SkillTriggerRuleDetailResponse created = service.create(
            GAME_ID, SKILL_KEY,
            oncePerUseRule("proc_cap", SkillTriggerEventType.PROCESS_MOMENT, null, null, limit)
        );
        assertEquals(limit, created.maxTriggersPerProcess());
        assertNull(created.oncePerUse());
        var limits = AggregateJson.tree(mapper.findRule(GAME_ID, SKILL_KEY, "proc_cap").limitsJson());
        assertEquals("cast", limits.path("maxTriggersPerProcess").path("processKey").asText());
        assertTrue(limits.get("oncePerUse").isNull());
        assertTrue(limits.get("perTargetCooldown").isNull());
    }

    @Test
    void assemblerLeavesMissingOncePerUseNullAndKeepsExistingLimits() {
        SkillTriggerRuleRow legacy = new SkillTriggerRuleRow(
            GAME_ID, SKILL_KEY, "legacy", "旧限制", null, 10, SkillTriggerEventType.BASIC_ATTACK_HIT, TS, TS,
            ruleRow("legacy", "旧限制", SkillTriggerEventType.BASIC_ATTACK_HIT).eventSourceJson(),
            "[]", "[]",
            "{\"perTargetCooldown\":{\"durationValue\":{\"kind\":\"FORMULA\",\"formulaKey\":\"per_target_cd\"},\"targetContext\":\"CURRENT_TARGET\"},\"maxTriggersPerProcess\":{\"processKey\":\"cast\",\"limitValue\":{\"kind\":\"FIXED\",\"value\":1}}}"
        );
        var detail = new SkillTriggerRuleAssembler().assemble(legacy);
        assertNull(detail.oncePerUse());
        assertEquals("per_target_cd", detail.perTargetCooldown().durationValue().formulaKey());
        assertEquals("cast", detail.maxTriggersPerProcess().processKey());
        assertEquals(0, BigDecimal.ONE.compareTo(detail.maxTriggersPerProcess().limitValue().value()));
    }
}
