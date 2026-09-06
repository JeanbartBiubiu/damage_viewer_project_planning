package xyz.game.datamanage.service.attribute;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.transaction.annotation.Transactional;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.attribute.AttributeMapper;
import xyz.game.datamanage.model.attribute.AttributeCreateRequest;
import xyz.game.datamanage.model.attribute.AttributeListQuery;
import xyz.game.datamanage.model.attribute.AttributeListResponse;
import xyz.game.datamanage.model.attribute.AttributeResponse;
import xyz.game.datamanage.model.attribute.AttributeStatus;
import xyz.game.datamanage.model.attribute.AttributeUpdateRequest;
import xyz.game.datamanage.model.attribute.AttributeValueType;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
class AttributeServiceTest {

    private static final String GAME_ID = "lol";
    private static final String ATTRIBUTE_KEY = "move_speed";

    @Mock private GamesMapper gamesMapper;
    @Mock private AttributeMapper mapper;

    private AttributeService service;

    @BeforeEach
    void setUp() {
        service = new AttributeService(gamesMapper, mapper, org.mockito.Mockito.mock(xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard.class));
        lenient().when(gamesMapper.countGames(GAME_ID)).thenReturn(1L);
    }

    @Test
    void listNormalizesQueryAndReturnsAllRowsWithTotal() {
        when(mapper.list(GAME_ID, "speed", "ENABLED"))
            .thenReturn(List.of(enabledAttribute()));

        AttributeListResponse response = service.list(
            GAME_ID,
            new AttributeListQuery("  speed  ", "  ENABLED  ")
        );

        assertEquals(1, response.total());
        assertEquals(List.of(enabledAttribute()), response.items());
        verify(mapper).list(GAME_ID, "speed", "ENABLED");

        when(mapper.list(GAME_ID, null, null)).thenReturn(List.of());
        AttributeListResponse empty = service.list(GAME_ID, new AttributeListQuery("  ", ""));
        assertEquals(0, empty.total());
        verify(mapper).list(GAME_ID, null, null);
    }

    @Test
    void listRejectsIllegalStatusWithStableFieldIssue() {
        ApiException ex = assertThrows(
            ApiException.class,
            () -> service.list(GAME_ID, new AttributeListQuery(null, "ARCHIVED"))
        );

        assertValidationField(ex, "status");
        verify(mapper, never()).list(eq(GAME_ID), isNull(), eq("ARCHIVED"));
    }

    @Test
    void getsAttributeAndReturnsStableNotFoundWhenItDoesNotExist() {
        when(mapper.findById(GAME_ID, ATTRIBUTE_KEY)).thenReturn(enabledAttribute());
        assertEquals(enabledAttribute(), service.get(GAME_ID, ATTRIBUTE_KEY));

        when(mapper.findById(GAME_ID, "missing")).thenReturn(null);
        ApiException ex = assertThrows(ApiException.class, () -> service.get(GAME_ID, "missing"));
        assertEquals("404.ATTRIBUTE_NOT_FOUND", ex.getCode());
    }

    @Test
    void createsNormalizedAttributeAndReadsBackTheStoredRow() {
        AttributeCreateRequest request = new AttributeCreateRequest(
            ATTRIBUTE_KEY,
            "  移动速度  ",
            AttributeValueType.DECIMAL,
            BigDecimal.ZERO,
            new BigDecimal("1000"),
            "  角色面板移动速度  ",
            AttributeStatus.ENABLED,
            100
        );
        when(mapper.countByKey(GAME_ID, ATTRIBUTE_KEY)).thenReturn(0L);
        when(mapper.countByNormalizedName(GAME_ID, "移动速度", null)).thenReturn(0L);
        when(mapper.insert(
            GAME_ID,
            ATTRIBUTE_KEY,
            "移动速度",
            "DECIMAL",
            BigDecimal.ZERO,
            new BigDecimal("1000"),
            "角色面板移动速度",
            "ENABLED",
            100
        )).thenReturn(1);
        when(mapper.findById(GAME_ID, ATTRIBUTE_KEY)).thenReturn(enabledAttribute());

        assertEquals(enabledAttribute(), service.create(GAME_ID, request));

        verify(mapper).insert(
            GAME_ID,
            ATTRIBUTE_KEY,
            "移动速度",
            "DECIMAL",
            BigDecimal.ZERO,
            new BigDecimal("1000"),
            "角色面板移动速度",
            "ENABLED",
            100
        );
    }

    @Test
    void createMapsKeyAndNormalizedNamePrecheckToDistinctStableConflicts() {
        AttributeCreateRequest request = createRequest("移动速度");
        when(mapper.countByKey(GAME_ID, ATTRIBUTE_KEY)).thenReturn(1L);

        ApiException key = assertThrows(ApiException.class, () -> service.create(GAME_ID, request));
        assertEquals("409.ATTRIBUTE_KEY_EXISTS", key.getCode());
        verify(mapper, never()).insert(
            eq(GAME_ID),
            eq(ATTRIBUTE_KEY),
            eq("移动速度"),
            eq("DECIMAL"),
            isNull(),
            isNull(),
            isNull(),
            eq("ENABLED"),
            eq(100)
        );

        when(mapper.countByKey(GAME_ID, ATTRIBUTE_KEY)).thenReturn(0L);
        when(mapper.countByNormalizedName(GAME_ID, "移动速度", null)).thenReturn(1L);
        ApiException name = assertThrows(ApiException.class, () -> service.create(GAME_ID, request));
        assertEquals("409.ATTRIBUTE_NAME_EXISTS", name.getCode());
    }

    @Test
    void databasePrimaryKeyConstraintMapsToStableConflictWithoutLeakingConstraintText() {
        stubCreatePrechecks();
        when(mapper.insert(
            GAME_ID,
            ATTRIBUTE_KEY,
            "移动速度",
            "DECIMAL",
            null,
            null,
            null,
            "ENABLED",
            100
        )).thenThrow(constraintViolation("pk_attributes"));

        ApiException ex = assertThrows(
            ApiException.class,
            () -> service.create(GAME_ID, createRequest("移动速度"))
        );
        assertSafeConstraintMapping(ex, "409.ATTRIBUTE_KEY_EXISTS", "pk_attributes");
    }

    @Test
    void databaseNormalizedNameConstraintMapsToStableConflictWithoutLeakingConstraintText() {
        stubCreatePrechecks();
        when(mapper.insert(
            GAME_ID,
            ATTRIBUTE_KEY,
            "移动速度",
            "DECIMAL",
            null,
            null,
            null,
            "ENABLED",
            100
        )).thenThrow(constraintViolation("uq_attributes_name"));

        ApiException ex = assertThrows(
            ApiException.class,
            () -> service.create(GAME_ID, createRequest("移动速度"))
        );
        assertSafeConstraintMapping(ex, "409.ATTRIBUTE_NAME_EXISTS", "uq_attributes_name");
    }

    @Test
    void fullPutLocksTargetClearsNullableColumnsAndCanDisableAttribute() {
        AttributeResponse current = enabledAttribute();
        AttributeResponse disabled = disabledAttribute();
        when(mapper.findByIdForUpdate(GAME_ID, ATTRIBUTE_KEY)).thenReturn(current);
        when(mapper.countByNormalizedName(GAME_ID, "移动速度", ATTRIBUTE_KEY)).thenReturn(0L);
        when(mapper.update(
            GAME_ID,
            ATTRIBUTE_KEY,
            "移动速度",
            "DECIMAL",
            null,
            null,
            null,
            "DISABLED",
            20
        )).thenReturn(1);
        when(mapper.findById(GAME_ID, ATTRIBUTE_KEY)).thenReturn(disabled);

        AttributeUpdateRequest request = new AttributeUpdateRequest(
            null,
            "  移动速度  ",
            AttributeValueType.DECIMAL,
            null,
            null,
            "   ",
            AttributeStatus.DISABLED,
            20
        );

        assertEquals(disabled, service.update(GAME_ID, ATTRIBUTE_KEY, request));
        verify(mapper).findByIdForUpdate(GAME_ID, ATTRIBUTE_KEY);
        verify(mapper).update(
            GAME_ID,
            ATTRIBUTE_KEY,
            "移动速度",
            "DECIMAL",
            null,
            null,
            null,
            "DISABLED",
            20
        );
    }

    @Test
    void updateRejectsMissingAttributeAndNameConflictBeforeWriting() {
        AttributeUpdateRequest request = updateRequest();
        when(mapper.findByIdForUpdate(GAME_ID, "missing")).thenReturn(null);

        ApiException missing = assertThrows(
            ApiException.class,
            () -> service.update(GAME_ID, "missing", request)
        );
        assertEquals("404.ATTRIBUTE_NOT_FOUND", missing.getCode());

        when(mapper.findByIdForUpdate(GAME_ID, ATTRIBUTE_KEY)).thenReturn(enabledAttribute());
        when(mapper.countByNormalizedName(GAME_ID, "移动速度", ATTRIBUTE_KEY)).thenReturn(1L);
        ApiException conflict = assertThrows(
            ApiException.class,
            () -> service.update(GAME_ID, ATTRIBUTE_KEY, request)
        );
        assertEquals("409.ATTRIBUTE_NAME_EXISTS", conflict.getCode());

        verify(mapper, never()).update(
            eq(GAME_ID),
            eq(ATTRIBUTE_KEY),
            eq("移动速度"),
            eq("DECIMAL"),
            isNull(),
            isNull(),
            isNull(),
            eq("ENABLED"),
            eq(100)
        );
    }

    @Test
    void rangeViolationUsesValidationErrorLocatedAtMaxValue() {
        AttributeCreateRequest request = new AttributeCreateRequest(
            ATTRIBUTE_KEY,
            "移动速度",
            AttributeValueType.DECIMAL,
            BigDecimal.TEN,
            BigDecimal.ONE,
            null,
            AttributeStatus.ENABLED,
            100
        );

        ApiException ex = assertThrows(ApiException.class, () -> service.create(GAME_ID, request));
        assertValidationField(ex, "maxValue");
        verify(mapper, never()).insert(
            eq(GAME_ID),
            eq(ATTRIBUTE_KEY),
            eq("移动速度"),
            eq("DECIMAL"),
            eq(BigDecimal.TEN),
            eq(BigDecimal.ONE),
            isNull(),
            eq("ENABLED"),
            eq(100)
        );
    }

    @Test
    void nonexistentGameWinsForListDetailCreateAndUpdate() {
        when(gamesMapper.countGames("missing")).thenReturn(0L);

        assertGameNotFound(() -> service.list("missing", new AttributeListQuery(null, null)));
        assertGameNotFound(() -> service.get("missing", ATTRIBUTE_KEY));
        assertGameNotFound(() -> service.create("missing", createRequest("移动速度")));
        assertGameNotFound(() -> service.update("missing", ATTRIBUTE_KEY, updateRequest()));

        verifyNoInteractions(mapper);
    }

    @Test
    void exposesFrozenReadOnlyAndWriteTransactionBoundaries() throws NoSuchMethodException {
        Transactional list = AttributeService.class
            .getMethod("list", String.class, AttributeListQuery.class)
            .getAnnotation(Transactional.class);
        Transactional get = AttributeService.class
            .getMethod("get", String.class, String.class)
            .getAnnotation(Transactional.class);
        Transactional create = AttributeService.class
            .getMethod("create", String.class, AttributeCreateRequest.class)
            .getAnnotation(Transactional.class);
        Transactional update = AttributeService.class
            .getMethod("update", String.class, String.class, AttributeUpdateRequest.class)
            .getAnnotation(Transactional.class);

        assertNotNull(list);
        assertNotNull(get);
        assertNotNull(create);
        assertNotNull(update);
        assertTrue(list.readOnly(), "list transaction must be read-only");
        assertTrue(get.readOnly(), "detail transaction must be read-only");
        assertFalse(create.readOnly(), "create transaction must be writable");
        assertFalse(update.readOnly(), "update transaction must be writable");
    }

    private void stubCreatePrechecks() {
        when(mapper.countByKey(GAME_ID, ATTRIBUTE_KEY)).thenReturn(0L);
        when(mapper.countByNormalizedName(GAME_ID, "移动速度", null)).thenReturn(0L);
    }

    private static void assertGameNotFound(ThrowingAction action) {
        ApiException ex = assertThrows(ApiException.class, action::run);
        assertEquals("404.GAME_NOT_FOUND", ex.getCode());
    }

    private static void assertValidationField(ApiException ex, String field) {
        assertEquals("400.VALIDATION_FAILED", ex.getCode());
        Object rawIssues = ex.getDetails().get("fieldIssues");
        assertTrue(rawIssues instanceof List<?>, () -> "fieldIssues must be a list: " + ex.getDetails());
        boolean found = ((List<?>) rawIssues).stream()
            .filter(Map.class::isInstance)
            .map(Map.class::cast)
            .anyMatch(issue -> field.equals(issue.get("field")));
        assertTrue(found, () -> "missing field issue for " + field + ": " + rawIssues);
    }

    private static void assertSafeConstraintMapping(
        ApiException ex, String expectedCode, String forbiddenConstraint) {
        assertEquals(expectedCode, ex.getCode());
        assertFalse(ex.getMessage().contains(forbiddenConstraint));
        assertFalse(ex.getDetails().toString().contains(forbiddenConstraint));
    }

    private static DuplicateKeyException constraintViolation(String constraint) {
        return new DuplicateKeyException(
            "duplicate key value violates unique constraint \"" + constraint + "\""
        );
    }

    private static AttributeCreateRequest createRequest(String name) {
        return new AttributeCreateRequest(
            ATTRIBUTE_KEY,
            name,
            AttributeValueType.DECIMAL,
            null,
            null,
            null,
            AttributeStatus.ENABLED,
            100
        );
    }

    private static AttributeUpdateRequest updateRequest() {
        return new AttributeUpdateRequest(
            null,
            "移动速度",
            AttributeValueType.DECIMAL,
            null,
            null,
            null,
            AttributeStatus.ENABLED,
            100
        );
    }

    private static AttributeResponse enabledAttribute() {
        OffsetDateTime created = OffsetDateTime.parse("2026-08-22T09:00:00Z");
        return new AttributeResponse(
            GAME_ID,
            ATTRIBUTE_KEY,
            "移动速度",
            AttributeValueType.DECIMAL,
            BigDecimal.ZERO,
            new BigDecimal("1000"),
            "角色面板移动速度",
            AttributeStatus.ENABLED,
            100,
            created,
            created
        );
    }

    private static AttributeResponse disabledAttribute() {
        return new AttributeResponse(
            GAME_ID,
            ATTRIBUTE_KEY,
            "移动速度",
            AttributeValueType.DECIMAL,
            null,
            null,
            null,
            AttributeStatus.DISABLED,
            20,
            OffsetDateTime.parse("2026-08-22T09:00:00Z"),
            OffsetDateTime.parse("2026-08-22T10:00:00Z")
        );
    }

    @FunctionalInterface
    private interface ThrowingAction {
        void run();
    }
}
