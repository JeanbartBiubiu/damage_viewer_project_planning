package xyz.game.datamanage.mapper;

import java.util.Map;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface GameProgressionSchemaMapper {

    Map<String, Object> findByGameId(@Param("gameId") String gameId);

    int upsert(
        @Param("gameId") String gameId,
        @Param("progressionKind") String progressionKind,
        @Param("stageMin") int stageMin,
        @Param("stageMax") int stageMax,
        @Param("stageLabel") String stageLabel,
        @Param("requireAllStages") boolean requireAllStages
    );
}
