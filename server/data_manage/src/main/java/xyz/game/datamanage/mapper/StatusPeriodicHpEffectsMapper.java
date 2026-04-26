package xyz.game.datamanage.mapper;

import java.sql.Timestamp;
import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface StatusPeriodicHpEffectsMapper {

    List<Map<String, Object>> listStatusPeriodicHpEffects(@Param("gameId") String gameId);

    List<Map<String, Object>> listChangedSince(
        @Param("gameId") String gameId,
        @Param("updatedAfter") Timestamp updatedAfter
    );

    Map<String, Object> findStatusPeriodicHpEffectById(
        @Param("gameId") String gameId,
        @Param("statusId") String statusId,
        @Param("groupKey") String groupKey,
        @Param("effectId") String effectId
    );

    int upsertStatusPeriodicHpEffect(
        @Param("gameId") String gameId,
        @Param("statusId") String statusId,
        @Param("groupKey") String groupKey,
        @Param("effectId") String effectId,
        @Param("versionId") long versionId,
        @Param("effectKind") String effectKind,
        @Param("tickFormulaId") String tickFormulaId,
        @Param("damageType") String damageType,
        @Param("canCrit") boolean canCrit,
        @Param("affectedByHealModifier") Boolean affectedByHealModifier,
        @Param("perStack") boolean perStack,
        @Param("extendJson") String extendJson
    );

    int updateVersionRange(
        @Param("gameId") String gameId,
        @Param("statusId") String statusId,
        @Param("groupKey") String groupKey,
        @Param("effectId") String effectId,
        @Param("versionId") long versionId
    );

    int upsertStatusPeriodicHpEffectLog(
        @Param("gameId") String gameId,
        @Param("statusId") String statusId,
        @Param("groupKey") String groupKey,
        @Param("effectId") String effectId,
        @Param("versionId") long versionId,
        @Param("effectKind") String effectKind,
        @Param("tickFormulaId") String tickFormulaId,
        @Param("damageType") String damageType,
        @Param("canCrit") boolean canCrit,
        @Param("affectedByHealModifier") Boolean affectedByHealModifier,
        @Param("perStack") boolean perStack,
        @Param("extendJson") String extendJson
    );
}
