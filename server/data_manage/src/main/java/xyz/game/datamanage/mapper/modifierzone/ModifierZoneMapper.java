package xyz.game.datamanage.mapper.modifierzone;

import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import xyz.game.datamanage.model.modifierzone.ModifierZoneResponse;

@Mapper
public interface ModifierZoneMapper {

    List<ModifierZoneResponse> list(
        @Param("gameId") String gameId,
        @Param("keyword") String keyword,
        @Param("domain") String domain,
        @Param("status") String status
    );

    ModifierZoneResponse findById(
        @Param("gameId") String gameId,
        @Param("modifierZoneKey") String modifierZoneKey
    );

    ModifierZoneResponse findByIdForUpdate(
        @Param("gameId") String gameId,
        @Param("modifierZoneKey") String modifierZoneKey
    );

    long countByKey(
        @Param("gameId") String gameId,
        @Param("modifierZoneKey") String modifierZoneKey
    );

    long countByNormalizedName(
        @Param("gameId") String gameId,
        @Param("name") String name,
        @Param("excludeModifierZoneKey") String excludeModifierZoneKey
    );

    long countAttributeReferences(
        @Param("gameId") String gameId,
        @Param("modifierZoneKey") String modifierZoneKey
    );

    long countDamageReferences(
        @Param("gameId") String gameId,
        @Param("modifierZoneKey") String modifierZoneKey
    );

    long countHealingReferences(
        @Param("gameId") String gameId,
        @Param("modifierZoneKey") String modifierZoneKey
    );

    long countShieldReceivedReferences(
        @Param("gameId") String gameId,
        @Param("modifierZoneKey") String modifierZoneKey
    );

    int insert(
        @Param("gameId") String gameId,
        @Param("modifierZoneKey") String modifierZoneKey,
        @Param("name") String name,
        @Param("domain") String domain,
        @Param("calculationMode") String calculationMode,
        @Param("applicationStage") String applicationStage,
        @Param("description") String description,
        @Param("status") String status,
        @Param("sortOrder") Integer sortOrder
    );

    int update(
        @Param("gameId") String gameId,
        @Param("modifierZoneKey") String modifierZoneKey,
        @Param("name") String name,
        @Param("domain") String domain,
        @Param("calculationMode") String calculationMode,
        @Param("applicationStage") String applicationStage,
        @Param("description") String description,
        @Param("status") String status,
        @Param("sortOrder") Integer sortOrder
    );

    int delete(
        @Param("gameId") String gameId,
        @Param("modifierZoneKey") String modifierZoneKey
    );
}
