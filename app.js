/* =========================================================
   英汉词典 · 前端查询引擎
   数据：ECDICT（MIT）预处理为字母分片，按需加载
   ========================================================= */
(function () {
  'use strict';

  const DICT = (window.DICT = window.DICT || {});

  /* 条目数组的字段索引 */
  const F = {
    W: 0, PH: 1, TR: 2, DE: 3, POS: 4,
    COL: 5, OXF: 6, TAG: 7, BNC: 8, FRQ: 9, EX: 10, AU: 11,
  };

  const TAG_NAMES = {
    zk: '中考', gk: '高考', cet4: '四级', cet6: '六级',
    ky: '考研', ielts: '雅思', toefl: '托福', gre: 'GRE',
  };

  const EX_NAMES = {
    p: '过去式', d: '过去分词', i: '现在分词', '3': '第三人称单数',
    r: '比较级', t: '最高级', s: '复数', '0': '原形', '1': '原形变换',
  };

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /* ---------------- 存储 ---------------- */
  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem('oxf.' + key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('oxf.' + key, JSON.stringify(value)); } catch (e) { /* 无痕模式降级 */ }
    },
  };

  let vocab = store.get('vocab', []);
  let history = store.get('history', []);

  /* ---------------- 分片加载 ---------------- */
  const letterReady = new Set();
  const wordMap = new Map();
  const srcCache = new Map();

  function loadSrc(src) {
    if (srcCache.has(src)) return srcCache.get(src);
    const p = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('无法加载 ' + src));
      document.head.appendChild(s);
    });
    srcCache.set(src, p);
    return p;
  }

  function varNameOf(letter) {
    return 's_' + (letter === '_' ? 'other' : letter);
  }

  async function ensureLetter(ch) {
    const l = /[a-z]/.test(ch) ? ch : '_';
    if (letterReady.has(l)) return;
    await loadSrc('data/shard-' + l + '.js');
    const arr = DICT[varNameOf(l)] || [];
    for (let i = 0; i < arr.length; i++) {
      wordMap.set(arr[i][F.W].toLowerCase(), arr[i]);
    }
    letterReady.add(l);
  }

  let lexReady = null;
  const lexIndex = new Map();
  function ensureLex() {
    if (lexReady) return lexReady;
    lexReady = loadSrc('data/lex.js').then(() => {
      const arr = DICT.lex || [];
      for (let i = 0; i < arr.length; i++) lexIndex.set(arr[i][0].toLowerCase(), arr[i][1]);
    }).catch(() => { });
    return lexReady;
  }

  let cnReady = null;
  function ensureCN() {
    if (cnReady) return cnReady;
    cnReady = loadSrc('data/cn.js').catch(() => { });
    return cnReady;
  }

  let tagsReady = null;
  function ensureTags() {
    if (tagsReady) return tagsReady;
    tagsReady = loadSrc('data/tags.js').catch(() => { });
    return tagsReady;
  }

  let formsReady = null;
  function ensureForms() {
    if (formsReady) return formsReady;
    formsReady = loadSrc('data/forms.js').catch(() => { });
    return formsReady;
  }

  /* ---------------- 文本工具 ---------------- */
  const hasCJK = (s) => /[\u4e00-\u9fff]/.test(s);

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function brief(e, len) {
    const t = (e[F.TR] || '').split('\n')[0] || '';
    const clean = t.replace(/^[a-zA-Z]{1,6}\.\s*/, '').replace(/^\[[^\]]{1,10}\]\s*/, '');
    return clean.length > (len || 40) ? clean.slice(0, len || 40) + '…' : clean;
  }

  /* 词形还原候选 */
  function lemmaCandidates(w) {
    const out = [];
    const add = (x) => { if (x && x.length > 1 && x !== w && out.indexOf(x) < 0) out.push(x); };
    if (/ies$/.test(w)) add(w.slice(0, -3) + 'y');
    if (/ves$/.test(w)) { add(w.slice(0, -3) + 'f'); add(w.slice(0, -3) + 'fe'); }
    if (/es$/.test(w)) add(w.slice(0, -2));
    if (/s$/.test(w) && !/ss$/.test(w)) add(w.slice(0, -1));
    if (/ied$/.test(w)) add(w.slice(0, -3) + 'y');
    if (/ed$/.test(w)) {
      add(w.slice(0, -2));
      add(w.slice(0, -1));
      if (/(\w)\1ed$/.test(w)) add(w.slice(0, -3));
    }
    if (/ing$/.test(w)) {
      add(w.slice(0, -3));
      add(w.slice(0, -3) + 'e');
      if (/(\w)\1ing$/.test(w)) add(w.slice(0, -4));
    }
    if (/ier$/.test(w)) add(w.slice(0, -3) + 'y');
    if (/er$/.test(w)) { add(w.slice(0, -2)); add(w.slice(0, -1)); if (/(\w)\1er$/.test(w)) add(w.slice(0, -3)); }
    if (/iest$/.test(w)) add(w.slice(0, -4) + 'y');
    if (/est$/.test(w)) { add(w.slice(0, -3)); add(w.slice(0, -2)); if (/(\w)\1est$/.test(w)) add(w.slice(0, -4)); }
    if (/ily$/.test(w)) add(w.slice(0, -3) + 'y');
    if (/ly$/.test(w)) add(w.slice(0, -2));
    return out;
  }

  /* 编辑距离（OSA），用于拼写纠错 */
  function distance(a, b) {
    const m = a.length, n = b.length;
    if (Math.abs(m - n) > 2) return 99;
    const d = [];
    for (let i = 0; i <= m; i++) { d[i] = [i]; }
    for (let j = 0; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        }
      }
    }
    return d[m][n];
  }

  /* ---------------- 查询 ---------------- */
  async function lookup(raw) {
    const q = String(raw || '').trim();
    if (!q) return null;

    if (hasCJK(q)) return lookupCN(q);

    const key = q.toLowerCase().replace(/\s+/g, ' ');
    await ensureLetter(key[0]);

    if (wordMap.has(key)) return { entry: wordMap.get(key) };

    /* 屈折变形反查（覆盖不规则动词，如 ran -> run） */
    await ensureForms();
    const formLemmas = (DICT.forms && DICT.forms[key]) || null;
    if (formLemmas) {
      for (const cand of formLemmas) {
        await ensureLetter(cand[0].toLowerCase());
        const hit = wordMap.get(cand.toLowerCase());
        if (hit) return { entry: hit, inflected: key };
      }
    }

    /* 规则词形还原 */
    for (const cand of lemmaCandidates(key)) {
      await ensureLetter(cand[0]);
      if (wordMap.has(cand)) return { entry: wordMap.get(cand), inflected: key };
    }

    /* 含连字符/空格时尝试拆分 */
    if (/[\s-]/.test(key)) {
      const first = key.split(/[\s-]/)[0];
      await ensureLetter(first[0]);
      if (wordMap.has(first)) return { entry: wordMap.get(first), partial: key };
    }

    /* 前缀与拼写建议 */
    await ensureLex();
    const prefix = [], fuzzy = [];
    for (const [w] of lexIndex) {
      if (w.startsWith(key) && w !== key && prefix.length < 40) prefix.push(w);
      if (Math.abs(w.length - key.length) <= 2 && fuzzy.length < 40) {
        if (distance(key, w) <= 2) fuzzy.push(w);
      }
    }
    const rank = (w) => lexIndex.get(w) || 99999;
    prefix.sort((a, b) => rank(a) - rank(b));
    fuzzy.sort((a, b) => distance(key, a) - distance(key, b) || rank(a) - rank(b));

    return {
      miss: true,
      query: q,
      prefix: prefix.slice(0, 8),
      fuzzy: fuzzy.slice(0, 8),
    };
  }

  async function lookupCN(q) {
    await ensureCN();
    const cn = DICT.cn || {};
    if (cn[q] && cn[q].length) return { cnHit: q, words: cn[q].slice() };

    const hits = [];
    for (const k in cn) {
      if (k.indexOf(q) >= 0) {
        hits.push([k, cn[k]]);
        if (hits.length > 60) break;
      }
    }
    if (!hits.length) return { miss: true, query: q, cn: true, prefix: [], fuzzy: [] };

    hits.sort((a, b) => Math.abs(a[0].length - q.length) - Math.abs(b[0].length - q.length));

    const words = [];
    for (const [, list] of hits) {
      for (const w of list) if (words.indexOf(w) < 0) words.push(w);
      if (words.length >= 12) break;
    }
    return { cnHit: q, words, cnMatched: hits.map((h) => h[0]).slice(0, 8) };
  }

  /* ---------------- 释义解析 ---------------- */
  function parseSenses(text) {
    const lines = String(text || '').split('\n').map((s) => s.trim()).filter(Boolean);
    const items = [];
    for (const line of lines) {
      let m = line.match(/^([a-zA-Z]{1,7}\.)\s*(.*)$/);
      if (m) { items.push({ pos: m[1].toLowerCase(), text: m[2] }); continue; }
      m = line.match(/^\[([^\]]{1,12})\]\s*(.*)$/);
      if (m) { items.push({ pos: '', domain: m[1], text: m[2] }); continue; }
      items.push({ pos: '', text: line });
    }
    /* 合并连续相同词性 */
    const out = [];
    for (const it of items) {
      const last = out[out.length - 1];
      if (last && it.pos && last.pos === it.pos && !it.domain && !last.domain) {
        last.text += '；' + it.text;
      } else {
        out.push({ pos: it.pos, domain: it.domain, text: it.text });
      }
    }
    return out;
  }

  /* 中文逗号转分号，符合双解词典义项分隔习惯 */
  function tidyCN(s) {
    return String(s || '').replace(/[,，]\s*/g, '；').replace(/；+/g, '；').replace(/；$/, '');
  }

  /* ---------------- 在线增强（发音 + 例句） ---------------- */
  const enrichCache = new Map();

  async function fetchEnrich(word) {
    const key = word.toLowerCase();
    if (enrichCache.has(key)) return enrichCache.get(key);
    const task = (async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      try {
        const res = await fetch(
          'https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(key),
          { signal: ctrl.signal }
        );
        if (!res.ok) throw new Error('not found');
        const data = await res.json();
        const out = { uk: '', us: '', examples: [], defs: [] };
        (data[0].phonetics || []).forEach((p) => {
          if (!p.audio) return;
          if (/-uk\.mp3/.test(p.audio)) out.uk = p.audio;
          else if (/-us\.mp3/.test(p.audio)) out.us = p.audio;
        });
        (data[0].meanings || []).forEach((m) => {
          (m.definitions || []).forEach((d) => {
            if (d.example && out.examples.length < 6 && out.examples.indexOf(d.example) < 0) {
              out.examples.push(d.example);
            }
          });
        });
        return out;
      } catch (e) {
        return null;
      } finally {
        clearTimeout(timer);
      }
    })();
    enrichCache.set(key, task);
    return task;
  }

  /* ---------------- 英文释义中译 ---------------- */
  let zhOn = store.get('zhOn', true);

  const ZH_API = 'https://transmart.qq.com/api/imt';
  /* 服务端仅校验请求体格式，不校验来源；CORS 允许任意站点 */
  const ZH_CK = 'browser-chrome-120.0.0-Windows-10-3f9a1c2e-8b4d-4e1a-9c7f-2d5e8a1b6c34-1700000000000';

  function getZhCache(word) {
    const v = store.get('zh.' + word.toLowerCase(), null);
    return Array.isArray(v) && v.length ? v : null;
  }

  function setZhCache(word, arr) {
    const key = word.toLowerCase();
    store.set('zh.' + key, arr);
    let keys = store.get('zhKeys', []);
    keys = keys.filter((k) => k !== key);
    keys.push(key);
    if (keys.length > 400) {
      keys.splice(0, keys.length - 400).forEach((k) => {
        try { localStorage.removeItem('oxf.zh.' + k); } catch (e) { }
      });
    }
    store.set('zhKeys', keys);
  }

  function postTranslate(texts) {
    return fetch(ZH_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        header: { fn: 'auto_translation', client_key: ZH_CK },
        type: 'plain',
        model_category: 'normal',
        text_domain: 'general',
        source: { lang: 'en', text_list: texts },
        target: { lang: 'zh' },
      }),
    }).then((res) => {
      if (!res.ok) throw new Error('http ' + res.status);
      return res.json();
    }).then((data) => {
      if (data.header && data.header.ret_code !== 'succ') throw new Error(data.header.ret_code);
      return data.auto_translation || [];
    });
  }

  async function translateTexts(texts) {
    const out = [];
    const BATCH = 20;
    for (let i = 0; i < texts.length; i += BATCH) {
      const chunk = texts.slice(i, i + BATCH);
      let part = null;
      for (let attempt = 0; attempt < 2 && !part; attempt++) {
        try {
          part = await postTranslate(chunk);
        } catch (e) {
          if (attempt === 0) await new Promise((r) => setTimeout(r, 420));
        }
      }
      if (!part || !part.length) return null;
      out.push.apply(out, part);
      if (i + BATCH < texts.length) await new Promise((r) => setTimeout(r, 160));
    }
    return out;
  }

  function applyZH(zh) {
    const body = $('#enBody');
    if (!body) return;
    $$('.en-item', body).forEach((el, i) => {
      const cell = el.querySelector('.en-zh');
      if (!cell) return;
      const t = zh[i];
      if (t && t.trim()) {
        cell.textContent = t;
        cell.hidden = false;
        cell.classList.remove('loading');
      } else {
        cell.hidden = true;
      }
    });
  }

  async function hydrateZH(word, senses, token) {
    const body = $('#enBody');
    if (!body || !senses.length) return;
    if (!zhOn) return;

    const cached = getZhCache(word);
    if (cached) { applyZH(cached); return; }

    const cells = $$('.en-zh', body);
    cells.forEach((c) => {
      c.hidden = false;
      c.classList.add('loading');
      c.textContent = '翻译中…';
    });

    const zh = await translateTexts(senses.map((s) => s.text));
    if (token !== renderToken) return;

    if (!zh) {
      cells.forEach((c) => { c.hidden = true; c.classList.remove('loading'); c.textContent = ''; });
      const t = $('#zhToggle');
      if (t) t.textContent = '中文 · 联网失败';
      return;
    }
    setZhCache(word, zh);
    applyZH(zh);
  }

  function bindZhToggle(word, senses) {
    const t = $('#zhToggle');
    if (!t) return;
    t.addEventListener('click', (e) => {
      e.stopPropagation();
      zhOn = !zhOn;
      store.set('zhOn', zhOn);
      t.textContent = '中文 · ' + (zhOn ? '开' : '关');
      const body = $('#enBody');
      if (!body) return;
      if (!zhOn) {
        $$('.en-zh', body).forEach((c) => { c.hidden = true; });
      } else {
        const cached = getZhCache(word);
        if (cached) applyZH(cached);
        else hydrateZH(word, senses, renderToken);
      }
    });
  }

  /* ---------------- 发音 ---------------- */
  let currentAudio = null;

  function speak(text, lang) {
    try {
      if (!window.speechSynthesis) return false;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      u.rate = 0.92;
      window.speechSynthesis.speak(u);
      return true;
    } catch (e) { return false; }
  }

  function playUrl(url) {
    if (currentAudio) { try { currentAudio.pause(); } catch (e) { } }
    currentAudio = new Audio(url);
    currentAudio.play().catch(() => { });
  }

  /* 朗读英文释义：优先英式语音，播放中按钮高亮 */
  let speakingBtn = null;

  function speakEn(text, btn) {
    try {
      const synth = window.speechSynthesis;
      if (!synth) { toast('当前浏览器不支持语音合成'); return; }
      synth.cancel();
      if (speakingBtn) { speakingBtn.classList.remove('playing'); speakingBtn = null; }
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-GB';
      u.rate = 0.95;
      const voices = synth.getVoices ? synth.getVoices() : [];
      if (voices.length) {
        const v = voices.find((x) => /^en[-_]GB/i.test(x.lang)) || voices.find((x) => /^en/i.test(x.lang));
        if (v) u.voice = v;
      }
      u.onstart = () => {
        if (btn && btn.isConnected) { btn.classList.add('playing'); speakingBtn = btn; }
      };
      u.onend = u.onerror = () => {
        if (btn && btn.isConnected) btn.classList.remove('playing');
        if (speakingBtn === btn) speakingBtn = null;
      };
      synth.speak(u);
    } catch (e) {
      toast('语音播放失败');
    }
  }

  /* ---------------- 渲染：词条 ---------------- */
  function stars(n) {
    if (!n) return '';
    let s = '';
    for (let i = 1; i <= 5; i++) s += i <= n ? '★' : '☆';
    return s;
  }

  function renderEntry(entry, ctx) {
    ctx = ctx || {};
    const word = entry[F.W];
    const ipa = entry[F.PH];
    const senses = parseSenses(entry[F.TR]);
    const enSenses = parseSenses(entry[F.DE]);
    const tags = (entry[F.TAG] || '').split(' ').filter(Boolean);
    const forms = parseExchange(entry[F.EX]);
    const inVocab = vocab.some((v) => v.w.toLowerCase() === word.toLowerCase());

    const badges = [];
    if (entry[F.OXF]) badges.push('<span class="badge core">牛津核心词</span>');
    if (entry[F.COL]) badges.push('<span class="badge stars" title="柯林斯 ' + entry[F.COL] + ' 星">' + stars(entry[F.COL]) + '</span>');
    tags.forEach((t) => {
      if (TAG_NAMES[t]) badges.push('<span class="badge exam">' + TAG_NAMES[t] + '</span>');
    });
    if (entry[F.BNC] || entry[F.FRQ]) {
      const parts = [];
      if (entry[F.BNC]) parts.push('BNC ' + entry[F.BNC]);
      if (entry[F.FRQ]) parts.push('COCA ' + entry[F.FRQ]);
      badges.push('<span class="badge freq">词频 ' + parts.join(' · ') + '</span>');
    }

    const hintHtml = ctx.inflected
      ? '<div class="hintbar"><span>' + esc(ctx.inflected) + ' 是</span><b data-word="' + esc(word) + '">' + esc(word) + '</b><span>的屈折形式，已为你定位到原形</span></div>'
      : '';

    const sensesHtml = senses.length
      ? '<ol class="senses">' + senses.map((s) => {
        const posCell = s.pos ? esc(s.pos) : '';
        const domain = s.domain ? '<span class="domain">' + esc(s.domain) + '</span>' : '';
        return '<li class="sense">' +
          '<div class="sense-pos">' + posCell + '</div>' +
          '<div class="sense-def">' + domain + esc(tidyCN(s.text)) + '</div>' +
          '</li>';
      }).join('') + '</ol>'
      : '<p class="empty">该词条暂无中文释义</p>';

    const enHtml = enSenses.length
      ? '<section class="block" id="enBlock">' +
      '<button class="block-head" aria-expanded="true" data-toggle>英文释义' +
      '<span class="zhtoggle" id="zhToggle">中文 · ' + (zhOn ? '开' : '关') + '</span>' +
      '<span class="caret">▾</span></button>' +
      '<div class="block-body def-en" id="enBody">' + enSenses.map((s, i) => (
        '<div class="en-item" data-i="' + i + '">' +
        '<span class="en-pos">' + esc(s.pos || '') + '</span>' +
        '<span class="en-text">' + esc(s.text) + '</span>' +
        '<span class="en-zh" hidden></span>' +
        '<button class="en-speak" data-speak="' + i + '" title="朗读本条释义" aria-label="朗读">' + iconSound() + '</button>' +
        '</div>'
      )).join('') + '</div></section>'
      : '';

    const formsHtml = forms.length
      ? '<section class="block"><button class="block-head" aria-expanded="true" data-toggle>词形变化<span class="caret">▾</span></button>' +
      '<div class="block-body"><div class="forms-grid">' +
      forms.map((f) => (
        '<a class="formcell" href="#/w/' + encodeURIComponent(f.v) + '">' +
        '<span class="fk">' + esc(f.label) + '</span>' +
        '<span class="fv">' + esc(f.v) + '</span></a>'
      )).join('') + '</div></div></section>'
      : '';

    const candHtml = (ctx.words && ctx.words.length > 1)
      ? '<section class="block"><div class="block-head" style="text-transform:none;letter-spacing:.05em">其他可能的对应词</div>' +
      '<div class="block-body"><div class="quickchips">' +
      ctx.words.filter((w) => w.toLowerCase() !== word.toLowerCase()).slice(0, 12).map((w) =>
        '<button data-word="' + esc(w) + '">' + esc(w) + '</button>').join('') +
      '</div></div></section>'
      : '';

    const cnNote = ctx.cnHit
      ? '<div class="hintbar"><span>中文「' + esc(ctx.cnHit) + '」匹配到 ' + ctx.words.length + ' 个词条</span></div>'
      : '';

    return '<article class="entry">' +
      cnNote + hintHtml +
      '<header class="entry-head">' +
      '<div>' +
      '<h1 class="entry-word">' + esc(word) + '</h1>' +
      '<div class="entry-ipa">' +
      (ipa ? '<span class="ipa-text">/' + esc(ipa) + '/</span>' : '<span class="ipa-text">—</span>') +
      '<div class="soundgroup" id="soundGroup">' +
      '<button class="soundbtn" data-voice="uk" data-word="' + esc(word) + '">' + iconSound() + '英</button>' +
      '<button class="soundbtn" data-voice="us" data-word="' + esc(word) + '">' + iconSound() + '美</button>' +
      '</div></div></div>' +
      '<div class="entry-tools">' +
      '<button class="toolbtn' + (inVocab ? ' on' : '') + '" data-vocab="' + esc(word) + '">' + iconStar() + (inVocab ? '已收藏' : '生词本') + '</button>' +
      '<button class="toolbtn" data-copy="' + esc(word) + '">' + iconCopy() + '复制</button>' +
      '</div>' +
      '</header>' +
      (badges.length ? '<div class="badges">' + badges.join('') + '</div>' : '') +
      sensesHtml +
      enHtml +
      formsHtml +
      candHtml +
      '<section class="block" id="exBlock" hidden>' +
      '<div class="block-head" style="text-transform:none;letter-spacing:.05em">例句<span class="caret" style="transform:none">· 在线</span></div>' +
      '<div class="block-body" id="exBody"></div>' +
      '</section>' +
      '</article>';
  }

  function parseExchange(ex) {
    if (!ex) return [];
    const out = [];
    String(ex).split('/').forEach((pair) => {
      const i = pair.indexOf(':');
      if (i < 0) return;
      const k = pair.slice(0, i).trim();
      const v = pair.slice(i + 1).split(',')[0].trim();
      if (!v || !EX_NAMES[k]) return;
      if (k === '0' || k === '1') return; /* 原形标记不展示 */
      out.push({ label: EX_NAMES[k], v: v });
    });
    return out;
  }

  const iconSound = () => '<svg viewBox="0 0 24 24"><path d="M4 9v6h3.5L13 19V5L7.5 9H4zm12.5-1.5a6 6 0 0 1 0 9"/></svg>';
  const iconStar = () => '<svg viewBox="0 0 24 24"><path d="M12 4l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 9.7l5.4-.8L12 4z"/></svg>';
  const iconCopy = () => '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>';

  /* ---------------- 渲染：空状态 ---------------- */
  function renderMiss(result) {
    const q = result.query;
    const block = (title, list, prefix) => {
      if (!list || !list.length) return '';
      return '<div class="miss-label">' + title + '</div>' +
        '<div class="quickchips" style="margin-bottom:22px">' +
        list.map((w) => '<button data-word="' + esc(w) + '">' +
          (prefix ? '<span style="opacity:.5">' + esc(q) + '</span>' + esc(w.slice(q.length)) : esc(w)) +
          '</button>').join('') + '</div>';
    };

    let html = '<div class="missword">' + esc(q) + '</div>';
    html += '<p class="miss-msg">' + (result.cn
      ? '中文索引中没有找到对应词条。可以尝试更短的关键词，或直接输入英文单词。'
      : '词库中未收录该词。可能是拼写有误，或属于专有名词/极低频词汇。') + '</p>';
    html += block('拼写相近', result.fuzzy);
    html += block('以此开头', result.prefix);
    if (!result.fuzzy.length && !result.prefix.length) {
      html += '<div class="miss-label">换个方式</div><div class="quickchips">' +
        '<button data-word="dictionary">dictionary</button>' +
        '<button data-word="serendipity">serendipity</button>' +
        '<button data-word="坚持">坚持</button></div>';
    }
    return html;
  }

  /* ---------------- 视图切换 ---------------- */
  const views = { home: $('#home'), entry: $('#entryView'), list: $('#listView'), miss: $('#missView') };

  function show(name) {
    Object.keys(views).forEach((k) => { views[k].hidden = k !== name; });
    if (name !== 'home') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function loading(on) {
    document.body.classList.toggle('is-loading', !!on);
  }

  /* ---------------- 主流程 ---------------- */
  let renderToken = 0;

  async function go(word, opts) {
    opts = opts || {};
    const token = ++renderToken;
    loading(true);
    try {
      const result = await lookup(word);
      if (token !== renderToken) return;

      if (!result || result.miss) {
        $('#missBox').innerHTML = renderMiss(result || { query: word, prefix: [], fuzzy: [] });
        show('miss');
        setHash('', true);
        return;
      }

      let entry = result.entry;
      let ctx = result;

      /* 中文命中：取匹配词中最高频的一个作为主词条 */
      if (!entry && result.words && result.words.length) {
        await ensureLex();
        const sorted = result.words.slice().sort((a, b) => (lexIndex.get(a) || 99999) - (lexIndex.get(b) || 99999));
        const pick = sorted[0];
        ctx = { cnHit: result.cnHit, words: result.words };
        await ensureLetter(pick[0].toLowerCase());
        entry = wordMap.get(pick.toLowerCase());
        if (entry && ctx.words.indexOf(pick) > 0) {
          ctx.words = [pick].concat(ctx.words.filter((w) => w !== pick));
        }
      }

      if (!entry) {
        $('#missBox').innerHTML = renderMiss({ query: word, prefix: [], fuzzy: [], cn: true });
        show('miss');
        return;
      }

      $('#entryBody').innerHTML = renderEntry(entry, ctx);
      show('entry');
      setHash(entry[F.W]);
      pushHistory(entry);
      bindEntryEvents(entry);
      hydrateExamples(entry[F.W], token);
      refreshVocabCount();
    } catch (err) {
      console.error(err);
      $('#missBox').innerHTML = '<div class="missword">加载失败</div><p class="miss-msg">' +
        '词库分片未能载入。若你是直接双击打开页面，请改用本地服务器访问（例如在本目录运行 <code>python -m http.server</code>）。</p>';
      show('miss');
    } finally {
      loading(false);
    }
  }

  function bindEntryEvents(entry) {
    const word = entry[F.W];

    /* 英文释义中译 + 朗读 */
    const enSenses = parseSenses(entry[F.DE]);
    if (enSenses.length) {
      bindZhToggle(word, enSenses);
      hydrateZH(word, enSenses, renderToken);
      $$('#enBody .en-speak').forEach((btn) => {
        btn.addEventListener('click', () => {
          const i = parseInt(btn.dataset.speak, 10);
          if (enSenses[i]) speakEn(enSenses[i].text, btn);
        });
      });
    }

    $$('#entryBody [data-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const body = btn.nextElementSibling;
        const open = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', String(!open));
        body.hidden = open;
      });
    });

    $$('#entryBody [data-voice]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const w = btn.dataset.word;
        const want = btn.dataset.voice;
        btn.classList.add('playing');
        setTimeout(() => btn.classList.remove('playing'), 900);
        const data = await fetchEnrich(w);
        const url = data && (want === 'uk' ? data.uk : data.us);
        if (url) playUrl(url);
        else speak(w, want === 'uk' ? 'en-GB' : 'en-US');
      });
    });

    const vbtn = $('#entryBody [data-vocab]');
    if (vbtn) {
      vbtn.addEventListener('click', () => {
        toggleVocab(entry);
        const on = vocab.some((v) => v.w.toLowerCase() === word.toLowerCase());
        vbtn.classList.toggle('on', on);
        vbtn.innerHTML = iconStar() + (on ? '已收藏' : '生词本');
      });
    }

    const cbtn = $('#entryBody [data-copy]');
    if (cbtn) {
      cbtn.addEventListener('click', () => {
        const text = word + (entry[F.PH] ? ' /' + entry[F.PH] + '/' : '') + '\n' + (entry[F.TR] || '');
        navigator.clipboard && navigator.clipboard.writeText(text)
          .then(() => toast('已复制释义'))
          .catch(() => toast('复制失败'));
      });
    }
  }

  async function hydrateExamples(word, token) {
    const block = $('#exBlock');
    const body = $('#exBody');
    if (!block || !body) return;
    const data = await fetchEnrich(word);
    if (token !== renderToken) return;
    if (!data || !data.examples.length) { block.hidden = true; return; }
    body.innerHTML = data.examples.map((ex) =>
      '<div class="ex-item"><span class="ex-en">' + esc(ex) + '</span>' +
      '<span class="ex-src">Wiktionary · CC BY-SA</span></div>').join('');
    block.hidden = false;
  }

  /* ---------------- 生词本 / 历史 ---------------- */
  function toggleVocab(entry) {
    const w = entry[F.W];
    const i = vocab.findIndex((v) => v.w.toLowerCase() === w.toLowerCase());
    if (i >= 0) {
      vocab.splice(i, 1);
      toast('已移出生词本');
    } else {
      vocab.unshift({ w: w, d: brief(entry, 50), t: Date.now() });
      toast('已加入生词本');
    }
    store.set('vocab', vocab);
    refreshVocabCount();
    renderHomeCards();
  }

  function pushHistory(entry) {
    const w = entry[F.W];
    history = history.filter((h) => h.w.toLowerCase() !== w.toLowerCase());
    history.unshift({ w: w, d: brief(entry, 50), t: Date.now() });
    if (history.length > 80) history = history.slice(0, 80);
    store.set('history', history);
    renderHomeCards();
  }

  function refreshVocabCount() {
    $('#vocabCount').textContent = String(vocab.length);
  }

  /* ---------------- 首页卡片 ---------------- */
  function renderHomeCards() {
    const recent = $('#recentBody');
    if (recent) {
      recent.innerHTML = history.length
        ? history.slice(0, 6).map((h) =>
          '<div class="miniword"><span class="mw" data-word="' + esc(h.w) + '">' + esc(h.w) + '</span>' +
          '<span class="md">' + esc(h.d) + '</span></div>').join('')
        : '<p class="empty">还没有查询记录</p>';
    }
    const vp = $('#vocabPreview');
    if (vp) {
      vp.innerHTML = vocab.length
        ? vocab.slice(0, 6).map((h) =>
          '<div class="miniword"><span class="mw" data-word="' + esc(h.w) + '">' + esc(h.w) + '</span>' +
          '<span class="md">' + esc(h.d) + '</span></div>').join('')
        : '<p class="empty">生词本为空，查词后可点“加入生词本”</p>';
    }
  }

  function wordOfTheDay() {
    const core = DICT.core || [];
    if (!core.length) return null;
    const d = new Date();
    const seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    return core[seed % core.length];
  }

  function renderWOTD(entry) {
    const box = $('#wotdBody');
    if (!box || !entry) return;
    box.innerHTML =
      '<div class="wotd-word">' + esc(entry[F.W]) + '</div>' +
      '<div class="wotd-ipa">' + (entry[F.PH] ? '/' + esc(entry[F.PH]) + '/' : '') + '</div>' +
      '<div class="wotd-def">' + esc(tidyCN(brief(entry, 90))) + '</div>' +
      '<a class="wotd-link" href="#/w/' + encodeURIComponent(entry[F.W]) + '">查看完整词条 →</a>';
  }

  /* ---------------- 列表视图 ---------------- */
  let listState = { words: [], shown: 0, step: 80 };

  async function openList(title, words, meta) {
    listState = { words: words, shown: 0, step: 80 };
    $('#listTitle').textContent = title;
    $('#listMeta').textContent = meta || ('共 ' + words.length + ' 词');
    $('#wordgrid').innerHTML = '';
    $('#listMore').innerHTML = '';
    show('list');
    appendList();
  }

  function appendList() {
    const { words, step } = listState;
    const start = listState.shown;
    const slice = words.slice(start, start + step);
    listState.shown = start + slice.length;

    const frag = document.createElement('div');
    frag.innerHTML = slice.map((w) =>
      '<div class="wordcell" data-word="' + esc(w) + '"><span class="wc-w">' + esc(w) + '</span></div>'
    ).join('');
    const grid = $('#wordgrid');
    while (frag.firstChild) grid.appendChild(frag.firstChild);

    if (listState.shown < words.length) {
      $('#listMore').innerHTML = '<button class="loadmore">加载更多（已显示 ' + listState.shown + ' / ' + words.length + '）</button>';
      $('#listMore .loadmore').addEventListener('click', appendList);
    } else {
      $('#listMore').innerHTML = '<p class="empty">已显示全部 ' + words.length + ' 个词条</p>';
    }
  }

  /* ---------------- 哈希路由 ---------------- */
  let suppressHash = false;

  function setHash(word, clear) {
    suppressHash = true;
    if (!word) {
      history.replaceState && window.history.replaceState(null, '', location.pathname + location.search);
    } else {
      location.hash = '#/w/' + encodeURIComponent(word);
    }
    setTimeout(() => { suppressHash = false; }, 60);
  }

  function readHash() {
    const m = location.hash.match(/^#\/w\/(.+)$/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  /* ---------------- 搜索框 ---------------- */
  const qInput = $('#q');
  const qHero = $('#q2');
  const suggestBox = $('#suggest');
  let sugItems = [];
  let sugIndex = -1;

  function syncClear() {
    $('#searchform').classList.toggle('has-value', !!qInput.value);
  }

  function closeSuggest() {
    suggestBox.hidden = true;
    sugItems = [];
    sugIndex = -1;
  }

  function highlight(word, q) {
    const i = word.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return esc(word);
    return esc(word.slice(0, i)) + '<mark>' + esc(word.slice(i, i + q.length)) + '</mark>' + esc(word.slice(i + q.length));
  }

  async function buildSuggest(q) {
    if (!q) { closeSuggest(); return; }

    if (hasCJK(q)) {
      await ensureCN();
      const cn = DICT.cn || {};
      const rows = [];
      if (cn[q]) {
        cn[q].slice(0, 4).forEach((w) => rows.push({ w: w, t: q }));
      }
      for (const k in cn) {
        if (rows.length >= 8) break;
        if (k.indexOf(q) >= 0 && k !== q) {
          cn[k].slice(0, 2).forEach((w) => {
            if (!rows.some((r) => r.w === w)) rows.push({ w: w, t: k });
          });
        }
      }
      paintSuggest(rows, q, true);
      return;
    }

    await ensureLex();
    const lower = q.toLowerCase();
    const rows = [];
    for (const [w, rank] of lexIndex) {
      if (w.startsWith(lower)) {
        rows.push({ w: w, rank: rank });
        if (rows.length >= 60) break;
      }
    }
    rows.sort((a, b) => (a.w.length - b.w.length) || (a.rank - b.rank));
    paintSuggest(rows.slice(0, 9), q, false);
  }

  function paintSuggest(rows, q, isCN) {
    if (!rows.length) { closeSuggest(); return; }
    sugItems = rows;
    sugIndex = -1;
    suggestBox.innerHTML = rows.map((r, i) =>
      '<div class="sug-item" role="option" data-idx="' + i + '" data-word="' + esc(r.w) + '">' +
      '<span class="w">' + (isCN ? esc(r.w) : highlight(r.w, q)) + '</span>' +
      '<span class="t">' + esc(r.t || '') + '</span>' +
      (r.rank && r.rank < 3000 ? '<span class="tier">高频</span>' : '') +
      '</div>').join('');
    suggestBox.hidden = false;
  }

  function moveSuggest(dir) {
    if (!sugItems.length) return;
    sugIndex = (sugIndex + dir + sugItems.length) % sugItems.length;
    $$('.sug-item', suggestBox).forEach((el, i) => el.classList.toggle('active', i === sugIndex));
    const active = $('.sug-item.active', suggestBox);
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
  }

  let suggestTimer = null;
  function onType(value) {
    syncClear();
    clearTimeout(suggestTimer);
    const q = value.trim();
    if (!q) { closeSuggest(); return; }
    suggestTimer = setTimeout(() => buildSuggest(q), 90);
  }

  function commit(word) {
    if (!word) return;
    qInput.value = word;
    syncClear();
    closeSuggest();
    qInput.blur();
    go(word);
  }

  /* ---------------- 事件绑定 ---------------- */
  function bindGlobal() {
    $('#searchform').addEventListener('submit', (e) => {
      e.preventDefault();
      if (sugIndex >= 0 && sugItems[sugIndex]) commit(sugItems[sugIndex].w);
      else commit(qInput.value.trim());
    });

    qInput.addEventListener('input', () => onType(qInput.value));
    qInput.addEventListener('focus', () => { if (qInput.value.trim()) onType(qInput.value); });

    qInput.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveSuggest(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveSuggest(-1); }
      else if (e.key === 'Escape') { closeSuggest(); qInput.blur(); }
    });

    $('#clearbtn').addEventListener('click', () => {
      qInput.value = '';
      syncClear();
      closeSuggest();
      qInput.focus();
    });

    suggestBox.addEventListener('mousedown', (e) => {
      const item = e.target.closest('.sug-item');
      if (item) { e.preventDefault(); commit(item.dataset.word); }
    });

    $('#heroGo').addEventListener('click', () => {
      const v = qHero.value.trim();
      if (v) commit(v);
    });

    qHero.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(qHero.value.trim()); }
    });

    $('#quickchips').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-tag]');
      if (b) browseTag(b.dataset.tag);
    });

    $('#randomWord').addEventListener('click', () => {
      const core = DICT.core || [];
      if (!core.length) return;
      const e = core[Math.floor(Math.random() * core.length)];
      renderWOTD(e);
    });

    $('#brand').addEventListener('click', (e) => {
      e.preventDefault();
      show('home');
      setHash('');
      renderHomeCards();
    });

    /* 全局点击：词条链接、卡片词 */
    document.addEventListener('click', (e) => {
      const w = e.target.closest('[data-word]');
      if (w && !e.target.closest('.sug-item')) {
        e.preventDefault();
        go(w.dataset.word);
        return;
      }
      const a = e.target.closest('a[href^="#/w/"]');
      if (a) {
        e.preventDefault();
        go(decodeURIComponent(a.getAttribute('href').replace('#/w/', '')));
      }
    });

    /* 顶栏按钮 */
    $$('.navbtn[data-act]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const act = btn.dataset.act;
        if (act === 'vocab') openDrawer('vocab');
        else if (act === 'history') openDrawer('history');
        else if (act === 'theme') toggleTheme();
        else if (act === 'about') $('#aboutModal').hidden = false;
      });
    });

    $('#themeBtn').addEventListener('click', (e) => { e.stopPropagation(); });

    $('#aboutOk').addEventListener('click', () => { $('#aboutModal').hidden = true; });
    $('#aboutModal').addEventListener('click', (e) => {
      if (e.target.id === 'aboutModal') $('#aboutModal').hidden = true;
    });

    $('#drawerClose').addEventListener('click', closeDrawer);
    $('#scrim').addEventListener('click', closeDrawer);

    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== qInput && document.activeElement !== qHero) {
        e.preventDefault();
        qInput.focus();
      }
      if (e.key === 'Escape') {
        closeDrawer();
        $('#aboutModal').hidden = true;
      }
    });

    window.addEventListener('hashchange', () => {
      if (suppressHash) return;
      const w = readHash();
      if (w) { go(w); return; }
      const t = location.hash.match(/^#\/tag\/(\w+)$/);
      if (t) { browseTag(t[1]); return; }
      show('home');
    });
  }

  function browseTag(tag) {
    setHashSilent('#/tag/' + tag);
    ensureTags().then(async () => {
      await ensureLex();
      const list = (DICT.tags || {})[tag] || [];
      if (!list.length) {
        toast('该分类暂无数据');
        return;
      }
      const sorted = list.slice().sort((a, b) => (lexIndex.get(a) || 99999) - (lexIndex.get(b) || 99999));
      openList((TAG_NAMES[tag] || tag) + '核心词汇', sorted, TAG_NAMES[tag] + ' 词汇 · 按词频排序 · 共 ' + sorted.length + ' 词');
    });
  }

  function setHashSilent(h) {
    suppressHash = true;
    location.hash = h;
    setTimeout(() => { suppressHash = false; }, 60);
  }

  /* ---------------- 抽屉 ---------------- */
  function openDrawer(kind) {
    const title = kind === 'vocab' ? '生词本' : '查询足迹';
    const data = kind === 'vocab' ? vocab : history;
    $('#drawerTitle').textContent = title + '（' + data.length + '）';
    $('#drawerBody').innerHTML = data.length
      ? data.map((h) =>
        '<div class="drow"><span class="dw" data-word="' + esc(h.w) + '">' + esc(h.w) + '</span>' +
        '<span class="dd">' + esc(h.d || '') + '</span>' +
        '<button class="dx" data-del="' + esc(h.w) + '">×</button></div>').join('')
      : '<p class="empty" style="padding:20px 10px">暂无记录</p>';
    $('#drawerFoot').innerHTML = data.length
      ? '<button class="ghostbtn" id="clearDrawer">清空' + title + '</button>' : '';

    $('#drawerBody').onclick = (e) => {
      const del = e.target.closest('[data-del]');
      if (del) {
        const w = del.dataset.del;
        if (kind === 'vocab') { vocab = vocab.filter((v) => v.w !== w); store.set('vocab', vocab); }
        else { history = history.filter((v) => v.w !== w); store.set('history', history); }
        refreshVocabCount();
        renderHomeCards();
        openDrawer(kind);
        return;
      }
      const wd = e.target.closest('[data-word]');
      if (wd) { closeDrawer(); go(wd.dataset.word); }
    };

    const clearer = $('#clearDrawer');
    if (clearer) {
      clearer.onclick = () => {
        if (kind === 'vocab') { vocab = []; store.set('vocab', []); }
        else { history = []; store.set('history', []); }
        refreshVocabCount();
        renderHomeCards();
        openDrawer(kind);
        toast('已清空');
      };
    }

    $('#drawer').hidden = false;
    $('#scrim').hidden = false;
  }

  function closeDrawer() {
    $('#drawer').hidden = true;
    $('#scrim').hidden = true;
  }

  /* ---------------- 主题 / 提示 ---------------- */
  function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    store.set('theme', next);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', next === 'dark' ? '#0b0e14' : '#f6f3ec');
  }

  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 1600);
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    const savedTheme = store.get('theme', null);
    if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);

    const meta = DICT.meta || {};
    if (meta.total) {
      $('#statWords').textContent = meta.total.toLocaleString('en-US');
      const aw = $('#aboutWords');
      if (aw) aw.textContent = meta.total.toLocaleString('en-US');
    }

    refreshVocabCount();
    renderHomeCards();
    renderWOTD(wordOfTheDay());
    bindGlobal();
    syncClear();

    const w = readHash();
    if (w) { go(w); }
    else if (/#\/tag\/(\w+)$/.test(location.hash)) {
      browseTag(location.hash.match(/^#\/tag\/(\w+)$/)[1]);
    }

    /* 首屏后台预热全局词表，使联想即时可用 */
    setTimeout(() => { ensureLex(); }, 600);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
