/**
 * Surgical InputBar layout for the Grok-simple composer.
 * Run after `npm install` (patches applied), then `npx patch-package @deepseek-ai/dsh-client-ui-conversation`.
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const file = path.resolve(
  import.meta.dirname,
  '..',
  'node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js',
)

let src = await readFile(file, 'utf8')
if (src.includes('data-composer-chrome')) {
  console.log('composer chrome already applied')
  process.exit(0)
}

const chromeCss =
  '.VphDDa_chrome{width:100%;max-width:var(--dsh-composer-card-max-width);box-sizing:border-box;justify-content:flex-end;align-items:center;gap:8px;min-height:28px;padding:0 4px 8px;display:flex}.VphDDa_chrome:empty{display:none}.VphDDa_chrome .VphDDa_select{max-width:280px}'

if (!src.includes('const pptAccessoryCss =')) {
  throw new Error('expected existing pptAccessoryCss patch')
}

src = src.replace(
  'tag.textContent = css$1 + pptAccessoryCss;',
  `const composerChromeCss = ${JSON.stringify(chromeCss)};\n\t\t\ttag.textContent = css$1 + pptAccessoryCss + composerChromeCss;`,
)

if (!src.includes('"promptRow": "VphDDa_promptRow"')) {
  throw new Error('expected promptRow css export')
}
src = src.replace(
  '"promptRow": "VphDDa_promptRow",',
  '"promptRow": "VphDDa_promptRow",\n\t\t\t"chrome": "VphDDa_chrome",',
)

const chromeRow = `(0, react_jsx_runtime.jsxs)("div", {
						className: InputBar_module_css_default.chrome,
						"data-composer-chrome": true,
						children: [accessSelect, sessionId === void 0 ? null : renderSlot("conversation.input.plan", { locked }), sessionId === void 0 ? null : renderSlot("conversation.input.model", { locked: modelSeatLocked })]
					}), `

const cardAnchor = '(0, react_jsx_runtime.jsxs)("div", {\n\t\t\t\t\t\tref: cardRef,\n\t\t\t\t\t\tclassName: clsx(InputBar_module_css_default.card,'
if (!src.includes(cardAnchor)) throw new Error('card anchor missing')
src = src.replace(cardAnchor, chromeRow + cardAnchor)

const toolsBlock = `children: [(0, react_jsx_runtime.jsxs)("div", {
									className: InputBar_module_css_default.tools,
									children: [
										(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
											label: t("input.commands"),
											side: "top",
											delayMs: 500,
											children: (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: InputBar_module_css_default.add,
												"aria-label": t("input.commands"),
												"aria-haspopup": "listbox",
												"aria-expanded": commandMenuOpen,
												disabled: locked || toggleCommandMenu === void 0,
												onMouseDown: keepFocus,
												onClick: onToggleCommandMenu,
												children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutline16, { size: 14 })
											})
										}),
										(0, react_jsx_runtime.jsxs)("div", {
											className: InputBar_module_css_default.modes,
											children: [accessSelect, sessionId === void 0 ? null : renderSlot("conversation.input.plan", { locked })]
										}),
										input === void 0 || sessionId === void 0 ? null : renderSlot("conversation.input.left", {})
									]
								})`

const toolsClean = `children: [(0, react_jsx_runtime.jsxs)("div", {
									className: InputBar_module_css_default.tools,
									children: [
										input === void 0 || sessionId === void 0 ? null : renderSlot("conversation.input.left", {})
									]
								})`

if (!src.includes(toolsBlock)) throw new Error('tools block missing')
src = src.replace(toolsBlock, toolsClean)

const trailingOld = `children: [
										input === void 0 || sessionId === void 0 ? null : renderSlot("conversation.input.right", {}),
										sessionId === void 0 ? null : renderSlot("conversation.input.model", { locked: modelSeatLocked }),
										(0, react_jsx_runtime.jsx)(ContextMeter, {
											useProjection,
											t
										}),
										interruptible &&`

const trailingNew = `children: [
										input === void 0 || sessionId === void 0 ? null : renderSlot("conversation.input.right", {}),
										interruptible &&`

if (!src.includes(trailingOld)) throw new Error('trailing block missing')
src = src.replace(trailingOld, trailingNew)

await writeFile(file, src)
console.log('applied composer chrome to', file)
