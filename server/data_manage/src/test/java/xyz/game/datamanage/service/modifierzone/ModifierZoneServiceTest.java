package xyz.game.datamanage.service.modifierzone;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.OffsetDateTime;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.modifierzone.ModifierZoneMapper;
import xyz.game.datamanage.model.modifierzone.ModifierZoneApplicationStage;
import xyz.game.datamanage.model.modifierzone.ModifierZoneCalculationMode;
import xyz.game.datamanage.model.modifierzone.ModifierZoneCreateRequest;
import xyz.game.datamanage.model.modifierzone.ModifierZoneDomain;
import xyz.game.datamanage.model.modifierzone.ModifierZoneListQuery;
import xyz.game.datamanage.model.modifierzone.ModifierZoneResponse;
import xyz.game.datamanage.model.modifierzone.ModifierZoneStatus;
import xyz.game.datamanage.model.modifierzone.ModifierZoneUpdateRequest;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
class ModifierZoneServiceTest {

    private static final String GAME_ID = "lol";
    private static final String KEY = "damage_pre_defense";

    @Mock private GamesMapper gamesMapper;
    @Mock private ModifierZoneMapper mapper;

    private ModifierZoneService service;

    @BeforeEach
    void setUp() {
        service = new ModifierZoneService(gamesMapper, mapper, org.mockito.Mockito.mock(xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard.class));
        when(gamesMapper.countGames(GAME_ID)).thenReturn(1L);
    }

    @Test
    void shieldReferencesBlockDeletionAndStructuralChanges() {
        when(mapper.findByIdForUpdate(GAME_ID, KEY)).thenReturn(zone());
        when(mapper.countShieldReceivedReferences(GAME_ID, KEY)).thenReturn(1L);
        assertCode("409.MODIFIER_ZONE_IN_USE", () -> service.delete(GAME_ID, KEY));
        assertCode("409.MODIFIER_ZONE_IN_USE", () -> service.update(GAME_ID, KEY,
            update(ModifierZoneDomain.SHIELD, ModifierZoneCalculationMode.RATIO_ADD,
                ModifierZoneApplicationStage.SHIELD_RESULT, ModifierZoneStatus.ENABLED)));
        verify(mapper, never()).delete(GAME_ID, KEY);
    }

    @Test
    void shieldDomainRejectsHealingStageAndFlatMode() {
        for (ModifierZoneCalculationMode mode : ModifierZoneCalculationMode.values()) {
            assertCode("400.VALIDATION_FAILED", () -> service.create(GAME_ID,
                new ModifierZoneCreateRequest(KEY, "错误护盾组合", ModifierZoneDomain.SHIELD,
                    mode, ModifierZoneApplicationStage.HEALING_RESULT, null, ModifierZoneStatus.ENABLED, 0)));
        }
        assertCode("400.VALIDATION_FAILED", () -> service.create(GAME_ID,
            new ModifierZoneCreateRequest(KEY, "错误护盾组合", ModifierZoneDomain.SHIELD,
                ModifierZoneCalculationMode.FLAT_ADD, ModifierZoneApplicationStage.SHIELD_RESULT,
                null, ModifierZoneStatus.ENABLED, 0)));
    }

    @Test
    void listsWithNormalizedDomainAndStatus() {
        when(mapper.list(GAME_ID, "伤害", "DAMAGE", "ENABLED")).thenReturn(List.of(zone()));

        var result = service.list(
            GAME_ID,
            new ModifierZoneListQuery(" 伤害 ", " DAMAGE ", " ENABLED ")
        );

        assertEquals(1, result.total());
        assertEquals(KEY, result.items().getFirst().modifierZoneKey());
    }

    @Test
    void rejectsInvalidCombinationBeforeWrite() {
        assertCode(
            "400.VALIDATION_FAILED",
            () -> service.create(
                GAME_ID,
                new ModifierZoneCreateRequest(
                    KEY,
                    "错误组合",
                    ModifierZoneDomain.DAMAGE,
                    ModifierZoneCalculationMode.FLAT_ADD,
                    ModifierZoneApplicationStage.DAMAGE_PRE_DEFENSE,
                    null,
                    ModifierZoneStatus.ENABLED,
                    0
                )
            )
        );
        verify(mapper, never()).insert(
            GAME_ID, KEY, "错误组合", "DAMAGE", "FLAT_ADD",
            "DAMAGE_PRE_DEFENSE", null, "ENABLED", 0
        );
    }

    @Test
    void createsValidZone() {
        when(mapper.countByKey(GAME_ID, KEY)).thenReturn(0L);
        when(mapper.countByNormalizedName(GAME_ID, "伤害前修正", null)).thenReturn(0L);
        when(mapper.insert(
            GAME_ID, KEY, "伤害前修正", "DAMAGE", "RATIO_ADD",
            "DAMAGE_PRE_DEFENSE", null, "ENABLED", 10
        )).thenReturn(1);
        when(mapper.findById(GAME_ID, KEY)).thenReturn(zone());

        ModifierZoneResponse created = service.create(
            GAME_ID,
            new ModifierZoneCreateRequest(
                " damage_pre_defense ",
                " 伤害前修正 ",
                ModifierZoneDomain.DAMAGE,
                ModifierZoneCalculationMode.RATIO_ADD,
                ModifierZoneApplicationStage.DAMAGE_PRE_DEFENSE,
                " ",
                ModifierZoneStatus.ENABLED,
                10
            )
        );

        assertEquals(KEY, created.modifierZoneKey());
    }

    @Test
    void referencedZoneCanBeDisabledButCannotChangeStructure() {
        when(mapper.findByIdForUpdate(GAME_ID, KEY)).thenReturn(zone());
        when(mapper.countAttributeReferences(GAME_ID, KEY)).thenReturn(0L);
        when(mapper.countDamageReferences(GAME_ID, KEY)).thenReturn(1L);
        when(mapper.countHealingReferences(GAME_ID, KEY)).thenReturn(0L);
        when(mapper.countByNormalizedName(GAME_ID, "伤害前修正", KEY)).thenReturn(0L);
        when(mapper.update(
            GAME_ID, KEY, "伤害前修正", "DAMAGE", "RATIO_ADD",
            "DAMAGE_PRE_DEFENSE", null, "DISABLED", 10
        )).thenReturn(1);
        when(mapper.findById(GAME_ID, KEY)).thenReturn(disabledZone());

        assertEquals(
            ModifierZoneStatus.DISABLED,
            service.update(GAME_ID, KEY, update(
                ModifierZoneDomain.DAMAGE,
                ModifierZoneCalculationMode.RATIO_ADD,
                ModifierZoneApplicationStage.DAMAGE_PRE_DEFENSE,
                ModifierZoneStatus.DISABLED
            )).status()
        );

        assertCode(
            "409.MODIFIER_ZONE_IN_USE",
            () -> service.update(GAME_ID, KEY, update(
                ModifierZoneDomain.DAMAGE,
                ModifierZoneCalculationMode.RATIO_ADD,
                ModifierZoneApplicationStage.DAMAGE_POST_DEFENSE,
                ModifierZoneStatus.ENABLED
            ))
        );
    }

    @Test
    void referencedZoneCannotBeDeleted() {
        when(mapper.findByIdForUpdate(GAME_ID, KEY)).thenReturn(zone());
        when(mapper.countDamageReferences(GAME_ID, KEY)).thenReturn(1L);

        assertCode("409.MODIFIER_ZONE_IN_USE", () -> service.delete(GAME_ID, KEY));
        verify(mapper, never()).delete(GAME_ID, KEY);
    }

    private static ModifierZoneUpdateRequest update(
        ModifierZoneDomain domain,
        ModifierZoneCalculationMode mode,
        ModifierZoneApplicationStage stage,
        ModifierZoneStatus status
    ) {
        return new ModifierZoneUpdateRequest(
            null,
            "伤害前修正",
            domain,
            mode,
            stage,
            null,
            status,
            10
        );
    }

    private static ModifierZoneResponse zone() {
        OffsetDateTime timestamp = OffsetDateTime.parse("2026-08-31T00:00:00Z");
        return new ModifierZoneResponse(
            GAME_ID,
            KEY,
            "伤害前修正",
            ModifierZoneDomain.DAMAGE,
            ModifierZoneCalculationMode.RATIO_ADD,
            ModifierZoneApplicationStage.DAMAGE_PRE_DEFENSE,
            null,
            ModifierZoneStatus.ENABLED,
            10,
            timestamp,
            timestamp
        );
    }

    private static ModifierZoneResponse disabledZone() {
        ModifierZoneResponse source = zone();
        return new ModifierZoneResponse(
            source.gameId(),
            source.modifierZoneKey(),
            source.name(),
            source.domain(),
            source.calculationMode(),
            source.applicationStage(),
            source.description(),
            ModifierZoneStatus.DISABLED,
            source.sortOrder(),
            source.createdAt(),
            source.updatedAt()
        );
    }

    private static void assertCode(String code, Runnable action) {
        ApiException exception = assertThrows(ApiException.class, action::run);
        assertEquals(code, exception.getCode());
    }
}
