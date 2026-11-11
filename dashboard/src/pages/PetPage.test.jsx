import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copy } from "../lib/copy";
import { PetPage } from "./PetPage.jsx";

const petApiMocks = vi.hoisted(() => ({
  importCodexPets: vi.fn(),
  importPetPackage: vi.fn(),
  installPetFromUrl: vi.fn(),
  listCodexImportable: vi.fn(),
  removePet: vi.fn(),
}));

vi.mock("../lib/pets-api.js", () => petApiMocks);

vi.mock("../ui/foundation/ClawdAnimated.jsx", () => ({
  ClawdAnimated: ({ state, character }) => <div data-state={state} data-character={character} />,
}));

vi.mock("../ui/foundation/FadeIn.jsx", () => ({
  FadeIn: ({ children }) => <>{children}</>,
}));

vi.mock("../hooks/use-pet-catalog.js", () => ({
  usePetCatalog: () => ({
    pets: [
      { id: "clawd", displayName: "Clawd", nameKey: "pet.character.clawd", spriteVersionNumber: 1 },
      { id: "sprout", displayName: "Sprout", nameKey: "pet.character.sprout", spriteVersionNumber: 1 },
      { id: "byte", displayName: "Byte", nameKey: "pet.character.byte", spriteVersionNumber: 1 },
      { id: "ember", displayName: "Ember", nameKey: "pet.character.ember", spriteVersionNumber: 1 },
    ],
    loading: false,
    available: true,
    refresh: vi.fn(),
  }),
}));

function installNativeBridge() {
  const messages = [];
  window.history.pushState({}, "", "/pet-settings?app=1");
  window.chrome = {
    webview: { postMessage: (message) => messages.push(JSON.parse(message)) },
  };
  return messages;
}

function installMacBridge() {
  const messages = [];
  window.history.pushState({}, "", "/pet-settings?app=1");
  // WKWebView exposes the shared nativeBridge handler; there is no
  // window.chrome.webview marker on macOS.
  window.webkit = {
    messageHandlers: {
      nativeBridge: { postMessage: (message) => messages.push(message) },
    },
  };
  return messages;
}

function installWindowsBridge() {
  const messages = [];
  window.history.pushState({}, "", "/pet-settings?app=1");
  window.chrome = {
    webview: { postMessage: (message) => messages.push(JSON.parse(message)) },
  };
  return messages;
}

beforeEach(() => {
  for (const mock of Object.values(petApiMocks)) mock.mockReset();
  // Most page tests do not exercise reverse import. Keeping discovery pending
  // avoids unrelated post-assertion state updates while the component remains mounted.
  petApiMocks.listCodexImportable.mockImplementation(() => new Promise(() => {}));
  petApiMocks.importCodexPets.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  window.history.pushState({}, "", "/");
  window.localStorage.removeItem("tokentracker_native_app");
  delete window.webkit;
  delete window.chrome;
});

describe("PetPage", () => {
  it("uses the page title without the redundant desktop companion eyebrow", () => {
    render(<PetPage />);

    expect(screen.getByRole("heading", { name: copy("pet.page.title") })).toBeInTheDocument();
    expect(screen.queryByText(copy("pet.page.eyebrow"))).not.toBeInTheDocument();
    const selectedClawd = screen.getByRole("button", { name: new RegExp(copy("pet.character.clawd")) });
    expect(selectedClawd).toHaveClass("border-oai-brand-500/40");
    expect(selectedClawd).not.toHaveClass("border-oai-black", "dark:border-white");
    expect(screen.getByRole("heading", { name: copy("pet.import.title") })).toBeInTheDocument();
  });

  it("reads and updates live desktop pet settings through the native bridge", async () => {
    const user = userEvent.setup();
    const messages = installNativeBridge();
    render(<PetPage />);

    expect(messages).toContainEqual({ type: "getPetSettings" });
    await act(async () => {
      window.dispatchEvent(new CustomEvent("native:petSettings", {
        detail: { visible: true, character: "sprout", size: "large" },
      }));
    });

    expect(await screen.findByRole("switch", { name: copy("pet.controls.show") })).toBeChecked();
    expect(screen.getByRole("button", {
      name: copy("pet.character.sprout"),
    })).toHaveAttribute("aria-pressed", "true");

    await act(async () => {
      await user.click(screen.getByRole("button", { name: copy("pet.character.byte") }));
    });
    await waitFor(() => {
      expect(messages).toContainEqual({ type: "setPetSetting", key: "character", value: "byte" });
    });
  });

  it("removes bundled companions but always protects Clawd", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    const messages = installNativeBridge();
    petApiMocks.removePet.mockResolvedValue({ ok: true, id: "sprout", hidden: true });
    render(<PetPage />);

    await act(async () => {
      window.dispatchEvent(new CustomEvent("native:petSettings", {
        detail: { visible: true, character: "sprout", size: "medium" },
      }));
    });

    expect(screen.getByRole("button", {
      name: `${copy("pet.import.remove")} · ${copy("pet.character.sprout")}`,
    })).toHaveClass("opacity-0", "group-hover:opacity-100");
    expect(screen.queryByRole("button", {
      name: `${copy("pet.import.remove")} · ${copy("pet.character.clawd")}`,
    })).not.toBeInTheDocument();

    await act(async () => {
      await user.click(screen.getByRole("button", {
        name: `${copy("pet.import.remove")} · ${copy("pet.character.sprout")}`,
      }));
    });

    expect(petApiMocks.removePet).toHaveBeenCalledWith("sprout");
    expect(messages).toContainEqual({
      type: "setPetSetting",
      key: "character",
      value: "clawd",
    });
    expect(messages).toContainEqual({ type: "refreshPetCatalog" });
  });

  it("lets browser users preview every data state without a native host", async () => {
    const user = userEvent.setup();
    render(<PetPage />);
    const focus = screen.getByRole("button", { name: copy("pet.state.focus") });
    await act(async () => {
      await user.click(focus);
    });
    expect(focus).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(copy("pet.controls.native_only"))).toBeInTheDocument();
  });

  it("uses the WebView2 JSON bridge for Windows pet settings", async () => {
    const user = userEvent.setup();
    const messages = installWindowsBridge();
    render(<PetPage />);

    expect(messages).toContainEqual({ type: "getPetSettings" });
    await act(async () => {
      window.dispatchEvent(new CustomEvent("native:petSettings", {
        detail: { visible: false, character: "ember", size: "small" },
      }));
    });

    const ember = await screen.findByRole("button", {
      name: copy("pet.character.ember"),
    });
    expect(ember).toHaveAttribute("aria-pressed", "true");
    await act(async () => {
      await user.click(screen.getByRole("button", {
        name: copy("pet.character.sprout"),
      }));
    });
    expect(messages).toContainEqual({ type: "setPetSetting", key: "character", value: "sprout" });
  });

  it("discovers Codex companions and imports a selected built-in pet", async () => {
    const user = userEvent.setup();
    const discovered = {
      codexDetected: true,
      importable: [{
        id: "rocky",
        displayName: "Rocky",
        description: "Built-in Codex companion.",
        spriteVersionNumber: 2,
        assetUrl: "/api/pets/codex/rocky/spritesheet.webp?v=app2",
      }],
    };
    petApiMocks.listCodexImportable
      .mockResolvedValueOnce(discovered)
      .mockResolvedValue({ codexDetected: false, importable: [] });

    render(<PetPage />);
    const browse = await screen.findByRole("button", { name: copy("pet.codex.browse") });
    await act(async () => { await user.click(browse); });
    const dialog = screen.getByRole("dialog", { name: copy("pet.codex.title") });
    expect(dialog).toBeInTheDocument();
    await waitFor(() => expect(dialog).toContainElement(document.activeElement));

    await act(async () => { await user.click(screen.getByRole("button", { name: /Rocky/ })); });
    await act(async () => {
      await user.click(screen.getByRole("button", { name: new RegExp(copy("pet.codex.import")) }));
    });

    await waitFor(() => expect(petApiMocks.importCodexPets).toHaveBeenCalledWith(["rocky"]));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: copy("pet.codex.title") })).not.toBeInTheDocument());
  });

  it("hides the action picker for hosts that do not push the actionLock capability", async () => {
    installNativeBridge();
    render(<PetPage />);

    await act(async () => {
      window.dispatchEvent(new CustomEvent("native:petSettings", {
        detail: { visible: true, character: "clawd", size: "medium" },
      }));
    });

    expect(await screen.findByRole("switch", { name: copy("pet.controls.show") })).toBeChecked();
    expect(screen.queryByText(copy("pet.action.title"))).not.toBeInTheDocument();
  });

  it("multi-selects which actions the pet may use through the native bridge", async () => {
    const user = userEvent.setup();
    const messages = installNativeBridge();
    render(<PetPage />);

    await act(async () => {
      window.dispatchEvent(new CustomEvent("native:petSettings", {
        detail: { visible: true, character: "clawd", size: "medium", actionLock: "auto" },
      }));
    });

    expect(await screen.findByText(copy("pet.action.title"))).toBeInTheDocument();
    const actionGroup = within(screen.getByRole("group", { name: copy("pet.action.title") }));
    expect(actionGroup.getByRole("button", { name: copy("pet.action.auto") })).toHaveAttribute("aria-pressed", "true");

    await user.click(actionGroup.getByRole("button", { name: copy("pet.state.streak") }));
    await waitFor(() => {
      expect(messages).toContainEqual({ type: "setPetSetting", key: "actionLock", value: "working-wizard" });
    });
    expect(actionGroup.getByRole("button", { name: copy("pet.action.auto") })).toHaveAttribute("aria-pressed", "false");

    await user.click(actionGroup.getByRole("button", { name: copy("pet.state.rest") }));
    await waitFor(() => {
      expect(messages).toContainEqual({
        type: "setPetSetting",
        key: "actionLock",
        value: "working-wizard,sleeping",
      });
    });

    await user.click(actionGroup.getByRole("button", { name: copy("pet.action.auto") }));
    await waitFor(() => {
      expect(messages).toContainEqual({ type: "setPetSetting", key: "actionLock", value: "auto" });
    });
    expect(actionGroup.getByRole("button", { name: copy("pet.state.streak") })).toHaveAttribute("aria-pressed", "false");
  });

  it("lists trotting as a disabled hint and never locks it", async () => {
    const user = userEvent.setup();
    const messages = installNativeBridge();
    render(<PetPage />);

    await act(async () => {
      window.dispatchEvent(new CustomEvent("native:petSettings", {
        detail: { visible: true, character: "clawd", size: "medium", actionLock: "auto" },
      }));
    });

    expect(await screen.findByText(copy("pet.action.title"))).toBeInTheDocument();
    const actionGroup = within(screen.getByRole("group", { name: copy("pet.action.title") }));
    const runRight = actionGroup.getByRole("button", { name: copy("pet.state.run_right") });
    const runLeft = actionGroup.getByRole("button", { name: copy("pet.state.run_left") });
    // 挥手是宿主信号动作（被召唤/唤醒/离线/出错），常驻会淹没提示，只展示不可锁。
    const waveButton = actionGroup.getByRole("button", { name: copy("pet.state.wave") });

    // Rows 1/2 are the drag-only directional pair; the picker shows them but must
    // never let them be locked into the ambient rotation.
    expect(runRight).toBeDisabled();
    expect(runLeft).toBeDisabled();
    expect(waveButton).toBeDisabled();
    await user.click(runRight);
    await user.click(waveButton);
    expect(messages).not.toContainEqual(expect.objectContaining({ key: "actionLock" }));
  });
it("hides the free-float mode and 动作 picker on a macOS host that does not support them", async () => {
    const user = userEvent.setup();
    const messages = installMacBridge();
    render(<PetPage />);

    // The host answers getSettings with the capability contract; the pet page
    // only becomes available after that reply (capability, not transport sniff).
    await act(async () => {
      window.dispatchEvent(new CustomEvent("native:settings", {
        detail: {
          platform: "macos",
          petBridge: true,
          islandModes: ["island"],
          petActionLockSupported: false,
          // No QuotaPanelController until B3c: the host advertises false.
          quotaWindow: false,
        },
      }));
    });
    await waitFor(() => expect(messages).toContainEqual({ type: "getPetSettings" }));

    await act(async () => {
      window.dispatchEvent(new CustomEvent("native:petSettings", {
        detail: {
          visible: true,
          character: "clawd",
          size: "medium",
          monitor: true,
          islandMode: true,
          // A host that still echoes quota/actionLock must NOT make those
          // controls appear: quotaWindow:false / petActionLockSupported:false are
          // the capability gates (neither surface exists yet).
          quota: true,
          trayStyle: "cat",
          actionLock: "auto",
        },
      }));
    });

    // The page is live (monitor toggle rendered from the host snapshot) — and
    // on a macOS host the toggle is labelled 灵动岛 (the mac pill IS the
    // island; the Windows shell keeps the 用量悬浮窗 label).
    const macMonitorLabel = copy("pet.controls.monitor_mac") || copy("pet.controls.monitor");
    expect(await screen.findByRole("switch", { name: macMonitorLabel })).toBeInTheDocument();
    // ...but the host offers only the top-anchored island, so neither the
    // 自由悬浮 option nor a single-option 悬浮模式 row is rendered.
    expect(screen.queryByText(copy("pet.controls.float_mode"))).not.toBeInTheDocument();
    expect(screen.queryByText(copy("pet.controls.island_mode"))).not.toBeInTheDocument();
    // The 动作 picker is hidden: no section title, no group control.
    expect(screen.queryByText(copy("pet.action.title"))).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: copy("pet.action.title") })).not.toBeInTheDocument();
    // 桌面限额 has no native window until B3c: the row must not render even though
    // the host snapshot carries a quota value.
    expect(screen.queryByText(copy("pet.controls.quota"))).not.toBeInTheDocument();

    // Whatever the user can still click only writes supported values.
    await act(async () => {
      await user.click(screen.getByRole("switch", { name: macMonitorLabel }));
    });
    await waitFor(() => expect(messages).toContainEqual({
      type: "setPetSetting",
      key: "monitor",
      value: false,
    }));
    expect(messages).not.toContainEqual(expect.objectContaining({ key: "islandMode", value: false }));
    expect(messages).not.toContainEqual(expect.objectContaining({ key: "actionLock" }));
  });

  it("renders the free-size slider on hosts that echo petScale and posts raw scale", async () => {
    const user = userEvent.setup();
    const messages = installMacBridge();
    render(<PetPage />);

    await act(async () => {
      window.dispatchEvent(new CustomEvent("native:settings", {
        detail: { platform: "macos", petBridge: true },
      }));
    });
    await act(async () => {
      window.dispatchEvent(new CustomEvent("native:petSettings", {
        detail: { visible: true, character: "clawd", size: "medium", petScale: 1.4 },
      }));
    });

    const slider = await screen.findByRole("slider", { name: copy("pet.controls.size") });
    expect(slider).toHaveValue("1.4");
    // The preset segmented control is replaced by the slider + anchor chips.
    expect(screen.queryByRole("button", { name: copy("pet.size.medium") })).not.toBeNull();
    expect(screen.getByRole("button", { name: copy("pet.size.medium") })).toHaveAttribute("aria-pressed", "true");

    // Moving the slider posts the raw continuous scale — the host clamps.
    // jsdom has no range-keyboard handling, so drive the input with a change
    // event the way a real drag would end with.
    await act(async () => {
      fireEvent.change(slider, { target: { value: "1.6" } });
    });
    await waitFor(() => {
      expect(messages).toContainEqual({ type: "setPetSetting", key: "petScale", value: 1.6 });
    });

    // An anchor chip posts the legacy `size` key — the host maps it to the
    // preset's anchor scale, keeping the bridge contract backward-compatible.
    await user.click(screen.getByRole("button", { name: copy("pet.size.large") }));
    await waitFor(() => {
      expect(messages).toContainEqual({ type: "setPetSetting", key: "size", value: "large" });
    });
  });

  it("keeps the three-preset segmented control on hosts that do not echo petScale", async () => {
    const messages = installMacBridge();
    render(<PetPage />);

    await act(async () => {
      window.dispatchEvent(new CustomEvent("native:settings", {
        detail: { platform: "macos", petBridge: true },
      }));
    });
    await act(async () => {
      window.dispatchEvent(new CustomEvent("native:petSettings", {
        detail: { visible: true, character: "clawd", size: "medium" },
      }));
    });

    expect(await screen.findByText(copy("pet.controls.size"))).toBeInTheDocument();
    expect(screen.queryByRole("slider", { name: copy("pet.controls.size") })).not.toBeInTheDocument();
    // No slider on this host: the preset control still renders, and none of its
    // buttons is the slider's anchor-chip variant (the segmented control has no
    // aria-pressed chips row either).
    expect(screen.queryByRole("group", { name: copy("pet.controls.size") })).not.toBeInTheDocument();
  });

  it("keeps the free-float mode and 动作 picker on hosts that offer them", async () => {
    const messages = installWindowsBridge();
    render(<PetPage />);

    await act(async () => {
      window.dispatchEvent(new CustomEvent("native:settings", { detail: { platform: "windows" } }));
    });
    await waitFor(() => expect(messages).toContainEqual({ type: "getPetSettings" }));

    await act(async () => {
      window.dispatchEvent(new CustomEvent("native:petSettings", {
        detail: {
          visible: true,
          character: "clawd",
          size: "medium",
          monitor: true,
          islandMode: true,
          actionLock: "auto",
          quota: true,
        },
      }));
    });

    // A WebView2 host that does not advertise islandModes keeps both modes, and
    // an echoed actionLock keeps the 动作 picker visible.
    expect(await screen.findByText(copy("pet.controls.island_mode"))).toBeInTheDocument();
    expect(screen.getByText(copy("pet.controls.float_mode"))).toBeInTheDocument();
    expect(screen.getByText(copy("pet.action.title"))).toBeInTheDocument();
    // Without a quotaWindow capability the Windows host's real quota window keeps
    // the 桌面限额 row visible (this host echoes quota and has the surface).
    expect(screen.getByText(copy("pet.controls.quota"))).toBeInTheDocument();
  });

  it("labels the mascot tray style as 宠物图标 on a macOS host", async () => {
    const messages = installMacBridge();
    render(<PetPage />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent("native:settings", {
        detail: { platform: "macos", petBridge: true, quotaWindow: true },
      }));
    });
    await waitFor(() => expect(messages).toContainEqual({ type: "getPetSettings" }));
    await act(async () => {
      window.dispatchEvent(new CustomEvent("native:petSettings", {
        detail: { visible: true, character: "clawd", size: "medium", trayStyle: "mascot", quota: true },
      }));
    });
    // macOS calls the character icon a PET icon; the Windows wording is not rendered.
    expect(await screen.findByRole("button", { name: copy("pet.controls.tray_mascot_mac") })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: copy("pet.controls.tray_mascot") })).not.toBeInTheDocument();
  });

  it("keeps the upstream 应用图标 label for the mascot tray style on Windows", async () => {
    const messages = installWindowsBridge();
    render(<PetPage />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent("native:settings", { detail: { platform: "windows" } }));
    });
    await waitFor(() => expect(messages).toContainEqual({ type: "getPetSettings" }));
    await act(async () => {
      window.dispatchEvent(new CustomEvent("native:petSettings", {
        detail: { visible: true, character: "clawd", size: "medium", trayStyle: "mascot", quota: true },
      }));
    });
    // Windows stays on the upstream label — the rename is macOS-only.
    expect(await screen.findByRole("button", { name: copy("pet.controls.tray_mascot") })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: copy("pet.controls.tray_mascot_mac") })).not.toBeInTheDocument();
  });
});
