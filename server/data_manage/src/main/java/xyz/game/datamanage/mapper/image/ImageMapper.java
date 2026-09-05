package xyz.game.datamanage.mapper.image;

import java.sql.Timestamp;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import xyz.game.datamanage.model.image.ImagePublicItemResponse;
import xyz.game.datamanage.model.image.ImageResponse;

@Mapper
public interface ImageMapper {

    List<ImageResponse> list(
        @Param("gameId") String gameId,
        @Param("keyword") String keyword,
        @Param("enabled") Boolean enabled
    );

    ImageResponse findById(
        @Param("gameId") String gameId,
        @Param("imageKey") String imageKey
    );

    ImageResponse findByIdForUpdate(
        @Param("gameId") String gameId,
        @Param("imageKey") String imageKey
    );

    List<ImagePublicItemResponse> listPublic(
        @Param("gameId") String gameId,
        @Param("updatedAfter") Timestamp updatedAfter
    );

    long countByKey(
        @Param("gameId") String gameId,
        @Param("imageKey") String imageKey
    );

    long countByNormalizedName(
        @Param("gameId") String gameId,
        @Param("name") String name,
        @Param("excludeImageKey") String excludeImageKey
    );

    int insert(
        @Param("gameId") String gameId,
        @Param("imageKey") String imageKey,
        @Param("name") String name,
        @Param("description") String description,
        @Param("imageBase64") String imageBase64,
        @Param("mimeType") String mimeType,
        @Param("byteSize") int byteSize,
        @Param("width") int width,
        @Param("height") int height
    );

    int update(
        @Param("gameId") String gameId,
        @Param("imageKey") String imageKey,
        @Param("name") String name,
        @Param("description") String description,
        @Param("enabled") boolean enabled,
        @Param("replaceContent") boolean replaceContent,
        @Param("imageBase64") String imageBase64,
        @Param("mimeType") String mimeType,
        @Param("byteSize") Integer byteSize,
        @Param("width") Integer width,
        @Param("height") Integer height
    );
}
