package xyz.game.datamanage.service.skillcategory;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
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
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.skillcategory.SkillCategoryMapper;
import xyz.game.datamanage.model.skillcategory.SkillCategoryCreateRequest;
import xyz.game.datamanage.model.skillcategory.SkillCategoryListQuery;
import xyz.game.datamanage.model.skillcategory.SkillCategoryResponse;
import xyz.game.datamanage.model.skillcategory.SkillCategoryStatus;
import xyz.game.datamanage.model.skillcategory.SkillCategoryUpdateRequest;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
class SkillCategoryServiceTest {

    private static final String GAME_ID = "lol";
    private static final String KEY = "active";

    @Mock private GamesMapper gamesMapper;
    @Mock private SkillCategoryMapper mapper;

    private SkillCategoryService service;

    @BeforeEach
    void setUp() {
        service = new SkillCategoryService(gamesMapper, mapper);
        when(gamesMapper.countGames(GAME_ID)).thenReturn(1L);
    }

    @Test
    void listsWithNormalizedStatusAndStableTotal() {
        when(mapper.list(GAME_ID, "技能", "DISABLED")).thenReturn(List.of(category()));

        var result = service.list(GAME_ID, new SkillCategoryListQuery(" 技能 ", " DISABLED "));

        assertEquals(1, result.total());
        assertEquals(KEY, result.items().getFirst().skillCategoryKey());
    }

    @Test
    void rejectsInvalidQueryStatusBeforeMapperAccess() {
        assertCode(
            "400.VALIDATION_FAILED",
            () -> service.list(GAME_ID, new SkillCategoryListQuery(null, "ARCHIVED"))
        );
        verify(mapper, never()).list(GAME_ID, null, null);
    }

    @Test
    void createsAndUpdatesFullEditableFields() {
        when(mapper.countByKey(GAME_ID, KEY)).thenReturn(0L);
        when(mapper.countByNormalizedName(GAME_ID, "主动技能", null)).thenReturn(0L);
        when(mapper.insert(GAME_ID, KEY, "主动技能", null, "ENABLED", 10)).thenReturn(1);
        when(mapper.findById(GAME_ID, KEY)).thenReturn(category());

        assertEquals(
            category(),
            service.create(
                GAME_ID,
                new SkillCategoryCreateRequest(" active ", " 主动技能 ", " ", SkillCategoryStatus.ENABLED, 10)
            )
        );

        when(mapper.findByIdForUpdate(GAME_ID, KEY)).thenReturn(category());
        when(mapper.countByNormalizedName(GAME_ID, "主动技能改", KEY)).thenReturn(0L);
        when(mapper.update(GAME_ID, KEY, "主动技能改", null, "DISABLED", 20)).thenReturn(1);
        when(mapper.findById(GAME_ID, KEY)).thenReturn(disabledCategory());

        assertEquals(
            SkillCategoryStatus.DISABLED,
            service.update(
                GAME_ID,
                KEY,
                new SkillCategoryUpdateRequest(null, "主动技能改", null, SkillCategoryStatus.DISABLED, 20)
            ).status()
        );
    }

    @Test
    void mapsForeignKeyDeleteConflictToStableInUseError() {
        when(mapper.findByIdForUpdate(GAME_ID, KEY)).thenReturn(category());
        when(mapper.delete(GAME_ID, KEY)).thenThrow(
            new DataIntegrityViolationException("referenced", new SQLException("fk", "23503"))
        );

        assertCode("409.SKILL_CATEGORY_IN_USE", () -> service.delete(GAME_ID, KEY));
    }

    @Test
    void duplicateAndMissingErrorsAreStable() {
        when(mapper.countByKey(GAME_ID, KEY)).thenReturn(1L);
        assertCode(
            "409.SKILL_CATEGORY_KEY_EXISTS",
            () -> service.create(
                GAME_ID,
                new SkillCategoryCreateRequest(KEY, "主动技能", null, SkillCategoryStatus.ENABLED, 10)
            )
        );

        when(mapper.findById(GAME_ID, "missing")).thenReturn(null);
        assertCode("404.SKILL_CATEGORY_NOT_FOUND", () -> service.get(GAME_ID, "missing"));
    }

    private static SkillCategoryResponse category() {
        OffsetDateTime timestamp = OffsetDateTime.parse("2026-08-23T08:00:00Z");
        return new SkillCategoryResponse(
            GAME_ID,
            KEY,
            "主动技能",
            null,
            SkillCategoryStatus.ENABLED,
            10,
            timestamp,
            timestamp
        );
    }

    private static SkillCategoryResponse disabledCategory() {
        SkillCategoryResponse source = category();
        return new SkillCategoryResponse(
            source.gameId(),
            source.skillCategoryKey(),
            "主动技能改",
            null,
            SkillCategoryStatus.DISABLED,
            20,
            source.createdAt(),
            source.updatedAt()
        );
    }

    private static void assertCode(String code, Runnable action) {
        ApiException exception = assertThrows(ApiException.class, action::run);
        assertEquals(code, exception.getCode());
    }
}
