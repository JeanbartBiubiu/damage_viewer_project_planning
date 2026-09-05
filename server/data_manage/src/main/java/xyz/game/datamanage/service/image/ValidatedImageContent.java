package xyz.game.datamanage.service.image;

record ValidatedImageContent(
    String imageBase64,
    String mimeType,
    int byteSize,
    int width,
    int height
) {
}
