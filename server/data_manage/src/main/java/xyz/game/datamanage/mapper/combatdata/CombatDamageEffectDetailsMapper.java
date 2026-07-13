package xyz.game.datamanage.mapper.combatdata;

import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface CombatDamageEffectDetailsMapper {

    List<Map<String, Object>> list(
        @Param("gameId") String gameId,
        @Param("stepId") Object stepId
    );

    Map<String, Object> findById(
        @Param("gameId") String gameId,
        @Param("stepId") Object stepId
    );

    int upsert(
        @Param("gameId") String gameId,
        @Param("changeRevision") long changeRevision,
        @Param("stepId") Object stepId,
        @Param("amountFormulaKey") Object amountFormulaKey,
        @Param("damageTypeId") Object damageTypeId,
        @Param("valuePolicyTypeId") Object valuePolicyTypeId,
        @Param("copyableOnHit") boolean copyableOnHit,
        @Param("critEligible") boolean critEligible
    );

    int deleteByStepId(@Param("gameId") String gameId, @Param("stepId") String stepId);
    List<Map<String, Object>> listChangedSince(
        @Param("gameId") String gameId,
        @Param("previousRevision") long previousRevision,
        @Param("publishRevision") long publishRevision
    );

    int copyChangedToLog(
        @Param("gameId") String gameId,
        @Param("versionId") long versionId,
        @Param("previousRevision") long previousRevision,
        @Param("publishRevision") long publishRevision
    );

}
