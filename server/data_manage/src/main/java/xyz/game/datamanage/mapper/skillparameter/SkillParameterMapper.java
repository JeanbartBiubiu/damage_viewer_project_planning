package xyz.game.datamanage.mapper.skillparameter;

import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import xyz.game.datamanage.model.character.LevelConfigResponse;
import xyz.game.datamanage.model.skillparameter.SkillParameterRow;

@Mapper
public interface SkillParameterMapper {

    List<SkillParameterRow> list(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey
    );

    SkillParameterRow findById(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("parameterKey") String parameterKey
    );

    SkillParameterRow findByIdForUpdate(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("parameterKey") String parameterKey
    );

    long countByKey(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("parameterKey") String parameterKey
    );

    long countFormulaReferences(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("parameterKey") String parameterKey
    );

    int insert(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("parameterKey") String parameterKey,
        @Param("name") String name,
        @Param("valueType") String valueType,
        @Param("valueMode") String valueMode,
        @Param("fixedValue") java.math.BigDecimal fixedValue,
        @Param("levelValuesJson") String levelValuesJson,
        @Param("description") String description,
        @Param("sortOrder") Integer sortOrder
    );

    int update(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("parameterKey") String parameterKey,
        @Param("name") String name,
        @Param("valueType") String valueType,
        @Param("valueMode") String valueMode,
        @Param("fixedValue") java.math.BigDecimal fixedValue,
        @Param("levelValuesJson") String levelValuesJson,
        @Param("description") String description,
        @Param("sortOrder") Integer sortOrder
    );

    int delete(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("parameterKey") String parameterKey
    );

    int deleteAllForSkill(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey
    );

    Integer lockGame(@Param("gameId") String gameId);

    LevelConfigResponse findLevelConfigForUpdate(@Param("gameId") String gameId);

    List<SkillParameterRow> lockSkillLevelParamsForSkill(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey
    );

    List<SkillParameterRow> lockCharacterLevelParamsForGame(@Param("gameId") String gameId);

    List<SkillParameterRow> listCharacterLevelParamsForGame(@Param("gameId") String gameId);

    int updateLevelValuesJson(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("parameterKey") String parameterKey,
        @Param("levelValuesJson") String levelValuesJson
    );

    List<String> lockSkillsForGame(@Param("gameId") String gameId);
}
