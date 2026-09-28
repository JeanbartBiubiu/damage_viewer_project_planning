package xyz.game.datamanage.mapper.build;

import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import xyz.game.datamanage.model.build.BuildGroupRow;
import xyz.game.datamanage.model.build.BuildOptionRow;
import xyz.game.datamanage.model.build.BuildSystemRow;

@Mapper
public interface BuildSystemMapper {
    List<BuildSystemRow> listSystems(@Param("gameId") String gameId, @Param("keyword") String keyword);

    BuildSystemRow findSystem(@Param("gameId") String gameId, @Param("systemKey") String systemKey);

    long countSystemName(
        @Param("gameId") String gameId, @Param("name") String name, @Param("excludeKey") String excludeKey
    );

    int insertSystem(
        @Param("gameId") String gameId, @Param("systemKey") String systemKey, @Param("name") String name,
        @Param("description") String description, @Param("configurationMode") String configurationMode,
        @Param("sortOrder") int sortOrder, @Param("selectionRulesJson") String selectionRulesJson
    );

    int updateSystem(
        @Param("gameId") String gameId, @Param("systemKey") String systemKey, @Param("name") String name,
        @Param("description") String description, @Param("configurationMode") String configurationMode,
        @Param("sortOrder") int sortOrder, @Param("selectionRulesJson") String selectionRulesJson
    );

    int deleteSystem(@Param("gameId") String gameId, @Param("systemKey") String systemKey);

    List<BuildGroupRow> listGroups(
        @Param("gameId") String gameId, @Param("systemKey") String systemKey, @Param("keyword") String keyword
    );

    BuildGroupRow findGroup(
        @Param("gameId") String gameId, @Param("systemKey") String systemKey, @Param("groupKey") String groupKey
    );

    long countGroupName(
        @Param("gameId") String gameId, @Param("systemKey") String systemKey,
        @Param("name") String name, @Param("excludeKey") String excludeKey
    );

    int insertGroup(
        @Param("gameId") String gameId, @Param("systemKey") String systemKey, @Param("groupKey") String groupKey,
        @Param("name") String name, @Param("description") String description, @Param("sortOrder") int sortOrder,
        @Param("slotsJson") String slotsJson
    );

    int updateGroup(
        @Param("gameId") String gameId, @Param("systemKey") String systemKey, @Param("groupKey") String groupKey,
        @Param("name") String name, @Param("description") String description, @Param("sortOrder") int sortOrder,
        @Param("slotsJson") String slotsJson
    );

    int deleteGroup(
        @Param("gameId") String gameId, @Param("systemKey") String systemKey, @Param("groupKey") String groupKey
    );

    List<BuildOptionRow> listOptions(
        @Param("gameId") String gameId, @Param("systemKey") String systemKey, @Param("keyword") String keyword
    );

    BuildOptionRow findOption(
        @Param("gameId") String gameId, @Param("systemKey") String systemKey, @Param("optionKey") String optionKey
    );

    long countOptionName(
        @Param("gameId") String gameId, @Param("systemKey") String systemKey,
        @Param("name") String name, @Param("excludeKey") String excludeKey
    );

    int insertOption(
        @Param("gameId") String gameId, @Param("systemKey") String systemKey, @Param("optionKey") String optionKey,
        @Param("name") String name, @Param("description") String description, @Param("maxRank") int maxRank,
        @Param("rankCostsJson") String rankCostsJson
    );

    int updateOption(
        @Param("gameId") String gameId, @Param("systemKey") String systemKey, @Param("optionKey") String optionKey,
        @Param("name") String name, @Param("description") String description, @Param("maxRank") int maxRank,
        @Param("rankCostsJson") String rankCostsJson
    );

    int deleteOption(
        @Param("gameId") String gameId, @Param("systemKey") String systemKey, @Param("optionKey") String optionKey
    );
}
