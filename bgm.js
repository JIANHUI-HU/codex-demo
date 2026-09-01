"use strict";

(() => {
  const button = document.querySelector(".bgm-toggle");
  if (!button) return;

  const storageKey = "liuhe-bgm-enabled";
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  let enabled = false;
  let context = null;
  let master = null;
  let loopTimer = null;
  let generation = 0;

  try { enabled = localStorage.getItem(storageKey) === "1"; } catch {}

  // 原创五声音阶牌桌小调：只借用欢快的“噔、噔、蹬”节奏感，不复刻现成游戏旋律。
  const beatSeconds = 0.245;
  const loopBeats = 32;
  const lead = [
    [0, 74, 0.65], [1, 78, 0.65], [2, 81, 1.35], [4, 78, 0.65], [5, 81, 0.65], [6, 83, 1.35],
    [8, 81, 0.65], [9, 78, 0.65], [10, 74, 1.35], [12, 76, 0.65], [13, 78, 0.65], [14, 81, 0.65], [15, 78, 0.65],
    [16, 74, 0.65], [17, 78, 0.65], [18, 81, 1.35], [20, 83, 0.65], [21, 81, 0.65], [22, 78, 1.35],
    [24, 76, 0.65], [25, 74, 0.65], [26, 71, 1.35], [28, 74, 0.65], [29, 76, 0.65], [30, 74, 1.35],
  ];
  const bass = [38, 45, 42, 43, 38, 45, 43, 45];

  function frequency(midi) { return 440 * (2 ** ((midi - 69) / 12)); }
  function scheduleTone(midi, start, duration, volume, type = "triangle") {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency(midi), start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.025);
  }
  function scheduleWoodClick(start, strong) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(strong ? 920 : 680, start);
    oscillator.frequency.exponentialRampToValueAtTime(310, start + 0.035);
    gain.gain.setValueAtTime(strong ? 0.018 : 0.009, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.045);
    oscillator.connect(gain).connect(master);
    oscillator.start(start);
    oscillator.stop(start + 0.05);
  }
  function scheduleLoop(activeGeneration) {
    if (!enabled || !context || activeGeneration !== generation || document.hidden) return;
    const start = context.currentTime + 0.075;
    lead.forEach(([beat, midi, length]) => {
      scheduleTone(midi, start + beat * beatSeconds, length * beatSeconds, 0.052, "triangle");
      scheduleTone(midi + 12, start + beat * beatSeconds, length * beatSeconds * 0.68, 0.008, "sine");
    });
    bass.forEach((midi, index) => scheduleTone(midi, start + index * 4 * beatSeconds, 2.7 * beatSeconds, 0.028, "sine"));
    for (let beat = 0; beat < loopBeats; beat += 1) scheduleWoodClick(start + beat * beatSeconds, beat % 4 === 0);
    loopTimer = setTimeout(() => scheduleLoop(activeGeneration), loopBeats * beatSeconds * 1000 - 90);
  }
  async function startMusic() {
    if (!enabled || !AudioContextClass || context) return;
    context = new AudioContextClass();
    master = context.createGain();
    master.gain.value = 0.42;
    master.connect(context.destination);
    await context.resume();
    generation += 1;
    scheduleLoop(generation);
  }
  function stopMusic() {
    generation += 1;
    clearTimeout(loopTimer);
    loopTimer = null;
    const closingContext = context;
    context = null;
    master = null;
    if (closingContext && closingContext.state !== "closed") closingContext.close().catch(() => {});
  }
  function renderButton() {
    const label = button.querySelector("em");
    if (label) label.textContent = enabled ? "音乐开" : "音乐关";
    button.classList.toggle("active", enabled);
    button.setAttribute("aria-pressed", String(enabled));
    button.title = enabled ? "关闭背景音乐" : "开启背景音乐";
  }
  function setEnabled(nextEnabled) {
    enabled = Boolean(nextEnabled);
    try { localStorage.setItem(storageKey, enabled ? "1" : "0"); } catch {}
    renderButton();
    if (enabled) startMusic().catch(() => setEnabled(false));
    else stopMusic();
  }

  if (!AudioContextClass) { button.disabled = true; button.title = "当前浏览器不支持背景音乐"; return; }
  button.addEventListener("click", () => setEnabled(!enabled));
  document.addEventListener("pointerdown", (event) => {
    if (enabled && event.target !== button && !button.contains(event.target)) startMusic().catch(() => setEnabled(false));
  }, { once: true, capture: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopMusic();
    else if (enabled) startMusic().catch(() => setEnabled(false));
  });
  window.addEventListener("pagehide", stopMusic);
  renderButton();
})();
