package xyz.game.datamanage.mapper;

import java.sql.Timestamp;
import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface ControlStateProfilesMapper {

    List<Map<String, Object>> listControlStateProfiles(@Param("gameId") String gameId);

    List<Map<String, Object>> listChangedSince(
        @Param("gameId") String gameId,
        @Param("updatedAfter") Timestamp updatedAfter
    );

    Map<String, Object> findControlStateProfileById(
        @Param("gameId") String gameId,
        @Param("controlProfileId") String controlProfileId
    );

    int upsertControlStateProfile(
        @Param("gameId") String gameId,
        @Param("controlProfileId") String controlProfileId,
        @Param("versionId") long versionId,
        @Param("name") String name,
        @Param("description") String description,
        @Param("controlKind") String controlKind,
        @Param("movementLockMode") String movementLockMode,
        @Param("castLockMode") String castLockMode,
        @Param("attackLockMode") String attackLockMode,
        @Param("inputOverrideMode") String inputOverrideMode,
        @Param("displacementKind") String displacementKind,
        @Param("blocksControlInput") boolean blocksControlInput,
        @Param("grantsUnstoppable") boolean grantsUnstoppable,
        @Param("breaksOnDamage") boolean breaksOnDamage,
        @Param("tenacityReducible") boolean tenacityReducible,
        @Param("priority") int priority,
        @Param("extendJson") String extendJson
    );

    int updateVersionRange(
        @Param("gameId") String gameId,
        @Param("controlProfileId") String controlProfileId,
        @Param("versionId") long versionId
    );

    int upsertControlStateProfileLog(
        @Param("gameId") String gameId,
        @Param("controlProfileId") String controlProfileId,
        @Param("versionId") long versionId,
        @Param("name") String name,
        @Param("description") String description,
        @Param("controlKind") String controlKind,
        @Param("movementLockMode") String movementLockMode,
        @Param("castLockMode") String castLockMode,
        @Param("attackLockMode") String attackLockMode,
        @Param("inputOverrideMode") String inputOverrideMode,
        @Param("displacementKind") String displacementKind,
        @Param("blocksControlInput") boolean blocksControlInput,
        @Param("grantsUnstoppable") boolean grantsUnstoppable,
        @Param("breaksOnDamage") boolean breaksOnDamage,
        @Param("tenacityReducible") boolean tenacityReducible,
        @Param("priority") int priority,
        @Param("extendJson") String extendJson
    );
}
