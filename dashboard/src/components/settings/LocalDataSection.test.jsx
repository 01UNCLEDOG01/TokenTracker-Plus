import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

describe("LocalDataSection", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("shows the local queue size and the transfer controls", async () => {
    fetch.mockResolvedValue(jsonResponse(200, { machine: { id: "m1", name: "pc" }, rows: 1234, bytes: 2048, max_bytes: 5242880 }));
    render(<LocalDataSection />);
    await waitFor(() => expect(screen.getByText(/1,234/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: copy("settings.local_data.export") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy("settings.local_data.choose") })).toBeInTheDocument();
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
});
