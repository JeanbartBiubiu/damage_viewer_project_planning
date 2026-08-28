package xyz.game.datamanage.mapper.skilleffect;

import java.math.BigDecimal;
import java.util.Collection;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import xyz.game.datamanage.model.skilleffect.SkillEffectAttributeChangeDetailRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectAttributeChangeOperation;
import xyz.game.datamanage.model.skilleffect.SkillEffectCatalogLockRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectCooldownChangeDetailRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectCooldownChangeOperation;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageDetailRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectResourceChangeDetailRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectResourceChangeOperation;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultType;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultValueRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectStatusOperation;
import xyz.game.datamanage.model.skilleffect.SkillEffectStatusOperationDetailRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectSummaryResponse;
import xyz.game.datamanage.model.skilleffect.SkillEffectTarget;

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
        @Param("sortOrder") Integer sortOrder
    );

    int updateEffect(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("effectKey") String effectKey,
        @Param("name") String name,
        @Param("description") String description,
        @Param("sortOrder") Integer sortOrder
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

    List<SkillEffectResultRow> listResults(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("effectKey") String effectKey
    );

    List<SkillEffectResultRow> listResultsForUpdate(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("effectKey") String effectKey
    );

    int insertResult(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("effectKey") String effectKey,
        @Param("resultKey") String resultKey,
        @Param("name") String name,
        @Param("resultType") SkillEffectResultType resultType,
        @Param("target") SkillEffectTarget target,
        @Param("description") String description,
        @Param("sortOrder") Integer sortOrder
    );

    int updateResult(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("effectKey") String effectKey,
        @Param("resultKey") String resultKey,
        @Param("name") String name,
        @Param("target") SkillEffectTarget target,
        @Param("description") String description,
        @Param("sortOrder") Integer sortOrder
    );

    int deleteResults(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("effectKey") String effectKey,
        @Param("resultKeys") Collection<String> resultKeys
    );

    List<SkillEffectResultValueRow> listValues(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("effectKey") String effectKey
    );

    int insertValue(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("effectKey") String effectKey,
        @Param("resultKey") String resultKey,
        @Param("formulaKey") String formulaKey,
        @Param("fixedMultiplier") BigDecimal fixedMultiplier,
        @Param("fixedMinValue") BigDecimal fixedMinValue,
        @Param("fixedMaxValue") BigDecimal fixedMaxValue
    );

    int updateValue(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("effectKey") String effectKey,
        @Param("resultKey") String resultKey,
        @Param("formulaKey") String formulaKey,
        @Param("fixedMultiplier") BigDecimal fixedMultiplier,
        @Param("fixedMinValue") BigDecimal fixedMinValue,
        @Param("fixedMaxValue") BigDecimal fixedMaxValue
    );

    int deleteValue(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("effectKey") String effectKey,
        @Param("resultKey") String resultKey
    );

    List<SkillEffectDamageDetailRow> listDamageDetails(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("effectKey") String effectKey
    );

    int insertDamageDetail(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("effectKey") String effectKey,
        @Param("resultKey") String resultKey,
        @Param("damageTypeKey") String damageTypeKey
    );

    int updateDamageDetail(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("effectKey") String effectKey,
        @Param("resultKey") String resultKey,
        @Param("damageTypeKey") String damageTypeKey
    );

    List<SkillEffectAttributeChangeDetailRow> listAttributeChangeDetails(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("effectKey") String effectKey
    );

    int insertAttributeChangeDetail(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("effectKey") String effectKey,
        @Param("resultKey") String resultKey,
        @Param("attributeKey") String attributeKey,
        @Param("operation") SkillEffectAttributeChangeOperation operation
    );

    int updateAttributeChangeDetail(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("effectKey") String effectKey,
        @Param("resultKey") String resultKey,
        @Param("attributeKey") String attributeKey,
        @Param("operation") SkillEffectAttributeChangeOperation operation
    );

    List<SkillEffectResourceChangeDetailRow> listResourceChangeDetails(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("effectKey") String effectKey
    );

    int insertResourceChangeDetail(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("effectKey") String effectKey,
        @Param("resultKey") String resultKey,
        @Param("attributeKey") String attributeKey,
        @Param("operation") SkillEffectResourceChangeOperation operation
    );

    int updateResourceChangeDetail(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("effectKey") String effectKey,
        @Param("resultKey") String resultKey,
        @Param("attributeKey") String attributeKey,
        @Param("operation") SkillEffectResourceChangeOperation operation
    );

    List<SkillEffectCooldownChangeDetailRow> listCooldownChangeDetails(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("effectKey") String effectKey
    );

    int insertCooldownChangeDetail(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("effectKey") String effectKey,
        @Param("resultKey") String resultKey,
        @Param("affectedSkillKey") String affectedSkillKey,
        @Param("operation") SkillEffectCooldownChangeOperation operation
    );

    int updateCooldownChangeDetail(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("effectKey") String effectKey,
        @Param("resultKey") String resultKey,
        @Param("affectedSkillKey") String affectedSkillKey,
        @Param("operation") SkillEffectCooldownChangeOperation operation
    );

    List<SkillEffectStatusOperationDetailRow> listStatusOperationDetails(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("effectKey") String effectKey
    );

    int insertStatusOperationDetail(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("effectKey") String effectKey,
        @Param("resultKey") String resultKey,
        @Param("statusKey") String statusKey,
        @Param("operation") SkillEffectStatusOperation operation
    );

    int updateStatusOperationDetail(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("effectKey") String effectKey,
        @Param("resultKey") String resultKey,
        @Param("statusKey") String statusKey,
        @Param("operation") SkillEffectStatusOperation operation
    );

    long countExternalCooldownReferences(
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

    List<SkillEffectCatalogLockRow> lockStatuses(
        @Param("gameId") String gameId,
        @Param("keys") Collection<String> keys
    );
}
