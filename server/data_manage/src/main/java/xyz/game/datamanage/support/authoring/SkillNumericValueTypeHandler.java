package xyz.game.datamanage.support.authoring;

import java.sql.CallableStatement;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import org.apache.ibatis.type.BaseTypeHandler;
import org.apache.ibatis.type.JdbcType;
import xyz.game.datamanage.model.value.SkillNumericValue;

public final class SkillNumericValueTypeHandler extends BaseTypeHandler<SkillNumericValue> {
    @Override public void setNonNullParameter(PreparedStatement ps, int i, SkillNumericValue value, JdbcType type) throws SQLException {
        ps.setString(i, AggregateJson.write(value));
    }
    @Override public SkillNumericValue getNullableResult(ResultSet rs, String column) throws SQLException { return read(rs.getString(column)); }
    @Override public SkillNumericValue getNullableResult(ResultSet rs, int column) throws SQLException { return read(rs.getString(column)); }
    @Override public SkillNumericValue getNullableResult(CallableStatement cs, int column) throws SQLException { return read(cs.getString(column)); }
    private static SkillNumericValue read(String value) { return value == null ? null : AggregateJson.read(value, SkillNumericValue.class); }
}
