package xyz.game.datamanage.service.skilltrigger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.EFFECT_KEY;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.GAME_ID;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.RESULT_KEY;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.SKILL_KEY;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.assertField;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.executeAction;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.rule;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.runtimeParam;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.stubAssembleExecuteEffect;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.stubParentAndCatalogs;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.thrown;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.updateFromCreate;

import java.math.BigDecimal;
import java.util.Collection;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.Mockito;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.skill.SkillMapper;
import xyz.game.datamanage.mapper.skilltrigger.SkillTriggerRuleMapper;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateType;
import xyz.game.datamanage.model.skillparameter.SkillParameterValueType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerAction;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerActionType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerCombatStatusBindingDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerCombatStatusValueKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEmptyEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventSource;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventValueBindingDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventValueKey;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerExecuteEffectActionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateBindingDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateValueKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerPriorResultBindingDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerPriorResultOutputKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerResultModifier;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleCreateRequest;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuntimeInputBinding;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuntimeInputSourceType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSubject;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerTargetContext;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class SkillTriggerRuleRuntimeInputServiceTest {

    @Mock private GamesMapper gamesMapper;
    @Mock private SkillMapper skillMapper;
    @Mock private SkillTriggerRuleMapper mapper;

    private SkillTriggerRuleService service;

    @BeforeEach
    void setUp() {
        stubParentAndCatalogs(gamesMapper, skillMapper, mapper);
        when(mapper.lockInternalStates(eq(GAME_ID), eq(SKILL_KEY), any())).thenReturn(List.of(
            SkillTriggerRuleTestSupport.state("stacks", SkillInternalStateType.COUNTER)
        ));
        service = SkillTriggerRuleTestSupport.service(gamesMapper, skillMapper, mapper);
    }

    @Test
    void missingExtraDuplicateAndTypeIncompatibleBindingsFailWithExactPaths() {
        when(mapper.listRuntimeInputParameters(eq(GAME_ID), eq(SKILL_KEY), any())).thenReturn(List.of(
            runtimeParam("ratio", SkillParameterValueType.DECIMAL)
        ));
        when(mapper.lockParameters(eq(GAME_ID), eq(SKILL_KEY), any())).thenReturn(List.of(
            runtimeParam("ratio", SkillParameterValueType.DECIMAL),
            runtimeParam("extra", SkillParameterValueType.DECIMAL),
            runtimeParam("hit", SkillParameterValueType.INTEGER)
        ));

        ApiException missing = thrown(() -> service.create(
            GAME_ID, SKILL_KEY, bound("missing", List.of())
        ));
        assertEquals("400.INVALID_RUNTIME_INPUT_BINDING", missing.getCode());
        assertField(missing, "actions[0].runtimeInputBindings", "BINDING_MISSING");

        ApiException extra = thrown(() -> service.create(
            GAME_ID,
            SKILL_KEY,
            bound("extra", List.of(
                new SkillTriggerRuntimeInputBinding(
                    "b1", "ratio", SkillTriggerRuntimeInputSourceType.EVENT_VALUE,
                    new SkillTriggerEventValueBindingDetail(SkillTriggerEventValueKey.HIT_INDEX)
                ),
                new SkillTriggerRuntimeInputBinding(
                    "b2", "extra", SkillTriggerRuntimeInputSourceType.EVENT_VALUE,
                    new SkillTriggerEventValueBindingDetail(SkillTriggerEventValueKey.HIT_INDEX)
                )
            ))
        ));
        assertEquals("400.INVALID_RUNTIME_INPUT_BINDING", extra.getCode());
        assertField(extra, "actions[0].runtimeInputBindings[1].parameterKey", "BINDING_EXTRA");

        ApiException duplicate = thrown(() -> service.create(
            GAME_ID,
            SKILL_KEY,
            bound("dup", List.of(
                new SkillTriggerRuntimeInputBinding(
                    "b1", "ratio", SkillTriggerRuntimeInputSourceType.EVENT_VALUE,
                    new SkillTriggerEventValueBindingDetail(SkillTriggerEventValueKey.HIT_INDEX)
                ),
                new SkillTriggerRuntimeInputBinding(
                    "b2", "ratio", SkillTriggerRuntimeInputSourceType.INTERNAL_STATE,
                    new SkillTriggerInternalStateBindingDetail("stacks", SkillTriggerInternalStateValueKind.VALUE, null)
                )
            ))
        ));
        assertEquals("400.VALIDATION_FAILED", duplicate.getCode());
        assertField(duplicate, "actions[0].runtimeInputBindings[1].parameterKey", "DUPLICATE");

        when(mapper.listRuntimeInputParameters(eq(GAME_ID), eq(SKILL_KEY), any())).thenReturn(List.of(
            runtimeParam("hit", SkillParameterValueType.INTEGER)
        ));
        ApiException type = thrown(() -> service.create(
            GAME_ID,
            SKILL_KEY,
            bound("type", List.of(new SkillTriggerRuntimeInputBinding(
                "b1",
                "hit",
                SkillTriggerRuntimeInputSourceType.PRIOR_ACTION_RESULT,
                new SkillTriggerPriorResultBindingDetail("deal_first", RESULT_KEY, SkillTriggerPriorResultOutputKind.CONFIGURED_VALUE)
            )), executeAction("deal_first", EFFECT_KEY))
        ));
        assertEquals("400.INVALID_RUNTIME_INPUT_BINDING", type.getCode());
        assertField(type, "actions[1].runtimeInputBindings[0].parameterKey", "REFERENCE_TYPE_MISMATCH");
    }

    @Test
    void fourSourcesRoundTripAndPriorResultMustBeEarlierImmediateExecuteEffect() {
        when(mapper.lockParameters(eq(GAME_ID), eq(SKILL_KEY), any())).thenReturn(List.of(
            runtimeParam("ratio", SkillParameterValueType.DECIMAL)
        ));
        when(mapper.listRuntimeInputParameters(eq(GAME_ID), eq(SKILL_KEY), any())).thenReturn(List.of(
            runtimeParam("ratio", SkillParameterValueType.DECIMAL)
        ));
        SkillTriggerRuntimeInputBinding eventValue = new SkillTriggerRuntimeInputBinding(
            "from_hit", "ratio", SkillTriggerRuntimeInputSourceType.EVENT_VALUE,
            new SkillTriggerEventValueBindingDetail(SkillTriggerEventValueKey.HIT_INDEX)
        );
        stubAssembleExecuteEffect(mapper, "src_event", "src_event", SkillTriggerEventType.BASIC_ATTACK_HIT, "deal", EFFECT_KEY);
        when(mapper.listBindings(GAME_ID, SKILL_KEY, "src_event")).thenReturn(List.of(
            new xyz.game.datamanage.model.skilltrigger.SkillTriggerRuntimeInputBindingRow(
                GAME_ID, SKILL_KEY, "src_event", "deal", "from_hit", "ratio",
                SkillTriggerRuntimeInputSourceType.EVENT_VALUE
            )
        ));
        when(mapper.listEventValueBindings(GAME_ID, SKILL_KEY, "src_event")).thenReturn(List.of(
            new xyz.game.datamanage.model.skilltrigger.SkillTriggerEventValueBindingRow(
                GAME_ID, SKILL_KEY, "src_event", "deal", "from_hit", SkillTriggerEventValueKey.HIT_INDEX
            )
        ));
        service.create(GAME_ID, SKILL_KEY, bound("src_event", List.of(eventValue)));
        verify(mapper).insertEventValueBinding(any());

        SkillTriggerRuntimeInputBinding state = new SkillTriggerRuntimeInputBinding(
            "from_state", "ratio", SkillTriggerRuntimeInputSourceType.INTERNAL_STATE,
            new SkillTriggerInternalStateBindingDetail("stacks", SkillTriggerInternalStateValueKind.VALUE, null)
        );
        stubAssembleExecuteEffect(mapper, "src_state", "src_state", SkillTriggerEventType.BASIC_ATTACK_HIT, "deal", EFFECT_KEY);
        service.create(GAME_ID, SKILL_KEY, bound("src_state", List.of(state)));
        verify(mapper).insertInternalStateBinding(any());

        SkillTriggerRuntimeInputBinding combat = new SkillTriggerRuntimeInputBinding(
            "from_status", "ratio", SkillTriggerRuntimeInputSourceType.COMBAT_STATUS,
            new SkillTriggerCombatStatusBindingDetail(
                SkillTriggerSubject.CURRENT_TARGET, "poison", SkillTriggerCombatStatusValueKind.STACKS, null, null
            )
        );
        stubAssembleExecuteEffect(mapper, "src_status", "src_status", SkillTriggerEventType.BASIC_ATTACK_HIT, "deal", EFFECT_KEY);
        when(mapper.countStatusApplyPersistent(any(), any(), any(), any(), any())).thenReturn(1L);
        service.create(GAME_ID, SKILL_KEY, bound("src_status", List.of(combat)));
        verify(mapper).insertCombatStatusBinding(any());

        SkillTriggerAction first = executeAction("deal_first", EFFECT_KEY);
        SkillTriggerAction second = new SkillTriggerAction(
            "follow", "后续", SkillTriggerActionType.EXECUTE_EFFECT, 20, SkillTriggerTargetContext.CURRENT_TARGET,
            new SkillTriggerExecuteEffectActionDetail("follow_up"),
            List.of(new SkillTriggerRuntimeInputBinding(
                "from_first", "ratio", SkillTriggerRuntimeInputSourceType.PRIOR_ACTION_RESULT,
                new SkillTriggerPriorResultBindingDetail("deal_first", RESULT_KEY, SkillTriggerPriorResultOutputKind.CONFIGURED_VALUE)
            )),
            List.of(new SkillTriggerResultModifier(RESULT_KEY, new BigDecimal("1.25"), new BigDecimal("1"), new BigDecimal("900")))
        );
        when(mapper.listEffectShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            SkillTriggerRuleTestSupport.damageShape(EFFECT_KEY, RESULT_KEY),
            SkillTriggerRuleTestSupport.damageShape("follow_up", RESULT_KEY, "follow_damage")
        ));
        when(mapper.listRuntimeInputParameters(eq(GAME_ID), eq(SKILL_KEY), any())).thenAnswer(invocation -> {
            Collection<String> keys = invocation.getArgument(2);
            if (keys != null && keys.contains("follow_damage")) {
                return List.of(runtimeParam("ratio", SkillParameterValueType.DECIMAL));
            }
            return List.of();
        });
        stubAssembleExecuteEffect(mapper, "src_prior", "src_prior", SkillTriggerEventType.BASIC_ATTACK_HIT, "deal_first", EFFECT_KEY);
        when(mapper.listActions(GAME_ID, SKILL_KEY, "src_prior")).thenReturn(List.of(
            SkillTriggerRuleTestSupport.executeActionRow("src_prior", "deal_first"),
            new xyz.game.datamanage.model.skilltrigger.SkillTriggerActionRow(
                GAME_ID, SKILL_KEY, "src_prior", "follow", "后续",
                SkillTriggerActionType.EXECUTE_EFFECT, 20, SkillTriggerTargetContext.CURRENT_TARGET
            )
        ));
        when(mapper.listEffectActions(GAME_ID, SKILL_KEY, "src_prior")).thenReturn(List.of(
            SkillTriggerRuleTestSupport.effectActionRow("src_prior", "deal_first", EFFECT_KEY),
            SkillTriggerRuleTestSupport.effectActionRow("src_prior", "follow", "follow_up")
        ));
        service.create(
            GAME_ID,
            SKILL_KEY,
            new SkillTriggerRuleCreateRequest(
                "src_prior", "src_prior", null, 10,
                new SkillTriggerEventSource(SkillTriggerEventType.BASIC_ATTACK_HIT, new SkillTriggerEmptyEventDetail()),
                List.of(),
                List.of(first, second),
                null,
                null
            )
        );
        verify(mapper).insertPriorResultBinding(any());
        verify(mapper).insertModifier(
            eq(GAME_ID), eq(SKILL_KEY), eq("src_prior"), eq("follow"), eq(RESULT_KEY),
            eq("follow_up"), eq(new BigDecimal("1.25")), eq(new BigDecimal("1")), eq(new BigDecimal("900"))
        );

        SkillTriggerAction laterFollow = new SkillTriggerAction(
            "follow", "后续", SkillTriggerActionType.EXECUTE_EFFECT, 10, SkillTriggerTargetContext.CURRENT_TARGET,
            new SkillTriggerExecuteEffectActionDetail("follow_up"),
            List.of(new SkillTriggerRuntimeInputBinding(
                "from_first", "ratio", SkillTriggerRuntimeInputSourceType.PRIOR_ACTION_RESULT,
                new SkillTriggerPriorResultBindingDetail("deal_first", RESULT_KEY, SkillTriggerPriorResultOutputKind.CONFIGURED_VALUE)
            )),
            List.of(new SkillTriggerResultModifier(RESULT_KEY, new BigDecimal("1.25"), new BigDecimal("1"), new BigDecimal("900")))
        );
        SkillTriggerAction laterFirst = new SkillTriggerAction(
            "deal_first", "执行效果", SkillTriggerActionType.EXECUTE_EFFECT, 20,
            SkillTriggerTargetContext.CURRENT_TARGET,
            new SkillTriggerExecuteEffectActionDetail(EFFECT_KEY),
            List.of(),
            List.of()
        );
        ApiException later = thrown(() -> service.create(
            GAME_ID,
            SKILL_KEY,
            new SkillTriggerRuleCreateRequest(
                "later", "later", null, 10,
                new SkillTriggerEventSource(SkillTriggerEventType.BASIC_ATTACK_HIT, new SkillTriggerEmptyEventDetail()),
                List.of(),
                List.of(laterFollow, laterFirst),
                null,
                null
            )
        ));
        assertEquals("400.INVALID_RUNTIME_INPUT_BINDING", later.getCode());
        assertField(later, "actions[0].runtimeInputBindings[0].detail.sourceActionKey", "RESULT_NOT_IMMEDIATELY_AVAILABLE");
    }

    @Test
    void updateDeletingOrReorderingSourceActionRollsBackAndEffectKeyChangeDeletesChildrenBeforeInsert() {
        when(mapper.lockParameters(eq(GAME_ID), eq(SKILL_KEY), any())).thenReturn(List.of(
            runtimeParam("ratio", SkillParameterValueType.DECIMAL)
        ));
        when(mapper.listRuntimeInputParameters(eq(GAME_ID), eq(SKILL_KEY), any())).thenAnswer(invocation -> {
            Collection<String> keys = invocation.getArgument(2);
            if (keys != null && keys.contains("follow_damage")) {
                return List.of(runtimeParam("ratio", SkillParameterValueType.DECIMAL));
            }
            return List.of();
        });
        when(mapper.listEffectShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            SkillTriggerRuleTestSupport.damageShape(EFFECT_KEY, RESULT_KEY),
            SkillTriggerRuleTestSupport.damageShape("follow_up", RESULT_KEY, "follow_damage"),
            SkillTriggerRuleTestSupport.damageShape("other", RESULT_KEY)
        ));
        SkillTriggerAction first = executeAction("deal_first", EFFECT_KEY);
        SkillTriggerAction second = new SkillTriggerAction(
            "follow", "后续", SkillTriggerActionType.EXECUTE_EFFECT, 20, SkillTriggerTargetContext.CURRENT_TARGET,
            new SkillTriggerExecuteEffectActionDetail("follow_up"),
            List.of(new SkillTriggerRuntimeInputBinding(
                "from_first", "ratio", SkillTriggerRuntimeInputSourceType.PRIOR_ACTION_RESULT,
                new SkillTriggerPriorResultBindingDetail("deal_first", RESULT_KEY, SkillTriggerPriorResultOutputKind.CONFIGURED_VALUE)
            )),
            List.of()
        );
        stubAssembleExecuteEffect(mapper, "keep", "keep", SkillTriggerEventType.BASIC_ATTACK_HIT, "deal_first", EFFECT_KEY);
        when(mapper.listActions(GAME_ID, SKILL_KEY, "keep")).thenReturn(List.of(
            SkillTriggerRuleTestSupport.executeActionRow("keep", "deal_first"),
            new xyz.game.datamanage.model.skilltrigger.SkillTriggerActionRow(
                GAME_ID, SKILL_KEY, "keep", "follow", "后续",
                SkillTriggerActionType.EXECUTE_EFFECT, 20, SkillTriggerTargetContext.CURRENT_TARGET
            )
        ));
        when(mapper.listEffectActions(GAME_ID, SKILL_KEY, "keep")).thenReturn(List.of(
            SkillTriggerRuleTestSupport.effectActionRow("keep", "deal_first", EFFECT_KEY),
            SkillTriggerRuleTestSupport.effectActionRow("keep", "follow", "follow_up")
        ));
        when(mapper.listBindings(GAME_ID, SKILL_KEY, "keep")).thenReturn(List.of(
            new xyz.game.datamanage.model.skilltrigger.SkillTriggerRuntimeInputBindingRow(
                GAME_ID, SKILL_KEY, "keep", "follow", "from_first", "ratio",
                SkillTriggerRuntimeInputSourceType.PRIOR_ACTION_RESULT
            )
        ));
        when(mapper.listPriorResultBindings(GAME_ID, SKILL_KEY, "keep")).thenReturn(List.of(
            new xyz.game.datamanage.model.skilltrigger.SkillTriggerPriorResultBindingRow(
                GAME_ID, SKILL_KEY, "keep", "follow", "from_first",
                "deal_first", EFFECT_KEY, RESULT_KEY, SkillTriggerPriorResultOutputKind.CONFIGURED_VALUE
            )
        ));
        service.create(
            GAME_ID, SKILL_KEY,
            new SkillTriggerRuleCreateRequest(
                "keep", "keep", null, 10,
                new SkillTriggerEventSource(SkillTriggerEventType.BASIC_ATTACK_HIT, new SkillTriggerEmptyEventDetail()),
                List.of(), List.of(first, second), null, null
            )
        );

        ApiException removed = thrown(() -> service.update(
            GAME_ID, SKILL_KEY, "keep",
            updateFromCreate(new SkillTriggerRuleCreateRequest(
                "keep", "keep", null, 10,
                new SkillTriggerEventSource(SkillTriggerEventType.BASIC_ATTACK_HIT, new SkillTriggerEmptyEventDetail()),
                List.of(), List.of(second), null, null
            ))
        ));
        assertEquals("400.INVALID_RUNTIME_INPUT_BINDING", removed.getCode());
        verify(mapper, never()).updateRule(any(), any(), any(), any(), any(), any(), any());
        verify(mapper, never()).deleteChildren(GAME_ID, SKILL_KEY, "keep");

        SkillTriggerAction renamedSource = executeAction("deal_first", "other");
        service.update(
            GAME_ID, SKILL_KEY, "keep",
            updateFromCreate(new SkillTriggerRuleCreateRequest(
                "keep", "keep", null, 10,
                new SkillTriggerEventSource(SkillTriggerEventType.BASIC_ATTACK_HIT, new SkillTriggerEmptyEventDetail()),
                List.of(), List.of(renamedSource, second), null, null
            ))
        );
        InOrder order = Mockito.inOrder(mapper);
        order.verify(mapper).updateRule(eq(GAME_ID), eq(SKILL_KEY), eq("keep"), any(), any(), any(), any());
        order.verify(mapper).deleteChildren(GAME_ID, SKILL_KEY, "keep");
        order.verify(mapper).insertAction(eq(GAME_ID), eq(SKILL_KEY), eq("keep"), eq("deal_first"), any(), any(), any(), any());
        order.verify(mapper).forceDeferredConstraintsImmediate();
    }

    private static SkillTriggerRuleCreateRequest bound(String ruleKey, List<SkillTriggerRuntimeInputBinding> bindings) {
        return bound(ruleKey, bindings, null);
    }

    private static SkillTriggerRuleCreateRequest bound(
        String ruleKey,
        List<SkillTriggerRuntimeInputBinding> bindings,
        SkillTriggerAction extraFirst
    ) {
        SkillTriggerAction execute = new SkillTriggerAction(
            "deal", "执行效果", SkillTriggerActionType.EXECUTE_EFFECT, 20,
            SkillTriggerTargetContext.CURRENT_TARGET,
            new SkillTriggerExecuteEffectActionDetail(EFFECT_KEY),
            bindings,
            List.of()
        );
        List<SkillTriggerAction> actions = extraFirst == null ? List.of(execute) : List.of(extraFirst, execute);
        return rule(
            ruleKey,
            new SkillTriggerEventSource(SkillTriggerEventType.BASIC_ATTACK_HIT, new SkillTriggerEmptyEventDetail()),
            actions
        );
    }
}
