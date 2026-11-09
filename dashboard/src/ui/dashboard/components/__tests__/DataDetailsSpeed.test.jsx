import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { copy } from "../../../../lib/copy";
import { DataDetails } from "../DataDetails.jsx";

// Same stub as DataDetailsProjects.test.jsx: never rendered here, but the
// import graph can't resolve its .js specifier.
vi.mock("../TrendMonitorZoomModal", () => ({ TrendMonitorZoomModal: () => null }));

const baseProps = {
  copy,
  dailyBreakdownRows: [],
  dailyBreakdownColumns: [],
  toggleSort: () => {},
  renderDetailDate: () => null,
  renderDetailCell: () => null,
  DETAILS_PAGED_PERIODS: new Set(),
  period: "month",
  detailsPageCount: 0,
  detailsPage: 0,
  setDetailsPage: () => {},
};

function openSpeedTab(props = {}) {
  render(<DataDetails {...baseProps} {...props} />);
  fireEvent.click(screen.getByRole("tab", { name: copy("dashboard.speed.title") }));
}

it("shows a retry-able failure line, not the gateway-blame copy, when the fetch fails", () => {
  const onRetry = vi.fn();
  openSpeedTab({
    agent2ApiSpeedModels: [],
    agent2ApiSpeedError: true,
    onAgent2ApiSpeedRetry: onRetry,
  });
  expect(screen.getByText(copy("dashboard.speed.fetch_failed"))).toBeInTheDocument();

  // The retry button rides the same refresh cycle the other aggregates use;
  // clicking it re-runs the hook's refresh.
  fireEvent.click(screen.getByRole("button", { name: copy("dashboard.speed.retry") }));
  expect(onRetry).toHaveBeenCalledTimes(1);
});

it("renders the failure line without a retry button when no retry is wired", () => {
  openSpeedTab({ agent2ApiSpeedModels: [], agent2ApiSpeedError: true });
  expect(screen.getByText(copy("dashboard.speed.fetch_failed"))).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: copy("dashboard.speed.retry") }),
  ).not.toBeInTheDocument();
});

it("shows the honest no-data empty copy (not gateway-only wording) when nothing is measured", () => {
  openSpeedTab({ agent2ApiSpeedModels: [], agent2ApiSpeedError: false });
  expect(screen.getByText(copy("dashboard.speed.empty"))).toBeInTheDocument();
});

it("renders session-tier rows with the session badge and gateway rows without one", () => {
  openSpeedTab({
    agent2ApiSpeedError: false,
    agent2ApiSpeedModels: [
      {
        model: "glm-5.3-flash",
        requests: 12,
        output_tokens: 40597,
        tokens_per_second: 28.4,
        avg_first_response_ms: 8109,
        speed_source: "gateway",
      },
      {
        model: "deepseek-flash",
        requests: 844,
        output_tokens: 1109201,
        tokens_per_second: 101.2,
        avg_first_response_ms: null,
        speed_source: "session",
      },
    ],
  });
  expect(screen.getByText("glm-5.3-flash")).toBeInTheDocument();
  const sessionBadge = screen.getByText(copy("dashboard.speed.session_badge"));
  // The badge sits inside the session row only — the gateway row stays unlabelled.
  expect(sessionBadge.closest("tr").textContent).toContain("deepseek-flash");
  expect(sessionBadge.closest("tr").textContent).not.toContain("glm-5.3-flash");
  expect(screen.getByText("101.2 tok/s")).toBeInTheDocument();
  expect(screen.getByText("28.4 tok/s")).toBeInTheDocument();
});
