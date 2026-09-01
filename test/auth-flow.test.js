"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { WebSocket } = require("ws");

test("邮箱账号可以注册、保持登录、退出并重新登录", async () => {
  process.env.PORT = "0";
  delete process.env.DATABASE_URL;
  delete process.env.RENDER;
  const { server, wss } = require("../server");
  if (!server.listening) await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function auth(path, payload, cookie = "") {
    return fetch(`${origin}/api/auth/${path}`, {
      method: path === "me" ? "GET" : "POST",
      headers: { ...(cookie ? { cookie } : {}), ...(path === "me" ? {} : { "content-type": "application/json" }) },
      body: path === "me" ? undefined : JSON.stringify(payload || {}),
    });
  }

  const registered = await auth("register", { email: "player@example.com", password: "mahjong88", nickname: "六合牌友" });
  assert.equal(registered.status, 201);
  const cookie = registered.headers.get("set-cookie").split(";")[0];
  assert.match(registered.headers.get("set-cookie"), /HttpOnly/);
  assert.deepEqual((await registered.json()).user, { id: "1", email: "player@example.com", nickname: "六合牌友" });

  const me = await auth("me", null, cookie);
  assert.equal(me.status, 200);
  assert.equal((await me.json()).user.nickname, "六合牌友");

  const duplicate = await auth("register", { email: "PLAYER@example.com", password: "mahjong88", nickname: "另一个人" });
  assert.equal(duplicate.status, 409);
  const wrongPassword = await auth("login", { email: "player@example.com", password: "wrong-pass" });
  assert.equal(wrongPassword.status, 401);

  const loggedOut = await auth("logout", {}, cookie);
  assert.equal(loggedOut.status, 200);
  assert.equal((await (await auth("me", null, cookie)).json()).user, null);

  const loggedIn = await auth("login", { email: "player@example.com", password: "mahjong88" });
  assert.equal(loggedIn.status, 200);
  assert.equal((await loggedIn.json()).user.email, "player@example.com");

  const guestSocket = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`);
  const guestError = new Promise((resolve) => guestSocket.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.type === "error") resolve(message);
  }));
  await once(guestSocket, "open");
  guestSocket.send(JSON.stringify({ type: "create", circles: 0, baseScore: 1 }));
  assert.match((await guestError).message, /登录/);
  guestSocket.close();
  await once(guestSocket, "close");

  await new Promise((resolve) => wss.close(() => server.close(resolve)));
});
