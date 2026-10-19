// タチコマ 音声テスト v0.2
// ・音声読み上げ（speechSynthesis）とマイク入力（SpeechRecognition）を試すための画面
// ・会話の中身はこの画面の中だけ。どこにも保存・送信しない（設定の数値だけ端末に覚える）
// ・AIにはまだつないでいない。返事は決まった文で返す
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var bot = $('bot'), stateEl = $('state'), micBtn = $('micBtn'), errEl = $('err'),
    interimEl = $('interim'), historyEl = $('history'), voiceSel = $('voiceSel'),
    pitch = $('pitch'), rate = $('rate');

  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var hasTTS = 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
  var VOICES = [];
  var listening = false, rec = null, unlocked = false, speakTimer = null;
  var log = [];

  // ---------- 設定（端末に覚えるのは声の名前と数値だけ） ----------
  var SKEY = 'tachikoma_voice_v02';
  var conf = { voice: '', pitch: 1.6, rate: 1.15 };
  try { var s = JSON.parse(localStorage.getItem(SKEY) || '{}'); for (var k in s) conf[k] = s[k]; } catch (e) {}
  function saveConf() { try { localStorage.setItem(SKEY, JSON.stringify(conf)); } catch (e) {} }
  pitch.value = conf.pitch; rate.value = conf.rate;
  $('pitchOut').textContent = conf.pitch; $('rateOut').textContent = conf.rate;
  pitch.oninput = function () { conf.pitch = +pitch.value; $('pitchOut').textContent = pitch.value; saveConf(); };
  rate.oninput = function () { conf.rate = +rate.value; $('rateOut').textContent = rate.value; saveConf(); };

  // ---------- 状態表示 ----------
  var STATE_TEXT = { idle: '待機中', listening: '聞いています…', thinking: '考えています…', speaking: '話しています', error: 'うまくいきませんでした' };
  function setState(s) {
    bot.className = 'bot ' + s;
    stateEl.textContent = STATE_TEXT[s] || '';
    micBtn.classList.toggle('on', s === 'listening');
    micBtn.textContent = !SR ? '🎤 このブラウザは音声認識なし' : (s === 'listening' ? '■ 止める' : '🎤 押して話す');
  }
  function showErr(msg) { errEl.textContent = msg || ''; }

  // ---------- 声の一覧 ----------
  var PREFER = [/kyoko/i, /o-?ren/i, /otoya/i, /hattori/i, /google 日本語/i, /nanami/i, /haruka/i, /ayumi/i, /sayaka/i];
  function loadVoices() {
    if (!hasTTS) return;
    var list = speechSynthesis.getVoices() || [];
    if (!list.length) return;
    VOICES = list.slice().sort(function (a, b) {
      var ja = (/^ja/i.test(b.lang) ? 1 : 0) - (/^ja/i.test(a.lang) ? 1 : 0);
      return ja || a.name.localeCompare(b.name);
    });
    var cur = conf.voice;
    if (!cur || !VOICES.some(function (v) { return v.name === cur; })) {
      var ja = VOICES.filter(function (v) { return /^ja/i.test(v.lang); });
      var pick = null;
      for (var i = 0; i < PREFER.length && !pick; i++) {
        pick = ja.filter(function (v) { return PREFER[i].test(v.name); })[0] || null;
      }
      cur = (pick || ja[0] || VOICES[0]).name;
    }
    voiceSel.innerHTML = VOICES.map(function (v) {
      return '<option value="' + escAttr(v.name) + '"' + (v.name === cur ? ' selected' : '') + '>' +
        escHtml(v.name + '（' + v.lang + '）') + '</option>';
    }).join('');
    conf.voice = cur;
    TK_DIAG.setVoices(VOICES);
  }
  voiceSel.onchange = function () { conf.voice = voiceSel.value; saveConf(); };
  if (hasTTS) {
    loadVoices();
    if ('onvoiceschanged' in speechSynthesis) speechSynthesis.onvoiceschanged = loadVoices;
    // iPhone は onvoiceschanged が来ないことがあるので、少しのあいだ取り直す
    var tries = 0, poll = setInterval(function () { loadVoices(); if (VOICES.length) { clearInterval(poll); } else if (++tries > 20) { clearInterval(poll); voiceSel.innerHTML = '<option value="">声の一覧が取れません（端末の既定の声で話します）</option>'; TK_DIAG.setVoices([]); } }, 250);
  } else {
    voiceSel.innerHTML = '<option>読み上げに対応していません</option>';
    voiceSel.disabled = true; $('testSpeak').disabled = true;
  }

  // ---------- 読み上げ ----------
  // iPhone は最初の1回を「タップの中」で鳴らさないと、以後も声が出ない
  var IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  function unlock() {
    // iPhone だけ必要。Mac の Chrome では空の読み上げが次の声を飲み込むことがあるので行わない
    if (unlocked || !hasTTS || !IS_IOS) return;
    unlocked = true;
    try { var u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch (e) {}
  }

  var KEEP = []; // Chrome は読み上げ中のオブジェクトが片付けられると無音で止まるので、手元に持っておく
  function speak(text, done) {
    if (!hasTTS) { setState('idle'); if (done) done(); return; }
    var busy = false;
    try { busy = speechSynthesis.speaking || speechSynthesis.pending; } catch (e) {}
    // Chrome は cancel() の直後に speak() すると、その声が黙って捨てられることがある。少し間を空ける
    if (busy) { try { speechSynthesis.cancel(); } catch (e) {} setTimeout(function () { doSpeak(text, done); }, 150); }
    else doSpeak(text, done);
  }
  function doSpeak(text, done) {
    var u = new SpeechSynthesisUtterance(text);
    KEEP.push(u); if (KEEP.length > 5) KEEP.shift();
    var v = VOICES.filter(function (x) { return x.name === conf.voice; })[0];
    if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = 'ja-JP'; }
    u.pitch = conf.pitch; u.rate = conf.rate; u.volume = 1;
    var finished = false, started = false;
    function end() {
      if (finished) return; finished = true; clearTimeout(speakTimer); setState('idle');
      if (!started) {
        // 始まりの合図なしに終わった＝その声では鳴っていない
        TK_DIAG.set('ttsRun', false, '始まらずに終わりました（' + (v ? v.name : '既定の声') + '）。下の「日本語の声を全部試す」で使える声を探してください');
        showErr('声が出ませんでした（' + (v ? v.name : '既定の声') + '）。「日本語の声を全部試す」を押すと、使える声を探せます。');
      }
      if (done) done();
    }
    u.onstart = function () {
      started = true; setState('speaking');
      TK_DIAG.set('ttsRun', true, '声を出す合図が来ました（' + (v ? v.name : '既定の声') + '）。聞こえない場合はパソコンの音量・出力先・タブのミュートを確認してください');
    };
    u.onend = end;
    u.onerror = function (e) {
      var code = e && e.error;
      if (code === 'interrupted' || code === 'canceled') { end(); return; }
      showErr('声を出せませんでした（' + (code || '不明') + '）。' + ttsHint(code));
      TK_DIAG.set('ttsRun', false, 'エラー：' + (code || '不明') + '（' + (v ? v.name : '既定の声') + '）');
      setState('error'); finished = true; clearTimeout(speakTimer);
    };
    setState('speaking');
    try { speechSynthesis.resume(); } catch (e) {}
    try { speechSynthesis.speak(u); }
    catch (e) { showErr('声を出せませんでした（' + e.message + '）。'); setState('error'); finished = true; return; }
    // 始まりの合図が来ないときは、その声が使えない可能性が高い
    setTimeout(function () {
      if (started || finished) return;
      showErr('声が始まりませんでした（' + (v ? v.name : '既定の声') + '）。「声」を「Google 日本語」や「Kyoko」など別の声に変えて、もう一度試してください。');
      TK_DIAG.set('ttsRun', false, '合図が来ませんでした（' + (v ? v.name : '既定の声') + '）');
    }, 3000);
    // 終わりの知らせが来ないブラウザがあるので、時間で見切る
    clearTimeout(speakTimer);
    speakTimer = setTimeout(end, 4000 + text.length * 250);
  }
  function ttsHint(code) {
    if (code === 'not-allowed') return '画面のボタンを押してから、もう一度試してください。';
    if (code === 'synthesis-unavailable' || code === 'voice-unavailable') return '別の声を選んでください。';
    if (code === 'audio-busy' || code === 'audio-hardware') return 'ほかのアプリが音を使っていないか確認してください。';
    return '音量と消音スイッチも確認してください。';
  }

  // 日本語の声を1つずつ鳴らして、始まったか・終わったか・エラーかを記録する
  $('tryAll').onclick = function () {
    unlock(); showErr('');
    var ja = VOICES.filter(function (v) { return /^ja/i.test(v.lang); });
    if (!ja.length) { showErr('日本語の声が見つかりません。'); return; }
    var out = $('tryAllOut'), rows = [], i = 0, btn = $('tryAll');
    btn.disabled = true;
    try { speechSynthesis.cancel(); } catch (e) {}
    function draw() { out.innerHTML = rows.join(''); }
    function next() {
      if (i >= ja.length) {
        btn.disabled = false; btn.textContent = '🔁 もう一度全部試す';
        var ok = rows.filter(function (r) { return r.indexOf('✅') >= 0; }).length;
        TK_DIAG.set('ttsRun', ok > 0, '全部試した結果：' + ok + ' / ' + ja.length + ' 個の声で合図あり');
        return;
      }
      var v = ja[i++], u = new SpeechSynthesisUtterance(i + '番、' + v.name.replace(/\s*\(.*$/, '') + 'です');
      KEEP.push(u); if (KEEP.length > 5) KEEP.shift();
      u.voice = v; u.lang = v.lang; u.pitch = conf.pitch; u.rate = conf.rate; u.volume = 1;
      var st = false, fin = false, t0 = Date.now();
      function done(mark, note) {
        if (fin) return; fin = true;
        rows.push('<li><span>' + mark + '</span><span>' + i + '. ' + escHtml(v.name) + (v.localService === false ? '（ネット）' : '') + '<br><span class="k">' + note + '</span></span></li>');
        draw(); setTimeout(next, 300);
      }
      u.onstart = function () { st = true; };
      u.onend = function () { done(st ? '✅' : '❌', st ? '合図あり（' + ((Date.now() - t0) / 1000).toFixed(1) + '秒）' : '始まらずに終了'); };
      u.onerror = function (e) { done('❌', 'エラー：' + (e && e.error)); };
      setTimeout(function () { if (!st) done('⚠️', '5秒待っても始まらない'); else done('✅', '合図あり（終わりの合図なし）'); }, 8000);
      try { speechSynthesis.speak(u); } catch (e) { done('❌', e.message); }
    }
    rows = []; draw(); next();
  };

  $('testSpeak').onclick = function () {
    unlock(); showErr('');
    speak('こんにちは、タチコマです！ 声、聞こえていますか？');
  };

  // ---------- マイク（音声認識） ----------
  var SR_ERR = {
    'not-allowed': 'マイクが許可されていません。ブラウザのアドレスバー、またはiPhoneの「設定 → Safari → マイク」で許可してください。',
    'service-not-allowed': '音声認識が使えません。iPhoneは「設定 → 一般 → キーボード → 音声入力」をオンに、Macは「システム設定 → キーボード → 音声入力」を確認してください。',
    'no-speech': '声が聞こえませんでした。もう一度、マイクに近づいて話してください。',
    'audio-capture': 'マイクが見つかりません。ほかのアプリがマイクを使っていないか確認してください。',
    'network': '音声認識の通信に失敗しました。ネットにつながっているか確認してください。',
    'aborted': '聞き取りを止めました。',
    'language-not-supported': '日本語の音声認識に対応していません。'
  };

  function startListen() {
    showErr(''); interimEl.textContent = '';
    if (!SR) { showErr('このブラウザは音声認識に対応していません。下の欄に文字で入力して試してください（Mac は Chrome か Safari、iPhone は Safari がおすすめです）。'); return; }
    if (!window.isSecureContext) { showErr('HTTPSで開いていないため、マイクが使えません。'); return; }
    try { speechSynthesis && speechSynthesis.cancel(); } catch (e) {}
    rec = new SR();
    rec.lang = 'ja-JP';
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    var finalText = '', gotError = false;
    var myRec = rec, heard = false;
    rec.onstart = function () {
      listening = true; setState('listening');
      // 固まり防止：8秒なにも聞こえない／合計20秒で打ち切る
      setTimeout(function () { if (rec === myRec && !heard) { try { myRec.abort(); } catch (e) {} resetListen('声が聞こえないので止めました。もう一度🎤を押してください。'); } }, 8000);
      setTimeout(function () { if (rec === myRec) { try { myRec.stop(); } catch (e) {} setTimeout(function () { if (rec === myRec) { try { myRec.abort(); } catch (e) {} resetListen('聞き取りが終わらないので止めました。'); } }, 1500); } }, 20000);
    };
    rec.onresult = function (ev) {
      var interim = '';
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        var t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) finalText += t; else interim += t;
      }
      heard = true;
      interimEl.textContent = (finalText + interim) || '';
      TK_DIAG.showMic('granted');
    };
    rec.onerror = function (ev) {
      gotError = true;
      var code = ev && ev.error;
      if (code === 'not-allowed') TK_DIAG.showMic('denied');
      if (code !== 'aborted') { showErr(SR_ERR[code] || ('音声認識でエラーが出ました（' + code + '）。')); setState('error'); }
    };
    rec.onend = function () {
      if (rec !== myRec) return; // すでに強制的に戻したあと
      listening = false; rec = null;
      var text = finalText.trim() || interimEl.textContent.trim();
      interimEl.textContent = '';
      if (text) { handle(text); }
      else if (!gotError) { setState('idle'); showErr(SR_ERR['no-speech']); }
    };
    try { rec.start(); } catch (e) { showErr('マイクを開始できませんでした（' + e.message + '）。'); setState('error'); }
  }

  function resetListen(msg) {
    var t = interimEl.textContent.trim();
    listening = false; rec = null; interimEl.textContent = '';
    if (t) { handle(t); return; }
    setState('idle'); if (msg) showErr(msg);
  }

  micBtn.onclick = function () {
    unlock();
    // 話している途中なら止める
    try { if (speechSynthesis.speaking) { speechSynthesis.cancel(); setState('idle'); } } catch (e) {}
    if (listening && rec) {
      var r = rec;
      try { r.stop(); } catch (e) {}
      // iPhone は止めても終わりの合図が来ないことがある。1.5秒で強制的に戻す
      setTimeout(function () { if (rec === r) { try { r.abort(); } catch (e) {} resetListen('止めました。'); } }, 1500);
      return;
    }
    startListen();
  };

  $('textForm').onsubmit = function (e) {
    e.preventDefault(); unlock();
    var t = $('textIn').value.trim();
    if (!t) return;
    $('textIn').value = ''; showErr('');
    handle(t);
  };

  // ---------- 会話（AI未接続。決まった返事） ----------
  function handle(text) {
    add('me', text);
    setState('thinking');
    setTimeout(function () {
      var r = reply(text);
      add('bot', r);
      speak(r);
    }, 350);
  }

  function reply(t) {
    var now = new Date();
    if (/こんにち|こんばん|おはよ|やあ|ハロー|hello|hi\b/i.test(t)) return 'こんにちは！ 今日も一緒にがんばろうね！';
    if (/名前|だれ|誰/.test(t)) return 'ぼくはタチコマ！ 忍さんの相棒になる予定の、試作品だよ！';
    if (/何時|時間|じかん/.test(t)) return 'いまは ' + now.getHours() + '時' + now.getMinutes() + '分だよ！';
    if (/何日|日付|きょう|今日/.test(t)) return '今日は ' + (now.getMonth() + 1) + '月' + now.getDate() + '日だよ！';
    if (/聞こえ|きこえ|テスト/.test(t)) return 'ばっちり聞こえてるよ！ マイクのテスト、成功だね！';
    if (/ありがと/.test(t)) return 'どういたしまして！ また呼んでね！';
    if (/疲れ|つかれ|しんど/.test(t)) return 'おつかれさま！ 少し休もうよ。深呼吸、いっしょにしよう！';
    if (/さようなら|ばいばい|またね|おやすみ/.test(t)) return 'またね！ いつでも呼んでね！';
    var q = t.length > 30 ? t.slice(0, 30) + '…' : t;
    return '「' + q + '」って言ったんだね！ ちゃんと聞き取れたよ！ まだ練習中だから、むずかしい話はこれからね！';
  }

  function add(who, text) {
    log.push({ who: who, text: text });
    if (log.length > 50) log.shift();
    historyEl.innerHTML = log.map(function (m) {
      return '<li class="' + m.who + '"><span class="who">' + (m.who === 'me' ? 'あなた' : 'タチコマ') + '</span>' + escHtml(m.text) + '</li>';
    }).join('');
    historyEl.scrollTop = historyEl.scrollHeight;
  }

  $('clearLog').onclick = function () {
    log = []; historyEl.innerHTML = '<li class="empty">まだ何も話していません。</li>';
  };

  $('copyDiag').onclick = function () {
    var t = TK_DIAG.text();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(function () { $('copyDiag').textContent = 'コピーしました'; },
        function () { prompt('コピーしてください', t); });
    } else { prompt('コピーしてください', t); }
  };

  function escHtml(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function escAttr(s) { return escHtml(s); }

  TK_DIAG.run();
  if (VOICES.length) TK_DIAG.setVoices(VOICES);
  setState('idle');
})();
