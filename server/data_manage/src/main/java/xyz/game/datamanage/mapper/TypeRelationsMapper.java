package xyz.game.datamanage.mapper;

import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface TypeRelationsMapper {

    List<Map<String, Object>> listTypeRelations(@Param("gameId") String gameId);

    Map<String, Object> findTypeRelationById(
        @Param("gameId") String gameId,
        @Param("typeId") int typeId,
        @Param("targetCategory") String targetCategory,
        @Param("targetId") String targetId
    );

    int upsertTypeRelation(
        @Param("gameId") String gameId,
        @Param("typeId") int typeId,
        @Param("versionId") long versionId,
        @Param("targetCategory") String targetCategory,
        @Param("targetId") String targetId,
        @Param("extendJson") String extendJson
    );
}
