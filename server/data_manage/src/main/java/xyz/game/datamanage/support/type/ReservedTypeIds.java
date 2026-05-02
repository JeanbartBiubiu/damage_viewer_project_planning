package xyz.game.datamanage.support.type;

import java.util.Map;
import java.util.Set;

public final class ReservedTypeIds {

    public static final int FIRST_LEVEL_RESERVED_TYPE_ID_START = 10000;
    public static final int SECOND_LEVEL_RESERVED_TYPE_ID_START = 20000;
    public static final int GAME_LOCAL_TYPE_ID_START = 30000;

    public static final int ATTRIBUTE_ENTRY_GROUP = 10000;
    public static final int ATTRIBUTE_HERO_PROGRESSION = 20000;
    public static final int ATTRIBUTE_MECHANIC_ONLY = 20001;

    public static final Set<Integer> ATTRIBUTE_ENTRY_GROUP_MEMBERS = Set.of(
        ATTRIBUTE_HERO_PROGRESSION,
        ATTRIBUTE_MECHANIC_ONLY
    );

    public static final Map<Integer, String> KEYS = Map.of(
        ATTRIBUTE_ENTRY_GROUP, "attribute_entry_group",
        ATTRIBUTE_HERO_PROGRESSION, "attribute_hero_progression",
        ATTRIBUTE_MECHANIC_ONLY, "attribute_mechanic_only"
    );

    private ReservedTypeIds() {
    }

    public static boolean isAttributeEntryGroupMember(Integer reservedTypeId) {
        return reservedTypeId != null && ATTRIBUTE_ENTRY_GROUP_MEMBERS.contains(reservedTypeId);
    }

    public static boolean isGameLocalTypeId(int typeId) {
        return typeId >= GAME_LOCAL_TYPE_ID_START;
    }
}
