package xyz.game.enginev2demo.runtime;

import java.util.List;

/**
 * 挂载在角色上的运行时状态实例。
 */
public final class StatusInstance {

    private final String statusId;
    private final String sourceActorId;
    private final String ownerActorId;
    private final StatusKind statusKind;
    private final long appliedAtMs;
    private final long expireAtMs;
    private final List<AppliedAttrModifier> appliedAttrModifiers;
    private double magnitude;
    private boolean active;

    public StatusInstance(
            String statusId,
            String sourceActorId,
            String ownerActorId,
            StatusKind statusKind,
            long appliedAtMs,
            long expireAtMs,
            double magnitude,
            boolean active,
            List<AppliedAttrModifier> appliedAttrModifiers) {
        this.statusId = statusId;
        this.sourceActorId = sourceActorId;
        this.ownerActorId = ownerActorId;
        this.statusKind = statusKind;
        this.appliedAtMs = appliedAtMs;
        this.expireAtMs = expireAtMs;
        this.magnitude = magnitude;
        this.active = active;
        this.appliedAttrModifiers = List.copyOf(appliedAttrModifiers);
    }

    public StatusInstance(
            String statusId,
            String sourceActorId,
            String ownerActorId,
            StatusKind statusKind,
            long appliedAtMs,
            long expireAtMs,
            double magnitude,
            boolean active) {
        this(statusId, sourceActorId, ownerActorId, statusKind, appliedAtMs, expireAtMs, magnitude, active, List.of());
    }

    public String statusId() {
        return statusId;
    }

    public String sourceActorId() {
        return sourceActorId;
    }

    public String ownerActorId() {
        return ownerActorId;
    }

    public StatusKind statusKind() {
        return statusKind;
    }

    public long appliedAtMs() {
        return appliedAtMs;
    }

    public long expireAtMs() {
        return expireAtMs;
    }

    public List<AppliedAttrModifier> appliedAttrModifiers() {
        return appliedAttrModifiers;
    }

    public double magnitude() {
        return magnitude;
    }

    public void setMagnitude(double magnitude) {
        this.magnitude = magnitude;
    }

    public boolean active() {
        return active;
    }

    public void setActive(boolean active) {
        this.active = active;
    }
}
