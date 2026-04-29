type ResourceImageThumbProps = {
  src: string | null;
  alt: string;
  size?: number;
  emptyLabel?: string;
};

export function ResourceImageThumb({ src, alt, size = 40, emptyLabel = '未上传' }: ResourceImageThumbProps) {
  const style = {
    width: size,
    height: size
  };

  if (src) {
    return (
      <div className="resource-image-thumb" style={style}>
        <img src={src} alt={alt} className="resource-image-thumb-image" />
      </div>
    );
  }

  return (
    <div className="resource-image-thumb resource-image-thumb-placeholder" style={style} aria-label={`${alt} 未上传图片`}>
      <span>{emptyLabel}</span>
    </div>
  );
}