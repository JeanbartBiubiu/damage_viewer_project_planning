package xyz.game.datamanage.mapper;

import java.sql.Timestamp;
import java.util.Map;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface GameDataStateMapper {

    Map<String, Object> findByGameId(@Param("gameId") String gameId);

    Map<String, Object> lockByGameId(@Param("gameId") String gameId);

    int insertInitialState(@Param("gameId") String gameId);

    Long incrementCurrentRevision(
        @Param("gameId") String gameId,
        @Param("updatedAt") Timestamp updatedAt
    );

    int updatePublishedRevision(
        @Param("gameId") String gameId,
        @Param("publishedRevision") long publishedRevision,
        @Param("updatedAt") Timestamp updatedAt
    );
}
