import hashlib
import json
from pathlib import Path
from PIL import Image

HERE = Path(__file__).resolve().parent
report = json.loads((HERE / '图片下载记录.json').read_text(encoding='utf-8'))
target_dir = HERE / '页面图片'
target_dir.mkdir(exist_ok=True)
rows = []
for item in report['items']:
    if item['status'] != '下载完成':
        rows.append({'key': item['key'], 'status': '图片待补'})
        continue
    source = HERE / item['rawFile']
    raw = source.read_bytes()
    assert hashlib.sha256(raw).hexdigest() == item['sha256']
    target = target_dir / (item['key'] + '.png')
    with Image.open(source) as original:
        original.load()
        width, height = original.size
        assert original.format == 'PNG'
        if width <= 64 and height <= 64:
            prepared = raw
            rule = '原图宽高均不超过64，保持原始PNG字节'
        else:
            import io
            edge = min(width, height)
            left, top = (width - edge) // 2, (height - edge) // 2
            image = original.convert('RGBA').crop((left, top, left + edge, top + edge)).resize((64, 64), Image.Resampling.LANCZOS)
            buffer = io.BytesIO()
            image.save(buffer, format='PNG')
            prepared = buffer.getvalue()
            rule = '按短边居中裁成正方形，保留透明度，用Pillow LANCZOS缩至64x64并保存PNG'
    if target.exists():
        assert target.read_bytes() == prepared, '已有页面图不覆盖：' + item['key']
    else:
        target.write_bytes(prepared)
    with Image.open(target) as image:
        assert image.width <= 64 and image.height <= 64
        rows.append({'key': item['key'], 'status': '页面图就绪', 'rawFile': item['rawFile'], 'rawSha256': item['sha256'], 'preparedFile': str(target.relative_to(HERE)).replace('\\', '/'), 'width': image.width, 'height': image.height, 'byteSize': len(prepared), 'sha256': hashlib.sha256(prepared).hexdigest(), 'rule': rule})
summary = {'ready': sum(row['status'] == '页面图就绪' for row in rows), 'pending': sum(row['status'] != '页面图就绪' for row in rows)}
(HERE / '页面图片记录.json').write_text(json.dumps({'counts': summary, 'items': rows}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(summary, ensure_ascii=False))
