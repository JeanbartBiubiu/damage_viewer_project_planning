package xyz.game.datamanage.mapper;

import java.sql.Timestamp;
import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface ImagesMapper {

    List<Map<String, Object>> listImages(@Param("gameId") String gameId);

    List<Map<String, Object>> listImagesUpdatedAfter(
        @Param("gameId") String gameId,
        @Param("updatedAfter") Timestamp updatedAfter
    );

    Map<String, Object> findImageByUri(@Param("gameId") String gameId, @Param("uri") String uri);

    int upsertImage(@Param("gameId") String gameId, @Param("uri") String uri, @Param("imageBase64") String imageBase64);
}
