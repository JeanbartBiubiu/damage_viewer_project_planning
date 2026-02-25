package xyz.game.datamanage.mapper;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface EditLogMapper {

    int insertEditLog(@Param("email") String email, @Param("editBody") String editBody);

    int deleteExpiredEditLogs();
}
