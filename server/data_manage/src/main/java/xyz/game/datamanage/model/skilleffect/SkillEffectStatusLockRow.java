package xyz.game.datamanage.model.skilleffect;

import xyz.game.datamanage.model.status.StatusKind;

public record SkillEffectStatusLockRow(String refKey, String status, StatusKind statusKind) {
}
