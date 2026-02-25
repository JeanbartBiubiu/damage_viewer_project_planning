package xyz.game.datamanage.mapper;

import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface GamesMapper {

    List<Map<String, Object>> listGames();

    Long countGames(@Param("gameId") String gameId);
}
