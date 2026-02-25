package xyz.game.datamanage.mapper;

import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface OwnerCategoriesMapper {

    List<Map<String, Object>> listOwnerCategories(@Param("gameId") String gameId);

    Long countOwnerCategory(@Param("gameId") String gameId, @Param("ownerType") String ownerType);
}
