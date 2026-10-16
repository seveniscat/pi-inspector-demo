#!/usr/bin/env python3
"""把 slides/ 下的幻灯片源文件拼成一个浏览器可直接打开的单文件 幻灯片.html。

用法：python3 docs/talk/build-html.py
只用标准库。源文件更新（从 Claude 重新同步 slides/）后重跑一次即可。

处理的自定义元素：
  <x-embed>      → 沙箱 iframe（srcdoc），只在当前页及相邻页加载，避免几十个动画同时跑
  <x-connector>  → 每页一层 SVG 箭头
  <aside>        → 讲者备注，按 N 显示
  data-build-in  → 进页后按序号依次淡入 / 上移 / 弹出
  /_blob/ 图片    → 未随源文件导出，显示占位框和 alt 文字
"""
import html
import json
import pathlib
import re

HERE = pathlib.Path(__file__).resolve().parent
SLIDES = HERE / "slides"
OUT = HERE / "幻灯片.html"

deck = json.loads((SLIDES / "deck.json").read_text(encoding="utf-8"))
order = deck["order"]
section_start = {v["start"]: v["description"] for v in deck.get("sections", {}).values()}

EMBED_RE = re.compile(r"<x-embed(?P<attrs>[^>]*)>(?P<body>.*?)</x-embed>", re.S)
CONN_RE = re.compile(r"<x-connector(?P<attrs>[^>]*)>\s*</x-connector>", re.S)
ASIDE_RE = re.compile(r"<aside>(?P<body>.*?)</aside>", re.S)
BLOB_IMG_RE = re.compile(r'<img(?P<attrs>[^>]*?)src="/_blob/[^"]*"(?P<rest>[^>]*)/?>', re.S)


def attr(attrs: str, name: str, default: str = "") -> str:
    m = re.search(rf'\b{name}="([^"]*)"', attrs)
    return m.group(1) if m else default


def embed_to_iframe(m: re.Match) -> str:
    style = attr(m.group("attrs"), "style")
    doc = (
        "<!doctype html><html><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width'></head><body>"
        + m.group("body")
        + "</body></html>"
    )
    return (
        f'<iframe class="xe" sandbox="allow-scripts" tabindex="-1" '
        f'style="{style};border:0;background:transparent;pointer-events:none" '
        f'data-srcdoc="{html.escape(doc, quote=True)}"></iframe>'
    )


def connectors_svg(found: list[str]) -> str:
    if not found:
        return ""
    parts = []
    for i, a in enumerate(found):
        x1, y1, x2, y2 = (float(attr(a, k, "0")) for k in ("x1", "y1", "x2", "y2"))
        style = attr(a, "style")
        color = (re.search(r"color:\s*([^;]+)", style) or [None, "#9AA3AD"])[1].strip()
        width = (re.search(r"border-width:\s*([\d.]+)px", style) or [None, "3"])[1]
        mid = f"ah{i}"
        parts.append(
            f'<marker id="{mid}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" '
            f'orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="{color}"/></marker>'
            f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" stroke-width="{width}" '
            f'marker-end="url(#{mid})"/>'
        )
    return (
        '<svg class="xc" viewBox="0 0 1920 1080" width="1920" height="1080" aria-hidden="true">'
        + "".join(parts)
        + "</svg>"
    )


def blob_placeholder(m: re.Match) -> str:
    attrs = m.group("attrs") + m.group("rest")
    style = attr(attrs, "style")
    alt = attr(attrs, "alt", "截图")
    return (
        f'<div class="blob" style="{style};display:flex;align-items:center;justify-content:center">'
        f'<p>截图未随源文件导出（在 Claude 幻灯片里查看）<br><span>{alt}</span></p></div>'
    )


sections, notes = [], []
for n, sid in enumerate(order, 1):
    src = (SLIDES / "slides" / f"{sid}.html").read_text(encoding="utf-8")
    m = ASIDE_RE.search(src)
    notes.append(m.group("body").strip() if m else "")
    src = ASIDE_RE.sub("", src)
    conns = [c.group("attrs") for c in CONN_RE.finditer(src)]
    src = CONN_RE.sub("", src)
    src = EMBED_RE.sub(embed_to_iframe, src)
    src = BLOB_IMG_RE.sub(blob_placeholder, src)
    # 箭头层放在 section 结尾，画在内容之上
    src = re.sub(r"</section>\s*$", connectors_svg(conns) + "</section>", src.strip())
    src = src.replace("<section ", f'<section data-n="{n}" data-sid="{sid}" ', 1)
    sections.append(src)

faces = "".join(
    f'<link rel="stylesheet" href="{f["href"]}">' for f in deck.get("faces", {}).values() if f.get("href")
)
outline = [{"n": order.index(k) + 1, "t": v} for k, v in section_start.items() if k in order]
outline.sort(key=lambda o: o["n"])

page = f"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(deck.get("title", "Slides"))}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
{faces}
<style>
:root {{ --bg:#05070A; --fg:#E9EDF3; --dim:#7C8798; --accent:#F2B84B; }}
* {{ box-sizing:border-box; }}
html,body {{ margin:0; height:100%; background:var(--bg); color:var(--fg); overflow:hidden;
  font-family:'Noto Sans SC', system-ui, sans-serif; }}
#stage {{ position:absolute; left:50%; top:50%; width:1920px; height:1080px; transform-origin:center center; }}
#stage > section {{ position:absolute; inset:0; width:1920px; height:1080px; overflow:hidden;
  opacity:0; visibility:hidden; transition:opacity .45s ease, visibility 0s linear .45s; }}
#stage > section.on {{ opacity:1; visibility:visible; transition:opacity .45s ease; }}
#stage section p, #stage section h1, #stage section h2, #stage section h3 {{ margin:0; }}
#stage section ul, #stage section ol {{ margin:0; padding-left:1.2em; }}
#stage section table {{ border-collapse:collapse; }}
#stage section a {{ color:inherit; }}
.xc {{ position:absolute; left:0; top:0; pointer-events:none; }}
.blob {{ border:2px dashed #3A4556 !important; }}
.blob p {{ font-size:30px; color:#9AA6B8; text-align:center; line-height:1.6; }}
.blob span {{ font-size:24px; color:#7C8798; }}
/* 进场动画 */
[data-build-in] {{ opacity:0; }}
section.on [data-build-in].in {{ opacity:1; transition:opacity .6s ease, transform .6s cubic-bezier(.2,.8,.2,1); transform:none; }}
section.on [data-build-in^="rise"]:not(.in) {{ transform:translateY(28px); }}
section.on [data-build-in^="pop"]:not(.in) {{ transform:scale(.92); }}
/* 控件 */
#bar {{ position:fixed; left:0; right:0; bottom:0; height:4px; background:#141A22; z-index:5; }}
#bar i {{ display:block; height:100%; width:0; background:linear-gradient(90deg,#F2B84B,#4FD1C5); transition:width .3s; }}
#hud {{ position:fixed; right:16px; bottom:14px; z-index:6; font:13px/1 ui-monospace,monospace; color:var(--dim);
  display:flex; gap:12px; align-items:center; opacity:.0; transition:opacity .3s; }}
body:hover #hud, #hud:focus-within {{ opacity:1; }}
#hud button {{ background:#111722; color:var(--fg); border:1px solid #243041; border-radius:8px; padding:6px 10px; font:inherit; cursor:pointer; }}
#notes {{ position:fixed; left:0; right:0; bottom:4px; max-height:38vh; overflow:auto; z-index:4; display:none;
  background:rgba(8,11,16,.94); border-top:1px solid #243041; padding:16px 24px 56px; font-size:15px; line-height:1.7; }}
#notes-body {{ white-space:pre-wrap; }}
#notes.show {{ display:block; }}
#notes h4 {{ margin:0 0 6px; font-size:12px; letter-spacing:.12em; color:var(--accent); font-weight:600; }}
#help {{ position:fixed; left:16px; bottom:14px; z-index:6; font-size:12px; color:var(--dim); opacity:0; transition:opacity .3s; }}
body:hover #help {{ opacity:1; }}
@media print {{
  html,body {{ overflow:visible; height:auto; background:#000; }}
  #bar,#hud,#notes,#help {{ display:none !important; }}
  #stage {{ position:static; transform:none !important; width:1920px; height:auto; }}
  #stage > section {{ position:relative; opacity:1; visibility:visible; page-break-after:always; }}
  [data-build-in] {{ opacity:1 !important; transform:none !important; }}
  @page {{ size:1920px 1080px; margin:0; }}
}}
</style>
</head>
<body>
<div id="stage">
{chr(10).join(sections)}
</div>
<div id="bar"><i></i></div>
<div id="notes" aria-live="polite"><h4>讲者备注</h4><div id="notes-body"></div></div>
<div id="help">← → 翻页 · N 备注 · F 全屏 · G 跳页 · 数字+回车 跳页</div>
<div id="hud"><button id="b-prev" aria-label="上一页">←</button><span id="pg"></span><button id="b-next" aria-label="下一页">→</button><button id="b-notes">备注</button><button id="b-full">全屏</button></div>
<script>
const NOTES = {json.dumps(notes, ensure_ascii=False)};
const OUTLINE = {json.dumps(outline, ensure_ascii=False)};
const stage = document.getElementById('stage');
const slides = [...stage.children];
const total = slides.length;
let cur = 0, typed = '';

function fit() {{
  const s = Math.min(innerWidth / 1920, innerHeight / 1080);
  stage.style.transform = `translate(-50%, -50%) scale(${{s}})`;
}}
function loadEmbeds(i, on) {{
  const s = slides[i]; if (!s) return;
  s.querySelectorAll('iframe.xe').forEach(f => {{
    if (on && !f.srcdoc) f.srcdoc = f.dataset.srcdoc;
    if (!on && f.srcdoc) {{ f.removeAttribute('srcdoc'); f.src = 'about:blank'; }}
  }});
}}
function builds(s) {{
  const els = [...s.querySelectorAll('[data-build-in]')];
  els.forEach(e => e.classList.remove('in'));
  els.map(e => [e, parseInt((e.dataset.buildIn.split(' ')[1]) || '1', 10)])
     .forEach(([e, k]) => setTimeout(() => s.classList.contains('on') && e.classList.add('in'), 120 + (k - 1) * 260));
}}
function go(i, push = true) {{
  i = Math.max(0, Math.min(total - 1, i));
  slides.forEach((s, k) => {{
    const near = Math.abs(k - i) <= 1;
    loadEmbeds(k, near);
    s.classList.toggle('on', k === i);
  }});
  cur = i;
  builds(slides[i]);
  document.getElementById('pg').textContent = `${{i + 1}} / ${{total}}`;
  document.querySelector('#bar i').style.width = `${{(i + 1) / total * 100}}%`;
  document.getElementById('notes-body').textContent = NOTES[i] || '（本页没有备注）';
  const sec = [...OUTLINE].reverse().find(o => o.n <= i + 1);
  document.title = `${{i + 1}}. ${{sec ? sec.t : ''}}`.trim();
  if (push) history.replaceState(null, '', '#' + (i + 1));
}}
function toggleNotes() {{ document.getElementById('notes').classList.toggle('show'); }}
function full() {{ document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); }}
addEventListener('keydown', e => {{
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key;
  if (/^[0-9]$/.test(k)) {{ typed += k; return; }}
  if (k === 'Enter' && typed) {{ go(parseInt(typed, 10) - 1); typed = ''; return; }}
  typed = '';
  if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(k)) {{ e.preventDefault(); go(cur + 1); }}
  else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(k)) {{ e.preventDefault(); go(cur - 1); }}
  else if (k === 'Home') go(0);
  else if (k === 'End') go(total - 1);
  else if (k === 'n' || k === 'N') toggleNotes();
  else if (k === 'f' || k === 'F') full();
  else if (k === 'g' || k === 'G') {{ const v = prompt(`跳到第几页（1–${{total}}）`); if (v) go(parseInt(v, 10) - 1); }}
}});
stage.addEventListener('click', e => {{ if (!e.target.closest('a')) go(cur + (e.clientX < innerWidth / 3 ? -1 : 1)); }});
document.getElementById('b-prev').onclick = () => go(cur - 1);
document.getElementById('b-next').onclick = () => go(cur + 1);
document.getElementById('b-notes').onclick = toggleNotes;
document.getElementById('b-full').onclick = full;
addEventListener('resize', fit);
addEventListener('hashchange', () => go((parseInt(location.hash.slice(1), 10) || 1) - 1, false));
addEventListener('beforeprint', () => slides.forEach((s, k) => loadEmbeds(k, true)));
fit();
go((parseInt(location.hash.slice(1), 10) || 1) - 1, false);
</script>
</body>
</html>
"""
OUT.write_text(page, encoding="utf-8")
print(f"wrote {OUT.relative_to(HERE.parent.parent)}  ({len(page.encode()) // 1024} KB, {len(order)} slides)")
