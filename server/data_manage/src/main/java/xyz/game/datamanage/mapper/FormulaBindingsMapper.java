package xyz.game.datamanage.mapper;

import java.sql.Timestamp;
import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface FormulaBindingsMapper {

    List<Map<String, Object>> listFormulaBindings(@Param("gameId") String gameId);

    List<Map<String, Object>> listChangedSince(
        @Param("gameId") String gameId,
        @Param("updatedAfter") Timestamp updatedAfter
    );

    Map<String, Object> findFormulaBindingById(
        @Param("gameId") String gameId,
        @Param("targetCategory") String targetCategory,
        @Param("targetId") String targetId,
        @Param("bindingKey") String bindingKey
    );

    int upsertFormulaBinding(
        @Param("gameId") String gameId,
        @Param("targetCategory") String targetCategory,
        @Param("targetId") String targetId,
        @Param("bindingKey") String bindingKey,
        @Param("versionId") long versionId,
        @Param("formulaId") String formulaId,
        @Param("overrideParamsJson") String overrideParamsJson
    );

    int updateVersionRange(
        @Param("gameId") String gameId,
        @Param("targetCategory") String targetCategory,
        @Param("targetId") String targetId,
        @Param("bindingKey") String bindingKey,
        @Param("versionId") long versionId
    );

    int upsertFormulaBindingLog(
        @Param("gameId") String gameId,
        @Param("targetCategory") String targetCategory,
        @Param("targetId") String targetId,
        @Param("bindingKey") String bindingKey,
        @Param("versionId") long versionId,
        @Param("formulaId") String formulaId,
        @Param("overrideParamsJson") String overrideParamsJson
    );
}
