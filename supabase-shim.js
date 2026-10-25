/*
 * Foliuma — camada de conexão com o Supabase.
 *
 * O app foi escrito para a API de dados do claude.ai (window.claude.use).
 * Este arquivo recria essa mesma API usando o Supabase, então o app funciona
 * igual fora do claude.ai: banco online, sincronização em tempo real entre
 * aparelhos, cadernos compartilhados, presença de pessoas e login.
 *
 * Tudo fica numa tabela genérica "docs" (caminho -> JSON). Veja supabase/schema.sql.
 */
(function () {
  'use strict';
  var cfg = window.CADERNO_CONFIG || {};
  var configured = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && !/SEU-PROJETO|COLE-AQUI/.test(cfg.SUPABASE_URL + cfg.SUPABASE_ANON_KEY));
  var LS = 'cadernoplus:';
  var requireLogin = cfg.REQUIRE_LOGIN !== false;
  var recovering = /type=recovery/.test(location.hash || '');
  var sb = null;

  var ready = (async function () {
    if (!configured || !window.supabase || !window.supabase.createClient) return { sb: null, session: null };
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true,
        // armazenamento explícito: sem isso, com o localStorage cheio a biblioteca guarda a sessão só na memória e o login some ao recarregar
        storage: {
          getItem: function (k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
          setItem: function (k, v) { try { window.localStorage.setItem(k, v); } catch (e) { try { sessionStorage.setItem(k, v); } catch (e2) {} console.warn('Foliuma: sem espaço para salvar a sessão no localStorage.', e); } },
          removeItem: function (k) { try { window.localStorage.removeItem(k); } catch (e) {} try { sessionStorage.removeItem(k); } catch (e2) {} }
        } }
    });
    try {
      var r = await sb.auth.getSession();
      var session = r && r.data ? r.data.session : null;
      var pending = null;
      if (session && sb.auth.mfa) {
        try {
          var a = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
          if (a && a.data && a.data.nextLevel === 'aal2' && a.data.currentLevel !== 'aal2') { pending = session; session = null; }
        } catch (e) {}
      }
      if (session) ensureProfile(session.user);
      return { sb: sb, session: session, pending: pending };
    } catch (e) { return { sb: sb, session: null }; }
  })();

  /* ---------------- utilidades ---------------- */
  var PALETTE = ['#F76707', '#2F9E44', '#1C7ED6', '#AE3EC9', '#D6336C', '#0C8599', '#F59F00', '#6741D9'];
  function colorFor(id) { var h = 0; String(id).split('').forEach(function (c) { h = (h * 31 + c.charCodeAt(0)) | 0; }); return PALETTE[Math.abs(h) % PALETTE.length]; }
  function parent(p) { return p.slice(0, p.lastIndexOf('/')); }
  function leaf(p) { return p.slice(p.lastIndexOf('/') + 1); }
  function mapErr(e) {
    var msg = String((e && (e.message || e.details || e.code)) || '');
    var err = new Error(msg || 'Erro de conexão');
    if (!navigator.onLine || /Failed to fetch|NetworkError|network|timeout|fetch/i.test(msg)) err.code = 'unavailable';
    else if (e && (e.code === '42501' || /row-level security|permission denied/i.test(msg))) err.code = 'invalid_argument';
    else if (/too large|payload|413/i.test(msg)) err.code = 'invalid_argument';
    else if (e && (e.status === 429 || /rate limit/i.test(msg))) err.code = 'resource_exhausted';
    else err.code = 'unavailable';
    return err;
  }
  function matches(data, filters) {
    return filters.every(function (f) {
      var v = data ? data[f[0]] : undefined;
      if (f[1] === '==') return v === f[2];
      if (f[1] === 'array-contains') return Array.isArray(v) && v.indexOf(f[2]) >= 0;
      return true;
    });
  }
  async function ensureProfile(user) {
    try {
      var meta = user.user_metadata || {};
      var name = meta.name || meta.full_name || (user.email ? user.email.split('@')[0] : 'Pessoa');
      await sb.from('profiles').upsert({ id: user.id, name: name, email: user.email || null, color: colorFor(user.id) }, { onConflict: 'id' });
    } catch (e) { /* perfil é opcional */ }
  }

  /* ---------------- banco de dados (API estilo Firestore) ---------------- */
  function makeDb() {
    function doc(path) {
      return {
        id: leaf(path),
        get: async function () {
          var r = await sb.from('docs').select('doc_id,data').eq('path', path).maybeSingle();
          if (r.error) throw mapErr(r.error);
          var row = r.data;
          return { id: leaf(path), exists: !!row, data: function () { return row ? row.data : undefined; } };
        },
        set: async function (value) {
          var r = await sb.from('docs').upsert({ path: path, collection: parent(path), doc_id: leaf(path), data: value }, { onConflict: 'path' });
          if (r.error) throw mapErr(r.error);
        },
        delete: async function () {
          var r = await sb.from('docs').delete().eq('path', path);
          if (r.error) throw mapErr(r.error);
        },
        collection: function (name) { return collection(path + '/' + name, [], 1000); }
      };
    }

    function collection(path, filters, lim) {
      async function fetchRows() {
        var q = sb.from('docs').select('path,doc_id,data,updated_at').eq('collection', path);
        filters.forEach(function (f) {
          var o = {};
          if (f[1] === '==') { o[f[0]] = f[2]; q = q.contains('data', o); }
          else if (f[1] === 'array-contains') { o[f[0]] = [f[2]]; q = q.contains('data', o); }
        });
        var r = await q.order('doc_id').limit(lim || 1000);
        if (r.error) throw mapErr(r.error);
        return r.data || [];
      }
      function toSnap(map, changes) {
        var docs = Object.keys(map).sort().map(function (k) { var row = map[k]; return { id: row.doc_id, exists: true, data: function () { return row.data; } }; });
        return { docs: docs, size: docs.length, empty: !docs.length, docChanges: function () { return changes || []; } };
      }
      return {
        where: function (f, op, v) { return collection(path, filters.concat([[f, op, v]]), lim); },
        limit: function (n) { return collection(path, filters, n); },
        orderBy: function () { return collection(path, filters, lim); },
        doc: function (id) { return doc(path + '/' + id); },
        get: async function () { var rows = await fetchRows(); var m = {}; rows.forEach(function (r) { m[r.doc_id] = r; }); return toSnap(m); },
        onSnapshot: function (cb, errCb) {
          var map = {}, alive = true, first = true;
          function emit(changes) { if (alive) try { cb(toSnap(map, changes)); } catch (e) { console.error(e); } }
          async function full() {
            try {
              var rows = await fetchRows(); var next = {}; var changes = [];
              rows.forEach(function (r) {
                next[r.doc_id] = r;
                var old = map[r.doc_id];
                if (!old) changes.push({ type: 'added', doc: { id: r.doc_id, exists: true, data: function () { return r.data; } } });
                else if (old.updated_at !== r.updated_at) changes.push({ type: 'modified', doc: { id: r.doc_id, exists: true, data: function () { return r.data; } } });
              });
              Object.keys(map).forEach(function (k) { if (!next[k]) { var o = map[k]; changes.push({ type: 'removed', doc: { id: k, exists: false, data: function () { return o.data; } } }); } });
              map = next; if (first || changes.length) emit(changes); first = false;
            } catch (e) { if (errCb) errCb(e); }
          }
          async function one(p) {
            try {
              var r = await sb.from('docs').select('path,doc_id,data,updated_at').eq('path', p).maybeSingle();
              var id = leaf(p), row = r.data;
              if (row && matches(row.data, filters)) { var t = map[id] ? 'modified' : 'added'; map[id] = row; emit([{ type: t, doc: { id: id, exists: true, data: function () { return row.data; } } }]); }
              else if (map[id]) { var o = map[id]; delete map[id]; emit([{ type: 'removed', doc: { id: id, exists: false, data: function () { return o.data; } } }]); }
            } catch (e) { /* uma falha isolada é corrigida na próxima sincronização completa */ }
          }
          full();
          var ch = sb.channel('docs:' + path + ':' + Math.random().toString(36).slice(2))
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'docs', filter: 'collection=eq.' + path }, function (p) { if (p.new && p.new.path) one(p.new.path); })
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'docs', filter: 'collection=eq.' + path }, function (p) { if (p.new && p.new.path) one(p.new.path); })
            .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'docs' }, function (p) { var op = p.old && p.old.path; if (op && parent(op) === path) one(op); })
            .subscribe(function (status) { if (status === 'SUBSCRIBED' && !first) full(); });
          var onOnline = function () { full(); };
          window.addEventListener('online', onOnline);
          return function unsubscribe() { alive = false; window.removeEventListener('online', onOnline); try { sb.removeChannel(ch); } catch (e) {} };
        }
      };
    }
    return { doc: doc, collection: function (p) { return collection(p, [], 1000); } };
  }

  /* ---------------- usuário e pessoas ---------------- */
  function makeUser(session) {
    var u = session.user, uid = u.id;
    return {
      id: async function () { return uid; },
      can: async function () { return true; },
      canEdit: async function () { return true; },
      isOwner: async function () { return true; },
      me: async function () { return { id: uid, email: u.email }; },
      profiles: async function (ids) {
        var out = {}; ids = (ids || []).filter(Boolean); if (!ids.length) return out;
        try { var r = await sb.from('profiles').select('id,name,color').in('id', ids); (r.data || []).forEach(function (p) { out[p.id] = { name: p.name || 'Pessoa', color: p.color || colorFor(p.id) }; }); } catch (e) {}
        return out;
      },
      search: async function (q) {
        q = String(q || '').replace(/[,()%*]/g, ' ').trim(); if (!q) return [];
        try { var r = await sb.from('profiles').select('id,name,email,color').or('name.ilike.%' + q + '%,email.ilike.%' + q + '%').limit(8); return (r.data || []).map(function (p) { return { id: p.id, name: p.name || p.email, color: p.color || colorFor(p.id) }; }); } catch (e) { return []; }
      }
    };
  }

  /* ---------------- presença (quem está na mesma página) ---------------- */
  function makeRoom(session) {
    var uid = session.user.id, mine = {}, listeners = [];
    var ch = sb.channel('foliuma-room', { config: { presence: { key: uid } } });
    function emit() {
      var st = ch.presenceState ? ch.presenceState() : {}; var peers = [];
      Object.keys(st).forEach(function (key) { (st[key] || []).forEach(function (m) { peers.push({ by: key, presence: m.p || {}, isMe: key === uid, kind: 'viewer' }); }); });
      listeners.forEach(function (f) { try { f({ peers: peers }); } catch (e) {} });
    }
    ch.on('presence', { event: 'sync' }, emit).subscribe(async function (s) { if (s === 'SUBSCRIBED') { try { await ch.track({ p: mine }); } catch (e) {} } });
    return {
      presence: async function (p) { Object.assign(mine, p || {}); try { await ch.track({ p: mine }); } catch (e) {} },
      onPeers: function (fn) { listeners.push(fn); emit(); return function () { listeners = listeners.filter(function (x) { return x !== fn; }); }; }
    };
  }

  /* ---------------- downloads ---------------- */
  var downloads = {
    save: async function (req) {
      var blob = req.data instanceof Blob ? req.data : new Blob([req.data]);
      var file = null;
      try { file = new File([blob], req.filename, { type: blob.type || 'application/octet-stream' }); } catch (e) {}
      var mobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
      if (mobile && file && navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: req.filename }); return { ok: true }; } catch (e) { if (e && e.name === 'AbortError') { var er = new Error('cancelado'); er.code = 'declined'; throw er; } }
      }
      var url = URL.createObjectURL(blob); var a = document.createElement('a');
      a.href = url; a.download = req.filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
      return { ok: true };
    }
  };

  /* ---------------- API compatível ---------------- */
  var cache = {};
  window.claude = {
    use: async function (name) {
      if (name === 'downloads') return downloads;
      if (name === 'sample') return null; // IA do Claude só existe dentro do claude.ai
      var r = await ready; if (!r.sb || !r.session) return null;
      if (cache[name]) return cache[name];
      if (name === 'db') return (cache.db = makeDb());
      if (name === 'user') return (cache.user = makeUser(r.session));
      if (name === 'room') return (cache.room = makeRoom(r.session));
      return null;
    }
  };

  /* ---------------- tela de conta ---------------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function overlay(html, locked) {
    var ov = document.createElement('div'); ov.className = 'overlay show'; ov.style.zIndex = '90';
    ov.innerHTML = '<div class="dialog" role="dialog" aria-modal="true">' + html + '</div>';
    document.body.appendChild(ov);
    if (!locked) ov.addEventListener('click', function (e) { if (e.target === ov) ov.remove(); });
    else { ov.style.background = 'color-mix(in srgb, var(--bg) 90%, transparent)'; ov.style.backdropFilter = 'blur(16px)'; ov.style.webkitBackdropFilter = 'blur(16px)'; }
    return ov;
  }
  function closeAll() { document.querySelectorAll('.overlay[style*="90"]').forEach(function (o) { o.remove(); }); }
  var CODE_INPUT = '<input class="field" id="mfaCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" style="font-size:24px;letter-spacing:.35em;text-align:center;font-variant-numeric:tabular-nums;height:52px">';
  function codeOf(ov) { return (ov.querySelector('#mfaCode').value || '').replace(/\D/g, ''); }
  function wireCode(ov, onSubmit) {
    var inp = ov.querySelector('#mfaCode');
    inp.addEventListener('input', function () { inp.value = inp.value.replace(/\D/g, '').slice(0, 6); if (inp.value.length === 6) onSubmit(); });
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); onSubmit(); } });
    setTimeout(function () { inp.focus(); }, 60);
  }
  function mfaMsg(ov, t, bad) { var m = ov.querySelector('#mfaMsg'); if (m) { m.textContent = t; m.style.color = bad ? 'var(--danger)' : 'var(--muted)'; } }
  function mfaErr(e) { var t = String(e && e.message || ''); return /invalid|incorrect|expired|code/i.test(t) ? 'Código incorreto ou expirado. Confira o app e tente de novo.' : /rate|many/i.test(t) ? 'Muitas tentativas. Aguarde um pouco e tente de novo.' : ('Não foi possível: ' + t); }
  async function verifiedFactors() { try { var f = await sb.auth.mfa.listFactors(); return (f.data && f.data.totp) || []; } catch (e) { return []; } }

  /* ---- verificação em duas etapas ---- */
  async function openMfaGate() {
    var r = await ready; var sess = r.pending; if (!sess) return;
    var factors = await verifiedFactors(); var factor = factors[0]; if (!factor) return;
    closeAll(); var busy = false;
    var ov = overlay('<header style="display:flex;align-items:center;gap:10px"><img src="icons/favicon.svg" width="30" height="30" alt="">Verificação em duas etapas</header><div class="body"><p>Abra o app autenticador no seu celular e digite o código de 6 dígitos do <b>Foliuma</b> para <b>' + esc(sess.user.email) + '</b>.</p>' + CODE_INPUT + '<p class="mini" id="mfaMsg" style="min-height:18px;margin:6px 0 0"></p><p class="mini" style="margin:8px 0 0">Perdeu o celular? Peça ao administrador do projeto para remover a verificação pelo painel do Supabase.</p></div><footer><button class="btn" data-out>Sair da conta</button><button class="btn primary" data-ok>Verificar</button></footer>', true);
    var go = async function () {
      if (busy) return; var code = codeOf(ov); if (code.length !== 6) { mfaMsg(ov, 'Digite os 6 dígitos.', true); return; }
      busy = true; mfaMsg(ov, 'Verificando…');
      var res = await sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code });
      busy = false;
      if (res.error) { mfaMsg(ov, mfaErr(res.error), true); ov.querySelector('#mfaCode').value = ''; ov.querySelector('#mfaCode').focus(); return; }
      mfaMsg(ov, 'Pronto! Abrindo…'); location.reload();
    };
    wireCode(ov, go); ov.querySelector('[data-ok]').onclick = go;
    ov.querySelector('[data-out]').onclick = async function () { await sb.auth.signOut(); location.reload(); };
  }
  async function enrollMfa() {
    closeAll();
    try { var all = await sb.auth.mfa.listFactors(); ((all.data && all.data.all) || []).filter(function (f) { return f.status !== 'verified'; }).forEach(function (f) { sb.auth.mfa.unenroll({ factorId: f.id }).catch(function () {}); }); } catch (e) {}
    var res = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Foliuma ' + new Date().toLocaleString('pt-BR') });
    if (res.error) { overlay('<header>Verificação em duas etapas</header><div class="body"><p>Não foi possível iniciar: ' + esc(res.error.message) + '</p><p class="mini">Confira se a autenticação em duas etapas (MFA/TOTP) está habilitada no painel do Supabase.</p></div><footer><button class="btn primary" data-x>Fechar</button></footer>').querySelector('[data-x]').onclick = closeAll; return; }
    var d = res.data, qr = (d.totp && d.totp.qr_code) || '', secret = (d.totp && d.totp.secret) || '';
    var src = /^data:/.test(qr) ? qr : 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(qr);
    var done = false, busy = false;
    var ov = overlay('<header>Ativar verificação em duas etapas</header><div class="body">' +
      '<ol class="steps"><li>Instale um app autenticador no celular: <b>Google Authenticator</b>, <b>Microsoft Authenticator</b>, <b>Authy</b> ou <b>1Password</b>.</li><li>No app, toque em adicionar e escaneie o código abaixo.</li><li>Digite o código de 6 dígitos que aparecer no app.</li></ol>' +
      '<div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin:6px 0 12px"><img src="' + esc(src) + '" alt="QR code" width="170" height="170" style="background:#fff;border-radius:12px;padding:8px;border:1px solid var(--line)">' +
      '<div style="flex:1;min-width:180px"><p class="mini" style="margin:0 0 4px">Não consegue escanear? Digite esta chave no app:</p><code id="mfaSecret" style="display:block;word-break:break-all;font-size:13px;padding:8px 10px;border-radius:8px;background:var(--hover);user-select:all">' + esc(secret.replace(/(.{4})/g, '$1 ').trim()) + '</code><button class="btn sm" data-copy style="margin-top:6px">Copiar chave</button><p class="mini" style="margin:8px 0 0">Guarde essa chave num lugar seguro: com ela você configura o código em outro celular.</p></div></div>' +
      CODE_INPUT + '<p class="mini" id="mfaMsg" style="min-height:18px;margin:6px 0 0"></p></div><footer><button class="btn" data-cancel>Cancelar</button><button class="btn primary" data-ok>Ativar</button></footer>', true);
    var go = async function () {
      if (busy || done) return; var code = codeOf(ov); if (code.length !== 6) { mfaMsg(ov, 'Digite os 6 dígitos do app.', true); return; }
      busy = true; mfaMsg(ov, 'Verificando…');
      var v = await sb.auth.mfa.challengeAndVerify({ factorId: d.id, code: code }); busy = false;
      if (v.error) { mfaMsg(ov, mfaErr(v.error), true); ov.querySelector('#mfaCode').value = ''; ov.querySelector('#mfaCode').focus(); return; }
      done = true; closeAll();
      overlay('<header>✅ Verificação ativada</header><div class="body"><p>A partir de agora, ao entrar no Foliuma, além da senha será pedido o código do seu app autenticador.</p><p class="mini">Os outros aparelhos conectados também vão pedir o código na próxima vez que abrirem o app.</p></div><footer><button class="btn primary" data-x>Entendi</button></footer>').querySelector('[data-x]').onclick = function () { closeAll(); };
    };
    wireCode(ov, go); ov.querySelector('[data-ok]').onclick = go;
    ov.querySelector('[data-copy]').onclick = async function () { try { await navigator.clipboard.writeText(secret); mfaMsg(ov, 'Chave copiada.'); } catch (e) { mfaMsg(ov, 'Selecione a chave e copie manualmente.', true); } };
    ov.querySelector('[data-cancel]').onclick = async function () { if (!done) { try { await sb.auth.mfa.unenroll({ factorId: d.id }); } catch (e) {} } closeAll(); openAccount(); };
  }
  async function disableMfa(factor) {
    closeAll(); var busy = false;
    var ov = overlay('<header>Desativar verificação em duas etapas</header><div class="body"><p>Para confirmar, digite o código atual do seu app autenticador.</p>' + CODE_INPUT + '<p class="mini" id="mfaMsg" style="min-height:18px;margin:6px 0 0"></p><p class="mini" style="margin:6px 0 0">Sem a verificação, basta a senha para entrar na sua conta.</p></div><footer><button class="btn" data-cancel>Cancelar</button><button class="btn danger primary" data-ok>Desativar</button></footer>', true);
    var go = async function () {
      if (busy) return; var code = codeOf(ov); if (code.length !== 6) { mfaMsg(ov, 'Digite os 6 dígitos.', true); return; }
      busy = true; mfaMsg(ov, 'Verificando…');
      var v = await sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code });
      if (v.error) { busy = false; mfaMsg(ov, mfaErr(v.error), true); ov.querySelector('#mfaCode').value = ''; return; }
      var u = await sb.auth.mfa.unenroll({ factorId: factor.id }); busy = false;
      if (u.error) { mfaMsg(ov, 'Não foi possível desativar: ' + u.error.message, true); return; }
      closeAll(); openAccount();
    };
    wireCode(ov, go); ov.querySelector('[data-ok]').onclick = go; ov.querySelector('[data-cancel]').onclick = function () { closeAll(); openAccount(); };
  }
  function confirmInline(btn, label) { if (btn.dataset.ok) return true; btn.dataset.ok = '1'; var old = btn.textContent; btn.textContent = label; btn.classList.add('danger'); setTimeout(function () { if (btn.isConnected) { delete btn.dataset.ok; btn.textContent = old; btn.classList.remove('danger'); } }, 4000); return false; }
  function clearDevice() {
    try { Object.keys(localStorage).filter(function (k) { return k.indexOf(LS) === 0; }).forEach(function (k) { localStorage.removeItem(k); }); } catch (e) {}
    try { indexedDB.deleteDatabase('cadernoplus'); indexedDB.deleteDatabase('foliuma-pages'); } catch (e) {}
  }
  async function openAccount() {
    var r = await ready;
    if (!configured) {
      overlay('<header>Conectar ao Supabase</header><div class="body"><p>O app ainda não está ligado a um banco online. Preencha o arquivo <b>config.js</b> com a URL e a chave <i>anon</i> do seu projeto Supabase (veja o README).</p><p>Enquanto isso, tudo fica salvo só neste aparelho.</p></div><footer><button class="btn primary" data-x>Entendi</button></footer>')
        .querySelector('[data-x]').onclick = function (e) { e.target.closest('.overlay').remove(); };
      return;
    }
    if (!r.sb) {
      overlay('<header>Sem conexão</header><div class="body"><p>Não foi possível carregar o Supabase. Verifique a internet e abra o app de novo.</p></div><footer><button class="btn primary" data-x>Fechar</button></footer>')
        .querySelector('[data-x]').onclick = function (e) { e.target.closest('.overlay').remove(); };
      return;
    }
    if (r.pending) { openMfaGate(); return; }
    if (r.session) {
      var factors = sb.auth.mfa ? await verifiedFactors() : [];
      var on = factors.length > 0;
      var ov = overlay('<header>Sua conta</header><div class="body"><p>Conectado como <b>' + esc(r.session.user.email) + '</b>. Suas anotações são salvas no Supabase e sincronizam entre todos os seus aparelhos.</p>' +
        '<div style="border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin:6px 0 12px;display:flex;align-items:center;gap:12px;flex-wrap:wrap"><span style="font-size:22px">' + (on ? '🛡️' : '🔓') + '</span><div style="flex:1;min-width:180px"><b>Verificação em duas etapas</b><div class="mini">' + (on ? '<span style="color:#2F9E44;font-weight:650">Ativada</span> · o login pede o código do app autenticador.' : 'Desativada · proteja sua conta com um código do celular além da senha.') + '</div></div>' +
        (sb.auth.mfa ? (on ? '<button class="btn sm" data-mfaoff>Desativar</button>' : '<button class="btn sm primary" data-mfaon>Ativar</button>') : '') + '</div>' +
        '<p class="mini">Ao sair, você pode manter uma cópia neste aparelho ou apagá-la (recomendado em aparelhos compartilhados).</p></div>' +
        '<footer><button class="btn" data-pass>Alterar senha</button><button class="btn" data-global title="Encerra a sessão em todos os celulares e computadores">Sair de todos os aparelhos</button><button class="btn" data-keep>Sair e manter cópia</button><button class="btn danger" data-clear>Sair e limpar este aparelho</button><button class="btn primary" data-x>Fechar</button></footer>');
      ov.querySelector('[data-x]').onclick = function () { ov.remove(); };
      ov.querySelector('[data-keep]').onclick = async function () { await sb.auth.signOut(); location.reload(); };
      ov.querySelector('[data-clear]').onclick = async function () { await sb.auth.signOut(); clearDevice(); location.reload(); };
      ov.querySelector('[data-pass]').onclick = function () { openNewPassword(false); };
      ov.querySelector('[data-global]').onclick = async function () { if (!confirmInline(this, 'Confirmar: sair de todos')) return; await sb.auth.signOut({ scope: 'global' }); location.reload(); };
      var bOn = ov.querySelector('[data-mfaon]'); if (bOn) bOn.onclick = enrollMfa;
      var bOff = ov.querySelector('[data-mfaoff]'); if (bOff) bOff.onclick = function () { disableMfa(factors[0]); };
      return;
    }
    var mode = 'in';
    var ov2 = overlay('<header style="display:flex;align-items:center;gap:10px"><img src="icons/favicon.svg" width="30" height="30" alt="">Entrar no Foliuma</header><div class="body">' +
      '<div class="seg" style="margin-bottom:12px"><button class="on" data-m="in" type="button">Entrar</button><button data-m="up" type="button">Criar conta</button></div>' +
      '<input class="field" id="acName" placeholder="Seu nome" autocomplete="name" hidden>' +
      '<input class="field" id="acEmail" type="email" placeholder="E-mail" autocomplete="email">' +
      '<input class="field" id="acPass" type="password" placeholder="Senha (mínimo 6 caracteres)" autocomplete="current-password">' +
      '<p class="mini" id="acMsg" style="min-height:18px;margin:0 0 6px"></p>' +
      '<button class="btn" id="acMagic" type="button" style="width:100%;justify-content:center">Receber link de acesso por e-mail</button>' +
      '<div style="text-align:center;margin-top:10px"><button type="button" id="acForgot" style="color:var(--accent);font-weight:600;font-size:13px">Esqueci minha senha</button></div>' +
      '<p class="mini" style="margin:10px 0 0">Anotações feitas antes de entrar são enviadas para a sua conta automaticamente.</p>' +
      '</div><footer>' + (requireLogin ? '' : '<button class="btn" data-skip>Usar sem conta</button>') + '<button class="btn primary" id="acGo">Entrar</button></footer>', requireLogin);
    if (requireLogin) document.body.classList.add('locked');
    var $ = function (s) { return ov2.querySelector(s); };
    var msg = function (t, bad) { $('#acMsg').textContent = t; $('#acMsg').style.color = bad ? 'var(--danger)' : 'var(--muted)'; };
    ov2.querySelector('.seg').onclick = function (e) {
      var b = e.target.closest('[data-m]'); if (!b) return; mode = b.dataset.m;
      ov2.querySelectorAll('.seg button').forEach(function (x) { x.classList.toggle('on', x === b); });
      $('#acName').hidden = mode !== 'up'; $('#acGo').textContent = mode === 'up' ? 'Criar conta' : 'Entrar';
      $('#acPass').autocomplete = mode === 'up' ? 'new-password' : 'current-password'; msg('');
    };
    var skipBtn = $('[data-skip]'); if (skipBtn) skipBtn.onclick = function () { try { localStorage.setItem(LS + 'skipLogin', '1'); } catch (e) {} ov2.remove(); };
    $('#acGo').onclick = async function () {
      var email = $('#acEmail').value.trim(), pass = $('#acPass').value;
      if (!email || pass.length < 6) { msg('Informe o e-mail e uma senha com pelo menos 6 caracteres.', true); return; }
      msg('Aguarde…');
      try {
        var res = mode === 'up'
          ? await sb.auth.signUp({ email: email, password: pass, options: { data: { name: $('#acName').value.trim() || email.split('@')[0] }, emailRedirectTo: location.href.split('#')[0] } })
          : await sb.auth.signInWithPassword({ email: email, password: pass });
        if (res.error) throw res.error;
        if (mode === 'up' && !res.data.session) { msg('Conta criada! Confirme pelo link que enviamos para o seu e-mail e depois entre.'); return; }
        location.reload();
      } catch (e) {
        var t = String(e && e.message || '');
        msg(/Invalid login/i.test(t) ? 'E-mail ou senha incorretos.' : /not confirmed/i.test(t) ? 'Confirme seu e-mail pelo link recebido antes de entrar.' : /already registered/i.test(t) ? 'Este e-mail já tem conta. Use Entrar.' : /Signups not allowed/i.test(t) ? 'Novos cadastros estão desativados. Peça um convite ao administrador.' : ('Não foi possível: ' + t), true);
      }
    };
    $('#acForgot').onclick = async function () {
      var email = $('#acEmail').value.trim(); if (!email) { msg('Digite seu e-mail no campo acima e clique de novo.', true); $('#acEmail').focus(); return; }
      msg('Enviando…');
      var res = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split('#')[0] });
      msg(res.error ? ('Não foi possível enviar: ' + res.error.message) : 'Enviamos um link para ' + email + '. Abra-o neste aparelho para criar uma senha nova.', !!res.error);
    };
    $('#acMagic').onclick = async function () {
      var email = $('#acEmail').value.trim(); if (!email) { msg('Digite seu e-mail primeiro.', true); return; }
      msg('Enviando…');
      var res = await sb.auth.signInWithOtp({ email: email, options: { emailRedirectTo: location.href.split('#')[0] } });
      msg(res.error ? ('Não foi possível enviar: ' + res.error.message) : 'Pronto! Abra o link enviado para ' + email + ' neste aparelho.', !!res.error);
    };
    setTimeout(function () { $('#acEmail').focus(); }, 50);
  }

  /* ---------------- instalação (PWA) ---------------- */
  var deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferredPrompt = e; });
  window.addEventListener('appinstalled', function () { deferredPrompt = null; });
  function isStandalone() { return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; }
  async function openInstall() {
    if (isStandalone()) { overlay('<header>App instalado</header><div class="body"><p>Você já está usando o Foliuma como aplicativo. 🎉</p></div><footer><button class="btn primary" data-x>Fechar</button></footer>').querySelector('[data-x]').onclick = function (e) { e.target.closest('.overlay').remove(); }; return; }
    if (deferredPrompt) { deferredPrompt.prompt(); try { await deferredPrompt.userChoice; } catch (e) {} deferredPrompt = null; return; }
    var ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    overlay('<header>Instalar no celular</header><div class="body">' + (ios
      ? '<ol class="steps"><li>Abra este endereço no <b>Safari</b>.</li><li>Toque em <b>Compartilhar</b> (o quadrado com a seta para cima).</li><li>Escolha <b>Adicionar à Tela de Início</b> e confirme.</li></ol><p class="mini">Para receber notificações de lembretes, o iPhone precisa do iOS 16.4 ou mais recente e o app aberto pela Tela de Início.</p>'
      : '<ol class="steps"><li>Abra este endereço no <b>Chrome</b> (ou Edge/Samsung Internet).</li><li>Toque no menu <b>⋮</b>.</li><li>Escolha <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>.</li></ol><p class="mini">No computador, use o ícone de instalar na barra de endereço do Chrome ou Edge.</p>') +
      '</div><footer><button class="btn primary" data-x>Entendi</button></footer>').querySelector('[data-x]').onclick = function (e) { e.target.closest('.overlay').remove(); };
  }

  async function openNewPassword(fromRecovery) {
    closeAll(); var busy = false;
    var ov = overlay('<header>' + (fromRecovery ? 'Criar nova senha' : 'Alterar senha') + '</header><div class="body"><p>' + (fromRecovery ? 'Você abriu o link de recuperação. Escolha uma senha nova para sua conta.' : 'Digite a nova senha da sua conta.') + '</p>' +
      '<input class="field" id="npA" type="password" placeholder="Nova senha (mínimo 6 caracteres)" autocomplete="new-password"><input class="field" id="npB" type="password" placeholder="Repita a nova senha" autocomplete="new-password">' +
      '<p class="mini" id="mfaMsg" style="min-height:18px;margin:0"></p></div><footer>' + (fromRecovery ? '' : '<button class="btn" data-cancel>Cancelar</button>') + '<button class="btn primary" data-ok>Salvar senha</button></footer>', fromRecovery);
    var go = async function () {
      if (busy) return; var a = ov.querySelector('#npA').value, b = ov.querySelector('#npB').value;
      if (a.length < 6) { mfaMsg(ov, 'A senha precisa ter pelo menos 6 caracteres.', true); return; }
      if (a !== b) { mfaMsg(ov, 'As senhas não conferem.', true); return; }
      busy = true; mfaMsg(ov, 'Salvando…');
      var res = await sb.auth.updateUser({ password: a }); busy = false;
      if (res.error) { mfaMsg(ov, 'Não foi possível: ' + res.error.message, true); return; }
      mfaMsg(ov, 'Senha atualizada!');
      if (fromRecovery) { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {} setTimeout(function () { location.reload(); }, 600); }
      else setTimeout(function () { closeAll(); openAccount(); }, 700);
    };
    ov.querySelector('[data-ok]').onclick = go;
    ov.querySelector('#npB').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    var c = ov.querySelector('[data-cancel]'); if (c) c.onclick = function () { closeAll(); openAccount(); };
    setTimeout(function () { ov.querySelector('#npA').focus(); }, 60);
  }
  window.cadernoAccount = { open: openAccount, install: openInstall, ready: ready };
  ready.then(function (r) { if (recovering && r.sb && (r.session || r.pending)) setTimeout(function () { openNewPassword(true); }, 400); });
  if (configured) ready.then(function (r) { if (r.sb) r.sb.auth.onAuthStateChange(function (ev) { if (ev === 'PASSWORD_RECOVERY') openNewPassword(true); }); });

  // Primeiro acesso: oferece login se o banco estiver configurado.
  ready.then(function (r) {
    if (recovering) return;
    if (r.pending) { setTimeout(openMfaGate, 300); return; }
    if (!r.sb || r.session) return;
    var skipped = false; try { skipped = localStorage.getItem(LS + 'skipLogin') === '1'; } catch (e) {}
    if (requireLogin) { document.body.classList.add('locked'); setTimeout(openAccount, 200); } else if (!skipped) setTimeout(openAccount, 900);
  });
  if (configured) ready.then(function (r) { if (r.sb) r.sb.auth.onAuthStateChange(function (ev) { if (ev === 'SIGNED_IN' && !r.session && !r.pending) location.reload(); }); });
})();
