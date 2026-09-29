import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChartImageInput } from "./chart-image-input";

const uploadMock = vi.fn();
vi.mock("@/lib/journal/trade-image-storage", () => ({
  uploadTradeImage: (file: File) => uploadMock(file),
  resolveTradeImage: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const REF = "storage:0b7e4c1a-3f2d-4e5a-9b8c-1d2e3f4a5b6c/a.png";

describe("a chart slot takes an image, not only a link (K6)", () => {
  it("uploads the chosen file and hands back the stored reference", async () => {
    const user = userEvent.setup({ delay: null });
    uploadMock.mockResolvedValue({ ok: true, ref: REF });
    const onChange = vi.fn();
    const { container } = render(<ChartImageInput value="" onChange={onChange} />);
    const file = new File(["png"], "chart.png", { type: "image/png" });
    await user.upload(container.querySelector('input[type="file"]') as HTMLInputElement, file);
    expect(uploadMock).toHaveBeenCalledWith(file);
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith(REF));
  });

  it("shows a stored image as a chip that can be removed, never its storage path", async () => {
    const user = userEvent.setup({ delay: null });
    const onChange = vi.fn();
    render(<ChartImageInput value={REF} onChange={onChange} />);
    expect(screen.getByText("Image saved")).toBeInTheDocument();
    expect(screen.queryByDisplayValue(REF)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove image" }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("still takes a TradingView link typed into the box", async () => {
    const user = userEvent.setup({ delay: null });
    const onChange = vi.fn();
    render(<ChartImageInput value="" onChange={onChange} />);
    await user.type(screen.getByRole("textbox"), "x");
    expect(onChange).toHaveBeenCalledWith("x");
  });
});
