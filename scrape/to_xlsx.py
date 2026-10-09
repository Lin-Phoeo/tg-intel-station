#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Build a multi-sheet Excel workbook (xlsxwriter, constant memory)."""
import json, os, re, collections, datetime
import xlsxwriter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'data', 'valuable_sorted.jsonl')
OUTDIR = os.path.join(ROOT, 'output', '数据')
os.makedirs(OUTDIR, exist_ok=True)
OUT = os.path.join(OUTDIR, 'Telegram资源精选.xlsx')

ILLEGAL = re.compile('[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\ud800-\udfff]')
def clean(v):
    if v is None:
        return ''
    return ILLEGAL.sub('', str(v))

CAT_ORDER = ['羊毛优惠', '项目副业', '实用工具', '开源项目', 'AI与科技', '服务器网络', '账号会员', '学习资源', '数码硬件', '资讯热点', '其他']
HEAD = ['日期', '频道', '分类', '标签', '价值分', '浏览', '正文', '链接', '原文']
WIDTHS = [11, 16, 10, 18, 8, 9, 80, 36, 36]
DESC = {
    '羊毛优惠': '免费/折扣/限时/抽奖/补贴等可直接省钱的信息',
    '项目副业': '可落地变现的项目、副业思路、信息差',
    '实用工具': '软件、网站、脚本、插件等效率工具',
    '开源项目': 'GitHub 等开源仓库与自建方案',
    'AI与科技': 'AI 模型、智能体、科技数码资讯',
    '服务器网络': 'VPS、节点、CDN、域名等网络资源',
    '账号会员': '账号、会员、激活码、合租拼车',
    '学习资源': '教程、课程、电子书、资料',
    '数码硬件': '硬件、外设、评测与开箱',
    '资讯热点': '行业资讯与热点',
    '其他': '未归入上述分类的内容',
}

counts = collections.Counter()
total = 0
with open(SRC, 'r', encoding='utf-8') as f:
    for line in f:
        if not line.strip():
            continue
        try:
            it = json.loads(line)
        except Exception:
            continue
        counts[it.get('primary') or '其他'] += 1
        total += 1
print('source rows', total, flush=True)

wb = xlsxwriter.Workbook(OUT, {'constant_memory': True, 'strings_to_urls': False})
fh = wb.add_format({'bold': True, 'font_color': 'white', 'bg_color': '#2F6F4E', 'align': 'left', 'valign': 'vcenter'})
ft = wb.add_format({'bold': True, 'font_size': 14})
fw = wb.add_format({'text_wrap': False, 'valign': 'top'})
fl = wb.add_format({'font_color': '#0563C1', 'valign': 'top'})
fn = wb.add_format({'valign': 'top', 'align': 'right'})

ws_info = wb.add_worksheet('说明')
ws_info.set_column(0, 0, 18)
ws_info.set_column(1, 1, 12)
ws_info.set_column(2, 2, 60)
ws_info.write(0, 0, 'Telegram 频道资源精选库', ft)
ws_info.write(1, 0, '数据条目'); ws_info.write(1, 1, total)
ws_info.write(2, 0, '生成时间'); ws_info.write(2, 1, datetime.datetime.now().strftime('%Y-%m-%d %H:%M'))
ws_info.write(4, 0, '工作表', fh); ws_info.write(4, 1, '条目数', fh); ws_info.write(4, 2, '说明', fh)
r = 5
for c in CAT_ORDER:
    if counts.get(c):
        ws_info.write(r, 0, c); ws_info.write(r, 1, counts[c]); ws_info.write(r, 2, DESC.get(c, ''))
        r += 1
ws_info.write(r, 0, '合计'); ws_info.write(r, 1, total)

ws_stat = wb.add_worksheet('统计')
ws_stat.set_column(0, 0, 18); ws_stat.set_column(1, 1, 12)
ws_stat.write(0, 0, '分类', fh); ws_stat.write(0, 1, '条目数', fh)
r = 1
for c in CAT_ORDER:
    if counts.get(c):
        ws_stat.write(r, 0, c); ws_stat.write(r, 1, counts[c]); r += 1
ws_stat.write(r, 0, '合计'); ws_stat.write(r, 1, total)

sheets = {}
for c in CAT_ORDER:
    if not counts.get(c):
        continue
    s = wb.add_worksheet(c[:28])
    for i, w in enumerate(WIDTHS):
        s.set_column(i, i, w)
    s.write_row(0, 0, HEAD, fh)
    s.freeze_panes(1, 0)
    s.autofilter(0, 0, 0, len(HEAD) - 1)
    sheets[c] = s

cur = None
ws = None
r = 1
n = 0
errs = 0
with open(SRC, 'r', encoding='utf-8') as f:
    for line in f:
        if not line.strip():
            continue
        try:
            it = json.loads(line)
        except Exception:
            continue
        c = it.get('primary') or '其他'
        if c not in sheets:
            continue
        if c != cur:
            ws = sheets[c]; cur = c; r = 1
        link = ''
        if it.get('links'):
            link = it['links'][0]
        elif it.get('lp'):
            link = it['lp'][0].get('u', '')
        try:
            ws.write(r, 0, clean((it.get('date') or '')[:10]))
            ws.write(r, 1, clean(it.get('channel')))
            ws.write(r, 2, clean(c))
            ws.write(r, 3, clean(' '.join(it.get('tags') or [])))
            ws.write_number(r, 4, float(it.get('value') or 0))
            ws.write_number(r, 5, int(it.get('views') or 0))
            ws.write(r, 6, clean((it.get('text') or '').replace('\n', ' ')[:600]), fw)
            ws.write(r, 7, clean(link), fl)
            ws.write(r, 8, clean(it.get('url')), fl)
            r += 1
            n += 1
        except Exception as ex:
            errs += 1
            if errs < 5:
                print('ROWERR', it.get('channel'), it.get('id'), repr(ex), flush=True)
wb.close()
print('WROTE', OUT, flush=True)
print('rows written', n, 'errors', errs, 'size MB', round(os.path.getsize(OUT) / 1024 / 1024, 1), flush=True)
