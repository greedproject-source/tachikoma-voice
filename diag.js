// 診断パネル：このブラウザで音声が使えるかを調べて表示する
(function () {
  'use strict';
  var items = {};
  var order = ['https', 'browser', 'tts', 'voices', 'jaVoice', 'ttsRun', 'stt', 'mic', 'standalone'];
  var labels = {
    https: 'HTTPS（安全な接続）',
    browser: 'ブラウザ',
    tts: '音声読み上げ（speechSynthesis）',
    voices: '使える声の数',
    jaVoice: '日本語の声',
    ttsRun: '読み上げの実行（試した結果）',
    stt: '音声認識（SpeechRecognition）',
    mic: 'マイクの許可',
    standalone: 'ホーム画面から起動'
  };

  function set(key, ok, text) {
    items[key] = { ok: ok, text: text };
    render();
  }

  function mark(ok) {
    if (ok === true) return '✅';
    if (ok === false) return '❌';
    if (ok === 'info') return 'ℹ️';
    return '⚠️';
  }

  function render() {
    var ul = document.getElementById('diag');
    if (!ul) return;
    var html = '';
    order.forEach(function (k) {
      var it = items[k];
      if (!it) return;
      html += '<li><span>' + mark(it.ok) + '</span><span><span class="k">' + labels[k] +
        '</span><br>' + esc(it.text) + '</span></li>';
    });
    ul.innerHTML = html;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function browserName() {
    var ua = navigator.userAgent;
    var ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var name = /CriOS/.test(ua) ? 'Chrome (iOS)' :
      /FxiOS/.test(ua) ? 'Firefox (iOS)' :
      /Edg\//.test(ua) ? 'Edge' :
      /Chrome\//.test(ua) ? 'Chrome' :
      /Safari\//.test(ua) ? 'Safari' : '不明';
    return (ios ? 'iPhone/iPad の ' : '') + name;
  }

  function run() {
    set('https', window.isSecureContext === true,
      window.isSecureContext ? 'OK' : 'HTTPSではありません。マイクが使えません');
    set('browser', 'info', browserName());
    var hasTTS = 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
    set('tts', hasTTS, hasTTS ? '使えます' : 'このブラウザは読み上げに対応していません');
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    set('stt', !!SR, SR ? '使えます（' + (window.SpeechRecognition ? '標準' : 'webkit') + '）' :
      'このブラウザは音声認識に対応していません。文字入力で試してください');
    var standalone = window.navigator.standalone === true ||
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    if (standalone) set('standalone', 'info', 'ホーム画面から起動しています。音声認識が動かない場合はSafariで開いてください');
    checkMic();
  }

  function checkMic() {
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'microphone' }).then(function (st) {
        showMic(st.state);
        st.onchange = function () { showMic(st.state); };
      }).catch(function () { showMic('unknown'); });
    } else {
      showMic('unknown');
    }
  }

  function showMic(state) {
    var map = {
      granted: [true, '許可されています'],
      denied: [false, '拒否されています。ブラウザ／iPhoneの設定でマイクを許可してください'],
      prompt: [null, 'まだ聞かれていません（🎤を押すと確認が出ます）'],
      unknown: [null, 'このブラウザでは事前に確認できません（🎤を押すとわかります）']
    };
    var v = map[state] || map.unknown;
    set('mic', v[0], v[1]);
  }

  function setVoices(list) {
    var ja = list.filter(function (v) { return /^ja/i.test(v.lang); });
    set('voices', list.length > 0, list.length + ' 個');
    set('jaVoice', ja.length > 0, ja.length ? ja.length + ' 個（' + ja.map(function (v) { return v.name; }).slice(0, 4).join('、') + (ja.length > 4 ? ' …' : '') + '）'
      : '見つかりません。OSの設定で日本語の音声を追加してください');
  }

  function text() {
    var lines = ['タチコマ音声テスト v0.2 診断', navigator.userAgent];
    order.forEach(function (k) {
      if (items[k]) lines.push(mark(items[k].ok) + ' ' + labels[k] + '：' + items[k].text);
    });
    return lines.join('\n');
  }

  window.TK_DIAG = { run: run, set: set, setVoices: setVoices, showMic: showMic, text: text };
})();
