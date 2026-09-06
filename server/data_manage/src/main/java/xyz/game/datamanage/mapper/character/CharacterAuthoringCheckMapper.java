package xyz.game.datamanage.mapper.character;

import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import xyz.game.datamanage.model.character.CharacterAuthoringCheckRows.AttachedSkill;
import xyz.game.datamanage.model.character.CharacterAuthoringCheckRows.ObjectRow;
import xyz.game.datamanage.model.character.CharacterAuthoringCheckRows.ReferenceRow;

@Mapper
public interface CharacterAuthoringCheckMapper {
    List<AttachedSkill> listAttachedSkills(@Param("gameId") String gameId, @Param("characterKey") String characterKey);
    List<ObjectRow> listObjects(@Param("gameId") String gameId, @Param("characterKey") String characterKey);
    List<ReferenceRow> listReferences(@Param("gameId") String gameId, @Param("characterKey") String characterKey);
}
