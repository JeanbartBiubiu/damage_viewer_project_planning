package xyz.game.datamanage.mapper;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface EditLogMapper {

    int insertEditLog(@Param("accountId") java.util.UUID accountId,
                      @Param("username") String username, @Param("editBody") String editBody);

    int deleteExpiredEditLogs();
}
