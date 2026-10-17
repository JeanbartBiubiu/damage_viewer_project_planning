package xyz.game.datamanage.model.simulation;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;

public record SimulationAvailabilityResponse(
    String gameId, String profile, String digestVersion, String scopeDigest, String sharedDigest,
    List<Entry> characters, List<Entry> equipment
) {
    public enum Status { READY, CONFIGURATION_INCOMPLETE, ENGINE_UNSUPPORTED, UNVERIFIED, OUT_OF_SCOPE }

    public record Issue(String code, String skillKey, String fieldPath, String message) { }

    public record ExcludedSkillSource(String skillKey, String reason) { }

    public record Verification(String wasmSha256, String adapterVersion, String externalDigest,
                               JsonNode requiredCoverage, boolean matched, List<String> evidenceRefs) { }

    public record Entry(String key, Status status, String contentDigest, List<Issue> issues, Verification verification,
                        List<ExcludedSkillSource> excludedSkillSources) { }
}
