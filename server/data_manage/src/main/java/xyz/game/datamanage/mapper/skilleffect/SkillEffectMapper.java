package xyz.game.datamanage.mapper.skilleffect;

import java.util.Collection;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import xyz.game.datamanage.model.skilleffect.SkillEffectCatalogLockRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectModifierZoneLockRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectSummaryResponse;

@Mapper
public interface SkillEffectMapper {

    List<SkillEffectSummaryResponse> listSummaries(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey
    );

    SkillEffectRow findEffect(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("effectKey") String effectKey
    );

    SkillEffectRow findEffectForUpdate(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("effectKey") String effectKey
    );

    long countByKey(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("effectKey") String effectKey
    );

    int insertEffect(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("effectKey") String effectKey,
        @Param("name") String name,
        @Param("description") String description,
        @Param("sortOrder") Integer sortOrder,
        @Param("results") String results,
        @Param("lifecycle") String lifecycle
    );

    int updateEffect(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("effectKey") String effectKey,
        @Param("name") String name,
        @Param("description") String description,
        @Param("sortOrder") Integer sortOrder,
        @Param("results") String results,
        @Param("lifecycle") String lifecycle
    );

    int deleteEffect(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("effectKey") String effectKey
    );

    int deleteAllForSkill(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey
    );

    long countExternalSkillScopeReferences(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey
    );

    long countProcessBindings(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("effectKey") String effectKey
    );

    List<String> lockFormulas(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("keys") Collection<String> keys
    );

    List<SkillEffectCatalogLockRow> lockDamageTypes(
        @Param("gameId") String gameId,
        @Param("keys") Collection<String> keys
    );

    List<SkillEffectCatalogLockRow> lockAttributes(
        @Param("gameId") String gameId,
        @Param("keys") Collection<String> keys
    );

    List<SkillEffectCatalogLockRow> lockSkills(
        @Param("gameId") String gameId,
        @Param("keys") Collection<String> keys
    );

    List<SkillEffectCatalogLockRow> lockSkillCategories(
        @Param("gameId") String gameId,
        @Param("keys") Collection<String> keys
    );

    List<SkillEffectCatalogLockRow> lockStatuses(
        @Param("gameId") String gameId,
        @Param("keys") Collection<String> keys
    );

    List<SkillEffectModifierZoneLockRow> lockModifierZones(
        @Param("gameId") String gameId,
        @Param("keys") Collection<String> keys
    );

    List<String> listRuntimeInputFormulaKeys(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("keys") Collection<String> keys
    );

    long countLifecycleOperationReferences(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("targetEffectKey") String targetEffectKey
    );

    long countRefreshOperationReferences(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("targetEffectKey") String targetEffectKey
    );

    List<String> lockEffects(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("keys") Collection<String> keys
    );

    List<SkillEffectLifecycleRow> lockLifecycles(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("keys") Collection<String> keys
    );
}
