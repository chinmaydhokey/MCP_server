import type { ToolTableEntry } from '@qa-brain/core';

/**
 * Curated tool table for Playwright MCP (playwright 1.62.1, `playwright mcp --caps=testing`).
 *
 * Three classes:
 *  - allow  → listed in tools/list (15 tools; the LLM sees these by default)
 *  - hidden → callable through `qa_call_tool`, not listed (keeps the default surface small)
 *  - block  → never callable (RCE-equivalent or policy-gated capabilities)
 *
 * Playwright documents `browser_run_code_unsafe` as RCE-equivalent and its origin/file guardrails as
 * "convenience, not a security boundary" — enforcement is the gateway's job.
 */
export const PLAYWRIGHT_TOOL_TABLE: Record<string, ToolTableEntry> = {
  // ---- listed (15) ----
  browser_navigate: { allow: true, description: 'Navigate the page to a URL. Returns the navigation status and a fresh accessibility snapshot.' },
  browser_snapshot: { allow: true, description: 'Capture the accessibility snapshot of the current page. Interactive elements carry [ref=eN]; pass a ref as `target` to action tools. Prefer this over screenshots.' },
  browser_find: { allow: true, description: 'Search the accessibility snapshot by text or regex and return matching nodes with refs (cheap re-grounding after a failed ref).' },
  browser_click: { allow: true },
  browser_type: { allow: true },
  browser_fill_form: { allow: true },
  browser_select_option: { allow: true },
  browser_press_key: { allow: true },
  browser_hover: { allow: true },
  browser_wait_for: { allow: true },
  browser_take_screenshot: { allow: true, description: 'Take a screenshot of the page or an element. Screenshots are evidence only and cannot be used to pick targets — use web_snapshot for that.' },
  browser_console_messages: { allow: true },
  browser_handle_dialog: { allow: true },
  browser_verify_text_visible: { allow: true },
  browser_verify_element_visible: { allow: true },
  // ---- hidden but callable via qa_call_tool (12) ----
  browser_navigate_back: { hidden: true },
  browser_tabs: { hidden: true },
  browser_network_requests: { hidden: true },
  browser_network_request: { hidden: true },
  browser_generate_locator: { hidden: true },
  browser_verify_value: { hidden: true },
  browser_verify_list_visible: { hidden: true },
  browser_drag: { hidden: true },
  browser_drop: { hidden: true },
  browser_file_upload: { hidden: true },
  browser_resize: { hidden: true },
  browser_close: { hidden: true },
  // ---- blocked (2 core + everything behind non-default caps) ----
  browser_run_code_unsafe: { block: true, description: 'Blocked: executes arbitrary JavaScript in the Playwright server process (RCE-equivalent).' },
  browser_evaluate: { block: true, description: 'Blocked: executes arbitrary JavaScript in the page; disabled by default policy.' },
  // vision caps
  browser_mouse_click_xy: { block: true },
  browser_mouse_down: { block: true },
  browser_mouse_drag_xy: { block: true },
  browser_mouse_move_xy: { block: true },
  browser_mouse_up: { block: true },
  browser_mouse_wheel: { block: true },
  // pdf / devtools / network / storage / config caps
  browser_pdf_save: { block: true },
  browser_start_tracing: { block: true },
  browser_stop_tracing: { block: true },
  browser_start_video: { block: true },
  browser_stop_video: { block: true },
  browser_route: { block: true },
  browser_unroute: { block: true },
  browser_route_list: { block: true },
  browser_network_state_set: { block: true },
  browser_storage_state: { block: true },
  browser_set_storage_state: { block: true },
  browser_get_config: { block: true },
};

/** Upstream tool names listed by default (sorted for deterministic tests). */
export const PLAYWRIGHT_LISTED_TOOLS: readonly string[] = Object.entries(PLAYWRIGHT_TOOL_TABLE)
  .filter(([, e]) => e.allow)
  .map(([n]) => n)
  .sort();

/** Upstream tool names that are hidden but callable. */
export const PLAYWRIGHT_HIDDEN_TOOLS: readonly string[] = Object.entries(PLAYWRIGHT_TOOL_TABLE)
  .filter(([, e]) => e.hidden)
  .map(([n]) => n)
  .sort();

/** Upstream tool names that are blocked. */
export const PLAYWRIGHT_BLOCKED_TOOLS: readonly string[] = Object.entries(PLAYWRIGHT_TOOL_TABLE)
  .filter(([, e]) => e.block)
  .map(([n]) => n)
  .sort();
