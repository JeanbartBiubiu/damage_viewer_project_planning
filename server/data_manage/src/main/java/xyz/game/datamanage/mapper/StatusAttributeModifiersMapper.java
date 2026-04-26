package xyz.game.datamanage.mapper;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface StatusAttributeModifiersMapper {

    List<Map<String, Object>> listStatusAttributeModifiers(@Param("gameId") String gameId);

    List<Map<String, Object>> listChangedSince(
        @Param("gameId") String gameId,
        @Param("updatedAfter") Timestamp updatedAfter
    );

    Map<String, Object> findStatusAttributeModifierById(
        @Param("gameId") String gameId,
        @Param("statusId") String statusId,
        @Param("groupKey") String groupKey,
        @Param("modifierId") String modifierId
    );

    int upsertStatusAttributeModifier(
        @Param("gameId") String gameId,
        @Param("statusId") String statusId,
        @Param("groupKey") String groupKey,
        @Param("modifierId") String modifierId,
        @Param("versionId") long versionId,
        @Param("attrKey") String attrKey,
        @Param("modifierMode") String modifierMode,
        @Param("value") BigDecimal value,
        @Param("formulaId") String formulaId,
        @Param("bucketKey") String bucketKey,
        @Param("perStack") boolean perStack,
        @Param("priority") int priority,
        @Param("extendJson") String extendJson
    );

    int updateVersionRange(
        @Param("gameId") String gameId,
        @Param("statusId") String statusId,
        @Param("groupKey") String groupKey,
        @Param("modifierId") String modifierId,
        @Param("versionId") long versionId
    );

    int upsertStatusAttributeModifierLog(
        @Param("gameId") String gameId,
        @Param("statusId") String statusId,
        @Param("groupKey") String groupKey,
        @Param("modifierId") String modifierId,
        @Param("versionId") long versionId,
        @Param("attrKey") String attrKey,
        @Param("modifierMode") String modifierMode,
        @Param("value") BigDecimal value,
        @Param("formulaId") String formulaId,
        @Param("bucketKey") String bucketKey,
        @Param("perStack") boolean perStack,
        @Param("priority") int priority,
        @Param("extendJson") String extendJson
    );
}
