package xyz.game.datamanage.mapper.simulation;

import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface SimulationAvailabilityMapper {
    List<Row> readGameRows(@Param("gameId") String gameId);

    record Row(String kind, String ownerKey, String objectKey, String data) { }
}
