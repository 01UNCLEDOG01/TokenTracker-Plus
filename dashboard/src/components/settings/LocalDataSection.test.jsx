import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { copy } from "../../lib/copy";

vi.mock("../../lib/local-api-auth", () => ({
  getLocalApiAuthHeaders: async () => ({}),
  clearLocalApiAuthToken: () => {},
}));

import { LocalDataSection } from "./LocalDataSection.jsx";

function jsonResponse(status, body) {
  return { ok: status === 200, status, json: async () => body };
}

const urlBackups = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };

describe("LocalDataSection", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    // jsdom has no blob URL plumbing; the component only needs the calls to exist.
    URL.createObjectURL = vi.fn(() => "blob:mock");
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    URL.createObjectURL = urlBackups.createObjectURL;
    URL.revokeObjectURL = urlBackups.revokeObjectURL;
  });

  it("shows the local queue size and the transfer controls", async () => {
    fetch.mockResolvedValue(jsonResponse(200, { machine: { id: "m1", name: "pc" }, rows: 1234, bytes: 2048, max_bytes: 5242880 }));
    render(<LocalDataSection />);
    await waitFor(() => expect(screen.getByText(/1,234/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: copy("settings.local_data.export") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy("settings.local_data.choose") })).toBeInTheDocument();
  });

  it("exports, and when the queue overflows the cap offers an older batch with the window bound", async () => {
    const truncatedBody = {
      truncated: true,
      total_rows: 50,
      snapshot: {
        kind: "tokentracker-local-usage",
        version: 1,
        exported_at: "2026-11-10T00:00:00.000Z",
        machine: { id: "m1", name: "pc" },
        rows: [{ source: "a", model: "m", hour_start: "2026-10-01T00:00:00.000Z" }],
        total_rows: 50,
        truncated: true,
        window: { from: "2026-10-01T00:00:00.000Z", to: "2026-11-01T00:00:00.000Z" },
      },
    };
    fetch
      .mockResolvedValueOnce(jsonResponse(200, { machine: { id: "m1" }, rows: 50, bytes: 100 }))
      .mockResolvedValueOnce(jsonResponse(200, truncatedBody))
      .mockResolvedValueOnce(jsonResponse(200, truncatedBody));
    render(<LocalDataSection />);
    await waitFor(() => expect(screen.getByText(/50/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: copy("settings.local_data.export") }));
    const windowText = copy("settings.local_data.exported_window", { rows: "1", total: "50", from: "2026-10-01" });
    await waitFor(() => expect(screen.getByText(windowText)).toBeInTheDocument());
    expect(fetch.mock.calls[1][1].body).toBe(JSON.stringify({ action: "export" }));

    fireEvent.click(screen.getByRole("button", { name: copy("settings.local_data.export_older") }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(fetch.mock.calls[2][1].body).toBe(JSON.stringify({ action: "export", before: "2026-10-01T00:00:00.000Z" }));
  });

  it("stops offering older batches when the window no longer advances", async () => {
    const truncatedBody = {
      truncated: true,
      total_rows: 50,
      snapshot: {
        kind: "tokentracker-local-usage",
        version: 1,
        exported_at: "2026-11-10T00:00:00.000Z",
        machine: { id: "m1", name: "pc" },
        rows: [{ source: "a", model: "m", hour_start: "2026-10-01T00:00:00.000Z" }],
        total_rows: 50,
        truncated: true,
        window: { from: "2026-10-01T00:00:00.000Z", to: "2026-11-01T00:00:00.000Z" },
      },
    };
    fetch
      .mockResolvedValueOnce(jsonResponse(200, { machine: { id: "m1" }, rows: 50, bytes: 100 }))
      .mockResolvedValueOnce(jsonResponse(200, truncatedBody))
      .mockResolvedValueOnce(jsonResponse(200, truncatedBody));
    render(<LocalDataSection />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: copy("settings.local_data.export") }));
    await waitFor(() => expect(screen.getByRole("button", { name: copy("settings.local_data.export_older") })));

    // Same window.from as the first batch → no progress → button disappears.
    fireEvent.click(screen.getByRole("button", { name: copy("settings.local_data.export_older") }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: copy("settings.local_data.export_older") })).not.toBeInTheDocument(),
    );
  });

  it("explains that a snapshot from this machine is rejected", async () => {
    fetch
      .mockResolvedValueOnce(jsonResponse(200, { machine: { id: "m1" }, rows: 10, bytes: 100 }))
      .mockResolvedValueOnce(jsonResponse(400, { code: "self_import" }));
    const { container } = render(<LocalDataSection />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const input = container.querySelector('input[type="file"]');
    const payload = JSON.stringify({ kind: "tokentracker-local-usage" });
    const file = new File([payload], "snapshot.json", { type: "application/json" });
    if (typeof file.text !== "function") file.text = async () => payload;
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(copy("settings.local_data.self")));
  });

  it("full backup export streams a gzipped download and reports its size", async () => {
    fetch
      .mockResolvedValueOnce(jsonResponse(200, { machine: { id: "m1" }, rows: 10, bytes: 100 }))
      .mockImplementationOnce(async () => ({
        ok: true,
        status: 200,
        blob: async () => new Blob([new Uint8Array(2048)], { type: "application/gzip" }),
      }));
    render(<LocalDataSection />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: copy("settings.local_data.export_full") }));
    await waitFor(() =>
      expect(screen.getByText(copy("settings.local_data.export_full_done", { size: "2.0 KB" }))).toBeInTheDocument(),
    );
    expect(fetch.mock.calls[1][1].body).toBe(JSON.stringify({ action: "export_full" }));
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it("routes .gz imports through the full-backup preview/confirm path", async () => {
    fetch
      .mockResolvedValueOnce(jsonResponse(200, { machine: { id: "m1" }, rows: 10, bytes: 100 }))
      .mockResolvedValueOnce(jsonResponse(200, { format: "ndjson-gzip", rows: 5, fresh: 5, duplicate: 0, token: "tok" }))
      .mockResolvedValueOnce(jsonResponse(200, { imported: 5, skipped: 0 }));
    const { container } = render(<LocalDataSection />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());

    const file = new File([new Uint8Array(32)], "tokentracker-local-full-abc.json.gz", { type: "application/gzip" });
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [file] } });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(fetch.mock.calls[1][1].headers["x-tokentracker-backup-action"]).toBe("preview_full");
    expect(fetch.mock.calls[1][1].headers["Content-Type"]).toBe("application/gzip");
    expect(fetch.mock.calls[1][1].body).toBe(file);

    fireEvent.click(screen.getByRole("button", { name: copy("settings.local_data.confirm") }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(fetch.mock.calls[2][1].headers["x-tokentracker-backup-action"]).toBe("import_full");
    expect(fetch.mock.calls[2][1].headers["x-tokentracker-import-token"]).toBe("tok");
  });
});
