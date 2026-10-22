#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 ECDICT 的 ecdict.csv 裁成分片静态数据，供纯前端词典站按需加载。

输出（en-dict/data/）：
  core.js      高频核心词（首屏即用）
  shard-a.js … 各首字母分片（懒加载）
  cn.js        中文反查倒排索引
  meta.js      统计信息
条目使用数组而非对象，减小体积：
  [word, phonetic, translation, definition, pos, collins, oxford, tag, bnc, frq, exchange, audio]
"""
import csv
import json
import os
import re
import sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "ecdict.csv")
OUT = os.path.join(ROOT, "data")
os.makedirs(OUT, exist_ok=True)

CJK = re.compile(r"[\u4e00-\u9fff]")
SPLIT_CN = re.compile(r"[，,；;/、。\s（）()\[\]【】]+")
FORM_KEYS = {"p", "d", "i", "3", "r", "t", "s"}

csv.field_size_limit(10 * 1024 * 1024)


def keep(row):
    """筛选值得收录的词条：考试词/核心词/常用词/短词。"""
    w = row["word"].strip()
    if not w or len(w) > 40:
        return False
    if not row["translation"].strip():
        return False
    if not re.fullmatch(r"[A-Za-z][A-Za-z\-'. ]*", w):
        return False
    try:
        collins = int(row["collins"].strip() or 0)
    except ValueError:
        collins = 0
    try:
        bnc = int(row["bnc"].strip() or 0)
    except ValueError:
        bnc = 0
    try:
        frq = int(row["frq"].strip() or 0)
    except ValueError:
        frq = 0
    if collins >= 1 or row["oxford"].strip() == "1" or row["tag"].strip():
        return True
    if (0 < bnc <= 40000) or (0 < frq <= 40000):
        return True
    # 短词几乎都是高频功能词/常用缩写，值得保留
    if len(w.replace("-", "").replace("'", "").replace(" ", "")) <= 2:
        return True
    return False


def rank_of(row):
    """越小越重要，用于排序与首屏选取。"""
    try:
        collins = int(row["collins"].strip() or 0)
    except ValueError:
        collins = 0
    try:
        bnc = int(row["bnc"].strip() or 0)
    except ValueError:
        bnc = 0
    try:
        frq = int(row["frq"].strip() or 0)
    except ValueError:
        frq = 0
    base = min([v for v in (bnc, frq) if v > 0] or [30000])
    score = base - collins * 1200
    if row["oxford"].strip() == "1":
        score -= 3000
    if row["tag"].strip():
        score -= 800
    return score


def to_arr(row):
    def num(k):
        v = row[k].strip()
        return int(v) if v.isdigit() else 0

    def txt(k):
        # 源文件用字面 "\n" 分隔多行释义，还原成真换行
        return row[k].strip().replace("\\n", "\n")

    return [
        row["word"].strip(),
        row["phonetic"].strip(),
        txt("translation"),
        txt("definition"),
        row["pos"].strip(),
        num("collins"),
        1 if row["oxford"].strip() == "1" else 0,
        row["tag"].strip(),
        num("bnc"),
        num("frq"),
        row["exchange"].strip(),
        row["audio"].strip(),
    ]


def build_cn_index(entries):
    """中文 -> 英文 倒排。只对较高频词建索引以控体积。"""
    idx = defaultdict(list)
    for e in entries:
        rank = rank_of_arr(e)
        if rank > 24000:
            continue
        word = e[0]
        for line in e[2].split("\n"):
            line = re.sub(r"^[a-zA-Z]+\.\s*", "", line)  # 去掉行首词性
            for tok in SPLIT_CN.split(line):
                tok = tok.strip()
                if not tok or not CJK.search(tok):
                    continue
                tok = re.sub(r"^(的|地|得)", "", tok)
                if not (1 <= len(tok) <= 8):
                    continue
                bucket = idx[tok]
                if word not in bucket and len(bucket) < 4:
                    bucket.append(word)
    return {k: v for k, v in idx.items() if v}


def rank_of_arr(e):
    collins, oxford, tag, bnc, frq = e[5], e[6], e[7], e[8], e[9]
    base = min([v for v in (bnc, frq) if v > 0] or [30000])
    score = base - collins * 1200 - (3000 if oxford else 0) - (800 if tag else 0)
    return score


def main():
    if not os.path.exists(SRC):
        sys.exit("缺少 ecdict.csv")

    seen = set()
    entries = []
    total = 0
    with open(SRC, "r", encoding="utf-8", errors="replace", newline="") as f:
        for row in csv.DictReader(f):
            total += 1
            if not row or not row.get("word"):
                continue
            if not keep(row):
                continue
            key = row["word"].strip().lower()
            if key in seen:
                continue
            seen.add(key)
            entries.append(to_arr(row))

    entries.sort(key=lambda e: e[0].lower())
    words_with_rank = sorted(entries, key=rank_of_arr)

    # 首屏核心词：柯林斯 3 星以上 + 牛津核心词，控制在 ~4000 条
    core = [e for e in words_with_rank if e[5] >= 3 or e[6]][:4200]
    core.sort(key=lambda e: e[0].lower())
    core_words = {e[0] for e in core}

    shards = defaultdict(list)
    for e in entries:
        head = e[0][0].lower()
        bucket = head if "a" <= head <= "z" else "_"
        shards[bucket].append(e)

    def dump(name, payload, var):
        path = os.path.join(OUT, name)
        with open(path, "w", encoding="utf-8") as f:
            f.write("(window.DICT=window.DICT||{}).%s=\n" % var)
            json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
            f.write(";\n")
        return os.path.getsize(path)

    sizes = {}
    sizes["core"] = dump("core.js", core, "core")
    for k, v in sorted(shards.items()):
        sizes["shard-" + k] = dump("shard-%s.js" % k, v, "s_" + (k if k != "_" else "other"))

    cn = build_cn_index(entries)
    sizes["cn"] = dump("cn.js", cn, "cn")

    # 全局词表（词头 + 重要度），用于跨分片联想与拼写纠正
    lex = [[e[0], max(1, min(99999, rank_of_arr(e)))] for e in words_with_rank]
    lex.sort(key=lambda x: x[0].lower())
    sizes["lex"] = dump("lex.js", lex, "lex")

    # 考试标签索引
    tags = defaultdict(list)
    for e in words_with_rank:
        for t in e[7].split():
            if len(tags[t]) < 6000:
                tags[t].append(e[0])
    sizes["tags"] = dump("tags.js", tags, "tags")

    # 屈折变形 -> 原形 反查索引（含不规则动词，如 ran -> run）
    forms = defaultdict(set)
    for e in words_with_rank:
        if rank_of_arr(e) > 28000:
            continue
        for pair in e[10].split("/"):
            i = pair.find(":")
            if i < 0:
                continue
            k, v = pair[:i].strip(), pair[i + 1:]
            if k not in FORM_KEYS:
                continue
            for tok in v.split(","):
                tok = tok.strip().lower()
                if tok and 1 <= len(tok) <= 30 and tok != e[0].lower():
                    forms[tok].add(e[0])
    forms_idx = {k: sorted(v)[:3] for k, v in forms.items()}
    sizes["forms"] = dump("forms.js", forms_idx, "forms")

    meta = {
        "total_raw": total,
        "total": len(entries),
        "core": len(core),
        "shards": sorted(shards.keys()),
        "cn_keys": len(cn),
        "built": "2026-10-22",
    }
    sizes["meta"] = dump("meta.js", meta, "meta")

    print("原始行数: %d" % total)
    print("收录词条: %d" % len(entries))
    print("核心词:   %d" % len(core))
    print("中文索引: %d 条" % len(cn))
    total_mb = sum(sizes.values()) / 1024 / 1024
    print("数据体积: %.1f MB" % total_mb)
    big = sorted(sizes.items(), key=lambda kv: -kv[1])[:6]
    for k, v in big:
        print("  %-12s %6.0f KB" % (k, v / 1024))


if __name__ == "__main__":
    main()
