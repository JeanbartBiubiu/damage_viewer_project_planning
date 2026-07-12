package xyz.game.datamanage.mapper.combatdata;

import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface CombatAbilityParametersMapper {

    List<Map<String, Object>> list(
        @Param("gameId") String gameId,
        @Param("abilityId") Object abilityId
    );

    Map<String, Object> findById(
        @Param("gameId") String gameId,
        @Param("abilityId") Object abilityId,
        @Param("paramKey") Object paramKey
    );

    int upsert(
        @Param("gameId") String gameId,
        @Param("changeRevision") long changeRevision,
        @Param("abilityId") Object abilityId,
        @Param("paramKey") Object paramKey,
        @Param("numericValue") Object numericValue
    );

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
