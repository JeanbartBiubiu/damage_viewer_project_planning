package xyz.game.datamanage.service.skillformula;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataIntegrityViolationException;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.skill.SkillMapper;
import xyz.game.datamanage.mapper.skillformula.SkillFormulaMapper;
import xyz.game.datamanage.model.skill.SkillRow;
import xyz.game.datamanage.model.skill.SkillStatus;
import xyz.game.datamanage.model.skillformula.AttributeOwner;
import xyz.game.datamanage.model.skillformula.AttributeValueKind;
import xyz.game.datamanage.model.skillformula.SkillFormulaAttributeNode;
import xyz.game.datamanage.model.skillformula.SkillFormulaAttributeRef;
import xyz.game.datamanage.model.skillformula.SkillFormulaAttributeStatusRow;
import xyz.game.datamanage.model.skillformula.SkillFormulaCreateRequest;
import xyz.game.datamanage.model.skillformula.SkillFormulaDetailResponse;
import xyz.game.datamanage.model.skillformula.SkillFormulaExpressionNode;
import xyz.game.datamanage.model.skillformula.SkillFormulaNodeType;
import xyz.game.datamanage.model.skillformula.SkillFormulaOperation;
import xyz.game.datamanage.model.skillformula.SkillFormulaOperationNode;
import xyz.game.datamanage.model.skillformula.SkillFormulaParameterNode;
import xyz.game.datamanage.model.skillformula.SkillFormulaRow;
import xyz.game.datamanage.model.skillformula.SkillFormulaSummaryResponse;
import xyz.game.datamanage.model.skillformula.SkillFormulaUpdateRequest;
import xyz.game.datamanage.support.error.ApiException;
import xyz.game.datamanage.support.authoring.AggregateJson;

@ExtendWith(MockitoExtension.class)
class SkillFormulaServiceTest {

    private static final String GAME_ID = "lol";
    private static final String SKILL_KEY = "varus_w";
    private static final String FORMULA_KEY = "missing_health_damage";

    @Mock private GamesMapper gamesMapper;
    @Mock private SkillMapper skillMapper;
    @Mock private SkillFormulaMapper formulaMapper;

    private SkillFormulaService service;

    @BeforeEach
    void setUp() {
        service = new SkillFormulaService(gamesMapper, skillMapper, formulaMapper, org.mockito.Mockito.mock(xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard.class));
        when(gamesMapper.countGames(GAME_ID)).thenReturn(1L);
    }

    @Test
    void listsRequiresParentAndReturnsSummariesWithoutExpression() {
        when(skillMapper.findById(GAME_ID, SKILL_KEY)).thenReturn(skill());
        when(formulaMapper.listSummaries(GAME_ID, SKILL_KEY)).thenReturn(List.of(formulaRow()));

        List<SkillFormulaSummaryResponse> items = service.list(GAME_ID, SKILL_KEY);
        assertEquals(1, items.size());
        assertEquals(FORMULA_KEY, items.get(0).formulaKey());
        assertEquals(SkillFormulaSummaryResponse.class, items.get(0).getClass());

        when(gamesMapper.countGames("missing")).thenReturn(0L);
        assertCode("404.GAME_NOT_FOUND", () -> service.list("missing", SKILL_KEY));

        when(skillMapper.findById(GAME_ID, "missing")).thenReturn(null);
        assertCode("404.SKILL_NOT_FOUND", () -> service.list(GAME_ID, "missing"));
        verify(formulaMapper, never()).listSummaries(eq(GAME_ID), eq("missing"));
    }

    @Test
    void createsNestedExpressionWithAllNodeKindsOperationsAndAttributeKinds() {
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill());
        when(formulaMapper.findExistingParameterKeys(eq(GAME_ID), eq(SKILL_KEY), anyCollection()))
            .thenAnswer(invocation -> new ArrayList<>((Collection<?>) invocation.getArgument(2)));
        when(formulaMapper.findAttributesByKeys(eq(GAME_ID), anyCollection()))
            .thenReturn(List.of(new SkillFormulaAttributeStatusRow("hp", "ENABLED"),
                new SkillFormulaAttributeStatusRow("ad", "ENABLED")));
        captureInsert(FORMULA_KEY, "已损失生命值伤害");
        SkillFormulaExpressionNode expression = allKindsExpression();
        SkillFormulaDetailResponse detail = service.create(GAME_ID, SKILL_KEY,
            new SkillFormulaCreateRequest(FORMULA_KEY, "已损失生命值伤害", null, 10, expression));
        assertEquals(expression, detail.expression());
        ArgumentCaptor<String> expressionCaptor = ArgumentCaptor.forClass(String.class);
        InOrder order = inOrder(skillMapper, formulaMapper);
        order.verify(skillMapper).findByIdForUpdate(GAME_ID, SKILL_KEY);
        order.verify(formulaMapper).insert(eq(GAME_ID), eq(SKILL_KEY), eq(FORMULA_KEY),
            anyString(), any(), eq(10), expressionCaptor.capture());
        assertEquals(AggregateJson.tree(AggregateJson.write(expression)),
            AggregateJson.tree(expressionCaptor.getValue()));
    }

    @Test
    void createsAcceptsRuntimeInputParameterReference() {
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill());
        when(formulaMapper.findExistingParameterKeys(eq(GAME_ID), eq(SKILL_KEY), anyCollection()))
            .thenReturn(List.of("current_stacks", "damage_per_stack"));
        captureInsert("stack_damage", "层数伤害");
        SkillFormulaExpressionNode expression = new SkillFormulaOperationNode(SkillFormulaOperation.MULTIPLY,
            List.of(new SkillFormulaParameterNode("current_stacks"), new SkillFormulaParameterNode("damage_per_stack")));
        SkillFormulaDetailResponse detail = service.create(GAME_ID, SKILL_KEY,
            new SkillFormulaCreateRequest("stack_damage", "层数伤害", null, 1, expression));
        assertEquals(expression, detail.expression());
    }

    @Test
    void preservesOperandOrderAcrossAllOperations() {
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill());
        when(formulaMapper.findExistingParameterKeys(eq(GAME_ID), eq(SKILL_KEY), anyCollection()))
            .thenReturn(List.of("left_param", "right_param"));
        captureInsert("ordered", "顺序");
        for (SkillFormulaOperation operation : SkillFormulaOperation.values()) {
            SkillFormulaExpressionNode expression = new SkillFormulaOperationNode(operation,
                List.of(new SkillFormulaParameterNode("left_param"), new SkillFormulaParameterNode("right_param")));
            SkillFormulaDetailResponse detail = service.create(GAME_ID, SKILL_KEY,
                new SkillFormulaCreateRequest("ordered", "顺序", null, 1, expression));
            assertEquals(expression, detail.expression());
        }
    }

    @Test
    void rejectsDepthAndNodeCountLimitsAndOperandCount() {
        SkillFormulaExpressionNode tooDeep = deepExpression(33);
        ApiException depthError = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillFormulaCreateRequest("too_deep", "过深", null, 1, tooDeep)
            )
        );
        assertEquals("400.VALIDATION_FAILED", depthError.getCode());
        assertFieldIssueContains(depthError, "DEPTH_LIMIT");

        SkillFormulaExpressionNode tooMany = wideExpression(257);
        ApiException nodeError = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillFormulaCreateRequest("too_many", "过多", null, 1, tooMany)
            )
        );
        assertEquals("400.VALIDATION_FAILED", nodeError.getCode());
        assertFieldIssueContains(nodeError, "NODE_LIMIT");

        ApiException operandError = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillFormulaCreateRequest(
                    "bad_ops",
                    "操作数错误",
                    null,
                    1,
                    new SkillFormulaOperationNode(
                        SkillFormulaOperation.ADD,
                        List.of(new SkillFormulaParameterNode("only_one"))
                    )
                )
            )
        );
        assertEquals("400.VALIDATION_FAILED", operandError.getCode());
        assertFieldIssueContains(operandError, "OPERAND_COUNT");
        verify(formulaMapper, never()).insert(any(), any(), any(), any(), any(), any(), any());
        verify(skillMapper, never()).findByIdForUpdate(any(), any());
    }

    @Test
    void rejectsCrossTypeNodeFieldsAsFieldMutex() {
        ApiException parameterError = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillFormulaCreateRequest(
                    "mutex_parameter",
                    "参数互斥",
                    null,
                    1,
                    new SkillFormulaParameterNode(
                        SkillFormulaNodeType.PARAMETER,
                        "ratio",
                        Set.of("operation", "operands")
                    )
                )
            )
        );
        assertEquals("400.VALIDATION_FAILED", parameterError.getCode());
        assertFieldIssueContains(parameterError, "expression.operation");
        assertFieldIssueContains(parameterError, "expression.operands");
        assertFieldIssueContains(parameterError, "FIELD_MUTEX");

        ApiException operationError = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillFormulaCreateRequest(
                    "mutex_operation",
                    "运算互斥",
                    null,
                    1,
                    new SkillFormulaOperationNode(
                        SkillFormulaNodeType.OPERATION,
                        SkillFormulaOperation.ADD,
                        List.of(
                            new SkillFormulaParameterNode("left"),
                            new SkillFormulaParameterNode("right")
                        ),
                        Set.of("parameterKey")
                    )
                )
            )
        );
        assertEquals("400.VALIDATION_FAILED", operationError.getCode());
        assertFieldIssueContains(operationError, "expression.parameterKey");
        assertFieldIssueContains(operationError, "FIELD_MUTEX");

        ApiException attributeError = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillFormulaCreateRequest(
                    "mutex_attribute",
                    "属性互斥",
                    null,
                    1,
                    new SkillFormulaAttributeNode(
                        SkillFormulaNodeType.ATTRIBUTE,
                        AttributeOwner.TARGET,
                        "hp",
                        AttributeValueKind.MISSING,
                        Set.of("operation")
                    )
                )
            )
        );
        assertEquals("400.VALIDATION_FAILED", attributeError.getCode());
        assertFieldIssueContains(attributeError, "expression.operation");
        verify(formulaMapper, never()).insert(any(), any(), any(), any(), any(), any(), any());
        verify(skillMapper, never()).findByIdForUpdate(any(), any());
    }

    @Test
    void batchesMissingReferencesWithStableFieldPaths() {
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill());
        when(formulaMapper.countByKey(GAME_ID, SKILL_KEY, FORMULA_KEY)).thenReturn(0L);
        when(formulaMapper.findExistingParameterKeys(eq(GAME_ID), eq(SKILL_KEY), anyCollection()))
            .thenReturn(List.of());
        when(formulaMapper.findAttributesByKeys(eq(GAME_ID), anyCollection())).thenReturn(List.of());

        SkillFormulaExpressionNode expression = new SkillFormulaOperationNode(
            SkillFormulaOperation.ADD,
            List.of(
                new SkillFormulaParameterNode("missing_param"),
                new SkillFormulaAttributeNode(
                    AttributeOwner.SOURCE,
                    "missing_attr",
                    AttributeValueKind.TOTAL
                )
            )
        );

        ApiException exception = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillFormulaCreateRequest(FORMULA_KEY, "引用错误", null, 1, expression)
            )
        );
        assertEquals("400.INVALID_FORMULA_REFERENCE", exception.getCode());
        @SuppressWarnings("unchecked")
        List<Map<String, String>> issues =
            (List<Map<String, String>>) exception.getDetails().get("fieldIssues");
        assertEquals(2, issues.size());
        assertEquals("expression.operands[0].parameterKey", issues.get(0).get("field"));
        assertEquals("UNKNOWN_SKILL_PARAMETER", issues.get(0).get("code"));
        assertEquals("expression.operands[1].attributeKey", issues.get(1).get("field"));
        assertEquals("UNKNOWN_ATTRIBUTE", issues.get(1).get("code"));
        verify(formulaMapper, never()).insert(any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void createRejectsDisabledAttributesWhileUpdateKeepsExistingDisabledTriple() {
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill());
        when(formulaMapper.countByKey(GAME_ID, SKILL_KEY, FORMULA_KEY)).thenReturn(0L);
        when(formulaMapper.findAttributesByKeys(eq(GAME_ID), anyCollection()))
            .thenReturn(List.of(new SkillFormulaAttributeStatusRow("hp", "DISABLED")));

        ApiException createError = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillFormulaCreateRequest(
                    FORMULA_KEY,
                    "停用属性",
                    null,
                    1,
                    new SkillFormulaAttributeNode(
                        AttributeOwner.TARGET,
                        "hp",
                        AttributeValueKind.MISSING
                    )
                )
            )
        );
        assertEquals("409.FORMULA_ATTRIBUTE_DISABLED", createError.getCode());
        assertFieldIssueContains(createError, "expression.attributeKey");

        when(formulaMapper.findByIdForUpdate(GAME_ID, SKILL_KEY, FORMULA_KEY)).thenReturn(formulaRow());
        when(formulaMapper.listAttributeRefs(GAME_ID, SKILL_KEY, FORMULA_KEY)).thenReturn(List.of(
            new SkillFormulaAttributeRef(AttributeOwner.TARGET, "hp", AttributeValueKind.MISSING)
        ));
        when(formulaMapper.findAttributesByKeys(eq(GAME_ID), anyCollection()))
            .thenReturn(List.of(
                new SkillFormulaAttributeStatusRow("hp", "DISABLED"),
                new SkillFormulaAttributeStatusRow("ad", "DISABLED")
            ));
        when(formulaMapper.findExistingParameterKeys(eq(GAME_ID), eq(SKILL_KEY), anyCollection()))
            .thenReturn(List.of("ratio"));
        captureUpdate(FORMULA_KEY, "保留停用");

        SkillFormulaDetailResponse kept = service.update(
            GAME_ID,
            SKILL_KEY,
            FORMULA_KEY,
            new SkillFormulaUpdateRequest(
                null,
                "保留停用",
                null,
                2,
                new SkillFormulaOperationNode(
                    SkillFormulaOperation.MULTIPLY,
                    List.of(
                        new SkillFormulaAttributeNode(
                            AttributeOwner.TARGET,
                            "hp",
                            AttributeValueKind.MISSING
                        ),
                        new SkillFormulaParameterNode("ratio")
                    )
                )
            )
        );
        assertEquals(
            AttributeValueKind.MISSING,
            ((SkillFormulaAttributeNode) ((SkillFormulaOperationNode) kept.expression()).operands().get(0))
                .attributeValueKind()
        );

        ApiException updateError = assertThrows(
            ApiException.class,
            () -> service.update(
                GAME_ID,
                SKILL_KEY,
                FORMULA_KEY,
                new SkillFormulaUpdateRequest(
                    null,
                    "新增停用",
                    null,
                    2,
                    new SkillFormulaOperationNode(
                        SkillFormulaOperation.ADD,
                        List.of(
                            new SkillFormulaAttributeNode(
                                AttributeOwner.TARGET,
                                "hp",
                                AttributeValueKind.MISSING
                            ),
                            new SkillFormulaAttributeNode(
                                AttributeOwner.SOURCE,
                                "ad",
                                AttributeValueKind.TOTAL
                            )
                        )
                    )
                )
            )
        );
        assertEquals("409.FORMULA_ATTRIBUTE_DISABLED", updateError.getCode());
        assertFieldIssueContains(updateError, "expression.operands[1].attributeKey");
    }

    @Test
    void updateWritesExpressionAtomicallyAndDoesNotReadBackOnFailure() {
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill());
        when(formulaMapper.findByIdForUpdate(GAME_ID, SKILL_KEY, FORMULA_KEY)).thenReturn(formulaRow());
        when(formulaMapper.findExistingParameterKeys(eq(GAME_ID), eq(SKILL_KEY), anyCollection()))
            .thenReturn(List.of("ratio"));
        when(formulaMapper.update(eq(GAME_ID), eq(SKILL_KEY), eq(FORMULA_KEY),
            eq("更新失败"), isNull(), eq(3), anyString()))
            .thenThrow(new DataIntegrityViolationException("update failed"));
        assertThrows(DataIntegrityViolationException.class, () -> service.update(GAME_ID, SKILL_KEY,
            FORMULA_KEY, new SkillFormulaUpdateRequest(null, "更新失败", null, 3, new SkillFormulaParameterNode("ratio"))));
        verify(formulaMapper, never()).findById(GAME_ID, SKILL_KEY, FORMULA_KEY);
    }

    @Test
    void updateAndDeleteLockParentSkillThenFormula() {
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill());
        when(formulaMapper.findByIdForUpdate(GAME_ID, SKILL_KEY, FORMULA_KEY)).thenReturn(formulaRow());
        when(formulaMapper.findExistingParameterKeys(eq(GAME_ID), eq(SKILL_KEY), anyCollection()))
            .thenReturn(List.of("ratio"));
        captureUpdate(FORMULA_KEY, "更新");
        service.update(GAME_ID, SKILL_KEY, FORMULA_KEY,
            new SkillFormulaUpdateRequest(null, "更新", null, 1, new SkillFormulaParameterNode("ratio")));
        when(formulaMapper.delete(GAME_ID, SKILL_KEY, FORMULA_KEY)).thenReturn(1);
        service.delete(GAME_ID, SKILL_KEY, FORMULA_KEY);
        InOrder order = inOrder(skillMapper, formulaMapper);
        order.verify(skillMapper).findByIdForUpdate(GAME_ID, SKILL_KEY);
        order.verify(formulaMapper).findByIdForUpdate(GAME_ID, SKILL_KEY, FORMULA_KEY);
        order.verify(skillMapper).findByIdForUpdate(GAME_ID, SKILL_KEY);
        order.verify(formulaMapper).findByIdForUpdate(GAME_ID, SKILL_KEY, FORMULA_KEY);
        order.verify(formulaMapper).delete(GAME_ID, SKILL_KEY, FORMULA_KEY);
    }

    @Test
    void doesNotMapUnrelatedForeignKeyOrGenericSqlstateToFormulaInUse() {
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill());
        when(formulaMapper.findByIdForUpdate(GAME_ID, SKILL_KEY, FORMULA_KEY)).thenReturn(formulaRow());
        DataIntegrityViolationException unrelated = new DataIntegrityViolationException(
            "ERROR: update or delete on table violates foreign key constraint "
                + "fk_unrelated_table SQLSTATE 23503"
        );
        when(formulaMapper.delete(GAME_ID, SKILL_KEY, FORMULA_KEY)).thenThrow(unrelated);
        DataIntegrityViolationException thrown = assertThrows(
            DataIntegrityViolationException.class,
            () -> service.delete(GAME_ID, SKILL_KEY, FORMULA_KEY)
        );
        assertEquals(unrelated, thrown);
    }

    @Test
    void rejectsImmutableFormulaKeyDuplicateKeyAndMissingParents() {
        assertCode(
            "400.VALIDATION_FAILED",
            () -> service.update(
                GAME_ID,
                SKILL_KEY,
                FORMULA_KEY,
                new SkillFormulaUpdateRequest(
                    FORMULA_KEY,
                    "不可改键",
                    null,
                    1,
                    new SkillFormulaParameterNode("ratio")
                )
            )
        );

        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill());
        when(formulaMapper.countByKey(GAME_ID, SKILL_KEY, FORMULA_KEY)).thenReturn(0L);
        when(formulaMapper.findExistingParameterKeys(eq(GAME_ID), eq(SKILL_KEY), anyCollection()))
            .thenReturn(List.of("ratio"));
        when(formulaMapper.insert(any(), any(), any(), any(), any(), any(), any()))
            .thenThrow(new DataIntegrityViolationException("violates pk_skill_formulas"));
        assertCode(
            "409.SKILL_FORMULA_KEY_EXISTS",
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillFormulaCreateRequest(
                    FORMULA_KEY,
                    "重复",
                    null,
                    1,
                    new SkillFormulaParameterNode("ratio")
                )
            )
        );

        when(gamesMapper.countGames("missing")).thenReturn(0L);
        assertCode("404.GAME_NOT_FOUND", () -> service.get("missing", SKILL_KEY, FORMULA_KEY));
        when(skillMapper.findById(GAME_ID, "missing")).thenReturn(null);
        assertCode("404.SKILL_NOT_FOUND", () -> service.get(GAME_ID, "missing", FORMULA_KEY));
        when(skillMapper.findById(GAME_ID, SKILL_KEY)).thenReturn(skill());
        when(formulaMapper.findById(GAME_ID, SKILL_KEY, "missing")).thenReturn(null);
        assertCode("404.SKILL_FORMULA_NOT_FOUND", () -> service.get(GAME_ID, SKILL_KEY, "missing"));
    }

    @Test
    void readRejectsMalformedOrOverLimitStoredExpression() {
        when(skillMapper.findById(GAME_ID, SKILL_KEY)).thenReturn(skill());
        for (String invalid : List.of("null", "{}", "{",
            "{\"nodeType\":\"OPERATION\",\"operation\":\"ADD\",\"operands\":[]}",
            AggregateJson.write(deepExpression(33)))) {
            when(formulaMapper.findById(GAME_ID, SKILL_KEY, FORMULA_KEY))
                .thenReturn(formulaRow(FORMULA_KEY, "损坏", invalid));
            assertCode("500.INTERNAL_ERROR", () -> service.get(GAME_ID, SKILL_KEY, FORMULA_KEY));
        }
    }

    @Test
    void triggerRuleProtectsFormulaDeleteBeforeMapperDeleteWithLongConstructor() {
        xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleService triggerRuleService =
            org.mockito.Mockito.mock(xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleService.class);
        SkillFormulaService guarded = new SkillFormulaService(
            gamesMapper, skillMapper, formulaMapper, triggerRuleService
        , org.mockito.Mockito.mock(xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard.class));
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill());
        when(formulaMapper.findByIdForUpdate(GAME_ID, SKILL_KEY, FORMULA_KEY)).thenReturn(formulaRow());
        org.mockito.Mockito.doThrow(new ApiException(
            org.springframework.http.HttpStatus.CONFLICT,
            "409.SKILL_FORMULA_IN_USE",
            "技能公式仍被触发规则引用，不能删除",
            Map.of("fieldIssues", List.of(Map.of("field", "formulaKey", "code", "TRIGGER_RULE_FORMULA_IN_USE")))
        )).when(triggerRuleService).assertFormulaDeletable(GAME_ID, SKILL_KEY, FORMULA_KEY);
        assertCode("409.SKILL_FORMULA_IN_USE", () -> guarded.delete(GAME_ID, SKILL_KEY, FORMULA_KEY));
        verify(formulaMapper, never()).delete(any(), any(), any());
    }

    private static SkillFormulaExpressionNode allKindsExpression() {
        SkillFormulaExpressionNode attributeKinds = new SkillFormulaOperationNode(
            SkillFormulaOperation.ADD,
            List.of(
                new SkillFormulaOperationNode(
                    SkillFormulaOperation.MIN,
                    List.of(
                        new SkillFormulaAttributeNode(AttributeOwner.SOURCE, "ad", AttributeValueKind.BASE),
                        new SkillFormulaAttributeNode(AttributeOwner.SOURCE, "ad", AttributeValueKind.BONUS)
                    )
                ),
                new SkillFormulaOperationNode(
                    SkillFormulaOperation.MAX,
                    List.of(
                        new SkillFormulaAttributeNode(AttributeOwner.SOURCE, "ad", AttributeValueKind.TOTAL),
                        new SkillFormulaOperationNode(
                            SkillFormulaOperation.SUBTRACT,
                            List.of(
                                new SkillFormulaAttributeNode(
                                    AttributeOwner.TARGET, "hp", AttributeValueKind.CURRENT
                                ),
                                new SkillFormulaOperationNode(
                                    SkillFormulaOperation.DIVIDE,
                                    List.of(
                                        new SkillFormulaAttributeNode(
                                            AttributeOwner.TARGET, "hp", AttributeValueKind.CURRENT_RATIO
                                        ),
                                        new SkillFormulaAttributeNode(
                                            AttributeOwner.TARGET, "hp", AttributeValueKind.MISSING_RATIO
                                        )
                                    )
                                )
                            )
                        )
                    )
                )
            )
        );
        return new SkillFormulaOperationNode(
            SkillFormulaOperation.MULTIPLY,
            List.of(
                new SkillFormulaAttributeNode(AttributeOwner.TARGET, "hp", AttributeValueKind.MISSING),
                new SkillFormulaOperationNode(
                    SkillFormulaOperation.ADD,
                    List.of(
                        new SkillFormulaParameterNode("missing_health_ratio"),
                        attributeKinds
                    )
                )
            )
        );
    }

    private static SkillFormulaExpressionNode deepExpression(int depth) {
        SkillFormulaExpressionNode node = new SkillFormulaParameterNode("leaf");
        for (int current = 1; current < depth; current++) {
            node = new SkillFormulaOperationNode(
                SkillFormulaOperation.ADD,
                List.of(node, new SkillFormulaParameterNode("leaf_" + current))
            );
        }
        return node;
    }

    private static SkillFormulaExpressionNode wideExpression(int leafCount) {
        List<SkillFormulaExpressionNode> leaves = new ArrayList<>();
        for (int i = 0; i < leafCount; i++) {
            leaves.add(new SkillFormulaParameterNode("p" + i));
        }
        while (leaves.size() > 1) {
            List<SkillFormulaExpressionNode> next = new ArrayList<>();
            for (int i = 0; i < leaves.size(); i += 2) {
                if (i + 1 < leaves.size()) {
                    next.add(new SkillFormulaOperationNode(
                        SkillFormulaOperation.ADD,
                        List.of(leaves.get(i), leaves.get(i + 1))
                    ));
                } else {
                    next.add(leaves.get(i));
                }
            }
            leaves = next;
        }
        return leaves.get(0);
    }

    private static SkillRow skill() {
        OffsetDateTime timestamp = OffsetDateTime.parse("2026-08-26T08:00:00Z");
        return new SkillRow(
            GAME_ID, SKILL_KEY, "枯萎箭袋", null, 5, SkillStatus.ENABLED, 10, timestamp, timestamp
        );
    }

    private static SkillFormulaRow formulaRow() {
        return formulaRow(FORMULA_KEY, "已损失生命值伤害");
    }

    private void captureInsert(String formulaKey, String name) {
        AtomicReference<String> saved = new AtomicReference<>();
        when(formulaMapper.insert(eq(GAME_ID), eq(SKILL_KEY), eq(formulaKey), anyString(), any(), any(), anyString()))
            .thenAnswer(invocation -> { saved.set(invocation.getArgument(6)); return 1; });
        when(formulaMapper.findById(GAME_ID, SKILL_KEY, formulaKey))
            .thenAnswer(invocation -> formulaRow(formulaKey, name, saved.get()));
    }

    private void captureUpdate(String formulaKey, String name) {
        AtomicReference<String> saved = new AtomicReference<>();
        when(formulaMapper.update(eq(GAME_ID), eq(SKILL_KEY), eq(formulaKey), anyString(), any(), any(), anyString()))
            .thenAnswer(invocation -> { saved.set(invocation.getArgument(6)); return 1; });
        when(formulaMapper.findById(GAME_ID, SKILL_KEY, formulaKey))
            .thenAnswer(invocation -> formulaRow(formulaKey, name, saved.get()));
    }

    private static SkillFormulaRow formulaRow(String formulaKey, String name) {
        return formulaRow(formulaKey, name, AggregateJson.write(new SkillFormulaParameterNode("ratio")));
    }

    private static SkillFormulaRow formulaRow(String formulaKey, String name, String expression) {
        OffsetDateTime timestamp = OffsetDateTime.parse("2026-08-26T08:00:00Z");
        return new SkillFormulaRow(
            GAME_ID, SKILL_KEY, formulaKey, name, null, 10, expression, timestamp, timestamp
        );
    }

    private static void assertCode(String code, Runnable action) {
        ApiException exception = assertThrows(ApiException.class, action::run);
        assertEquals(code, exception.getCode());
    }

    @SuppressWarnings("unchecked")
    private static void assertFieldIssueContains(ApiException exception, String expected) {
        List<Map<String, String>> issues =
            (List<Map<String, String>>) exception.getDetails().get("fieldIssues");
        boolean matched = issues.stream().anyMatch(issue ->
            expected.equals(issue.get("field")) || expected.equals(issue.get("code"))
        );
        assertTrue(matched, () -> "expected field issue containing " + expected + " but was " + issues);
    }
}
