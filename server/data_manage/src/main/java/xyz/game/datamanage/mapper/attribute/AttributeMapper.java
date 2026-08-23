package xyz.game.datamanage.mapper.attribute;

import java.math.BigDecimal;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import xyz.game.datamanage.model.attribute.AttributeResponse;

@Mapper
public interface AttributeMapper {

    List<AttributeResponse> list(
        @Param("gameId") String gameId,
        @Param("keyword") String keyword,
        @Param("status") String status
    );

    AttributeResponse findById(
        @Param("gameId") String gameId,
        @Param("attributeKey") String attributeKey
    );

    AttributeResponse findByIdForUpdate(
        @Param("gameId") String gameId,
        @Param("attributeKey") String attributeKey
    );

    long countByKey(
        @Param("gameId") String gameId,
        @Param("attributeKey") String attributeKey
    );

    long countByNormalizedName(
        @Param("gameId") String gameId,
        @Param("name") String name,
        @Param("excludeAttributeKey") String excludeAttributeKey
    );

    int insert(
        @Param("gameId") String gameId,
        @Param("attributeKey") String attributeKey,
        @Param("name") String name,
        @Param("valueType") String valueType,
        @Param("minValue") BigDecimal minValue,
        @Param("maxValue") BigDecimal maxValue,
        @Param("description") String description,
        @Param("status") String status,
        @Param("sortOrder") int sortOrder
    );

    int update(
        @Param("gameId") String gameId,
        @Param("attributeKey") String attributeKey,
        @Param("name") String name,
        @Param("valueType") String valueType,
        @Param("minValue") BigDecimal minValue,
        @Param("maxValue") BigDecimal maxValue,
        @Param("description") String description,
        @Param("status") String status,
        @Param("sortOrder") int sortOrder
    );
}
