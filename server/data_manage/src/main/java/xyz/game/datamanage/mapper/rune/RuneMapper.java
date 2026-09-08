package xyz.game.datamanage.mapper.rune;

import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import xyz.game.datamanage.model.rune.RunePathRow;
import xyz.game.datamanage.model.rune.RuneResponse;

@Mapper
public interface RuneMapper {
    List<RuneResponse> listRunes(@Param("gameId") String gameId, @Param("keyword") String keyword, @Param("category") String category);
    RuneResponse findRune(@Param("gameId") String gameId, @Param("runeKey") String runeKey);
    long countRuneName(@Param("gameId") String gameId, @Param("name") String name, @Param("excludeKey") String excludeKey);
    int insertRune(@Param("gameId") String gameId, @Param("runeKey") String runeKey, @Param("name") String name,
        @Param("description") String description, @Param("category") String category);
    int updateRune(@Param("gameId") String gameId, @Param("runeKey") String runeKey, @Param("name") String name,
        @Param("description") String description, @Param("category") String category);
    int deleteRune(@Param("gameId") String gameId, @Param("runeKey") String runeKey);
    List<RunePathRow> listPaths(@Param("gameId") String gameId, @Param("keyword") String keyword);
    RunePathRow findPath(@Param("gameId") String gameId, @Param("pathKey") String pathKey);
    long countPathName(@Param("gameId") String gameId, @Param("name") String name, @Param("excludeKey") String excludeKey);
    int insertPath(@Param("gameId") String gameId, @Param("pathKey") String pathKey, @Param("name") String name,
        @Param("description") String description, @Param("kind") String kind, @Param("sortOrder") int sortOrder,
        @Param("slotsJson") String slotsJson);
    int updatePath(@Param("gameId") String gameId, @Param("pathKey") String pathKey, @Param("name") String name,
        @Param("description") String description, @Param("kind") String kind, @Param("sortOrder") int sortOrder,
        @Param("slotsJson") String slotsJson);
    int deletePath(@Param("gameId") String gameId, @Param("pathKey") String pathKey);
}
