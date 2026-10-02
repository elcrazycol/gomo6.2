import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SubscriptionsPanel } from "./SubscriptionsPanel";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "profile.subscribers": "Подписчики",
        "profile.subscriptions": "Подписки",
      })[key] ?? key,
  }),
}));

// The panel gates on the store's per-profile "loaded" flags; both list kinds are
// marked ready so the toggle renders immediately.
vi.mock("@/stores/friendsStore", () => ({
  useFriendsStore: (selector: (s: unknown) => unknown) =>
    selector({
      profileSubscribers: [],
      profileSubscriptions: [],
      profileSubscribersFor: "u-1",
      profileSubscriptionsFor: "u-1",
      fetchProfileSubscribers: () => Promise.resolve(),
      fetchProfileSubscriptions: () => Promise.resolve(),
    }),
}));

vi.mock("@/components/SubscriptionList", () => ({
  SubscriptionList: ({ kind }: { kind: string }) => <div data-testid="list">{kind}</div>,
}));

describe("SubscriptionsPanel", () => {
  it("defaults to the subscribers list and toggles to subscriptions", () => {
    render(<SubscriptionsPanel userId="u-1" />);

    expect(screen.getByTestId("list")).toHaveTextContent("subscribers");

    fireEvent.click(screen.getByRole("button", { name: /Подписки/ }));

    expect(screen.getByTestId("list")).toHaveTextContent("subscriptions");
  });
});
