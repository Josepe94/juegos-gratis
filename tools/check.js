// Comprobación: el bot es admin con permiso de publicar en cada canal configurado. No publica nada.
const token = process.env.TELEGRAM_BOT_TOKEN;
const api = async (m, p) => (await fetch(`https://api.telegram.org/bot${token}/${m}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p || {}) })).json();
(async () => {
  const me = await api('getMe');
  console.log('BOT', me.ok ? '@' + me.result.username : 'TOKEN MAL: ' + me.description);
  for (const v of ['TELEGRAM_CHAT_ID', 'MODA_CHAT_ID', 'OPOS_CHAT_ID']) {
    const chat = (process.env[v] || '').trim();
    if (!chat) { console.log(`${v}: (vacía)`); continue; }
    const c = await api('getChat', { chat_id: chat });
    if (!c.ok) { console.log(`${v}=${chat}: NO ENCONTRADO (${c.description})`); continue; }
    const mem = await api('getChatMember', { chat_id: chat, user_id: me.result.id });
    const st = mem.ok ? mem.result.status : 'error ' + mem.description;
    console.log(`${v}=${chat}: "${c.result.title}" · bot=${st} · puede publicar=${mem.ok ? mem.result.can_post_messages : '?'}`);
  }
})();
