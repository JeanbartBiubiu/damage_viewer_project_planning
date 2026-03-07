package xyz.game.datamanage.mapper;

import java.sql.Timestamp;
import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface FormulaProfilesMapper {

    List<Map<String, Object>> listFormulaProfiles(@Param("gameId") String gameId);

    List<Map<String, Object>> listChangedSince(
        @Param("gameId") String gameId,
        @Param("updatedAfter") Timestamp updatedAfter
    );

    Map<String, Object> findFormulaProfileById(@Param("gameId") String gameId, @Param("formulaId") String formulaId);

    int upsertFormulaProfile(
        @Param("gameId") String gameId,
        @Param("formulaId") String formulaId,
        @Param("versionId") long versionId,
        @Param("formulaType") String formulaType,
        @Param("formulaKind") String formulaKind,
        @Param("paramsJson") String paramsJson,
        @Param("description") String description
    );

    int updateVersionRange(
        @Param("gameId") String gameId,
        @Param("formulaId") String formulaId,
        @Param("versionId") long versionId
    );

    int upsertFormulaProfileLog(
        @Param("gameId") String gameId,
        @Param("formulaId") String formulaId,
        @Param("versionId") long versionId,
        @Param("formulaType") String formulaType,
        @Param("formulaKind") String formulaKind,
        @Param("paramsJson") String paramsJson,
        @Param("description") String description
    );
}
