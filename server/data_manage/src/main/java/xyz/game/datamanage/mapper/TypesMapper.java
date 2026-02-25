package xyz.game.datamanage.mapper;

import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface TypesMapper {

    List<Map<String, Object>> listTypes(@Param("gameId") String gameId);

    Map<String, Object> findTypeById(@Param("gameId") String gameId, @Param("typeId") int typeId);

    int upsertType(
        @Param("gameId") String gameId,
        @Param("typeId") int typeId,
        @Param("versionId") long versionId,
        @Param("name") String name,
        @Param("description") String description,
        @Param("reservedTypeId") Integer reservedTypeId
    );
}
