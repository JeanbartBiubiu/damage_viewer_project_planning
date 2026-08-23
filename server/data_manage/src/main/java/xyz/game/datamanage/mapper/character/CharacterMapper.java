package xyz.game.datamanage.mapper.character;

import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import xyz.game.datamanage.model.character.CharacterAttributeDefinition;
import xyz.game.datamanage.model.character.CharacterResponse;
import xyz.game.datamanage.model.character.LevelConfigResponse;

@Mapper
public interface CharacterMapper {

    LevelConfigResponse findLevelConfig(@Param("gameId") String gameId);

    int upsertLevelConfig(
        @Param("gameId") String gameId,
        @Param("minLevel") int minLevel,
        @Param("maxLevel") int maxLevel
    );

    List<CharacterResponse> list(@Param("gameId") String gameId, @Param("keyword") String keyword);

    List<String> listCharacterKeys(@Param("gameId") String gameId);

    CharacterResponse findById(
        @Param("gameId") String gameId,
        @Param("characterKey") String characterKey
    );

    CharacterResponse findByIdForUpdate(
        @Param("gameId") String gameId,
        @Param("characterKey") String characterKey
    );

    long countByKey(@Param("gameId") String gameId, @Param("characterKey") String characterKey);

    long countByNormalizedName(
        @Param("gameId") String gameId,
        @Param("name") String name,
        @Param("excludeCharacterKey") String excludeCharacterKey
    );

    int insertCharacter(
        @Param("gameId") String gameId,
        @Param("characterKey") String characterKey,
        @Param("name") String name,
        @Param("description") String description
    );

    int updateCharacter(
        @Param("gameId") String gameId,
        @Param("characterKey") String characterKey,
        @Param("name") String name,
        @Param("description") String description
    );

    int deleteCharacter(@Param("gameId") String gameId, @Param("characterKey") String characterKey);

    List<CharacterAttributeDefinition> listAttributeDefinitions(@Param("gameId") String gameId);

    String findLevelValuesJson(
        @Param("gameId") String gameId,
        @Param("characterKey") String characterKey
    );

    int insertLevelValues(
        @Param("gameId") String gameId,
        @Param("characterKey") String characterKey,
        @Param("levelValuesJson") String levelValuesJson
    );

    int updateLevelValues(
        @Param("gameId") String gameId,
        @Param("characterKey") String characterKey,
        @Param("levelValuesJson") String levelValuesJson
    );
}
