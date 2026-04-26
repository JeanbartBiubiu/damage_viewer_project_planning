package xyz.game.datamanage.mapper;

import java.sql.Timestamp;
import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface StatusModifierGroupsMapper {

    List<Map<String, Object>> listStatusModifierGroups(@Param("gameId") String gameId);

    List<Map<String, Object>> listChangedSince(
        @Param("gameId") String gameId,
        @Param("updatedAfter") Timestamp updatedAfter
    );

    Map<String, Object> findStatusModifierGroupById(
        @Param("gameId") String gameId,
        @Param("statusId") String statusId,
        @Param("groupKey") String groupKey
    );

    int upsertStatusModifierGroup(
        @Param("gameId") String gameId,
        @Param("statusId") String statusId,
        @Param("groupKey") String groupKey,
        @Param("versionId") long versionId,
        @Param("groupName") String groupName,
        @Param("phaseKey") String phaseKey,
        @Param("snapshotPolicy") String snapshotPolicy,
        @Param("intervalMs") Integer intervalMs,
        @Param("maxTicks") Integer maxTicks,
        @Param("priority") int priority,
        @Param("extendJson") String extendJson
    );

    int updateVersionRange(
        @Param("gameId") String gameId,
        @Param("statusId") String statusId,
        @Param("groupKey") String groupKey,
        @Param("versionId") long versionId
    );

    int upsertStatusModifierGroupLog(
        @Param("gameId") String gameId,
        @Param("statusId") String statusId,
        @Param("groupKey") String groupKey,
        @Param("versionId") long versionId,
        @Param("groupName") String groupName,
        @Param("phaseKey") String phaseKey,
        @Param("snapshotPolicy") String snapshotPolicy,
        @Param("intervalMs") Integer intervalMs,
        @Param("maxTicks") Integer maxTicks,
        @Param("priority") int priority,
        @Param("extendJson") String extendJson
    );
}
