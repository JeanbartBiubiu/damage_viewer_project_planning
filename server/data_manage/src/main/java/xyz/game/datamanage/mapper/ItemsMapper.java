package xyz.game.datamanage.mapper;

import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface ItemsMapper {

    List<Map<String, Object>> listItems(@Param("gameId") String gameId);

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
}
