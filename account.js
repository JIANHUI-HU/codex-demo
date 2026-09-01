"use strict";

(() => {
  const trigger = document.querySelector(".account-trigger");
  if (!trigger) return;

  let user = null;
  const dialog = document.createElement("dialog");
  dialog.className = "account-dialog";
  dialog.innerHTML = `
    <button class="account-close" type="button" aria-label="关闭">×</button>
    <div class="account-brand"><span>六合牌局</span><h2>牌友账号</h2><p>登录后使用固定昵称进入在线牌桌</p></div>
    <div class="account-auth">
      <div class="account-tabs"><button type="button" data-tab="login" class="active">登录</button><button type="button" data-tab="register">注册</button></div>
      <form data-account-form="login">
        <label>邮箱<input name="email" type="email" maxlength="254" autocomplete="email" placeholder="name@example.com" required></label>
        <label>密码<input name="password" type="password" minlength="8" maxlength="72" autocomplete="current-password" placeholder="至少 8 个字符" required></label>
        <button class="account-submit" type="submit">登录</button>
      </form>
      <form data-account-form="register" hidden>
        <label>牌桌昵称<input name="nickname" maxlength="10" autocomplete="nickname" placeholder="1 至 10 个字" required></label>
        <label>邮箱<input name="email" type="email" maxlength="254" autocomplete="email" placeholder="name@example.com" required></label>
        <label>密码<input name="password" type="password" minlength="8" maxlength="72" autocomplete="new-password" placeholder="至少 8 个字符" required></label>
        <button class="account-submit" type="submit">注册并登录</button>
      </form>
    </div>
    <div class="account-profile" hidden>
      <div class="account-avatar">牌</div>
      <h3></h3><p></p>
      <button class="account-logout" type="button">退出登录</button>
    </div>
    <p class="account-message" role="status"></p>
  `;
  document.body.append(dialog);

  const authRoot = dialog.querySelector(".account-auth");
  const profile = dialog.querySelector(".account-profile");
  const message = dialog.querySelector(".account-message");

  function setMessage(text, kind = "") { message.textContent = text; message.className = `account-message ${kind}`; }
  function selectTab(name) {
    dialog.querySelectorAll(".account-tabs button").forEach((button) => button.classList.toggle("active", button.dataset.tab === name));
    dialog.querySelectorAll("[data-account-form]").forEach((form) => { form.hidden = form.dataset.accountForm !== name; });
    setMessage("");
  }
  function setUser(nextUser) {
    user = nextUser || null;
    window.liuheAccount.user = user;
    trigger.textContent = user ? user.nickname : "登录 / 注册";
    trigger.classList.toggle("signed-in", Boolean(user));
    authRoot.hidden = Boolean(user);
    profile.hidden = !user;
    if (user) {
      profile.querySelector("h3").textContent = user.nickname;
      profile.querySelector("p").textContent = user.email;
    }
    window.dispatchEvent(new CustomEvent("liuhe-auth-change", { detail: { user } }));
  }
  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      credentials: "same-origin",
      headers: { "content-type": "application/json", ...(options.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "账号服务暂时不可用");
    return data;
  }
  function open(tab = "login") {
    if (!user) selectTab(tab);
    setMessage("");
    if (!dialog.open) dialog.showModal();
  }
  async function refresh() {
    try { const data = await api("/api/auth/me", { method: "GET" }); setUser(data.user); }
    catch (error) { setUser(null); console.warn(error.message); }
    return user;
  }

  window.liuheAccount = { user, open, refresh };
  trigger.addEventListener("click", () => open("login"));
  dialog.querySelector(".account-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
  dialog.querySelectorAll(".account-tabs button").forEach((button) => button.addEventListener("click", () => selectTab(button.dataset.tab)));
  dialog.querySelectorAll("[data-account-form]").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector(".account-submit");
    const payload = Object.fromEntries(new FormData(form));
    submit.disabled = true; setMessage(form.dataset.accountForm === "login" ? "正在登录…" : "正在创建账号…");
    try {
      const data = await api(`/api/auth/${form.dataset.accountForm}`, { method: "POST", body: JSON.stringify(payload) });
      setUser(data.user); form.reset(); setMessage("登录成功", "success");
      setTimeout(() => dialog.close(), 350);
    } catch (error) { setMessage(error.message, "error"); }
    finally { submit.disabled = false; }
  }));
  dialog.querySelector(".account-logout").addEventListener("click", async () => {
    try { await api("/api/auth/logout", { method: "POST", body: "{}" }); setUser(null); selectTab("login"); setMessage("已退出登录", "success"); }
    catch (error) { setMessage(error.message, "error"); }
  });

  refresh();
  const requestedTab = new URLSearchParams(location.search).get("account");
  if (["login", "register"].includes(requestedTab)) setTimeout(() => open(requestedTab), 0);
})();
