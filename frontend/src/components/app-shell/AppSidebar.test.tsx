import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import AppSidebar from "./AppSidebar";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));

it("opens the protected local player from the dashboard sidebar", () => {
  render(
    <AppSidebar
      user={{ id: "u1", email: "learner@example.com", full_name: "Learner", is_active: true, created_at: "2026-01-01", has_face_enrolled: false }}
      collapsed={false}
      onToggleCollapse={() => {}}
      onOpenSecurity={() => {}}
      onLogout={() => {}}
    />,
  );

  expect(screen.getByRole("link", { name: "Test player" })).toHaveAttribute("href", "/learn/price-action-secrets/1");
  expect(screen.getByRole("link", { name: "Preview video (no DRM)" })).toHaveAttribute("href", "/learn/price-action-secrets/1?preview=1");
});
