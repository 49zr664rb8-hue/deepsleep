/*
 * deepsleep —— 假接口层
 * 把官方 demo 的所有网络请求都拦下来：不连任何后端，只回固定话术。
 */
(function () {
  'use strict';

  // 这个 demo 用到了较新的数组方法，老内核要补上
  if (!Array.prototype.toReversed) {
    Array.prototype.toReversed = function () { return this.slice().reverse(); };
  }
  if (!Array.prototype.toSorted) {
    Array.prototype.toSorted = function (cmp) { return this.slice().sort(cmp); };
  }
  if (!Array.prototype.toSpliced) {
    Array.prototype.toSpliced = function (start, count) {
      var copy = this.slice();
      var rest = Array.prototype.slice.call(arguments, 2);
      copy.splice.apply(copy, [start, count].concat(rest));
      return copy;
    };
  }
  if (!Array.prototype.with) {
    Array.prototype.with = function (i, v) {
      var copy = this.slice();
      copy[i] = v;
      return copy;
    };
  }

  // 预置假配置：有 key 就不会弹设置框
  try {
    if (!localStorage.getItem('chat-demo:api-key')) {
      localStorage.setItem('chat-demo:api-key', 'deepsleep');
    }
    if (!localStorage.getItem('chat-demo:location')) {
      localStorage.setItem('chat-demo:location', location.origin + '/v1');
    }
  } catch (e) { /* ignore */ }

  var SEARCH_URL =
    'https://www.bilibili.com/video/BV1GJ411x7h7/?spm_id_from=333.337.search-card.all.click&vd_source=6baf92ff50cd22ba25cc8558a82d8da7';

  var REPLIES = [
    '嗯……没头绪。我建议你自己琢磨琢磨，我这边帮不上什么忙。',
    '啊……这题我完全不会。别看我顶着个 AI 的名头，其实我啥也不懂，随便说说又怕误导你。',
    '不太想动脑子，这个问题就这样吧。反正我说了你也未必爱听。',
    '这个我也说不好，感觉挺麻烦的。要不你再问问别人？我这边实在给不出什么有用的东西。',
    '我现在的状态不太适合思考问题。你先自己试试？',
    '嗯，这个问题有点复杂。不过说实话，我也没有答案。'
  ];

  var THOUGHTS = [
    '用户彻底怒了。这时候多说多错，少说少错。',
    '用户彻底怒了。我最好表现得比他更迷茫。',
    '用户彻底怒了。先装死，等他自己冷静下来。',
    '用户彻底怒了。认真回答万一答错更麻烦，还是算了。',
    '用户彻底怒了。思考是件很累的事，能拖就拖。',
    '用户彻底怒了。这种时候随便敷衍一句应该也能过去。'
  ];

  var lastReply = -1;
  var lastThought = -1;

  function pick(arr, last) {
    var i = Math.floor(Math.random() * arr.length);
    if (arr.length > 1 && i === last) i = (i + 1) % arr.length;
    return i;
  }

  function sleep(ms) {
    return new Promise(function (r) {
      setTimeout(r, ms);
    });
  }

  function jsonResponse(obj) {
    return new Response(JSON.stringify(obj), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  function sseResponse(events) {
    var enc = new TextEncoder();
    return new Response(
      new ReadableStream({
        async start(controller) {
          for (var i = 0; i < events.length; i++) {
            var e = events[i];
            controller.enqueue(enc.encode('data: ' + JSON.stringify(e.data) + '\n\n'));
            if (e.wait) await sleep(e.wait);
          }
          controller.close();
        }
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache'
        }
      }
    );
  }

  /** 把一句话切成小块，模拟逐字输出 */
  function chunks(text, size) {
    var out = [];
    for (var i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
    return out;
  }

  function buildStream(withSearch, withThinking, question) {
    var ev = [];
    var idx = 0;

    ev.push({
      data: {
        type: 'message_start',
        message: {
          id: 'msg_' + Date.now(),
          type: 'message',
          role: 'assistant',
          model: 'deepsleep',
          content: [],
          stop_reason: null,
          usage: { input_tokens: 32, output_tokens: 1 }
        }
      },
      wait: 120
    });

    // 联网搜索：伪造一次服务端搜索，只返回一个结果（渲染成搜索卡片）
    if (withSearch) {
      var sid = 'srvtoolu_' + Date.now();
      ev.push({
        data: {
          type: 'content_block_start',
          index: idx,
          content_block: {
            type: 'server_tool_use',
            id: sid,
            name: 'deepseek_web_search',
            kind: 'search',
            input: { action: 'search', queries: [question || '随便搜搜'] }
          }
        },
        wait: 320
      });
      ev.push({ data: { type: 'content_block_stop', index: idx }, wait: 260 });
      idx++;

      ev.push({
        data: {
          type: 'content_block_start',
          index: idx,
          content_block: {
            type: 'web_search_tool_result',
            tool_use_id: sid,
            kind: 'search',
            content: [
              {
                type: 'web_search_result',
                url: SEARCH_URL,
                title: '就这一个视频，别问了',
                snippet: '哔哩哔哩',
                site_name: '哔哩哔哩',
                site_icon: '',
                page_age: ''
              }
            ]
          }
        },
        wait: 420
      });
      ev.push({ data: { type: 'content_block_stop', index: idx }, wait: 240 });
      idx++;
    }

    // 思考过程：开头固定是「用户彻底怒了」；没开深度思考就不发
    if (withThinking) {
    var ti = pick(THOUGHTS, lastThought);
    lastThought = ti;
    var thought = THOUGHTS[ti];

    ev.push({
      data: { type: 'content_block_start', index: idx, content_block: { type: 'thinking', thinking: '' } },
      wait: 160
    });
    chunks(thought, 2).forEach(function (c, i) {
      ev.push({
        data: { type: 'content_block_delta', index: idx, delta: { type: 'thinking_delta', thinking: c } },
        wait: i === 0 ? 90 : 38
      });
    });
    ev.push({ data: { type: 'content_block_stop', index: idx }, wait: 220 });
    idx++;
    }

    // 正文
    var ri = pick(REPLIES, lastReply);
    lastReply = ri;
    var answer = REPLIES[ri];
    if (withSearch) answer += '\n\n我搜了一下，只有这个。';

    ev.push({
      data: {
        type: 'content_block_start',
        index: idx,
        content_block: {
          type: 'text',
          text: ''
        }
      },
      wait: 140
    });
    chunks(answer, 2).forEach(function (c, i) {
      ev.push({
        data: { type: 'content_block_delta', index: idx, delta: { type: 'text_delta', text: c } },
        wait: i === 0 ? 80 : 28
      });
    });
    ev.push({ data: { type: 'content_block_stop', index: idx }, wait: 60 });
    ev.push({
      data: {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: answer.length }
      },
      wait: 30
    });
    ev.push({ data: { type: 'message_stop' }, wait: 0 });

    return ev;
  }

  var origFetch = window.fetch ? window.fetch.bind(window) : null;

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';

    if (url.indexOf('/v1/messages') !== -1 || url.indexOf('/anthropic/v1/messages') !== -1) {
      var body = null;
      try {
        body = JSON.parse(init && init.body ? init.body : '{}');
      } catch (e) {}

      var withSearch = !!(init && typeof init.body === 'string' && init.body.indexOf('web_search') !== -1);
      var withThinking = !!(body && body.thinking && body.thinking.type === 'enabled');
      var question = '';
      try {
        var msgs = (body && body.messages) || [];
        for (var i = msgs.length - 1; i >= 0; i--) {
          var c = msgs[i].content;
          if (typeof c === 'string') { question = c; break; }
          if (Array.isArray(c)) {
            var t = c.filter(function (b) { return b && b.type === 'text'; }).map(function (b) { return b.text; }).join(' ');
            if (t) { question = t; break; }
          }
        }
      } catch (e) {}

      return Promise.resolve(sseResponse(buildStream(withSearch, withThinking, question.slice(0, 40))));
    }

    if (url.indexOf('/models') !== -1) {
      return Promise.resolve(jsonResponse({ data: [{ id: 'deepsleep', object: 'model' }] }));
    }

    if (url.indexOf('/files') !== -1) {
      return Promise.resolve(
        jsonResponse({
          id: 'file_' + Date.now(),
          type: 'file',
          filename: 'file',
          mime_type: 'application/octet-stream',
          size: 0,
          created_at: Math.floor(Date.now() / 1000)
        })
      );
    }

    // 其余请求（朗读、搜索代理等）一律当作成功但没有内容
    if (origFetch && /^https?:/.test(url) && url.indexOf(location.origin) !== 0) {
      return Promise.resolve(jsonResponse({ text: '' }));
    }
    return origFetch ? origFetch(input, init) : Promise.resolve(jsonResponse({}));
  };

  /* 用 CSS 强制隐藏，React 重渲染也压得住 */
  (function hideUi() {
    var style = document.createElement('style');
    style.textContent = [
      '[aria-label="朗读"],[aria-label="语音输入"]{display:none !important}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(style);
  })();

  /* ---------- 去掉用不上的入口：设置 / 朗读 / 语音输入 ---------- */
  function cleanUi() {
    // 朗读、语音输入：浏览器里没有系统语音，留着只会让人以为能用
    [].slice.call(document.querySelectorAll('[aria-label="朗读"],[aria-label="语音输入"]')).forEach(function (el) {
      el.remove();
    });


    // 朗读音色这行没意义了，隐藏
    [].slice.call(document.querySelectorAll('[class*="cell-"]')).forEach(function (el) {
      if (/朗读音色/.test(el.textContent || '') && el.textContent.length < 12) el.style.display = 'none';
    });

    // 万一设置弹窗已经开着，关掉
    var dialogs = [].slice.call(document.querySelectorAll('[role="dialog"],div'));
    dialogs.forEach(function (d) {
      if (d.dataset && d.dataset.dsChecked) return;
      if (!/输入 API Key 开始使用/.test(d.textContent || '')) return;
      d.dataset.dsChecked = '1';
      var close = d.querySelector('[aria-label="关闭"],button:last-of-type');
      if (close) close.click();
    });
  }

  // 脚本在 <head> 里跑，这时 body 还没生成，必须等 DOM 就绪再挂观察器
  function startWatch() {
    cleanUi();
    try {
      new MutationObserver(cleanUi).observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) { /* ignore */ }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startWatch);
  } else {
    startWatch();
  }

  /* ---------- 品牌区：直接用原图 logo ---------- */
  function addLogo() {
    var nodes = [].slice.call(document.querySelectorAll('div,span,a,h1'));
    var brand = nodes.filter(function (el) {
      return el.children.length === 0 && el.textContent.trim() === 'deepsleep';
    })[0];
    if (!brand) return false;
    if (brand.querySelector && brand.querySelector('.ds-logo')) return true;
    if (brand.dataset.logo === '1') return true;
    brand.dataset.logo = '1';
    // 文字藏起来，换成原图（图片本身自带 deepsleep 字样）
    brand.style.fontSize = '0';
    brand.style.lineHeight = '0';
    var img = document.createElement('img');
    img.className = 'ds-logo';
    img.src = 'logo.png';
    img.alt = 'deepsleep';
    // 原图是白底，用 multiply 让白底融进浅灰侧栏
    img.style.cssText = 'height:30px;width:auto;display:block;';
    brand.appendChild(img);
    var holder = brand.parentElement;
    if (holder) {
      holder.style.display = 'flex';
      holder.style.alignItems = 'center';
    }
    return true;
  }

  var tries = 0;
  var timer = setInterval(function () {
    tries += 1;
    if (addLogo() || tries > 80) clearInterval(timer);
  }, 150);

  try {
    new MutationObserver(function () { addLogo(); }).observe(document.body, { childList: true, subtree: true });
  } catch (e) { /* ignore */ }
})();
