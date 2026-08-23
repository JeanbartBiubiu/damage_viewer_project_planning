package xyz.game.datamanage.mapper.equipment;

import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import xyz.game.datamanage.model.equipment.EquipmentAttributeDefinition;
import xyz.game.datamanage.model.equipment.EquipmentResponse;

@Mapper
public interface EquipmentMapper {

    List<EquipmentResponse> list(@Param("gameId") String gameId, @Param("keyword") String keyword);

    EquipmentResponse findById(@Param("gameId") String gameId, @Param("equipmentKey") String equipmentKey);

    EquipmentResponse findByIdForUpdate(@Param("gameId") String gameId, @Param("equipmentKey") String equipmentKey);

    long countByKey(@Param("gameId") String gameId, @Param("equipmentKey") String equipmentKey);

    long countByNormalizedName(
        @Param("gameId") String gameId,
        @Param("name") String name,
        @Param("excludeEquipmentKey") String excludeEquipmentKey
    );

    int insertEquipment(
        @Param("gameId") String gameId,
        @Param("equipmentKey") String equipmentKey,
        @Param("name") String name,
        @Param("description") String description
    );

    int updateEquipment(
        @Param("gameId") String gameId,
        @Param("equipmentKey") String equipmentKey,
        @Param("name") String name,
        @Param("description") String description
    );

    int deleteEquipment(@Param("gameId") String gameId, @Param("equipmentKey") String equipmentKey);

    List<EquipmentAttributeDefinition> listAttributeDefinitions(@Param("gameId") String gameId);

    String findAttributeValuesJson(@Param("gameId") String gameId, @Param("equipmentKey") String equipmentKey);

    int insertAttributeValues(
        @Param("gameId") String gameId,
        @Param("equipmentKey") String equipmentKey,
        @Param("attributeValuesJson") String attributeValuesJson
    );

    int updateAttributeValues(
        @Param("gameId") String gameId,
        @Param("equipmentKey") String equipmentKey,
        @Param("attributeValuesJson") String attributeValuesJson
    );
}
