package xyz.game.datamanage.mapper;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface AttributeDefinitionsMapper {

    List<Map<String, Object>> listAttributeDefinitions(@Param("gameId") String gameId);

    Map<String, Object> findAttributeDefinitionById(@Param("gameId") String gameId, @Param("attrKey") String attrKey);

    int upsertAttributeDefinition(
        @Param("gameId") String gameId,
        @Param("attrKey") String attrKey,
        @Param("versionId") long versionId,
        @Param("attrName") String attrName,
        @Param("attrType") String attrType,
        @Param("defaultValue") BigDecimal defaultValue
    );
}
