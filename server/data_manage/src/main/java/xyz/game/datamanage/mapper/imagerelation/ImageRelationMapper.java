package xyz.game.datamanage.mapper.imagerelation;

import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import xyz.game.datamanage.model.imagerelation.ImageOptionResponse;
import xyz.game.datamanage.model.imagerelation.ImageUsageRow;
import xyz.game.datamanage.model.imagerelation.RepresentativeImageResponse;

@Mapper
public interface ImageRelationMapper {
    long countSource(
        @Param("gameId") String gameId,
        @Param("sourceType") String sourceType,
        @Param("sourceParentKey") String sourceParentKey,
        @Param("sourceKey") String sourceKey
    );

    String findImageKey(
        @Param("gameId") String gameId,
        @Param("sourceType") String sourceType,
        @Param("sourceParentKey") String sourceParentKey,
        @Param("sourceKey") String sourceKey
    );

    RepresentativeImageResponse.Image findImage(
        @Param("gameId") String gameId, @Param("imageKey") String imageKey
    );

    int put(
        @Param("gameId") String gameId,
        @Param("sourceType") String sourceType,
        @Param("sourceParentKey") String sourceParentKey,
        @Param("sourceKey") String sourceKey,
        @Param("imageKey") String imageKey
    );

    int deleteForSource(
        @Param("gameId") String gameId,
        @Param("sourceType") String sourceType,
        @Param("sourceParentKey") String sourceParentKey,
        @Param("sourceKey") String sourceKey
    );

    int deleteForSkill(@Param("gameId") String gameId, @Param("skillKey") String skillKey);

    List<ImageUsageRow> listUsages(@Param("gameId") String gameId, @Param("imageKey") String imageKey);

    List<ImageOptionResponse.Item> listOptions(
        @Param("gameId") String gameId, @Param("keyword") String keyword
    );
}
