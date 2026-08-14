import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PostViewCount } from "@/components/PostViewCount";

describe("PostViewCount", () => {
  it("renders the count with an eye icon", () => {
    render(<PostViewCount count={42} />);
    const badge = screen.getByTestId("post-views-count");
    expect(badge).toHaveTextContent("42");
    expect(badge).toHaveAttribute("title", "Просмотры");
  });

  it("renders a zero count", () => {
    render(<PostViewCount count={0} />);
    expect(screen.getByTestId("post-views-count")).toHaveTextContent("0");
  });

  it("renders large counts in compact form", () => {
    render(<PostViewCount count={1243} />);
    expect(screen.getByTestId("post-views-count")).toHaveTextContent("1,2К");
  });

  it("renders millions in compact form", () => {
    render(<PostViewCount count={1_500_000} />);
    expect(screen.getByTestId("post-views-count")).toHaveTextContent("1,5М");
  });

  it("renders nothing when the count is absent", () => {
    const { container } = render(<PostViewCount count={undefined} />);
    expect(container.firstChild).toBeNull();
  });
});
