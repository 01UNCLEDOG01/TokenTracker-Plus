import { useEffect, useState } from "react";
import { getLocalMachineIdentity } from "./api";
import { isLocalOnlyDeployment } from "./insforge-config";

export const LOCAL_PROFILE_STORAGE_KEY = "tt.localProfile.v1";
export const LOCAL_PROFILE_CHANGED_EVENT = "tt:local-profile-changed";
export const LOCAL_AVATAR_SIZE = 256;
const MAX_AVATAR_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_AVATAR_DATA_URL_LENGTH = 1_500_000;
const MAX_DISPLAY_NAME_LENGTH = 40;

function normalizeProfile(value) {
  const source = value && typeof value === "object" ? value : {};
  const displayName = typeof source.displayName === "string"
    ? source.displayName.trim().slice(0, MAX_DISPLAY_NAME_LENGTH)
    : "";
  const avatarDataUrl = typeof source.avatarDataUrl === "string"
    && source.avatarDataUrl.startsWith("data:image/")
    && source.avatarDataUrl.length <= MAX_AVATAR_DATA_URL_LENGTH
    ? source.avatarDataUrl
    : null;
  return { displayName, avatarDataUrl };
}

export function readLocalProfile() {
  if (typeof window === "undefined") return normalizeProfile(null);
  try {
    const raw = window.localStorage.getItem(LOCAL_PROFILE_STORAGE_KEY);
    return normalizeProfile(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizeProfile(null);
  }
}

export function writeLocalProfile(value) {
  const profile = normalizeProfile(value);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(LOCAL_PROFILE_STORAGE_KEY, JSON.stringify(profile));
    } catch (error) {
      console.warn("[tokentracker] local profile write failed:", error);
    }
    window.dispatchEvent(new CustomEvent(LOCAL_PROFILE_CHANGED_EVENT));
  }
  return profile;
}

function subscribeLocalProfile(callback) {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event) => {
    if (event.key === null || event.key === LOCAL_PROFILE_STORAGE_KEY) callback();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(LOCAL_PROFILE_CHANGED_EVENT, callback);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(LOCAL_PROFILE_CHANGED_EVENT, callback);
  };
}

export function useLocalProfile() {
  const [profile, setProfile] = useState(readLocalProfile);
  useEffect(() => subscribeLocalProfile(() => setProfile(readLocalProfile())), []);
  return profile;
}

let cachedMachineIdentity = null;
let machineIdentityPromise = null;

/**
 * The local machine identity is the only "account ID" a single-machine build
 * has. The CLI's machine id is stable across restarts and browser caches.
 */
export function useLocalMachineIdentity({ enabled = true } = {}) {
  const [identity, setIdentity] = useState(() => cachedMachineIdentity || {
    machineId: null,
    deviceName: null,
    loading: Boolean(enabled && isLocalOnlyDeployment()),
  });

  useEffect(() => {
    if (!enabled || !isLocalOnlyDeployment()) {
      setIdentity((current) => ({ ...current, loading: false }));
      return undefined;
    }
    if (cachedMachineIdentity) {
      setIdentity({ ...cachedMachineIdentity, loading: false });
      return undefined;
    }
    let active = true;
    if (!machineIdentityPromise) {
      machineIdentityPromise = getLocalMachineIdentity()
        .then((data) => {
          cachedMachineIdentity = {
            machineId: typeof data?.machineId === "string" ? data.machineId : null,
            deviceName: typeof data?.deviceName === "string" ? data.deviceName : null,
          };
          return cachedMachineIdentity;
        })
        .catch(() => {
          machineIdentityPromise = null;
          return { machineId: null, deviceName: null };
        });
    }
    machineIdentityPromise.then((value) => {
      if (active) setIdentity({ ...value, loading: false });
    });
    return () => {
      active = false;
    };
  }, [enabled]);

  return identity;
}

export function resolveLocalDisplayName(profile, identity, fallback = "") {
  const custom = String(profile?.displayName || "").trim();
  if (custom) return custom;
  const device = String(identity?.deviceName || "").trim();
  return device || fallback;
}

export function localIdShort(machineId, length = 8) {
  const value = String(machineId || "").trim();
  if (!value) return "";
  return value.length <= length ? value : `${value.slice(0, length)}…`;
}

function loadImageSource(file) {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file);
  }
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("无法读取这张图片"));
    };
    image.src = objectUrl;
  });
}

/**
 * Read a local image, cover-crop it to a 256px square, and return a small JPEG
 * data URL. Keeping it small matters: localStorage is the only store a local
 * profile has, and a raw phone photo would exceed the quota.
 */
export async function readAvatarFile(file) {
  if (!file || !String(file.type || "").startsWith("image/")) {
    throw new Error("invalid_type");
  }
  if (file.size > MAX_AVATAR_SOURCE_BYTES) {
    throw new Error("too_large");
  }
  const source = await loadImageSource(file).catch(() => {
    throw new Error("unreadable");
  });
  try {
    const width = Number(source.width) || 0;
    const height = Number(source.height) || 0;
    if (!width || !height) throw new Error("unreadable");
    const canvas = document.createElement("canvas");
    canvas.width = LOCAL_AVATAR_SIZE;
    canvas.height = LOCAL_AVATAR_SIZE;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("unsupported");
    const scale = Math.max(LOCAL_AVATAR_SIZE / width, LOCAL_AVATAR_SIZE / height);
    const drawWidth = width * scale;
    const drawHeight = height * scale;
    context.drawImage(
      source,
      (LOCAL_AVATAR_SIZE - drawWidth) / 2,
      (LOCAL_AVATAR_SIZE - drawHeight) / 2,
      drawWidth,
      drawHeight,
    );
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    if (dataUrl.length > MAX_AVATAR_DATA_URL_LENGTH) throw new Error("too_large");
    return dataUrl;
  } finally {
    source.close?.();
  }
}
