// Cloudflare Worker: мост между чатом на сайте и Telegram-ботом
// Нужны: KV-привязка CHAT, секреты BOT_TOKEN, OWNER_ID, WEBHOOK_SECRET, переменная ALLOWED_ORIGIN
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    };
    const json = (o, s = 200) =>
      new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
    const tg = (m, b) =>
      fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${m}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b),
      }).then((r) => r.json());
    const okSid = (s) => /^[a-z0-9]{8,32}$/.test(s || "");
    const TTL = 60 * 60 * 24 * 7;

    if (req.method === "OPTIONS") return new Response(null, { headers: cors });

    // Клиент отправляет сообщение -> тебе в Telegram
    if (url.pathname === "/send" && req.method === "POST") {
      const { sid, text } = await req.json().catch(() => ({}));
      if (!okSid(sid) || !text || text.length > 1000) return json({ error: "bad" }, 400);
      const r = await tg("sendMessage", {
        chat_id: env.OWNER_ID,
        text: `💬 Клиент ${sid.slice(0, 6)}:\n${text}\n\nОтветь на это сообщение реплаем.`,
      });
      if (r.ok) await env.CHAT.put("m:" + r.result.message_id, sid, { expirationTtl: TTL });
      return json({ ok: !!r.ok });
    }

    // Сайт забирает твои ответы
    if (url.pathname === "/poll") {
      const sid = url.searchParams.get("sid");
      const after = Number(url.searchParams.get("after")) || 0;
      if (!okSid(sid)) return json({ error: "bad" }, 400);
      const list = JSON.parse((await env.CHAT.get("r:" + sid)) || "[]");
      return json({ messages: list.filter((m) => m.id > after) });
    }

    // Webhook от Telegram: твой ответ реплаем
    if (url.pathname === "/tg" && req.method === "POST") {
      if (req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET)
        return new Response("forbidden", { status: 403 });
      const m = (await req.json()).message;
      if (m && m.text && m.reply_to_message && String(m.from.id) === String(env.OWNER_ID)) {
        const sid = await env.CHAT.get("m:" + m.reply_to_message.message_id);
        if (sid) {
          const list = JSON.parse((await env.CHAT.get("r:" + sid)) || "[]");
          list.push({ id: Date.now(), text: m.text.slice(0, 2000) });
          await env.CHAT.put("r:" + sid, JSON.stringify(list.slice(-50)), { expirationTtl: TTL });
        }
      }
      return new Response("ok");
    }
    return new Response("Tema chat");
  },
};
