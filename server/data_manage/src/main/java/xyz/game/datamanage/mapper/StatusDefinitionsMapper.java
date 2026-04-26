package xyz.game.datamanage.mapper;

import java.sql.Timestamp;
import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface StatusDefinitionsMapper {

    List<Map<String, Object>> listStatusDefinitions(@Param("gameId") String gameId);

    List<Map<String, Object>> listChangedSince(
        @Param("gameId") String gameId,
        @Param("updatedAfter") Timestamp updatedAfter
    );

    Map<String, Object> findStatusDefinitionById(
        @Param("gameId") String gameId,
        @Param("statusId") String statusId
    );

    int upsertStatusDefinition(
        @Param("gameId") String gameId,
        @Param("statusId") String statusId,
        @Param("versionId") long versionId,
        @Param("name") String name,
        @Param("description") String description,
        @Param("statusKind") String statusKind,
        @Param("statusTypeId") Integer statusTypeId,
        @Param("controlProfileId") String controlProfileId,
        @Param("stackGroupKey") String stackGroupKey,
        @Param("sourceScope") String sourceScope,
        @Param("stackMode") String stackMode,
        @Param("maxStacks") int maxStacks,
        @Param("maxInstances") Integer maxInstances,
        @Param("durationMode") String durationMode,
        @Param("durationMs") Integer durationMs,
        @Param("durationFormulaId") String durationFormulaId,
        @Param("defaultMagnitudeFormulaId") String defaultMagnitudeFormulaId,
        @Param("snapshotPolicy") String snapshotPolicy,
        @Param("dispellable") boolean dispellable,
        @Param("cleansePriority") int cleansePriority,
        @Param("extendJson") String extendJson
    );

    int updateVersionRange(
        @Param("gameId") String gameId,
        @Param("statusId") String statusId,
        @Param("versionId") long versionId
    );

    int upsertStatusDefinitionLog(
        @Param("gameId") String gameId,
        @Param("statusId") String statusId,
        @Param("versionId") long versionId,
        @Param("name") String name,
        @Param("description") String description,
        @Param("statusKind") String statusKind,
        @Param("statusTypeId") Integer statusTypeId,
        @Param("controlProfileId") String controlProfileId,
        @Param("stackGroupKey") String stackGroupKey,
        @Param("sourceScope") String sourceScope,
        @Param("stackMode") String stackMode,
        @Param("maxStacks") int maxStacks,
        @Param("maxInstances") Integer maxInstances,
        @Param("durationMode") String durationMode,
        @Param("durationMs") Integer durationMs,
        @Param("durationFormulaId") String durationFormulaId,
        @Param("defaultMagnitudeFormulaId") String defaultMagnitudeFormulaId,
        @Param("snapshotPolicy") String snapshotPolicy,
        @Param("dispellable") boolean dispellable,
        @Param("cleansePriority") int cleansePriority,
        @Param("extendJson") String extendJson
    );
}
