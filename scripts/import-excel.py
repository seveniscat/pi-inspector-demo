"""
把舆情导出的 Excel 导入成本地数据集：data/<name>/posts.json + comments.json

用法：
  python3 scripts/import-excel.py 舆情数据.xlsx                  # 帖子和评论在同一个文件的不同 sheet
  python3 scripts/import-excel.py 帖子.xlsx 评论.xlsx             # 分两个文件也行
  python3 scripts/import-excel.py data.xlsx --name real           # 数据集名，默认 real（data/real/ 已 gitignore）

按表头自动识别 sheet：
  帖子表：ID 平台 平台ID 标题 作者 URL 评论数 情绪标签 积极评论数 中性评论数 消极评论数 相关性 来自搜索 发布时间 抓取时间
  评论表：ID 帖子ID 所属帖子标题 平台 平台ID 作者 内容 点赞数 情绪标签 是否回复 回复数 发布时间 抓取时间
也支持 .csv（UTF-8，表头同上）。导入完成后打印数据概况，方便核对情绪标签、相关性、时间格式是否被正确识别。
"""
import argparse
import csv
import datetime as dt
import json
import pathlib
import re
import sys
from collections import Counter

TZ = dt.timezone(dt.timedelta(hours=8))

POST_FIELDS = {
    "ID": "id", "平台": "platform", "平台ID": "platform_id", "标题": "title", "作者": "author", "URL": "url",
    "评论数": "comment_count", "情绪标签": "sentiment", "积极评论数": "pos", "中性评论数": "neu", "消极评论数": "neg",
    "相关性": "relevance", "来自搜索": "source_query", "发布时间": "published_at", "抓取时间": "crawled_at",
}
COMMENT_FIELDS = {
    "ID": "id", "帖子ID": "post_id", "所属帖子标题": "post_title", "平台": "platform", "平台ID": "platform_id",
    "作者": "author", "内容": "content", "点赞数": "likes", "情绪标签": "sentiment", "是否回复": "is_reply",
    "回复数": "reply_count", "发布时间": "published_at", "抓取时间": "crawled_at",
}


def norm_header(h):
    return re.sub(r"\s+", "", str(h or "")).upper().replace("ＩＤ", "ID")


def norm_sentiment(v):
    s = str(v or "").strip().lower()
    if not s:
        return None
    if re.search(r"积极|正面|正向|positive|pos|好评", s):
        return "positive"
    if re.search(r"消极|负面|负向|negative|neg|差评", s):
        return "negative"
    if re.search(r"中性|中立|neutral|neu", s):
        return "neutral"
    return None


def to_int(v):
    if v is None or v == "":
        return 0
    try:
        return int(float(str(v).replace(",", "").strip()))
    except ValueError:
        m = re.match(r"([\d.]+)\s*[wW万]", str(v))
        return int(float(m.group(1)) * 10000) if m else 0


def to_bool(v):
    return str(v or "").strip().lower() in {"是", "true", "1", "yes", "y", "回复"}


def to_iso(v):
    if v is None or v == "":
        return ""
    if isinstance(v, dt.datetime):
        d = v
    elif isinstance(v, dt.date):
        return v.isoformat()
    else:
        s = str(v).strip()
        if re.fullmatch(r"\d{10}(\d{3})?", s):  # unix 时间戳（秒 / 毫秒）
            n = int(s)
            d = dt.datetime.fromtimestamp(n / 1000 if n > 1e12 else n, TZ)
        else:
            s2 = s.replace("/", "-").replace("T", " ").replace("年", "-").replace("月", "-").replace("日", "")
            s2 = re.sub(r"(\+\d{2}:?\d{2}|Z)$", "", s2).strip()
            if re.fullmatch(r"\d{4}-\d{1,2}-\d{1,2}", s2):  # 只有日期：保留为日期，不伪造 00:00
                y, m, dd = s2.split("-")
                return f"{y}-{int(m):02d}-{int(dd):02d}"
            d = None
            for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d", "%Y-%m-%d %H:%M:%S.%f"):
                try:
                    d = dt.datetime.strptime(s2, fmt)
                    break
                except ValueError:
                    pass
            if d is None:
                return s  # 认不出就原样保留，概况里会提示
    if d.tzinfo is None:
        d = d.replace(tzinfo=TZ)
    return d.astimezone(TZ).isoformat(timespec="seconds")


def to_relevance(v):
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return str(v).strip()


def read_tables(path):
    """返回 [(来源名, headers, rows)]"""
    p = pathlib.Path(path)
    if p.suffix.lower() == ".csv":
        with open(p, encoding="utf-8-sig", newline="") as f:
            rows = list(csv.reader(f))
        return [(p.name, rows[0], rows[1:])] if rows else []
    import openpyxl

    wb = openpyxl.load_workbook(p, read_only=True, data_only=True)
    out = []
    for ws in wb.worksheets:
        rows = [r for r in ws.iter_rows(values_only=True) if any(c not in (None, "") for c in r)]
        if rows:
            out.append((f"{p.name}:{ws.title}", list(rows[0]), rows[1:]))
    return out


def map_rows(headers, rows, fields):
    idx = {}
    hs = [norm_header(h) for h in headers]
    for cn, key in fields.items():
        if norm_header(cn) in hs:
            idx[key] = hs.index(norm_header(cn))
    return [{k: (r[i] if i < len(r) else None) for k, i in idx.items()} for r in rows], set(idx)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--name", default="real")
    args = ap.parse_args()

    raw_posts, raw_comments = [], []
    for f in args.files:
        for src, headers, rows in read_tables(f):
            hs = {norm_header(h) for h in headers}
            if "帖子ID" in hs and "内容" in hs:
                mapped, got = map_rows(headers, rows, COMMENT_FIELDS)
                raw_comments += mapped
                kind = "评论"
            elif "标题" in hs and "评论数" in hs:
                mapped, got = map_rows(headers, rows, POST_FIELDS)
                raw_posts += mapped
                kind = "帖子"
            else:
                print(f"跳过 {src}：表头既不像帖子表也不像评论表 → {headers[:8]}")
                continue
            print(f"读取 {src} → {kind}表 {len(mapped)} 行")

    if not raw_posts or not raw_comments:
        sys.exit("没有同时读到帖子表和评论表，请检查文件和表头")

    raw_sent = Counter()
    posts = []
    for r in raw_posts:
        if r.get("id") in (None, ""):
            continue
        raw_sent[str(r.get("sentiment"))] += 1
        posts.append({
            "id": str(r["id"]).strip(),
            "platform": str(r.get("platform") or "").strip(),
            "platform_id": str(r.get("platform_id") or "").strip(),
            "title": str(r.get("title") or "").strip(),
            "author": str(r.get("author") or "").strip(),
            "url": str(r.get("url") or "").strip(),
            "comment_count": to_int(r.get("comment_count")),
            "sentiment": norm_sentiment(r.get("sentiment")),
            "comment_sentiment": {"positive": to_int(r.get("pos")), "neutral": to_int(r.get("neu")), "negative": to_int(r.get("neg"))},
            "relevance": to_relevance(r.get("relevance")),
            "source_query": str(r.get("source_query") or "").strip(),
            "published_at": to_iso(r.get("published_at")),
            "crawled_at": to_iso(r.get("crawled_at")),
        })

    post_ids = {p["id"] for p in posts}
    comments, orphan = [], 0
    for r in raw_comments:
        if r.get("id") in (None, ""):
            continue
        raw_sent[str(r.get("sentiment"))] += 1
        c = {
            "id": str(r["id"]).strip(),
            "post_id": str(r.get("post_id") or "").strip(),
            "post_title": str(r.get("post_title") or "").strip(),
            "platform": str(r.get("platform") or "").strip(),
            "author": str(r.get("author") or "").strip(),
            "content": str(r.get("content") or "").strip(),
            "likes": to_int(r.get("likes")),
            "sentiment": norm_sentiment(r.get("sentiment")),
            "is_reply": to_bool(r.get("is_reply")),
            "reply_count": to_int(r.get("reply_count")),
            "published_at": to_iso(r.get("published_at")),
        }
        if c["post_id"] not in post_ids:
            orphan += 1
        comments.append(c)

    out = pathlib.Path(__file__).resolve().parent.parent / "data" / args.name
    out.mkdir(parents=True, exist_ok=True)
    (out / "posts.json").write_text(json.dumps(posts, ensure_ascii=False, indent=1), encoding="utf-8")
    (out / "comments.json").write_text(json.dumps(comments, ensure_ascii=False, indent=1), encoding="utf-8")

    # ── 概况：导入后先看一眼，确认字段都被正确识别 ──
    def bad_time(xs):
        return sum(1 for x in xs if x and not re.match(r"\d{4}-\d{2}-\d{2}", x))

    days = sorted({p["published_at"][:10] for p in posts if p["published_at"]})
    cdays = sorted({c["published_at"][:10] for c in comments if c["published_at"]})
    print(f"\n已写入 {out}/")
    print(f"帖子 {len(posts)} 条，评论 {len(comments)} 条")
    print(f"平台：{dict(Counter(p['platform'] for p in posts))}")
    print(f"帖子发布时间：{days[0] if days else '?'} ~ {days[-1] if days else '?'}；评论：{cdays[0] if cdays else '?'} ~ {cdays[-1] if cdays else '?'}")
    print(f"来自搜索：{dict(Counter(p['source_query'] for p in posts).most_common(10))}")
    print(f"情绪标签原始值：{dict(raw_sent.most_common(10))}")
    print(f"情绪识别失败：帖子 {sum(1 for p in posts if not p['sentiment'])}，评论 {sum(1 for c in comments if not c['sentiment'])}")
    print(f"相关性取值：{dict(Counter(str(p['relevance']) for p in posts).most_common(8))}")
    date_only = sum(1 for c in comments if c["published_at"] and "T" not in c["published_at"])
    if date_only:
        print(f"评论发布时间只有日期（无时分）：{date_only} 条，按天统计不受影响")
    print(f"时间格式未识别：帖子 {bad_time([p['published_at'] for p in posts])}，评论 {bad_time([c['published_at'] for c in comments])}")
    print(f"找不到所属帖子的评论：{orphan}")
    mismatch = sum(1 for p in posts if p["comment_count"] != sum(1 for c in comments if c["post_id"] == p["id"]))
    print(f"评论数字段与实际评论条数不一致的帖子：{mismatch}（平台评论数通常大于抓到的条数，属正常）")
    print(f"\n使用：.env 设置 SOCIAL_MODE=local SOCIAL_DATASET={args.name}")


if __name__ == "__main__":
    main()
