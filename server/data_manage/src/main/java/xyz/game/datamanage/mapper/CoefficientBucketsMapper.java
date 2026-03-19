package xyz.game.datamanage.mapper;

import java.sql.Timestamp;
import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface CoefficientBucketsMapper {

    List<Map<String, Object>> listCoefficientBuckets(@Param("gameId") String gameId);

    List<Map<String, Object>> listChangedSince(
        @Param("gameId") String gameId,
        @Param("updatedAfter") Timestamp updatedAfter
    );

    Map<String, Object> findCoefficientBucketById(
        @Param("gameId") String gameId,
        @Param("bucketKey") String bucketKey
    );

    int upsertCoefficientBucket(
        @Param("gameId") String gameId,
        @Param("bucketKey") String bucketKey,
        @Param("versionId") long versionId,
        @Param("resolutionDomain") String resolutionDomain,
        @Param("stageKey") String stageKey,
        @Param("targetAttrKey") String targetAttrKey,
        @Param("aggregationMode") String aggregationMode,
        @Param("provisional") boolean provisional,
        @Param("name") String name,
        @Param("description") String description,
        @Param("editorHintJson") String editorHintJson,
        @Param("bucketConfigJson") String bucketConfigJson
    );

    int updateVersionRange(
        @Param("gameId") String gameId,
        @Param("bucketKey") String bucketKey,
        @Param("versionId") long versionId
    );

    int upsertCoefficientBucketLog(
        @Param("gameId") String gameId,
        @Param("bucketKey") String bucketKey,
        @Param("versionId") long versionId,
        @Param("resolutionDomain") String resolutionDomain,
        @Param("stageKey") String stageKey,
        @Param("targetAttrKey") String targetAttrKey,
        @Param("aggregationMode") String aggregationMode,
        @Param("provisional") boolean provisional,
        @Param("name") String name,
        @Param("description") String description,
        @Param("editorHintJson") String editorHintJson,
        @Param("bucketConfigJson") String bucketConfigJson
    );
}
