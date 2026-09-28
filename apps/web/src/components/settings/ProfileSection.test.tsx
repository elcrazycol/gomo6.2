import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ProfileSection } from "./ProfileSection";

const navigate = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigate };
});

const renderSection = () =>
  render(
    <MemoryRouter>
      <ProfileSection userId="u1" />
    </MemoryRouter>,
  );

describe("ProfileSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("offers the profile, the studio and the placeholders picker", () => {
    renderSection();

    expect(screen.getByText("Кастомизация профиля")).toBeInTheDocument();
    expect(screen.getByText("Студия профиля")).toBeInTheDocument();
    expect(screen.getByText("Плейсхолдеры профиля")).toBeInTheDocument();
  });

  it("navigates to the profile itself", async () => {
    renderSection();
    await userEvent.click(screen.getByText("Основная кастомизация"));
    expect(navigate).toHaveBeenCalledWith("/profile/u1");
  });

  it("navigates to the studio and the placeholders editor", async () => {
    renderSection();

    await userEvent.click(screen.getByText("Студия профиля"));
    expect(navigate).toHaveBeenCalledWith("/settings/prof-studio");

    await userEvent.click(screen.getByText("Плейсхолдеры профиля"));
    expect(navigate).toHaveBeenCalledWith("/settings/placeholders");
  });

  it("no longer links to the dead /settings/posts route", () => {
    renderSection();
    expect(navigate).not.toHaveBeenCalledWith("/settings/posts");
    expect(screen.queryByText("Внешний вид постов")).not.toBeInTheDocument();
  });
});
