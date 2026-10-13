package xyz.game.datamanage.model.calculation;

import com.fasterxml.jackson.databind.JsonNode;

/** 同一游戏完整计算配置；不存在配置时 configuration 为 null，空状态仍有摘要。 */
public record GameCalculationRulesResponse(String gameId, String baseDigest, JsonNode configuration) {}
