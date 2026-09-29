import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));

import { imageFileProblem, MAX_IMAGE_BYTES } from "./trade-image-storage";

describe("which files the bucket takes (K6)", () => {
  it("takes a PNG, a JPEG or a WebP up to 10 MB", () => {
    for (const type of ["image/png", "image/jpeg", "image/webp"]) {
      expect(imageFileProblem({ type, size: 1_000 }), type).toBeNull();
    }
    expect(imageFileProblem({ type: "image/png", size: MAX_IMAGE_BYTES })).toBeNull();
  });

  it("says why before any upload: another type, or too large", () => {
    expect(imageFileProblem({ type: "application/pdf", size: 10 })).toMatch(/PNG, JPEG or WebP/);
    expect(imageFileProblem({ type: "image/png", size: MAX_IMAGE_BYTES + 1 })).toMatch(/10 MB/);
  });
});
