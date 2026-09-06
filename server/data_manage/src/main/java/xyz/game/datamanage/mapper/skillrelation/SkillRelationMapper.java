package xyz.game.datamanage.mapper.skillrelation;

import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import xyz.game.datamanage.model.skillrelation.CharacterSkillRelationResponse;
import xyz.game.datamanage.model.skillrelation.EquipmentSkillRelationResponse;

@Mapper
public interface SkillRelationMapper {

    long countBySkill(@Param("gameId") String gameId, @Param("skillKey") String skillKey);

    List<CharacterSkillRelationResponse> listCharacterRelations(
        @Param("gameId") String gameId,
        @Param("characterKey") String characterKey,
        @Param("skillKey") String skillKey
    );

    CharacterSkillRelationResponse findCharacterRelation(
        @Param("gameId") String gameId,
        @Param("characterKey") String characterKey,
        @Param("skillKey") String skillKey
    );

    int insertCharacterRelation(
        @Param("gameId") String gameId,
        @Param("characterKey") String characterKey,
        @Param("skillKey") String skillKey,
        @Param("sortOrder") int sortOrder
    );

    int updateCharacterRelation(
        @Param("gameId") String gameId,
        @Param("characterKey") String characterKey,
        @Param("skillKey") String skillKey,
        @Param("sortOrder") int sortOrder
    );

    int deleteCharacterRelation(
        @Param("gameId") String gameId,
        @Param("characterKey") String characterKey,
        @Param("skillKey") String skillKey
    );

    List<EquipmentSkillRelationResponse> listEquipmentRelations(
        @Param("gameId") String gameId,
        @Param("equipmentKey") String equipmentKey,
        @Param("skillKey") String skillKey
    );

    EquipmentSkillRelationResponse findEquipmentRelation(
        @Param("gameId") String gameId,
        @Param("equipmentKey") String equipmentKey,
        @Param("skillKey") String skillKey
    );

    int insertEquipmentRelation(
        @Param("gameId") String gameId,
        @Param("equipmentKey") String equipmentKey,
        @Param("skillKey") String skillKey,
        @Param("sortOrder") int sortOrder
    );

    int updateEquipmentRelation(
        @Param("gameId") String gameId,
        @Param("equipmentKey") String equipmentKey,
        @Param("skillKey") String skillKey,
        @Param("sortOrder") int sortOrder
    );

    int deleteEquipmentRelation(
        @Param("gameId") String gameId,
        @Param("equipmentKey") String equipmentKey,
        @Param("skillKey") String skillKey
    );

}
