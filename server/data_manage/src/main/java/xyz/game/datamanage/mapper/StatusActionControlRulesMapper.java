package xyz.game.datamanage.mapper;

import java.sql.Timestamp;
import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface StatusActionControlRulesMapper {

    List<Map<String, Object>> listStatusActionControlRules(@Param("gameId") String gameId);

    List<Map<String, Object>> listChangedSince(
        @Param("gameId") String gameId,
        @Param("updatedAfter") Timestamp updatedAfter
    );

    Map<String, Object> findStatusActionControlRuleById(
        @Param("gameId") String gameId,
        @Param("ruleId") String ruleId
    );

    int upsertStatusActionControlRule(
        @Param("gameId") String gameId,
        @Param("ruleId") String ruleId,
        @Param("versionId") long versionId,
        @Param("statusTypeId") int statusTypeId,
        @Param("ruleKind") String ruleKind,
        @Param("actionTypeIdsJson") String actionTypeIdsJson,
        @Param("actionMatchTypeIdsJson") String actionMatchTypeIdsJson,
        @Param("interruptPhaseTypeIdsJson") String interruptPhaseTypeIdsJson,
        @Param("priority") int priority,
        @Param("description") String description,
        @Param("extendJson") String extendJson
    );

    int updateVersionRange(
        @Param("gameId") String gameId,
        @Param("ruleId") String ruleId,
        @Param("versionId") long versionId
    );

    int upsertStatusActionControlRuleLog(
        @Param("gameId") String gameId,
        @Param("ruleId") String ruleId,
        @Param("versionId") long versionId,
        @Param("statusTypeId") int statusTypeId,
        @Param("ruleKind") String ruleKind,
        @Param("actionTypeIdsJson") String actionTypeIdsJson,
        @Param("actionMatchTypeIdsJson") String actionMatchTypeIdsJson,
        @Param("interruptPhaseTypeIdsJson") String interruptPhaseTypeIdsJson,
        @Param("priority") int priority,
        @Param("description") String description,
        @Param("extendJson") String extendJson
    );
}
