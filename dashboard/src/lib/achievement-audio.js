// Audio playback manager for achievement unlocks and promotions.
// Uses Web Audio API with pre-decoded AudioBuffers, falling back gracefully
// if the browser blocks autoplay before user interaction.

const SOUND_STORAGE_KEY = "tokentracker:sound:enabled";

const SOUND_URLS = {
  unlock: "/sounds/steam-achievement.mp3",
  tierUp: "/sounds/steam-achievement.mp3", // 站主偏好：升级音效先同用 Steam 音效，后续再自定义
};

let audioCtx = null;
const audioBuffers = {};
const bufferPromises = {};

function getAudioContext() {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    audioCtx = new AudioContextClass({ latencyHint: "interactive" });
  }
  return audioCtx;
}

export function isSoundEnabled() {
  if (typeof window === "undefined") return true;
  try {
    const val = localStorage.getItem(SOUND_STORAGE_KEY);
    return val === null ? true : val === "true";
  } catch {
    return true;
  }
}

export function setSoundEnabled(enabled) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SOUND_STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    // Ignore storage quota errors
  }
}

async function loadSoundBuffer(type) {
  const url = SOUND_URLS[type];
  if (!url) return null;
  if (audioBuffers[type]) return audioBuffers[type];
  if (bufferPromises[type]) return bufferPromises[type];

  bufferPromises[type] = (async () => {
    try {
      const ctx = getAudioContext();
      if (!ctx) return null;
      const response = await fetch(url);
      if (!response.ok) return null;
      const arrayBuffer = await response.arrayBuffer();
      const decoded = await ctx.decodeAudioData(arrayBuffer);
      audioBuffers[type] = decoded;
      return decoded;
    } catch {
      return null;
    }
  })();

  return bufferPromises[type];
}

async function playSound(type, volume = 0.75) {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    if (ctx.state === "suspended") {
      await ctx.resume().catch(() => {});
    }
    const buffer = await loadSoundBuffer(type);
    if (!buffer) return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const gainNode = ctx.createGain();
    gainNode.gain.value = Math.max(0, Math.min(1, volume));

    source.connect(gainNode);
    gainNode.connect(ctx.destination);

    source.start(0);
  } catch {
    // Safely ignore autoplay restrictions or background tab pauses
  }
}

/**
 * Play classic Steam achievement unlock chime.
 */
export function playUnlockSound() {
  return playSound("unlock", 0.85);
}

/**
 * Play high-tier promotion chime when advancing tiers (bronze -> silver -> gold -> diamond).
 */
export function playTierUpSound() {
  return playSound("tierUp", 0.8);
}
