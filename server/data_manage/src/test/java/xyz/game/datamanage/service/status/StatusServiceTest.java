package xyz.game.datamanage.service.status;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.DuplicateKeyException;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.status.StatusMapper;
import xyz.game.datamanage.model.status.StatusCreateRequest;
import xyz.game.datamanage.model.status.StatusListQuery;
import xyz.game.datamanage.model.status.StatusRecordStatus;
import xyz.game.datamanage.model.status.StatusResponse;
import xyz.game.datamanage.model.status.StatusUpdateRequest;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
class StatusServiceTest {

    private static final String GAME_ID = "lol";
    private static final String KEY = "poison";

    @Mock private GamesMapper gamesMapper;
    @Mock private StatusMapper mapper;

    private StatusService service;

    @BeforeEach
    void setUp() {
        service = new StatusService(gamesMapper, mapper);
        lenient().when(gamesMapper.countGames(GAME_ID)).thenReturn(1L);
    }

    @Test
    void listsWithNormalizedKeywordStatusAndStableTotal() {
        when(mapper.list(GAME_ID, "毒", "ENABLED")).thenReturn(List.of(status()));

        var result = service.list(GAME_ID, new StatusListQuery(" 毒 ", " ENABLED "));

        assertEquals(1, result.total());
        assertEquals(KEY, result.items().getFirst().statusKey());
        assertEquals(StatusRecordStatus.ENABLED, result.items().getFirst().status());
    }

    @Test
    void emptyKeywordAndStatusAreOmittedAndEmptyMapperResultIsStable() {
        when(mapper.list(GAME_ID, null, null)).thenReturn(List.of());

        var result = service.list(GAME_ID, new StatusListQuery("  ", " "));

        assertEquals(0, result.total());
        assertEquals(List.of(), result.items());
        verify(mapper).list(GAME_ID, null, null);
    }

    @Test
    void rejectsInvalidQueryStatusBeforeMapperAccess() {
        assertCode(
            "400.VALIDATION_FAILED",
            () -> service.list(GAME_ID, new StatusListQuery(null, "ARCHIVED"))
        );
        verify(mapper, never()).list(GAME_ID, null, null);
    }

    @Test
    void createsAndUpdatesFullEditableFieldsIncludingDisable() {
        when(mapper.countByKey(GAME_ID, KEY)).thenReturn(0L);
        when(mapper.countByNormalizedName(GAME_ID, "中毒", null)).thenReturn(0L);
        when(mapper.insert(GAME_ID, KEY, "中毒", null, "ENABLED", 10)).thenReturn(1);
        when(mapper.findById(GAME_ID, KEY)).thenReturn(status());

        assertEquals(
            status(),
            service.create(
                GAME_ID,
                new StatusCreateRequest(" poison ", " 中毒 ", " ", StatusRecordStatus.ENABLED, 10)
            )
        );

        when(mapper.findByIdForUpdate(GAME_ID, KEY)).thenReturn(status());
        when(mapper.countByNormalizedName(GAME_ID, "中毒改", KEY)).thenReturn(0L);
        when(mapper.update(GAME_ID, KEY, "中毒改", null, "DISABLED", 0)).thenReturn(1);
        when(mapper.findById(GAME_ID, KEY)).thenReturn(disabledStatus());

        assertEquals(
            StatusRecordStatus.DISABLED,
            service.update(
                GAME_ID,
                KEY,
                new StatusUpdateRequest(null, "中毒改", null, StatusRecordStatus.DISABLED, 0)
            ).status()
        );
        assertEquals(0, disabledStatus().sortOrder());
    }

    @Test
    void rejectsNonNullStatusKeyOnUpdate() {
        assertCode(
            "400.VALIDATION_FAILED",
            () -> service.update(
                GAME_ID,
                KEY,
                new StatusUpdateRequest(KEY, "中毒", null, StatusRecordStatus.ENABLED, 10)
            )
        );
        verify(mapper, never()).findByIdForUpdate(GAME_ID, KEY);
        verify(mapper, never()).update(GAME_ID, KEY, "中毒", null, "ENABLED", 10);
    }

    @Test
    void duplicateAndMissingErrorsAreStable() {
        when(mapper.countByKey(GAME_ID, KEY)).thenReturn(1L);
        assertCode(
            "409.STATUS_KEY_EXISTS",
            () -> service.create(
                GAME_ID,
                new StatusCreateRequest(KEY, "中毒", null, StatusRecordStatus.ENABLED, 10)
            )
        );

        when(mapper.countByKey(GAME_ID, "other")).thenReturn(0L);
        when(mapper.countByNormalizedName(GAME_ID, "中毒", null)).thenReturn(1L);
        assertCode(
            "409.STATUS_NAME_EXISTS",
            () -> service.create(
                GAME_ID,
                new StatusCreateRequest("other", "中毒", null, StatusRecordStatus.ENABLED, 10)
            )
        );

        when(mapper.findById(GAME_ID, "missing")).thenReturn(null);
        assertCode("404.STATUS_NOT_FOUND", () -> service.get(GAME_ID, "missing"));

        when(mapper.findByIdForUpdate(GAME_ID, "missing")).thenReturn(null);
        assertCode(
            "404.STATUS_NOT_FOUND",
            () -> service.update(
                GAME_ID,
                "missing",
                new StatusUpdateRequest(null, "中毒", null, StatusRecordStatus.ENABLED, 10)
            )
        );
        assertCode("404.STATUS_NOT_FOUND", () -> service.delete(GAME_ID, "missing"));
    }

    @Test
    void concurrentConstraintViolationsMapWithoutLeakingConstraintText() {
        when(mapper.countByKey(GAME_ID, KEY)).thenReturn(0L);
        when(mapper.countByNormalizedName(GAME_ID, "中毒", null)).thenReturn(0L);
        when(mapper.insert(GAME_ID, KEY, "中毒", null, "ENABLED", 10))
            .thenThrow(new DuplicateKeyException(
                "duplicate key value violates unique constraint \"pk_statuses\""
            ))
            .thenThrow(new DuplicateKeyException(
                "duplicate key value violates unique constraint \"uq_statuses_name\""
            ));
        ApiException key = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID,
                new StatusCreateRequest(KEY, "中毒", null, StatusRecordStatus.ENABLED, 10)
            )
        );
        assertEquals("409.STATUS_KEY_EXISTS", key.getCode());
        assertFalse(key.getMessage().contains("pk_statuses"));

        ApiException name = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID,
                new StatusCreateRequest(KEY, "中毒", null, StatusRecordStatus.ENABLED, 10)
            )
        );
        assertEquals("409.STATUS_NAME_EXISTS", name.getCode());
        assertFalse(name.getDetails().toString().contains("uq_statuses_name"));
    }

    @Test
    void mapsForeignKeyDeleteConflictToStableInUseError() {
        when(mapper.findByIdForUpdate(GAME_ID, KEY)).thenReturn(status());
        when(mapper.delete(GAME_ID, KEY)).thenThrow(
            new DataIntegrityViolationException("referenced", new SQLException("fk", "23503"))
        );

        assertCode("409.STATUS_IN_USE", () -> service.delete(GAME_ID, KEY));
    }

    @Test
    void otherDeleteIntegrityViolationsAreNotMappedToInUse() {
        when(mapper.findByIdForUpdate(GAME_ID, KEY)).thenReturn(status());
        DataIntegrityViolationException other = new DataIntegrityViolationException(
            "check",
            new SQLException("ck", "23514")
        );
        when(mapper.delete(GAME_ID, KEY)).thenThrow(other);

        DataIntegrityViolationException thrown = assertThrows(
            DataIntegrityViolationException.class,
            () -> service.delete(GAME_ID, KEY)
        );
        assertInstanceOf(SQLException.class, thrown.getCause());
    }

    @Test
    void nonexistentGameWinsForAllOperations() {
        when(gamesMapper.countGames("missing")).thenReturn(0L);

        assertCode("404.GAME_NOT_FOUND", () -> service.list("missing", new StatusListQuery(null, null)));
        assertCode("404.GAME_NOT_FOUND", () -> service.get("missing", KEY));
        assertCode(
            "404.GAME_NOT_FOUND",
            () -> service.create(
                "missing",
                new StatusCreateRequest(KEY, "中毒", null, StatusRecordStatus.ENABLED, 10)
            )
        );
        assertCode(
            "404.GAME_NOT_FOUND",
            () -> service.update(
                "missing",
                KEY,
                new StatusUpdateRequest(null, "中毒", null, StatusRecordStatus.ENABLED, 10)
            )
        );
        assertCode("404.GAME_NOT_FOUND", () -> service.delete("missing", KEY));
        verifyNoInteractions(mapper);
    }

    private static StatusResponse status() {
        OffsetDateTime timestamp = OffsetDateTime.parse("2026-08-27T00:00:00Z");
        return new StatusResponse(
            GAME_ID,
            KEY,
            "中毒",
            null,
            StatusRecordStatus.ENABLED,
            10,
            timestamp,
            timestamp
        );
    }

    private static StatusResponse disabledStatus() {
        StatusResponse source = status();
        return new StatusResponse(
            source.gameId(),
            source.statusKey(),
            "中毒改",
            null,
            StatusRecordStatus.DISABLED,
            0,
            source.createdAt(),
            source.updatedAt()
        );
    }

    private static void assertCode(String code, Runnable action) {
        ApiException exception = assertThrows(ApiException.class, action::run);
        assertEquals(code, exception.getCode());
    }
}
