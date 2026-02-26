package xyz.game.datamanage.mapper;

import java.sql.Timestamp;
import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface ItemsMapper {

    List<Map<String, Object>> listItems(@Param("gameId") String gameId);

    List<Map<String, Object>> listChangedSince(
        @Param("gameId") String gameId,
        @Param("updatedAfter") Timestamp updatedAfter
    );

    Map<String, Object> findItemById(@Param("gameId") String gameId, @Param("itemId") String itemId);

    int upsertItem(
        @Param("gameId") String gameId,
        @Param("itemId") String itemId,
        @Param("versionId") long versionId,
        @Param("name") String name,
        @Param("goldCost") Integer goldCost,
        @Param("iconUrl") String iconUrl,
        @Param("statsModifierJson") String statsModifierJson,
        @Param("skillRefsJson") String skillRefsJson,
        @Param("recipeIdsJson") String recipeIdsJson
    );

    int updateVersionRange(
        @Param("gameId") String gameId,
        @Param("itemId") String itemId,
        @Param("versionId") long versionId
    );

    int upsertItemLog(
        @Param("gameId") String gameId,
        @Param("itemId") String itemId,
        @Param("versionId") long versionId,
        @Param("name") String name,
        @Param("goldCost") Integer goldCost,
        @Param("iconUrl") String iconUrl,
        @Param("statsModifierJson") String statsModifierJson,
        @Param("skillRefsJson") String skillRefsJson,
        @Param("recipeIdsJson") String recipeIdsJson
    );
}
