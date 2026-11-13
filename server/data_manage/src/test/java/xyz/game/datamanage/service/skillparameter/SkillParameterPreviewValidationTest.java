package xyz.game.datamanage.service.skillparameter;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.skill.SkillMapper;
import xyz.game.datamanage.mapper.skillparameter.SkillParameterMapper;
import xyz.game.datamanage.model.character.LevelConfigResponse;
import xyz.game.datamanage.model.skillparameter.SkillParameterCreateRequest;
import xyz.game.datamanage.model.skillparameter.SkillParameterUpdateRequest;
import xyz.game.datamanage.model.skillparameter.SkillParameterValueMode;
import xyz.game.datamanage.model.skillparameter.SkillParameterValueType;
import xyz.game.datamanage.service.skilltrigger.reference.SkillTriggerReferenceGuard;
import xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard;
import xyz.game.datamanage.support.error.ApiException;

class SkillParameterPreviewValidationTest {
    private final SkillParameterMapper mapper = mock(SkillParameterMapper.class);
    private final SkillParameterService service = new SkillParameterService(mock(GamesMapper.class), mock(SkillMapper.class),
        mapper, new SkillParameterLevelService(new ObjectMapper()), mock(SkillTriggerReferenceGuard.class),
        mock(GameConfigurationWriteGuard.class));

    private static SkillParameterCreateRequest values(Map<String, BigDecimal> levels) {
        return new SkillParameterCreateRequest("by_level", "按等级", SkillParameterValueType.INTEGER,
            SkillParameterValueMode.CHARACTER_LEVEL, null, levels, null, 1);
    }

    @Test
    void readonlyPreviewUsesUnlockedLevelConfigurationForCreateAndUpdate() {
        when(mapper.findLevelConfig("lol")).thenReturn(new LevelConfigResponse("lol", 1, 2));
        var request = values(Map.of("1", BigDecimal.ONE, "2", BigDecimal.TEN));
        boolean previous = TransactionSynchronizationManager.isCurrentTransactionReadOnly();
        TransactionSynchronizationManager.setCurrentTransactionReadOnly(true);
        try {
            service.validateConfigurationCreate("lol", request, 5);
            service.validateConfigurationUpdate("lol", "by_level", new SkillParameterUpdateRequest(null, request.name(),
                request.valueType(), request.valueMode(), null, request.levelValues(), null, 1), 5);
        } finally {
            TransactionSynchronizationManager.setCurrentTransactionReadOnly(previous);
        }
        verify(mapper, times(2)).findLevelConfig("lol");
        verify(mapper, never()).findLevelConfigForUpdate("lol");
    }

    @Test
    void readonlyPreviewStillRejectsAnIncompleteCharacterLevelMap() {
        when(mapper.findLevelConfig("lol")).thenReturn(new LevelConfigResponse("lol", 1, 2));
        boolean previous = TransactionSynchronizationManager.isCurrentTransactionReadOnly();
        TransactionSynchronizationManager.setCurrentTransactionReadOnly(true);
        try {
            assertThrows(ApiException.class, () -> service.validateConfigurationCreate("lol", values(Map.of("1", BigDecimal.ONE)), 5));
        } finally {
            TransactionSynchronizationManager.setCurrentTransactionReadOnly(previous);
        }
        verify(mapper, never()).findLevelConfigForUpdate("lol");
    }

    @Test
    void writeValidationKeepsTheLevelConfigurationLock() {
        when(mapper.findLevelConfigForUpdate("lol")).thenReturn(new LevelConfigResponse("lol", 1, 2));
        service.validateConfigurationCreate("lol", values(Map.of("1", BigDecimal.ONE, "2", BigDecimal.TEN)), 5);
        verify(mapper).findLevelConfigForUpdate("lol");
        verify(mapper, never()).findLevelConfig("lol");
    }
}
