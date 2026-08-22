import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  captureWallReturnUnderlay,
  consumeWallReturnUnderlay,
  clearWallReturnUnderlay,
} from "./wallReturnUnderlay";

describe("wallReturnUnderlay", () => {
  beforeEach(() => {
    clearWallReturnUnderlay();
  });

  afterEach(() => {
    clearWallReturnUnderlay();
    document.getElementById("main-content")?.remove();
  });

  it("captures a clone of #main-content with ids and readiness markers stripped", () => {
    const main = document.createElement("main");
    main.id = "main-content";
    main.tabIndex = -1;
    main.innerHTML = `
      <div id="dupe" data-wall-return-ready="profile">
        <span id="inner">feed content</span>
      </div>
    `;
    document.body.appendChild(main);

    captureWallReturnUnderlay();

    const underlay = consumeWallReturnUnderlay();
    expect(underlay).not.toBeNull();
    expect(underlay!.node).toBeInstanceOf(HTMLElement);
    expect(underlay!.node.id).toBe("");
    expect(underlay!.node.hasAttribute("tabindex")).toBe(false);
    expect(underlay!.node.querySelector("[id]")).toBeNull();
    expect(underlay!.node.querySelector("[data-wall-return-ready]")).toBeNull();
    // The original stays intact.
    expect(document.getElementById("main-content")).toBe(main);
    expect(main.querySelector("#dupe")).not.toBeNull();
  });

  it("applies the captured scroll offset to the snapshot", () => {
    const main = document.createElement("main");
    main.id = "main-content";
    main.textContent = "page";
    document.body.appendChild(main);

    window.scrollY = 320;
    captureWallReturnUnderlay();

    const underlay = consumeWallReturnUnderlay();
    expect(underlay!.scrollY).toBe(320);
    expect(underlay!.node.style.transform).toContain("-320px");
  });

  it("consume is destructive — a second call returns null", () => {
    const main = document.createElement("main");
    main.id = "main-content";
    document.body.appendChild(main);

    captureWallReturnUnderlay();
    expect(consumeWallReturnUnderlay()).not.toBeNull();
    expect(consumeWallReturnUnderlay()).toBeNull();
  });

  it("does nothing when #main-content is absent", () => {
    captureWallReturnUnderlay();
    expect(consumeWallReturnUnderlay()).toBeNull();
  });
});
