import { Fragment, type ReactNode } from "react";
import { parseMarkdown, type Block, type Inline } from "@/lib/journal/notes/markdown";

/**
 * Renders a note body.
 *
 * Walks the parse tree into React elements. There is no `dangerouslySetInnerHTML`
 * here and there must never be one: React escapes every text node it renders, so
 * markup typed into a note is displayed rather than executed, with no sanitizer
 * to keep patched. Link targets are already filtered to safe schemes by the
 * parser.
 */
function renderInline(nodes: Inline[]): ReactNode {
  return nodes.map((node, i) => {
    switch (node.type) {
      case "text":
        return <Fragment key={i}>{node.value}</Fragment>;
      case "strong":
        return <strong key={i}>{renderInline(node.children)}</strong>;
      case "em":
        return <em key={i}>{renderInline(node.children)}</em>;
      case "code":
        return (
          <code
            key={i}
            className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]"
          >
            {node.value}
          </code>
        );
      case "link":
        return (
          <a
            key={i}
            href={node.href}
            className="underline underline-offset-2 hover:no-underline"
            // Notes can link anywhere; noopener keeps a target page from
            // reaching back into this one through window.opener.
            target={node.href.startsWith("http") ? "_blank" : undefined}
            rel={node.href.startsWith("http") ? "noopener noreferrer" : undefined}
          >
            {renderInline(node.children)}
          </a>
        );
    }
  });
}

const HEADING_CLASS: Record<number, string> = {
  1: "mt-4 text-xl font-semibold first:mt-0",
  2: "mt-4 text-lg font-semibold first:mt-0",
  3: "mt-3 text-base font-semibold first:mt-0",
  4: "mt-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground first:mt-0",
};

function renderBlock(block: Block, key: number): ReactNode {
  switch (block.type) {
    case "heading": {
      const Tag = (["h1", "h2", "h3", "h4"] as const)[block.level - 1];
      return (
        <Tag key={key} className={HEADING_CLASS[block.level]}>
          {renderInline(block.children)}
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p key={key} className="leading-relaxed">
          {renderInline(block.children)}
        </p>
      );
    case "list":
      return block.ordered ? (
        <ol key={key} className="ml-5 list-decimal space-y-1">
          {block.items.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ol>
      ) : (
        <ul key={key} className="ml-5 list-disc space-y-1">
          {block.items.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ul>
      );
    case "quote":
      return (
        <blockquote
          key={key}
          className="border-l-2 pl-3 text-muted-foreground italic"
        >
          {renderInline(block.children)}
        </blockquote>
      );
    case "code":
      return (
        <pre
          key={key}
          className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs"
        >
          <code>{block.value}</code>
        </pre>
      );
    case "rule":
      return <hr key={key} className="my-4" />;
  }
}

export function MarkdownView({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  const blocks = parseMarkdown(content);
  if (blocks.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Prazna beleška. Počni da pišeš levo — pregled se osvežava dok kucaš.
      </p>
    );
  }
  return (
    <div className={className}>
      <div className="space-y-3 text-sm">{blocks.map(renderBlock)}</div>
    </div>
  );
}
