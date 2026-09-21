package xyz.game.datamanage.mapper.status;

import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import xyz.game.datamanage.model.status.StatusResponse;

@Mapper
public interface StatusMapper {

    List<StatusResponse> list(
        @Param("gameId") String gameId,
        @Param("keyword") String keyword,
        @Param("status") String status
    );

    StatusResponse findById(
        @Param("gameId") String gameId,
        @Param("statusKey") String statusKey
    );

    StatusResponse findByIdForUpdate(
        @Param("gameId") String gameId,
        @Param("statusKey") String statusKey
    );

    long countByKey(
        @Param("gameId") String gameId,
        @Param("statusKey") String statusKey
    );

    long countByNormalizedName(
        @Param("gameId") String gameId,
        @Param("name") String name,
        @Param("excludeStatusKey") String excludeStatusKey
    );

    int insert(
        @Param("gameId") String gameId,
        @Param("statusKey") String statusKey,
        @Param("name") String name,
        @Param("description") String description,
        @Param("statusKind") String statusKind,
        @Param("status") String status,
        @Param("sortOrder") Integer sortOrder
    );

    int update(
        @Param("gameId") String gameId,
        @Param("statusKey") String statusKey,
        @Param("name") String name,
        @Param("description") String description,
        @Param("status") String status,
        @Param("sortOrder") Integer sortOrder
    );

    int delete(
        @Param("gameId") String gameId,
        @Param("statusKey") String statusKey
    );
}
