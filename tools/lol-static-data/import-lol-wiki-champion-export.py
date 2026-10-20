"""将 Wiki 官方当前修订导出整理为全英雄本地原文，不生成战斗配置。"""
import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT = ROOT / "数据参考/lol-wiki-champions-full"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes((json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))


def slug(value):
    result = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    if not result:
        raise ValueError(f"页面名称不能形成文件名: {value!r}")
    return result


def read_export(path):
    root = ET.parse(path).getroot()
    ns = {"m": root.tag.split("}", 1)[0][1:]}
    result = {}
    for page in root.findall("m:page", ns):
        revision = page.find("m:revision", ns)
        text = revision.findtext("m:text", default="", namespaces=ns)
        title = page.findtext("m:title", namespaces=ns)
        result[title] = {
            "title": title,
            "pageId": int(page.findtext("m:id", namespaces=ns)),
            "revisionId": int(revision.findtext("m:id", namespaces=ns)),
            "revisionTimestamp": revision.findtext("m:timestamp", namespaces=ns),
            "contentModel": revision.findtext("m:model", default="wikitext", namespaces=ns),
            "sourceUrl": "https://wiki.leagueoflegends.com/en-us/" + quote(title.replace(" ", "_"), safe="/"),
            "text": text,
        }
    return result


def resolve(pages, title):
    visited = set()
    while True:
        if title in visited:
            raise ValueError(f"页面重定向循环: {title}")
        visited.add(title)
        page = pages.get(title)
        if not page:
            raise ValueError(f"导出缺少页面或重定向目标: {title}")
        redirect = re.match(r"\s*#REDIRECT\s*\[\[([^\]|#]+)", page["text"], re.I)
        if not redirect:
            return page
        title = redirect.group(1).strip()


def save_raw(out, page, relative):
    raw = page["text"].encode("utf-8")
    destination = out / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(raw)
    return {**{k: v for k, v in page.items() if k != "text"}, "rawRelPath": relative,
            "contentSha256": digest(raw), "rawByteSize": len(raw)}


def verify(out):
    manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    errors = []
    for row in manifest["champions"]:
        hero = json.loads((out / row["metadataRelPath"]).read_text(encoding="utf-8"))
        if set(hero["slots"]) != {"P", "Q", "W", "E", "R"}:
            errors.append(f'{row["title"]}: 五个技能入口不完整')
        for page in [hero["page"], *([hero["dataPage"]] if hero.get("dataPage") else []), *hero["abilities"]]:
            data = (out / page["rawRelPath"]).read_bytes()
            if digest(data) != page["contentSha256"] or len(data) != page["rawByteSize"]:
                errors.append(f'{page["title"]}: 原文摘要不符')
        targets = {p["title"] for p in hero["abilities"]}
        for slot, titles in hero["slots"].items():
            if not titles or not set(titles).issubset(targets):
                errors.append(f'{row["title"]}/{slot}: 缺少最终技能原文')
    for page in [manifest["championList"], *manifest["dependencies"]]:
        if digest((out / page["rawRelPath"]).read_bytes()) != page["contentSha256"]:
            errors.append(f'{page["title"]}: 依赖原文摘要不符')
    if manifest["championCount"] != len(manifest["champions"]):
        errors.append("英雄清单条数不符")
    if errors:
        raise ValueError("\n".join(errors))
    return {"champions": manifest["championCount"], "abilityPages": manifest["abilityPageCount"],
            "resolvedBaseSlots": manifest["championCount"] * 5, "dependencies": len(manifest["dependencies"]), "verified": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, action="append", help="官方 XML 导出，可重复提供重定向补包")
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--check", action="store_true", help="只核对现有清单、技能入口及原文摘要")
    args = parser.parse_args()
    out = args.output_root.resolve()
    if args.check:
        print(json.dumps(verify(out), ensure_ascii=False))
        return
    if not args.input:
        parser.error("需要 --input 或 --check")
    if (out / "manifest.json").exists():
        raise ValueError("目标已有完整资料清单；请显式选择新的目录，避免覆盖旧修订")
    pages = {}
    exports = []
    for path in args.input:
        current = read_export(path)
        for title, page in current.items():
            previous = pages.get(title)
            if previous and previous["revisionId"] == page["revisionId"] and previous["text"] != page["text"]:
                raise ValueError(f"同修订号原文冲突: {title}")
            if not previous or page["revisionId"] > previous["revisionId"]:
                pages[title] = page
        data = path.read_bytes()
        exports.append({"fileName": path.name, "sha256": digest(data), "bytes": len(data)})
    list_page = resolve(pages, "List of champions")
    names = re.findall(r"\{\{List of champions row\|([^|}\n]+)", list_page["text"])
    if not names or len(names) != len(set(names)):
        raise ValueError("英雄列表为空或含重复项")
    rows, total = [], 0
    # 写入前先核对所有主入口，避免把缺页导出误报为全量成功。
    resolved = []
    for name in names:
        page = resolve(pages, name)
        prefix = f'Template:Data {page["title"]}/'
        abilities = [p for p in pages.values() if p["title"].startswith(prefix)
                     and re.search(r"^\|champion\s*=\s*\S", p["text"], re.M)]
        abilities.sort(key=lambda p: p["title"])
        slots = {slot: [] for slot in ["P", "Q", "W", "E", "R"]}
        for ability in abilities:
            match = re.search(r"^\|skill\s*=\s*([A-Z])\b", ability["text"], re.M)
            slot = "P" if match and match.group(1) == "I" else match.group(1) if match else None
            if slot in slots:
                slots[slot].append(ability["title"])
        if any(not titles for titles in slots.values()):
            raise ValueError(f"缺少实际技能槽正文: {name} {slots}")
        resolved.append((name, page, slots, abilities))
    for name, page, slots, abilities in resolved:
        key = slug(name)
        hero = {"wikiChampionTitle": name, "resolvedTitle": page["title"], "slots": slots,
                "page": save_raw(out, page, f"raw/{key}/champion.wikitext"),
                "abilities": [save_raw(out, p, f'raw/{key}/{slug(p["title"].split("/", 1)[1])}.wikitext') for p in abilities]}
        data_title = f'Template:Data {page["title"]}'
        if data_title in pages:
            hero["dataPage"] = save_raw(out, resolve(pages, data_title), f"raw/{key}/data.wikitext")
        relative = f"champions/{key}.json"
        write_json(out / relative, hero)
        rows.append({"title": name, "resolvedTitle": page["title"], "metadataRelPath": relative, "abilityPageCount": len(abilities)})
        total += len(abilities)
    dependency_titles = sorted({title for title in pages if title.startswith("Module:")} | {
        "Template:Pp", "Template:Ap", "Template:Pplevel", "Template:Passive progression level", "Template:Ability progression", "Template:Ability progression2", "Template:Stat table"})
    dependencies = [save_raw(out, pages[t], f'dependencies/{slug(t)}.{"lua" if pages[t]["contentModel"] == "Scribunto" else "wikitext"}')
                    for t in dependency_titles if t in pages]
    manifest = {"schemaVersion": "lol-wiki-full-champion-source-v1", "fetchedAt": datetime.now(timezone.utc).isoformat(),
                "sourceUrl": "https://wiki.leagueoflegends.com/en-us/List_of_champions", "acquisition": "MediaWiki Special:Export; current revision; include templates; redirect supplements",
                "purpose": "原始资料与修订依据；不改变既有游戏数据版本、适配范围或运行证明",
                "license": "CC BY-SA 3.0; original page authors and source links retained", "exports": exports,
                "championCount": len(rows), "abilityPageCount": total,
                "championList": save_raw(out, list_page, "list-of-champions.wikitext"), "dependencies": dependencies, "champions": rows}
    write_json(out / "manifest.json", manifest)
    print(json.dumps(verify(out), ensure_ascii=False))


if __name__ == "__main__":
    main()
