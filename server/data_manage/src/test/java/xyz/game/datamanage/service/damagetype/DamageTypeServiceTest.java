package xyz.game.datamanage.service.damagetype;

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
import xyz.game.datamanage.mapper.damagetype.DamageTypeMapper;
import xyz.game.datamanage.model.damagetype.DamageTypeCreateRequest;
import xyz.game.datamanage.model.damagetype.DamageTypeListQuery;
import xyz.game.datamanage.model.damagetype.DamageTypeResponse;
import xyz.game.datamanage.model.damagetype.DamageTypeStatus;
import xyz.game.datamanage.model.damagetype.DamageTypeUpdateRequest;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
class DamageTypeServiceTest {

    private static final String GAME_ID = "lol";
    private static final String KEY = "physical";

    @Mock private GamesMapper gamesMapper;
    @Mock private DamageTypeMapper mapper;

    private DamageTypeService service;

    @BeforeEach
    void setUp() {
        service = new DamageTypeService(gamesMapper, mapper, org.mockito.Mockito.mock(xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard.class));
        when(gamesMapper.countGames(GAME_ID)).thenReturn(1L);
    }

    @Test
    void listsWithNormalizedStatusAndStableTotal() {
        when(mapper.list(GAME_ID, "伤害", "ENABLED")).thenReturn(List.of(damageType()));

        var result = service.list(GAME_ID, new DamageTypeListQuery(" 伤害 ", " ENABLED "));

        assertEquals(1, result.total());
        assertEquals(KEY, result.items().getFirst().damageTypeKey());
    }

    @Test
    void rejectsInvalidQueryStatusBeforeMapperAccess() {
        assertCode(
            "400.VALIDATION_FAILED",
            () -> service.list(GAME_ID, new DamageTypeListQuery(null, "ARCHIVED"))
        );
        verify(mapper, never()).list(GAME_ID, null, null);
    }

    @Test
    void createsAndUpdatesFullEditableFields() {
        when(mapper.countByKey(GAME_ID, KEY)).thenReturn(0L);
        when(mapper.countByNormalizedName(GAME_ID, "物理伤害", null)).thenReturn(0L);
        when(mapper.insert(GAME_ID, KEY, "物理伤害", null, "ENABLED", 10)).thenReturn(1);
        when(mapper.findById(GAME_ID, KEY)).thenReturn(damageType());

        assertEquals(
            damageType(),
            service.create(
                GAME_ID,
                new DamageTypeCreateRequest(" physical ", " 物理伤害 ", " ", DamageTypeStatus.ENABLED, 10)
            )
        );

        when(mapper.findByIdForUpdate(GAME_ID, KEY)).thenReturn(damageType());
        when(mapper.countByNormalizedName(GAME_ID, "物理伤害改", KEY)).thenReturn(0L);
        when(mapper.update(GAME_ID, KEY, "物理伤害改", null, "DISABLED", 20)).thenReturn(1);
        when(mapper.findById(GAME_ID, KEY)).thenReturn(disabledDamageType());

        assertEquals(
            DamageTypeStatus.DISABLED,
            service.update(
                GAME_ID,
                KEY,
                new DamageTypeUpdateRequest(null, "物理伤害改", null, DamageTypeStatus.DISABLED, 20)
            ).status()
        );
    }

    @Test
    void mapsForeignKeyDeleteConflictToStableInUseError() {
        when(mapper.findByIdForUpdate(GAME_ID, KEY)).thenReturn(damageType());
        when(mapper.delete(GAME_ID, KEY)).thenThrow(
            new DataIntegrityViolationException("referenced", new SQLException("fk", "23503"))
        );

        assertCode("409.DAMAGE_TYPE_IN_USE", () -> service.delete(GAME_ID, KEY));
    }

    @Test
    void mapsSkillEffectDamageDetailForeignKeyToStableInUseError() {
        when(mapper.findByIdForUpdate(GAME_ID, KEY)).thenReturn(damageType());
        when(mapper.delete(GAME_ID, KEY)).thenThrow(
            new DataIntegrityViolationException(
                "fk_skill_effect_damage_details_damage_type",
                new SQLException("fk_skill_effect_damage_details_damage_type", "23503")
            )
        );

        assertCode("409.DAMAGE_TYPE_IN_USE", () -> service.delete(GAME_ID, KEY));
    }

    @Test
    void duplicateAndMissingErrorsAreStable() {
        when(mapper.countByKey(GAME_ID, KEY)).thenReturn(1L);
        assertCode(
            "409.DAMAGE_TYPE_KEY_EXISTS",
            () -> service.create(
                GAME_ID,
                new DamageTypeCreateRequest(KEY, "物理伤害", null, DamageTypeStatus.ENABLED, 10)
            )
        );

        when(mapper.findById(GAME_ID, "missing")).thenReturn(null);
        assertCode("404.DAMAGE_TYPE_NOT_FOUND", () -> service.get(GAME_ID, "missing"));
    }

    private static DamageTypeResponse damageType() {
        OffsetDateTime timestamp = OffsetDateTime.parse("2026-08-23T08:00:00Z");
        return new DamageTypeResponse(
            GAME_ID,
            KEY,
            "物理伤害",
            null,
            DamageTypeStatus.ENABLED,
            10,
            timestamp,
            timestamp
        );
    }

    private static DamageTypeResponse disabledDamageType() {
        DamageTypeResponse source = damageType();
        return new DamageTypeResponse(
            source.gameId(),
            source.damageTypeKey(),
            "物理伤害改",
            null,
            DamageTypeStatus.DISABLED,
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
