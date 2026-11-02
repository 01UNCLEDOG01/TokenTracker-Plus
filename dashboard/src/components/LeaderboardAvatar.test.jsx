import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LeaderboardAvatar } from "./LeaderboardAvatar.jsx";

describe("LeaderboardAvatar", () => {
  it("renders the remote avatar and falls back to initials when it fails to load", () => {
    const { container } = render(<LeaderboardAvatar avatarUrl="https://example.test/avatar.png" displayName="Dana Doe" />);
    const image = container.querySelector("img");
    expect(image).toHaveAttribute("src", "https://example.test/avatar.png");
    fireEvent.error(image);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("DD")).toBeInTheDocument();
  });

  it("derives two initials from a multi-word name", () => {
    render(<LeaderboardAvatar displayName="Dana Doe" />);
    expect(screen.getByText("DD")).toBeInTheDocument();
  });

  it("uses the first two characters for a single-word name", () => {
    render(<LeaderboardAvatar displayName="solo" />);
    expect(screen.getByText("SO")).toBeInTheDocument();
  });

  it("shows a placeholder when the name is empty", () => {
    render(<LeaderboardAvatar displayName="" />);
    expect(screen.getByText("?")).toBeInTheDocument();
  });
});
