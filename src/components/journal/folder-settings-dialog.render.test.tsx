import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FolderSettingsDialog } from "./folder-settings-dialog";
import type { NoteFolder } from "@/lib/journal/notes/note-types";

/**
 * The icon picker inside the folder settings dialog. `updateFolder` and
 * `deleteFolder` are mocked; the sidebar's own re-render of the chosen icon is
 * covered by `folder-icons.test.ts` proving `folderIcon()` resolves what gets
 * stored here — this file is about the picker's own state, not the round trip.
 */

const updateFolderMock = vi.fn();
const deleteFolderMock = vi.fn();
vi.mock("@/app/(app)/notebook/actions", () => ({
  updateFolder: (...a: unknown[]) => updateFolderMock(...a),
  deleteFolder: (...a: unknown[]) => deleteFolderMock(...a),
  createFolder: vi.fn(),
  moveFolder: vi.fn(),
  emptyTrash: vi.fn(),
  createNote: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const folder = (over: Partial<NoteFolder> = {}): NoteFolder => ({
  id: "f1",
  name: "Trade Notes",
  template_text: null,
  sort_order: 0,
  icon: null,
  is_system: false,
  ...over,
});

beforeEach(() => {
  updateFolderMock.mockReset().mockResolvedValue({ ok: true });
  deleteFolderMock.mockReset().mockResolvedValue({ ok: true, orphaned: 0 });
});

describe("FolderSettingsDialog — icon picker", () => {
  it("starts with nothing pressed for a folder that has no icon yet", () => {
    render(
      <FolderSettingsDialog folder={folder()} open onOpenChange={() => {}} />,
    );
    const pressed = screen
      .queryAllByRole("button", { pressed: true })
      .filter((b) => b.hasAttribute("aria-label"));
    expect(pressed).toHaveLength(0);
  });

  it("SHOWS THE STORED ICON AS PRESSED, so opening the dialog does not look like a reset", () => {
    render(
      <FolderSettingsDialog
        folder={folder({ icon: "rocket" })}
        open
        onOpenChange={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "rocket" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("picking an icon presses it and unpresses the rest", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <FolderSettingsDialog folder={folder()} open onOpenChange={() => {}} />,
    );
    await user.click(screen.getByRole("button", { name: "star" }));
    expect(screen.getByRole("button", { name: "star" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "rocket" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("CLICKING THE SELECTED ICON AGAIN CLEARS IT back to the plain folder", async () => {
    // Same toggle-off idiom the tri-state answer buttons use elsewhere in this
    // app: without a way back, the first click is permanent.
    const user = userEvent.setup({ delay: null });
    render(
      <FolderSettingsDialog
        folder={folder({ icon: "star" })}
        open
        onOpenChange={() => {}}
      />,
    );
    await user.click(screen.getByRole("button", { name: "star" }));
    expect(screen.getByRole("button", { name: "star" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("Save sends the picked icon alongside name and template", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <FolderSettingsDialog folder={folder()} open onOpenChange={() => {}} />,
    );
    await user.click(screen.getByRole("button", { name: "brain" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(updateFolderMock).toHaveBeenCalledWith(
      "f1",
      expect.objectContaining({ icon: "brain" }),
    );
  });
});

describe("FolderSettingsDialog — system folder protection", () => {
  it("disables Delete for a system folder, so the automation it backs can't be deleted out from under it", () => {
    render(
      <FolderSettingsDialog
        folder={folder({ is_system: true })}
        open
        onOpenChange={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /delete folder/i })).toBeDisabled();
  });

  it("leaves Delete enabled for an ordinary folder", () => {
    render(
      <FolderSettingsDialog
        folder={folder({ is_system: false })}
        open
        onOpenChange={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /delete folder/i })).not.toBeDisabled();
  });
});
