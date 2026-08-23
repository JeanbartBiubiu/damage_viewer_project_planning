package xyz.game.datamanage.model.character;

import java.util.List;

public record CharacterListResponse(List<CharacterResponse> items, int total) {
}
