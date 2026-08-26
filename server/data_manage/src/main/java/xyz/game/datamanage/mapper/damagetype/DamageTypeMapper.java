package xyz.game.datamanage.mapper.damagetype;

import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import xyz.game.datamanage.model.damagetype.DamageTypeResponse;

@Mapper
public interface DamageTypeMapper {

    List<DamageTypeResponse> list(
        @Param("gameId") String gameId,
        @Param("keyword") String keyword,
        @Param("status") String status
    );

    DamageTypeResponse findById(
        @Param("gameId") String gameId,
        @Param("damageTypeKey") String damageTypeKey
    );

    DamageTypeResponse findByIdForUpdate(
        @Param("gameId") String gameId,
        @Param("damageTypeKey") String damageTypeKey
    );

    long countByKey(
        @Param("gameId") String gameId,
        @Param("damageTypeKey") String damageTypeKey
    );

    long countByNormalizedName(
        @Param("gameId") String gameId,
        @Param("name") String name,
        @Param("excludeDamageTypeKey") String excludeDamageTypeKey
    );

    int insert(
        @Param("gameId") String gameId,
        @Param("damageTypeKey") String damageTypeKey,
        @Param("name") String name,
        @Param("description") String description,
        @Param("status") String status,
        @Param("sortOrder") Integer sortOrder
    );

    int update(
        @Param("gameId") String gameId,
        @Param("damageTypeKey") String damageTypeKey,
        @Param("name") String name,
        @Param("description") String description,
        @Param("status") String status,
        @Param("sortOrder") Integer sortOrder
    );

    int delete(
        @Param("gameId") String gameId,
        @Param("damageTypeKey") String damageTypeKey
    );
}
