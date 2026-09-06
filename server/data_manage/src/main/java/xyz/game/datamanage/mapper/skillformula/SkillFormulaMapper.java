package xyz.game.datamanage.mapper.skillformula;

import java.util.Collection;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import xyz.game.datamanage.model.skillformula.SkillFormulaAttributeRef;
import xyz.game.datamanage.model.skillformula.SkillFormulaAttributeStatusRow;
import xyz.game.datamanage.model.skillformula.SkillFormulaRow;

@Mapper
public interface SkillFormulaMapper {

    List<SkillFormulaRow> listSummaries(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey
    );

    SkillFormulaRow findById(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("formulaKey") String formulaKey
    );

    SkillFormulaRow findByIdForUpdate(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("formulaKey") String formulaKey
    );

    long countByKey(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("formulaKey") String formulaKey
    );

    int insert(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("formulaKey") String formulaKey,
        @Param("name") String name,
        @Param("description") String description,
        @Param("sortOrder") Integer sortOrder,
        @Param("expression") String expression
    );

    int update(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("formulaKey") String formulaKey,
        @Param("name") String name,
        @Param("description") String description,
        @Param("sortOrder") Integer sortOrder,
        @Param("expression") String expression
    );

    int delete(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("formulaKey") String formulaKey
    );

    int deleteAllForSkill(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey
    );

    List<SkillFormulaAttributeRef> listAttributeRefs(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("formulaKey") String formulaKey
    );

    List<SkillFormulaAttributeStatusRow> findAttributesByKeys(
        @Param("gameId") String gameId,
        @Param("keys") Collection<String> keys
    );

    List<String> findExistingParameterKeys(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("keys") Collection<String> keys
    );
}
