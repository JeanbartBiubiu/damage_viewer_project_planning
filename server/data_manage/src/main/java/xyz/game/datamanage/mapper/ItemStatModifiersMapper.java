package xyz.game.datamanage.mapper;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface ItemStatModifiersMapper {

    List<Map<String, Object>> listItemStatModifiers(@Param("gameId") String gameId);

    List<Map<String, Object>> listItemStatModifiersByItemId(
        @Param("gameId") String gameId,
        @Param("itemId") String itemId
    );

    List<Map<String, Object>> listChangedSince(
        @Param("gameId") String gameId,
        @Param("updatedAfter") Timestamp updatedAfter
    );

    int deleteItemStatModifiersByItemId(
        @Param("gameId") String gameId,
        @Param("itemId") String itemId
    );

    int upsertItemStatModifier(
        @Param("gameId") String gameId,
        @Param("itemId") String itemId,
        @Param("attrKey") String attrKey,
        @Param("versionId") long versionId,
        @Param("value") BigDecimal value
    );

    int updateVersionRange(
        @Param("gameId") String gameId,
        @Param("itemId") String itemId,
        @Param("attrKey") String attrKey,
        @Param("versionId") long versionId
    );

    int upsertItemStatModifierLog(
        @Param("gameId") String gameId,
        @Param("itemId") String itemId,
        @Param("attrKey") String attrKey,
        @Param("versionId") long versionId,
        @Param("value") BigDecimal value
    );
}
