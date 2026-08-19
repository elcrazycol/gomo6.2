import { describe, it, expect } from "vitest";
import i18n from "@/i18n";
import { apiErrorMessage } from "./apiErrors";

const t = i18n.t.bind(i18n);

describe("apiErrorMessage", () => {
  it("renders a known code through the error namespace", () => {
    const err = { code: "invalid_credentials", message: "Invalid credentials" };
    expect(apiErrorMessage(err, t)).toBe("Неверный логин или пароль");
  });

  it("falls back to the raw message for unknown codes", () => {
    const err = { code: "unknown_code", message: "Something bad happened" };
    expect(apiErrorMessage(err, t)).toBe("Something bad happened");
  });

  it("falls back to the raw message when no code is present", () => {
    const err = { message: "Legacy error text" };
    expect(apiErrorMessage(err, t)).toBe("Legacy error text");
  });

  it("uses the generic fallback key when there is no message either", () => {
    expect(apiErrorMessage({}, t)).toBe("Произошла ошибка");
  });

  it("passes params to the localized template", () => {
    const err = { code: "video_processing", params: { reason: "boom" } };
    expect(apiErrorMessage(err, t)).toBe("Не удалось обработать видео");
  });
});
