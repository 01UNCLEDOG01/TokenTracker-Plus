import { beforeEach, describe, expect, it } from "vitest";
import {
  LOCAL_PROFILE_STORAGE_KEY,
  localIdShort,
  readAvatarFile,
  readLocalProfile,
  resolveLocalDisplayName,
  writeLocalProfile,
} from "./local-profile";

describe("local profile", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("round-trips a name and rejects non-image avatar values", () => {
    expect(readLocalProfile()).toEqual({ displayName: "", avatarDataUrl: null });
    writeLocalProfile({
      displayName: "  本地用户  ",
      avatarDataUrl: "https://example.test/avatar.png",
    });
    expect(readLocalProfile()).toEqual({ displayName: "本地用户", avatarDataUrl: null });
    expect(JSON.parse(window.localStorage.getItem(LOCAL_PROFILE_STORAGE_KEY))).toEqual({
      displayName: "本地用户",
      avatarDataUrl: null,
    });
  });

  it("prefers the custom name, then the device name, then the fallback", () => {
    expect(resolveLocalDisplayName({ displayName: "A" }, { deviceName: "PC" }, "Local")).toBe("A");
    expect(resolveLocalDisplayName({ displayName: "" }, { deviceName: "PC" }, "Local")).toBe("PC");
    expect(resolveLocalDisplayName({}, {}, "Local")).toBe("Local");
  });

  it("shortens the local machine id for the sidebar", () => {
    expect(localIdShort("d4360d0b85964b98", 8)).toBe("d4360d0b…");
    expect(localIdShort("abc", 8)).toBe("abc");
    expect(localIdShort(null)).toBe("");
  });

  it("rejects a non-image avatar before reading it", async () => {
    await expect(readAvatarFile({ type: "text/plain", size: 10 })).rejects.toThrow("invalid_type");
  });
});
