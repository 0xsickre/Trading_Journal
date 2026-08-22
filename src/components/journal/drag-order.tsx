"use client";

import { useRef, useState, useTransition } from "react";
import type { ComponentProps, DragEvent, HTMLAttributes } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { moveToIndex } from "@/lib/journal/playbook-order";

/**
 * Drag-to-reorder, shared by every list in the app that has an order the trader
 * chose.
 *
 * Lifted out of `playbook-rules-editor.tsx`, where it was written first and
 * where its whole argument still applies word for word. It is here because the
 * category and tag tables in Settings want exactly the same behaviour, and a
 * second copy of an optimistic-preview-with-rollback is a second place for the
 * rollback to be got wrong.
 */

/**
 * Reorder-by-dragging for a list of ids.
 *
 * Native HTML5 drag events, no library: the two lists here are short, flat and
 * same-axis, which is the case the native API handles without help.
 *
 * THE LIST MOVES WHILE YOU DRAG, and it stays moved the moment you let go.
 * Both halves of that matter, and the first version had neither: it only tinted
 * the row under the cursor, so nothing appeared to happen until the drop, and
 * then the new order waited on a server round trip plus `router.refresh()`
 * before it was drawn. Dragging something and watching it not move is the whole
 * of what made it feel broken.
 *
 * So `order` is what the caller renders, and it comes from a local PREVIEW
 * while a drag is in flight: every `dragover` recomputes it, so rows slide past
 * one another under the pointer. On drop the preview simply stays — it is
 * already the answer — while the write goes out behind it. This is the
 * optimistic-with-rollback shape `dashboard.tsx` and `playbooks-screen.tsx`
 * already use for their own view state: on failure the preview is dropped and
 * the server's order snaps back with a toast, so the UI can never keep an order
 * the database refused.
 *
 * The pointer path is deliberately NOT the only one. Dragging cannot be done
 * from a keyboard, so both lists keep Move up / Move down in their menus.
 */
export function useDragOrder(
  ids: string[],
  commit: (ordered: string[]) => Promise<{ ok: boolean; error?: string }>,
) {
  const router = useRouter();
  const [, start] = useTransition();
  const [dragId, setDragId] = useState<string | null>(null);
  const [preview, setPreview] = useState<string[] | null>(null);
  // Set by `onDrop`, read by `onDragEnd` — which fires afterwards, and would
  // otherwise throw away the preview a completed drop just committed.
  const dropped = useRef(false);

  /**
   * The preview is used only while it still describes the SAME SET of ids the
   * server sent. Once it does not — a rule added in the dialog, one removed in
   * another tab — it is stale and the server's order wins.
   *
   * Checked rather than cleared, and that is deliberate: clearing it would mean
   * a `setState` in an effect, which cascades a second render for something
   * that is a pure comparison. A preview that has become equal to `ids` renders
   * identically anyway, so there is nothing to clean up — the next drag
   * overwrites it, and a failure drops it explicitly.
   */
  const previewUsable =
    preview != null &&
    preview.length === ids.length &&
    ids.every((id) => preview.includes(id));
  const order = previewUsable ? preview : ids;

  /** Props for the element that RECEIVES a drop — the whole row or card. */
  function target(id: string): DragTargetProps {
    return {
      onDragOver: (e: DragEvent) => {
        if (!dragId) return;
        // Without preventDefault the browser refuses the drop outright — and it
        // is called even over the dragged row itself, so the cursor keeps
        // saying "move" across the whole list rather than flickering to "no".
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (dragId === id) return;
        setPreview((cur) => moveToIndex(cur ?? order, dragId, id) ?? cur ?? order);
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        dropped.current = true;
        setDragId(null);
        const next = previewUsable ? preview : null;
        if (!next) return;
        start(async () => {
          const res = await commit(next);
          if (!res.ok) {
            setPreview(null);
            toast.error(res.error ?? "Failed");
            return;
          }
          router.refresh();
        });
      },
      "data-dragging": dragId === id ? "" : undefined,
    };
  }

  /**
   * Props for the HANDLE that starts a drag.
   *
   * Only the handle is `draggable`, not the row: a draggable row swallows the
   * click that opens a rule for editing, and makes selecting its text a drag.
   *
   * The row is found from the EVENT rather than through a ref. A ref would have
   * to be created in the row and passed down into this function during render,
   * which is exactly what `react-hooks/refs` forbids — and it buys nothing here,
   * since `closest` runs at drag time, when the DOM is settled. Setting the drag
   * image to that row is what makes the whole row follow the cursor instead of a
   * lone six-dot glyph.
   */
  function handle(id: string): DragHandleProps {
    return {
      draggable: true,
      onDragStart: (e: DragEvent) => {
        e.dataTransfer.effectAllowed = "move";
        // Firefox starts no drag at all unless some data is attached.
        e.dataTransfer.setData("text/plain", id);
        const row = (e.currentTarget as HTMLElement).closest<HTMLElement>(
          "[data-drag-row]",
        );
        if (row) e.dataTransfer.setDragImage(row, 16, 16);
        dropped.current = false;
        setDragId(id);
      },
      onDragEnd: () => {
        setDragId(null);
        // A drag abandoned outside the list — Escape, or a drop on nothing —
        // must put the rows back where they were.
        if (!dropped.current) setPreview(null);
        dropped.current = false;
      },
    };
  }

  return { order, target, handle };
}

/** The two data attributes the CSS below keys off, alongside the drop handlers. */
export type DragTargetProps = HTMLAttributes<HTMLElement> & {
  "data-dragging"?: string;
  "data-drop-target"?: string;
};

export type DragHandleProps = Pick<
  HTMLAttributes<HTMLElement>,
  "onDragStart" | "onDragEnd"
> & { draggable?: boolean };

/** The six-dot grip. Purely a pointer affordance — the menu is the keyboard path. */
export function Grip({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      {...props}
      aria-hidden
      title="Drag to reorder"
      className={cn(
        "shrink-0 cursor-grab text-muted-foreground/60 hover:text-muted-foreground active:cursor-grabbing",
        className,
      )}
    >
      <GripVertical className="size-4" />
    </span>
  );
}

