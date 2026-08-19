import { describe, expect, it } from "vitest";
import { Folder, Rocket } from "lucide-react";
import {
  NOTE_FOLDER_ICONS,
  NOTE_FOLDER_ICON_NAMES,
  folderIcon,
} from "./folder-icons";

describe("folderIcon", () => {
  it("resolves a known name", () => {
    expect(folderIcon("rocket")).toBe(Rocket);
  });

  it("FALLS BACK TO THE PLAIN FOLDER for null — a folder made before this feature", () => {
    expect(folderIcon(null)).toBe(Folder);
  });

  it("falls back for undefined too", () => {
    expect(folderIcon(undefined)).toBe(Folder);
  });

  it("FALLS BACK FOR AN UNRECOGNIZED NAME rather than throwing", () => {
    // A row written by an older client, or a name dropped from a future,
    // smaller icon set — a bad value here must be inert, never a crash.
    expect(folderIcon("some-icon-that-does-not-exist")).toBe(Folder);
  });
});

describe("NOTE_FOLDER_ICON_NAMES", () => {
  it("lists every key of the icon map, so a picker built from it can never omit or invent one", () => {
    expect(NOTE_FOLDER_ICON_NAMES).toEqual(Object.keys(NOTE_FOLDER_ICONS));
  });
});
