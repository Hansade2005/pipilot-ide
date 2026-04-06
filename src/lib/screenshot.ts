import html2canvas from "html2canvas";
import { db } from "./db";

/**
 * Screenshot capture utility for the PiPilot IDE.
 *
 * Strategy: We can't capture the Sandpack iframe directly (cross-origin).
 * Instead we:
 *   1. Grab all project files from IndexedDB
 *   2. Build a full HTML document (inline CSS + JS)
 *   3. Render it in a hidden same-origin iframe
 *   4. Wait for it to load + run JS
 *   5. Use html2canvas to capture the iframe body
 *   6. Return a base64 PNG data URL
 */

const CAPTURE_WIDTH = 1280;
const CAPTURE_HEIGHT = 800;
const RENDER_TIMEOUT = 3000; // ms to wait for JS to run

/**
 * Capture a screenshot of the current project's web preview.
 * Returns a base64 PNG data URL string + a text layout analysis.
 */
export async function capturePreviewScreenshot(projectId?: string): Promise<{ dataUrl: string; layoutReport: string }> {
  // 1. Get all project files from IndexedDB
  let files = await db.files.where("type").equals("file").toArray();
  if (projectId) {
    files = files.filter((f) => f.projectId === projectId);
  }

  // Find key files
  const indexHtml = files.find((f) => f.name === "index.html");
  if (!indexHtml?.content) {
    throw new Error("No index.html found in project — nothing to screenshot.");
  }

  const cssFiles = files.filter((f) => f.name.endsWith(".css"));
  const jsFiles = files.filter((f) =>
    f.name.endsWith(".js") && f.name !== "index.html"
  );

  // 2. Build a self-contained HTML document
  let html = indexHtml.content;

  // Inline CSS: replace <link rel="stylesheet" href="..."> with <style> blocks
  for (const cssFile of cssFiles) {
    const name = cssFile.name;
    const content = cssFile.content ?? "";
    // Match various link tag patterns for this CSS file
    const linkPatterns = [
      new RegExp(`<link[^>]*href=["']/?${escapeRegex(name)}["'][^>]*/?>`, "gi"),
      new RegExp(`<link[^>]*href=["']/?${escapeRegex(cssFile.id)}["'][^>]*/?>`, "gi"),
    ];
    let replaced = false;
    for (const pattern of linkPatterns) {
      if (pattern.test(html)) {
        html = html.replace(pattern, `<style>/* ${name} */\n${content}\n</style>`);
        replaced = true;
        break;
      }
    }
    // If the link tag wasn't found, inject the CSS into <head>
    if (!replaced && content.trim()) {
      html = html.replace("</head>", `<style>/* ${name} */\n${content}\n</style>\n</head>`);
    }
  }

  // Inline JS: replace <script src="..."> with inline <script> blocks
  for (const jsFile of jsFiles) {
    const name = jsFile.name;
    let content = jsFile.content ?? "";
    // Escape </script> inside JS content to prevent breaking the HTML parser
    content = content.replace(/<\/script>/gi, "<\\/script>");
    const scriptPatterns = [
      new RegExp(`<script[^>]*src=["']/?${escapeRegex(name)}["'][^>]*>\\s*</script>`, "gi"),
      new RegExp(`<script[^>]*src=["']/?${escapeRegex(jsFile.id)}["'][^>]*>\\s*</script>`, "gi"),
    ];
    let replaced = false;
    for (const pattern of scriptPatterns) {
      if (pattern.test(html)) {
        html = html.replace(pattern, `<script>/* ${name} */\n${content}\n</script>`);
        replaced = true;
        break;
      }
    }
    if (!replaced && content.trim()) {
      html = html.replace("</body>", `<script>/* ${name} */\n${content}\n</script>\n</body>`);
    }
  }

  // 2b. Remove external CDN scripts that crash in hidden iframes
  // (Tailwind CDN, Lucide, etc. try to query the DOM and fail)
  // Keep the Tailwind CDN <script> since it provides styling but wrap it in try/catch
  html = html.replace(
    /<script[^>]*src=["']https?:\/\/[^"']*unpkg\.com\/lucide[^"']*["'][^>]*>[\s\S]*?<\/script>/gi,
    "<!-- lucide removed for screenshot -->"
  );
  // Wrap any remaining external scripts in try-catch
  html = html.replace(
    /(<script[^>]*src=["']https?:\/\/[^"']+["'][^>]*>[\s\S]*?<\/script>)/gi,
    (match) => {
      // Keep the script but add error suppression
      return match;
    }
  );

  // Inject a global error suppressor at the top of <head> so CDN scripts don't crash
  html = html.replace(
    "<head>",
    `<head><script>window.onerror=function(){return true};</script>`
  );

  // 3. Create a hidden same-origin iframe
  const iframe = document.createElement("iframe");
  iframe.style.cssText = `
    position: fixed;
    top: -9999px;
    left: -9999px;
    width: ${CAPTURE_WIDTH}px;
    height: ${CAPTURE_HEIGHT}px;
    border: none;
    visibility: hidden;
    pointer-events: none;
    z-index: -1;
  `;
  document.body.appendChild(iframe);

  try {
    // 4. Write the HTML and wait for it to render
    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!iframeDoc) throw new Error("Cannot access iframe document");

    // Suppress JS errors inside the iframe (CDN scripts like Tailwind, Lucide, etc.)
    // These errors are harmless and expected when running outside the normal browser context
    if (iframe.contentWindow) {
      iframe.contentWindow.onerror = () => true; // swallow errors
    }

    iframeDoc.open();
    iframeDoc.write(html);
    iframeDoc.close();

    // Wait for load + JS execution
    await new Promise<void>((resolve) => {
      iframe.onload = () => setTimeout(resolve, 400);
      // Fallback timeout in case onload never fires
      setTimeout(resolve, RENDER_TIMEOUT);
    });

    // Extra delay for CSS/fonts/animations to settle
    await new Promise((r) => setTimeout(r, 200));

    // 5. Capture with html2canvas
    // Use try/catch around html2canvas since it can throw on edge-case DOM nodes
    let canvas: HTMLCanvasElement;
    try {
      canvas = await html2canvas(iframeDoc.body, {
        width: CAPTURE_WIDTH,
        height: CAPTURE_HEIGHT,
        windowWidth: CAPTURE_WIDTH,
        windowHeight: CAPTURE_HEIGHT,
        useCORS: true,
        allowTaint: true,
        logging: false,
        backgroundColor: "#ffffff",
        scale: 1,
        // Ignore elements that cause html2canvas to crash
        ignoreElements: (el) => {
          // Skip script tags and elements with cross-origin issues
          if (el.tagName === "SCRIPT" || el.tagName === "IFRAME") return true;
          return false;
        },
      });
    } catch (canvasErr) {
      // Fallback: create a simple canvas with an error message
      canvas = document.createElement("canvas");
      canvas.width = CAPTURE_WIDTH;
      canvas.height = CAPTURE_HEIGHT;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT);
      ctx.fillStyle = "#333333";
      ctx.font = "16px sans-serif";
      ctx.fillText("Screenshot capture failed — page may have complex elements", 40, CAPTURE_HEIGHT / 2);
      ctx.fillText(`Error: ${canvasErr instanceof Error ? canvasErr.message : "Unknown"}`, 40, CAPTURE_HEIGHT / 2 + 24);
    }

    // 6. Analyze the DOM for a text-based layout report (works without vision API!)
    const layoutReport = analyzeDom(iframeDoc.body);

    // 7. Convert to base64 PNG
    const dataUrl = canvas.toDataURL("image/png", 0.85);
    return { dataUrl, layoutReport };
  } finally {
    // Clean up the hidden iframe
    document.body.removeChild(iframe);
  }
}

/* ─── DOM Layout Analyzer ────────────────────────────────────────────
 * Walks the rendered DOM and extracts visual information as structured
 * text. This gives the AI "eyes" without needing a vision API.
 * Captures: element positions, sizes, colors, fonts, text content,
 * images, links, overall layout structure.
 * ──────────────────────────────────────────────────────────────────── */

interface ElementInfo {
  tag: string;
  role?: string;
  text?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  bg?: string;
  color?: string;
  fontSize?: string;
  fontFamily?: string;
  fontWeight?: string;
  src?: string;
  href?: string;
  display?: string;
  children: ElementInfo[];
}

function isVisible(el: Element, style: CSSStyleDeclaration): boolean {
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  return true;
}

function rgbToHex(rgb: string): string {
  const match = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return rgb;
  const r = parseInt(match[1]), g = parseInt(match[2]), b = parseInt(match[3]);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function analyzeElement(el: Element, depth: number): ElementInfo | null {
  if (depth > 8) return null; // don't go too deep
  if (el.tagName === "SCRIPT" || el.tagName === "STYLE" || el.tagName === "LINK" || el.tagName === "META") return null;

  const style = window.getComputedStyle(el);
  if (!isVisible(el, style)) return null;

  const rect = el.getBoundingClientRect();
  const info: ElementInfo = {
    tag: el.tagName.toLowerCase(),
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    w: Math.round(rect.width),
    h: Math.round(rect.height),
    children: [],
  };

  // Role/landmark
  const role = el.getAttribute("role");
  if (role) info.role = role;

  // Colors
  const bg = rgbToHex(style.backgroundColor);
  if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "#000000" && bg !== "transparent") info.bg = bg;
  const color = rgbToHex(style.color);
  if (color) info.color = color;

  // Typography
  info.fontSize = style.fontSize;
  if (style.fontWeight !== "400" && style.fontWeight !== "normal") info.fontWeight = style.fontWeight;
  // Only include font family for headings and important elements
  if (["h1", "h2", "h3", "h4", "h5", "h6", "button", "a"].includes(info.tag)) {
    info.fontFamily = style.fontFamily.split(",")[0].trim().replace(/['"]/g, "");
  }

  // Display mode
  if (["flex", "grid", "inline-flex", "inline-grid"].includes(style.display)) {
    info.display = style.display;
  }

  // Direct text content (not from children)
  const directText = Array.from(el.childNodes)
    .filter((n) => n.nodeType === 3) // text nodes
    .map((n) => n.textContent?.trim())
    .filter(Boolean)
    .join(" ");
  if (directText && directText.length > 0) {
    info.text = directText.slice(0, 100) + (directText.length > 100 ? "..." : "");
  }

  // Image source
  if (el.tagName === "IMG") {
    const src = (el as HTMLImageElement).src;
    info.src = src.length > 100 ? src.slice(0, 80) + "..." : src;
  }

  // Link href
  if (el.tagName === "A") {
    info.href = (el as HTMLAnchorElement).getAttribute("href") || undefined;
  }

  // Recurse into children
  for (const child of Array.from(el.children)) {
    const childInfo = analyzeElement(child, depth + 1);
    if (childInfo) info.children.push(childInfo);
  }

  return info;
}

function formatLayoutTree(info: ElementInfo, indent: number = 0): string {
  const pad = "  ".repeat(indent);
  const parts: string[] = [];

  // Build element description
  let desc = `${pad}<${info.tag}`;
  if (info.role) desc += ` role="${info.role}"`;
  if (info.display) desc += ` display=${info.display}`;
  desc += `> [${info.x},${info.y} ${info.w}x${info.h}]`;
  if (info.bg) desc += ` bg:${info.bg}`;
  if (info.color) desc += ` color:${info.color}`;
  if (info.fontSize) desc += ` ${info.fontSize}`;
  if (info.fontWeight) desc += ` bold:${info.fontWeight}`;
  if (info.fontFamily) desc += ` font:${info.fontFamily}`;
  if (info.src) desc += ` src="${info.src}"`;
  if (info.href) desc += ` href="${info.href}"`;
  if (info.text) desc += ` "${info.text}"`;

  parts.push(desc);

  // Children
  for (const child of info.children) {
    parts.push(formatLayoutTree(child, indent + 1));
  }

  return parts.join("\n");
}

function analyzeDom(body: HTMLElement): string {
  const rootInfo = analyzeElement(body, 0);
  if (!rootInfo) return "Could not analyze DOM — page may be empty.";

  const lines: string[] = [];
  lines.push("=== UI LAYOUT ANALYSIS ===");
  lines.push(`Viewport: ${CAPTURE_WIDTH}x${CAPTURE_HEIGHT}`);
  lines.push("");

  // Gather high-level stats
  const allElements: ElementInfo[] = [];
  function collect(info: ElementInfo) {
    allElements.push(info);
    info.children.forEach(collect);
  }
  collect(rootInfo);

  const images = allElements.filter((e) => e.tag === "img");
  const links = allElements.filter((e) => e.tag === "a");
  const headings = allElements.filter((e) => /^h[1-6]$/.test(e.tag));
  const buttons = allElements.filter((e) => e.tag === "button" || (e.tag === "a" && e.role === "button"));
  const navs = allElements.filter((e) => e.tag === "nav" || e.role === "navigation");
  const uniqueBgColors = [...new Set(allElements.filter((e) => e.bg).map((e) => e.bg))];
  const uniqueTextColors = [...new Set(allElements.filter((e) => e.color).map((e) => e.color))];

  lines.push("--- SUMMARY ---");
  lines.push(`Total visible elements: ${allElements.length}`);
  lines.push(`Images: ${images.length}${images.length > 0 ? " — " + images.map((i) => i.src || "no-src").join(", ") : ""}`);
  lines.push(`Links: ${links.length}${links.length > 0 ? " — " + links.slice(0, 5).map((l) => `"${l.text || ""}" → ${l.href || ""}`).join(", ") : ""}`);
  lines.push(`Headings: ${headings.map((h) => `${h.tag}:"${h.text || ""}"`).join(", ") || "none"}`);
  lines.push(`Buttons: ${buttons.map((b) => `"${b.text || ""}"`).join(", ") || "none"}`);
  lines.push(`Nav sections: ${navs.length}`);
  lines.push(`Background colors used: ${uniqueBgColors.join(", ") || "none"}`);
  lines.push(`Text colors used: ${uniqueTextColors.slice(0, 8).join(", ") || "none"}`);
  lines.push("");

  lines.push("--- LAYOUT TREE ---");
  lines.push(formatLayoutTree(rootInfo));

  // Cap at ~4000 chars to avoid overwhelming the context
  const report = lines.join("\n");
  if (report.length > 4000) {
    return report.slice(0, 3900) + "\n\n[Layout analysis truncated — showing first 3900 chars]";
  }
  return report;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
