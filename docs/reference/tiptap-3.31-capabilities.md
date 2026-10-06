# Tiptap 3.31.3: capability map for KALFA

Written 2026-09-30 as the evidence base for a `{`-triggered value-path field: typing `{` opens a searchable list of value paths passed in at runtime, and the choice becomes an atomic chip that stores the path id. The owner's order of preference is Tiptap built-ins, then `@workflowbuilder/ui`, then our shadcn components, then custom code.

**Labels.**
- **VERIFIED:** checked against the cited file:line or URL, which was read in full.
- **MEASURED:** observed by running the installed packages (the probes in [§11](#11-probe-transcripts)).
- **INFERRED:** depends on something not read in full or not executed (see [Coverage](#13-coverage)).

Line numbers refer to `node_modules/<package>/dist/index.js` unless another file is named.

Installed versions (VERIFIED, `npm ls --all` and each `package.json`):

| Package | Version | How it arrives | Note |
|---|---|---|---|
| `@tiptap/core` | 3.31.3 | transitive (peer of every package) | peer `@tiptap/pm 3.31.3` |
| `@tiptap/pm` | 3.31.3 | direct (`package.json:116`) | re-exports 13 ProseMirror packages (§1.2) |
| `@tiptap/react` | 3.31.3 | direct (`:117`) | peers React/`@types/react` 17–19, core/pm **exact** 3.31.3; optional deps: bubble-menu, floating-menu |
| `@tiptap/starter-kit` | 3.31.3 | direct (`:118`) | **pins** 21 `@tiptap/*` packages at 3.31.3 (starter-kit changelog 3.30.0) |
| `@tiptap/suggestion` | 3.31.3 | direct (`:119`) | peer `@floating-ui/dom ^1.0.0` |
| `@tiptap/extension-mention` | 3.31.3 | direct (`:115`) | peer `@tiptap/suggestion 3.31.3` |
| `@tiptap/extensions` | 3.31.3 | **transitive only** (via starter-kit) | Placeholder, CharacterCount, UndoRedo, … |
| `@tiptap/extension-document`, `-paragraph`, `-text` | 3.31.3 | **transitive only** (via starter-kit) | the three nodes a single-line field needs |
| `@tiptap/extension-bubble-menu`, `-floating-menu` | 3.31.3 | optional deps of `@tiptap/react` | |
| `@floating-ui/dom` / `core` / `utils` | 1.8.0 / 1.8.0 / 0.2.12 | `dom` is direct (`package.json:87`) | one copy each |
| `react` / `react-dom` / `@types/react` | 19.3.0 | direct | inside every Tiptap peer range |
| `prosemirror-model` | 1.25.12 | via `@tiptap/pm` | **one copy** (no nested duplicates found). This matters because core warns and breaks on duplicates (`warnOnDuplicatedProseMirrorModel`, core `index.js:5896`) |
| `jsdom` | 26.1.0 | transitive (crawlee, vitest) | used by the probes |

Nothing in `src/` imports Tiptap yet (VERIFIED, `grep -rl @tiptap src` found no files).

---

## 0. The main finding

**Tiptap covers the editing half of the feature. It ships no UI and no ARIA.** What needs custom code is the list component, its accessibility wiring, a single-line policy and the JSON Forms glue.

The pieces that exist out of the box:
- **Trigger.** `@tiptap/suggestion` detects the `{` trigger, keeps the query, and decorates the typed text with a `span.suggestion`.
- **List mechanics.** Suggestion calls `items({query, signal})` with debounce, abort and loading state. It routes keyboard events to your list through `render().onKeyDown`, and positions the popup with Floating UI through `props.mount()`, including RTL-aware `-start` alignment.
- **Chip.** `@tiptap/extension-mention` is the atomic inline chip. It stores `id`, `label` and `mentionSuggestionChar`, and supports custom `renderText` and `renderHTML`. Backspace can remove the whole chip.
- **React.** `@tiptap/react` provides `useEditor`, `EditorContent`, `ReactRenderer` (renders the list as a React component inside our React tree, so context works), `useEditorState` and `ReactNodeViewRenderer` (for a React chip).
- **Nodes.** The `Document`, `Paragraph` and `Text` nodes come from the separate packages `@tiptap/extension-document`, `-paragraph` and `-text`, which today arrive only through starter-kit (§9 dependency note).
- **Content and serialization.** `@tiptap/core` provides content get/set, `getJSON`/`getText`/`generateText` (which runs server-side with no DOM, MEASURED), plus `editorProps.attributes` for `aria-*` and `dir`.
- **Placeholder.** `@tiptap/extensions` provides the Placeholder.

What must be built:
1. The list component.
2. Its ARIA wiring onto the editor element (Suggestion emits none).
3. A single-line policy: `Document` restricted to one paragraph, Enter blocked and paste flattened.
4. Close-on-blur (Suggestion does not close on blur, MEASURED).
5. The JSON Forms control wrapper.

§9 has the full fit table.

---

## 1. Package graph and exports

### 1.1 Graph (VERIFIED, `npm ls --all @tiptap/* @floating-ui/*`, each `package.json`)

```
@tiptap/react ──peer──> @tiptap/core, @tiptap/pm (exact 3.31.3), react 17–19
   ├─ ./menus ──> @tiptap/extension-bubble-menu ──> @floating-ui/dom, @tiptap/pm/tables (CellSelection)
   │           └> @tiptap/extension-floating-menu ──peer──> @floating-ui/dom
   └─ deps: use-sync-external-store, fast-equals
@tiptap/extension-mention ──peer──> @tiptap/suggestion ──peer──> @floating-ui/dom ──> core ──> utils
@tiptap/starter-kit ──deps(pinned)──> blockquote, bold, bullet-list*, code, code-block, document, dropcursor*,
      gapcursor*, hard-break, heading, horizontal-rule, italic, link (+linkifyjs ^4.3.3), list,
      list-item*, list-keymap*, ordered-list*, paragraph, strike, text, underline, extensions, pm, core
      (* = one-line shims that re-export from @tiptap/extension-list or @tiptap/extensions)
@tiptap/pm ──deps──> 13 prosemirror-* packages (§1.2)
```

`@floating-ui/react` 0.27.20 and 0.26.28 are also installed, but they belong to `@mantine/core` 9.6.2 and `@workflowbuilder/sdk` (through `overflow-ui`). No Tiptap package uses them (VERIFIED, `npm ls`).

### 1.2 `@tiptap/pm` subpaths (VERIFIED, `pm/package.json` exports and every `dist/*/index.d.ts` and `index.js`)

Each subpath is exactly `export * from "prosemirror-<name>"`.

| Subpath | Re-exports | Installed |
|---|---|---|
| `@tiptap/pm/changeset` | prosemirror-changeset | 2.4.4 |
| `/commands` | prosemirror-commands | 1.7.2 |
| `/dropcursor` | prosemirror-dropcursor | 1.8.4 |
| `/gapcursor` | prosemirror-gapcursor | 1.4.1 |
| `/history` | prosemirror-history | 1.5.1 |
| `/inputrules` | prosemirror-inputrules | 1.5.1 |
| `/keymap` | prosemirror-keymap | 1.2.3 |
| `/model` | prosemirror-model | 1.25.12 |
| `/schema-list` | prosemirror-schema-list | 1.5.1 |
| `/state` | prosemirror-state | 1.4.4 |
| `/tables` | prosemirror-tables | 1.8.5 |
| `/transform` | prosemirror-transform | 1.12.2 |
| `/view` | prosemirror-view | 1.42.6 (≥ 1.42.3 carries the paste-XSS fix GHSA-c8x8-7fp4-3x9w; pm changelog 3.31.2) |

There is no root export, so `import … from '@tiptap/pm'` fails. Always use a subpath.

### 1.3 `@tiptap/core` exports (VERIFIED, `core/dist/index.d.ts` 1–5757, read in full)

**Classes and building blocks**

| Export | Meaning |
|---|---|
| `Editor` | The editor instance. Options in §4.1. Methods: `mount`, `unmount`, `chain`, `can`, `setOptions`, `setEditable`, `registerPlugin`, `unregisterPlugin`, `getJSON`, `getHTML`, `getText`, `getAttributes`, `isActive`, `destroy`, `$node`, `$nodes`, `$pos`, `$doc`. Getters: `commands`, `state`, `view`, `storage`, `isEditable`, `isEmpty`, `isDestroyed`, `isFocused`, `isInitialized`, `instanceId`, `utils` |
| `Extension` / `Node` / `Mark` | `create(config)`, `configure(options)`, `extend(config)` |
| `NodeView`, `MarkView`, `ResizableNodeView` (+ deprecated `ResizableNodeview`) | Base node and mark views; resizable media wrapper |
| `InputRule`, `PasteRule`, `inputRulesPlugin`, `pasteRulesPlugin` | Rule engines |
| `markInputRule`, `nodeInputRule`, `textblockTypeInputRule`, `textInputRule`, `wrappingInputRule` | Input-rule builders |
| `markPasteRule`, `nodePasteRule`, `textPasteRule` | Paste-rule builders |
| `CommandManager`, `ExtensionManager`, `NodePos`, `Tracker`, `MappablePosition`, `createMappablePosition`, `getUpdatedPosition` | Internals exposed for advanced use |
| `Decoration` (`.Inline` / `.Node` / `.Widget`), `InlineDecoration`, `NodeDecoration`, `WidgetDecoration`, `DecorationManager`, `DECORATION_MANAGER_PLUGIN_KEY`, `createWidgetDecoration`, `liveWidgetKeys` | The 3.30 `addDecorations()` API |
| `extensions` namespace | The core extensions: `ClipboardTextSerializer`, `Commands`, `Delete`, `Drop`, `Editable`, `FocusEvents`, `Keymap`, `Paste`, `Tabindex`, `TextDirection`, `focusEventsPluginKey` |
| `commands` namespace | Every command implementation (next table) |
| `markdown` namespace + `createInlineMarkdownSpec`, `createBlockMarkdownSpec`, `createAtomBlockMarkdownSpec`, `parseAttributes`, `serializeAttributes`, `parseIndentedBlocks`, `renderNestedMarkdownContent` | Markdown helpers used by `@tiptap/markdown` (not installed) |
| `h` / `createElement`, `Fragment` (+ `@tiptap/core/jsx-runtime`) | JSX that produces a `DOMOutputSpec` for `renderHTML` |

**Commands** (VERIFIED, d.ts 3117–4208). Each is `editor.commands.x()` / `chain().x()` / `can().x()`.

| Command | Meaning |
|---|---|
| `blur()` | Remove focus |
| `clearContent(emitUpdate = true)` | Empty the document |
| `clearNodes()` | Normalize the selected blocks to paragraphs |
| `command(fn)` | Inline command |
| `createParagraphNear()` | Paragraph next to the selected block node |
| `cut(range, targetPos)` | Move a range |
| `deleteCurrentNode()` | Delete the node that holds the anchor |
| `deleteNode(type)` | Delete the nearest node of that type |
| `deleteRange(range)` | Delete a range |
| `deleteSelection()` | Delete the selection (all ranges, since 3.27.3) |
| `enter()` | Trigger Enter |
| `exitCode()` | Leave a code block |
| `extendMarkRange(type, attrs?)` | Grow the selection to the mark |
| `first(commands)` | Run until one returns true |
| `focus(pos?, {scrollIntoView})` | Focus, optionally at a position |
| `forEach(items, fn)` | Loop |
| `insertContent(value, opts)` / `insertContentAt(pos, value, opts)` | Insert JSON, HTML or a node (options: `parseOptions`, `updateSelection`, `applyInputRules`, `applyPasteRules`, `errorOnInvalidContent`) |
| `insertDefaultBlock(opts)` | Insert the default textblock (3.29) |
| `joinUp()` / `joinDown()` / `joinBackward()` / `joinForward()` / `joinItemBackward()` / `joinItemForward()` / `joinTextblockBackward()` / `joinTextblockForward()` | Joins |
| `keyboardShortcut(name)` | Simulate a key |
| `lift(type)`, `liftEmptyBlock()`, `liftListItem(type)`, `sinkListItem(type)`, `splitListItem(type)`, `toggleList(…)`, `wrapInList(type)` | Structure and lists |
| `newlineInCode()` | Newline in code |
| `resetAttributes(type, keys)` / `updateAttributes(type, attrs)` | Attributes |
| `scrollIntoView()` | Scroll the selection into view |
| `selectAll()` / `selectNodeBackward()` / `selectNodeForward()` / `selectParentNode()` / `selectTextblockStart()` / `selectTextblockEnd()` | Selection |
| `setContent(content, {emitUpdate = true, parseOptions, errorOnInvalidContent})` | Replace the document |
| `setMark(type, attrs)` / `toggleMark` / `unsetMark` / `unsetAllMarks({ignoreClearable})` | Marks |
| `setMeta(key, value)` | Transaction meta |
| `setNode(type, attrs)` / `toggleNode` / `toggleWrap` / `wrapIn` | Blocks |
| `setNodeSelection(pos)` / `setTextSelection(pos \| range)` | Selection |
| `setTextDirection(dir, pos?)` / `unsetTextDirection(pos?)` | Per-node `dir` (§5) |
| `splitBlock({keepMarks})` | Split the block |
| `undoInputRule()` | Undo the last input rule |
| `updateDecorations(name?)` | Recompute `addDecorations` |

**Helpers**

| Group | Exports |
|---|---|
| Schema and content | `getSchema`, `getSchemaByResolvedExtensions`, `createDocument`, `createNodeFromContent`, `generateHTML`, `generateJSON`, `generateText`, `getHTMLFromFragment`, `getText`, `getTextBetween`, `getTextSerializersFromSchema`, `getTextContentFromNodes`, `rewriteUnknownContent`, `getDebugJSON` |
| Queries | `findChildren`, `findChildrenInRange`, `findParentNode`, `findParentNodeClosestToPos`, `getAttributes`, `getMarkAttributes`, `getNodeAttributes`, `getMarkRange`, `getMarksBetween`, `getNodeAtPosition`, `getPreviousBlockSibling`, `isActive`, `isMarkActive`, `isNodeActive`, `isAtStartOfNode`, `isAtEndOfNode`, `isNodeEmpty`, `isList`, `isNodeViewSelected`, `canInsertNode`, `posToDOMRect`, `resolveFocusPosition`, `defaultBlockAt`, `getChangedRanges`, `combineTransactionSteps`, `selectionToInsertionEnd` |
| Type guards | `isTextSelection`, `isNodeSelection`, `isProseMirror{Step, StepResult, ReplaceStep, ReplaceAroundStep, AddMarkStep, RemoveMarkStep, AddNodeMarkStep, RemoveNodeMarkStep, AttrStep, DocAttrStep, Fragment, Slice, NodeSelection, CellSelection}`, `isFunction`, `isNumber`, `isString`, `isRegExp`, `isPlainObject`, `isEmptyObject` |
| Platform | `isAndroid`, `isiOS`, `isMacOS`, `isSafari`, `isFirefox` |
| Utilities | `mergeAttributes`, `mergeDeep`, `callOrReturn`, `escapeForRegEx`, `elementFromString`, `createStyleTag`, `deleteProps`, `fromString`, `minMax`, `objectIncludes`, `removeDuplicates`, `findDuplicates`, `attrsEqual`, `marksEqual`, `getStyleProperty`, `decodeHtmlEntities`, `encodeHtmlEntities`, `getExtensionField`, `getRenderedAttributes`, `getAttributesFromExtensions`, `getSplittedAttributes`, `injectExtensionAttributesToParseRule`, `isExtensionRulesEnabled`, `resolveExtensions`, `sortExtensions`, `flattenExtensions`, `splitExtensions`, `getMarkType`, `getNodeType`, `getSchemaTypeByName`, `getSchemaTypeNameByName`, `createChainableState`, `updateMarkViewAttributes` |

**Types:** `JSONContent`, `Content`, `EditorOptions`, `EditorEvents`, `Range`, `NodeViewProps`, `NodeViewRendererProps`, `NodeViewRendererOptions`, `NodeConfig`, `MarkConfig`, `ExtensionConfig`, `Attribute`, `GlobalAttributes`, `TextSerializer`, `Commands` / `Storage` (module-augmentation interfaces), `DecorationSpec` and the rest.

### 1.4 `@tiptap/react` exports (VERIFIED, `react/dist/index.d.ts` 1–632 and `index.js` 1–1297)

- The bundle starts with `"use client"` (line 1).
- It **re-exports all of `@tiptap/core`** (line 9). Per changelog 3.27.4, server code should import core symbols from `@tiptap/core` directly, because the `@tiptap/react` re-exports cross the client boundary.

| Export | Meaning |
|---|---|
| `useEditor(options, deps?)` | Creates, updates and destroys the editor (§4.2). Returns `Editor \| null` when `immediatelyRender: false` |
| `EditorContent` | `React.memo` wrapper. Renders `<div>` (props spread onto it) and moves the editor DOM into it. Renders the node-view portals |
| `useEditorState({editor, selector, equalityFn?})` | Subscribes to a derived slice. Default equality is `deepEqual` from `fast-equals` (line 227) |
| `ReactRenderer(Component, {editor, props, as = 'div', className})` | Renders any component into `element` through a portal inside `EditorContent`. Members: `element`, `ref`, `props`, `updateProps` (shallow-compared), `updateAttributes`, `destroy` |
| `ReactNodeViewRenderer(Component, options)` / `ReactNodeView` | React node view. Options: `as`, `className`, `attrs` (object or function), `update`, `contentDOMElementTag`, `stopEvent`, `ignoreMutation`, `trackNodeViewPosition`, `selectedOnTextSelection` (deprecated in favour of the `selectionInside` prop) |
| `NodeViewWrapper` / `NodeViewContent` | Required wrapper (`data-node-view-wrapper`) and editable hole |
| `ReactMarkViewRenderer`, `ReactMarkView`, `MarkViewContent`, `ReactMarkViewContext` | Mark views |
| `ReactWidgetRenderer(Component, {editor, pos, key, props, as, className, …})` | Component inside a widget decoration (3.30) |
| `EditorProvider`, `EditorContext`, `EditorConsumer`, `useCurrentEditor` | Legacy context API |
| `Tiptap` (+ `Tiptap.Content`), `TiptapWrapper`, `TiptapContent`, `TiptapContext`, `useTiptap`, `useTiptapState` | Composable API. Requires a non-null editor (throws otherwise, line 1224) |
| `useReactNodeView`, `ReactNodeViewContext`, `ReactNodeViewContentProvider`, `createContentComponent`, `PureEditorContent` | Internals |
| `@tiptap/react/menus`: `BubbleMenu`, `FloatingMenu` | React wrappers of the menu plugins (§1.7) |

### 1.5 `@tiptap/suggestion` exports (VERIFIED, `suggestion/dist/index.d.ts` 1–419 and `index.js` 1–656)

| Export | Meaning |
|---|---|
| `Suggestion(options)` (also default) | Returns a ProseMirror `Plugin` (§2) |
| `SuggestionPluginKey` | `new PluginKey('suggestion')`, the default key |
| `exitSuggestion(view, pluginKey = SuggestionPluginKey)` | Dispatches `{exit: true}` meta to close the suggestion |
| `findSuggestionMatch(trigger)` | The default matcher (replaceable through the option) |
| Types | `SuggestionOptions`, `SuggestionProps`, `SuggestionKeyDownProps`, `SuggestionMatch`, `Trigger`, `SuggestionPlacement`, `SuggestionFloatingUiOptions`, `SuggestionFloatingUiConfig`, `SuggestionMount`, `SuggestionMountOptions`, `SuggestionPositionData` |

### 1.6 `@tiptap/extension-mention` exports (VERIFIED, `index.d.ts` 1–94 and `index.js` 1–235)

`Mention` (also default), `MentionOptions`, `MentionNodeAttrs`. §3 covers the details.

### 1.7 BubbleMenu and FloatingMenu (VERIFIED: `extension-bubble-menu` d.ts 1–170 and js 1–325; `extension-floating-menu` d.ts 1–180 and js 1–264; `react/dist/menus` d.ts and js 1–443)

**Exports:**
- `BubbleMenu` (Extension), `BubbleMenuPlugin`, `BubbleMenuView`.
- `FloatingMenu` (Extension, plus an `updateFloatingMenuPosition` command), `FloatingMenuPlugin`, `FloatingMenuView`.

**Behaviour:**
- **When they show.** BubbleMenu shows on a non-empty text selection while the editor has focus (`bubble-menu` js 83–90). FloatingMenu shows on an empty top-level textblock (`floating-menu` js 26–33).
- **Floating UI defaults.** Bubble: `placement:'top'`, `offset:8`, `flip:{}`, `shift:{}` (62–82). Floating: `placement:'right'` (34–45).
- **Where they mount.** Both append to `appendTo` or else `view.dom.parentElement` (bubble 233–234, floating 187–188).
- **Controls.** Both accept `'show'`, `'hide'`, `'updatePosition'` and `{type:'updateOptions'}` as transaction meta on their plugin key.
- **Focus.** Both set `element.tabIndex = 0`.

**Relevance here:** neither menu is a suggestion list. They are not needed for the field, and the React wrappers **call `document.createElement` during render** (`menus/index.js` 262 and 354), so they must never be server-rendered (VERIFIED by reading the code; not executed on a server). The bubble menu imports `CellSelection` from `@tiptap/pm/tables` (line 4), which pulls prosemirror-tables into any bundle that uses it.

### 1.8 `@tiptap/extensions` (VERIFIED, `dist/index.d.ts` 1–321 and `index.js` 1–699)

The 8 subpath entry points (`./character-count`, `./drop-cursor`, `./focus`, `./gap-cursor`, `./placeholder`, `./selection`, `./trailing-node`, `./undo-redo`) contain exactly the code of the matching sections of `index.js`. This was checked line by line with a script: 0 lines not present in `index.js`.

| Export | Options (defaults) | Meaning |
|---|---|---|
| `Placeholder` | `placeholder:'Write something …'`, `emptyEditorClass:'is-editor-empty'`, `emptyNodeClass:'is-empty'`, `dataAttribute:'placeholder'`, `showOnlyWhenEditable:true`, `showOnlyCurrent:true`, `includeChildren:false` (514–533) | Node decoration on empty textblocks: a class plus `data-placeholder`. The CSS is ours |
| `CharacterCount` | `limit:null`, `mode:'textSize'`, `autoTrim:true`, `textCounter`, `wordCounter` (12–86) | `editor.storage.characterCount.characters()` / `.words()`. Blocks transactions over the limit (`filterTransaction` 68–83) |
| `UndoRedo` | `depth:100`, `newGroupDelay:500` (665–695) | `undo`/`redo` commands; Mod-z, Shift-Mod-z, Mod-y |
| `TrailingNode` | `node` (schema default), `notAfter:[]`, plus the default node always added (609–653) | Appends a node at the end; `skipTrailingNode` meta |
| `Focus` | `className:'has-focus'`, `mode:'all'` | Class on focused nodes |
| `Selection` | `className:'selection'` | Keeps the selection visible on blur |
| `Dropcursor` | `color:'currentColor'`, `width:1`, `class` | Drop cursor |
| `Gapcursor` | none | Gap cursor; adds `allowGapCursor` to `NodeConfig` |
| `preparePlaceholderAttribute`, `DEFAULT_DATA_ATTRIBUTE`, `PLUGIN_KEY`, `skipTrailingNodeMeta` | | Helpers and constants |

### 1.9 `@tiptap/starter-kit` and what it bundles (VERIFIED, `starter-kit/dist/index.d.ts` 1–137 and `index.js` 1–70; every bundled `.d.ts`)

- `StarterKit` registers 23 extensions (`index.js` 18–67).
- Each option is `Partial<Options> | false`, except `document`, `gapcursor` and `text`, which are typed **`false` only**. You cannot pass options to them.

| Key | Extension (package) | Options / commands |
|---|---|---|
| `blockquote` | Blockquote | `HTMLAttributes`; `set/toggle/unsetBlockquote` |
| `bold` | Bold | `HTMLAttributes`; `set/toggle/unsetBold` |
| `bulletList`, `orderedList`, `listItem`, `listKeymap` | from `@tiptap/extension-list` | `itemTypeName`, `keepMarks`, `keepAttributes`; `toggleBulletList`, `toggleOrderedList`; ListKeymap `listTypes` |
| `code` | Code | `HTMLAttributes`; `set/toggle/unsetCode` |
| `codeBlock` | CodeBlock | `languageClassPrefix`, `exitOnTripleEnter`, `exitOnArrowDown`, `exitOnArrowUp`, `defaultLanguage`, `enableTabIndentation`, `tabSize`, `HTMLAttributes`; `set/toggleCodeBlock` |
| `document` | Document (`name:'doc'`, `topNode`, `content:'block+'`) | none |
| `dropcursor`, `gapcursor`, `undoRedo`, `trailingNode` | from `@tiptap/extensions` | as §1.8 |
| `hardBreak` | HardBreak | `keepMarks`, `HTMLAttributes`; `setHardBreak` (Shift-Enter) |
| `heading` | Heading | `levels`, `HTMLAttributes`; `set/toggleHeading` |
| `horizontalRule` | HorizontalRule | `HTMLAttributes`, `nextNodeType`; `setHorizontalRule` |
| `italic`, `strike`, `underline` | marks | `HTMLAttributes`; `set/toggle/unset*` |
| `link` | Link (linkifyjs) | `autolink`, `protocols`, `defaultProtocol`, `openOnClick`, `enableClickSelection`, `linkOnPaste`, `markdownLinks`, `HTMLAttributes`, `isAllowedUri`, `shouldAutoLink`, `validate` (deprecated); `setLink`/`toggleLink`/`unsetLink` |
| `paragraph` | Paragraph (`priority:1000`, `content:'inline*'`, `group:'block'`) | `HTMLAttributes`; `setParagraph` (Mod-Alt-0) |
| `text` | Text | none |

`@tiptap/extension-list` also exports `TaskList`, `TaskItem` (with an `a11y.checkboxLabel` option), `ListKit`, `listHelpers` and ordered-list marker helpers (VERIFIED, `extension-list/dist/index.d.ts` 1–390; all 7 subpath `.d.ts` files are subsets of it).

The implementation JS of the bundled extensions was **not** read beyond Document, Paragraph and Text (§13).

---

## 2. Suggestion in depth

### 2.1 Every option (VERIFIED, defaults at `suggestion/dist/index.js:582`, types at `index.d.ts:73-281`)

| Option | Default | Exact behaviour |
|---|---|---|
| `editor` | required | The editor. Mention fills it in for you |
| `pluginKey` | `SuggestionPluginKey` (`'suggestion'`) | Needed to read state or to call `exitSuggestion`. **Mention overrides it with an anonymous `new PluginKey()` for each trigger** (`mention` js 20) unless you pass your own (the override spread is at line 42) |
| `char` | `'@'` | Trigger string. Escaped with `escapeForRegEx` (js 10). Multi-character triggers such as `'{{'` work (MEASURED, probe 4) |
| `allowSpaces` | `false` | Query may contain spaces; the match runs lazily to the next `\s<char>` or the end of the text (js 14, 25–28). Forced off when `allowToIncludeChar` is on (js 9) |
| `allowToIncludeChar` | `false` | The char may repeat inside the query (js 13) |
| `allowedPrefixes` | `[' ']` | The character before the trigger must be one of these, or the start of the text node. **`null` allows any prefix** (js 20–22). The prefixes go into a regex character class **unescaped** (js 21), so `]`, `\`, `^` or `-` break it: `']'` silently never matches (MEASURED, 2o) |
| `startOfLine` | `false` | Anchors the regex with `^` (js 12) |
| `items({query, editor, signal})` | `() => []` | Sync or async. Called **after a microtask even when sync**: the first render always sees `items: initialItems ?? []` with `loading: true` (js 527–557; MEASURED 3a). Aborted when the query changes (`signal`) |
| `command({editor, range, props})` | `() => null` | Runs when your list calls `props.command(item)` |
| `render()` | `() => ({})` | Factory, **called once per plugin** (js 583). Returns `{onBeforeStart, onStart, onBeforeUpdate, onUpdate, onExit, onKeyDown}` |
| `minQueryLength` | `0` | Below this length `items()` is not called, and the renderer gets `initialItems ?? []` with `loading: false` (js 482, 527–533) |
| `debounce` | `0` | Milliseconds of debounce before `items()` runs (js 283–303) |
| `initialItems` | `undefined` | Shown immediately, and while loading |
| `placement` | `'bottom-start'` | Only `top`, `bottom` and their `-start`/`-end` forms (d.ts 23). Handed to `computePosition` |
| `offset` | `{mainAxis:4, crossAxis:0}` | Becomes the Floating UI `offset()` middleware (js 330–333) |
| `flip` | `true` | Adds `flip()` (js 334) |
| `floatingUi` | `undefined` | `{strategy?: 'absolute' \| 'fixed', middleware?: Middleware[]}`. The middleware is appended after offset and flip (js 335–338) |
| `container` | `undefined` → `document.body` | Selector or element for `mount()`. An unresolvable selector falls back to `body` (js 346–355) |
| `dismissOnOutsideClick` | `true` | Only with `props.mount`: a capture-phase `pointerdown` outside both the popup and `view.dom` dispatches exit (js 408–415) |
| `allow({editor, state, range, isActive})` | `() => true` | Veto per match. Mention's default checks that the parent can contain a mention node (mention js 37–41) |
| `shouldShow({editor, range, query, text, transaction})` | `undefined` | A second veto (3.15.1), meant for collaboration |
| `shouldResetDismissed({editor, state, range, match, transaction, allowSpaces})` | `undefined` | Return `true` to reopen a suggestion the user dismissed (js 87–98) |
| `decorationTag` | `'span'` | Tag of the inline decoration over `char + query` |
| `decorationClass` | `'suggestion'` | Its class |
| `decorationEmptyClass` | `'is-empty'` | Added while the query is empty (js 151–153) |
| `decorationContent` | `''` | Written to `data-decoration-content` (js 158), for a CSS `::after` hint |
| `findSuggestionMatch` | built-in | Replaceable matcher, `(Trigger) => {range, query, text} \| null` |

### 2.2 The matcher, exactly (VERIFIED, js 6–38; MEASURED, probe §11.1)

1. Build the regex:
   - `allowSpaces` off: `(?:^)?<char>[^\s<char>]*` with flags `gm`.
   - `allowSpaces` on: `<char>.*?(?=\s<char>|$)`.
2. Take **only the text node immediately before the cursor**: `$position.nodeBefore` must be a text node (js 15). A chip or any other inline node in between ends the scan, so the start of the text node after a chip counts as "start" for the prefix check.
3. Take the **last** regex match in that text (js 18). Check the one character before it against `allowedPrefixes`.
4. Return a match only if the cursor lies inside `[from, to]` (js 29).
5. The query is `match[0].slice(char.length)`.

**Does `{` need escaping?** No action is needed from us. `escapeForRegEx` escapes it to `\{` (core `index.js:3866-3868`), and `\{` is valid both outside and inside the `[^…]` class (MEASURED 1a–1c). Passing `char: '{'` is correct.

Measured outcomes with `char:'{'` (probe 1, `allowedPrefixes` default unless stated):

| Text before caret | Result |
|---|---|
| `{` | match, query `""` |
| `שלום {שם` | match, query `שם` (**Hebrew query works**) |
| `שלום {guest.first_name` | query `guest.first_name` (dots, underscores and hyphens are kept) |
| `abc{x` / `שלום{x` | **no match** (prefix is not a space) |
| `abc{x` with `allowedPrefixes:null` | match, query `x` |
| `{שם פרטי` | no match (space ends the query); with `allowSpaces:true`: query `שם פרטי` |
| `{{` | no match by default; with `allowedPrefixes:null` it matches the second `{`, query `""` |
| `x {q` (NBSP before) | **no match**. NBSP is not `' '` |
| `x‏{q` (RLM before) | no match |
| `{g}` | match, query `g}`. **A closing brace becomes part of the query** |
| `{שם‏` | query includes the RLM control character |

**Hebrew:** `[^\s{]` accepts any Hebrew letter, so queries in Hebrew and mixed Hebrew/Latin work. The two traps are that bidi control marks (U+200E/U+200F) and `}` end up inside the query. Strip them in `items()`, for example with `query.replace(/[‎‏‪-‮⁦-⁩}]/g, '')`. JavaScript `\s` includes NBSP, so an NBSP **ends** a query (INFERRED from the regex semantics; not probed). The `allowedPrefixes` check, on the other hand, rejects NBSP as a prefix (MEASURED).

### 2.3 State machine and lifecycle (VERIFIED, js 170–268 and 437–574; MEASURED 3a, 6a–6i)

**Plugin state:** `{active, range, query, text, composing, decorationId, dismissedRange}`. On each transaction:
- **Exit meta** (`{exit:true}`) deactivates and remembers `dismissedRange` (198–209).
- Matching runs **only when the editor is editable and the selection is empty** (or during IME composition) (215).
- **Moving the caret out of the range** deactivates (216).
- **Dismissed suggestions stay closed.** A suggestion dismissed with Escape or `exitSuggestion` stays closed while the match starts at the same place. Inserting whitespace, or a new trigger elsewhere, reopens (87–98; MEASURED 6d/6e).

**Renderer calls** (plugin view `update`, 465–566):

| Transition | Calls, in order |
|---|---|
| start | `onBeforeStart(props)`, then `onStart(props)` with `items: initialItems ?? []`, `loading: willFetch`. Then, if fetching, `onUpdate({…, loading: true})`, `await items()`, and `onUpdate({items, loading: false})` |
| query or range change | `onBeforeUpdate`, then the same fetch sequence as above |
| stop | `onExit(props of the previous state)` |
| plugin destroyed (editor destroyed) | `onExit(lastProps)` (567–572) |

`props` = `{editor, range, query, text, items, command(item), decorationNode, clientRect(), loading, placement, offset, flip, container, floatingUi, mount(element, opts)}` (484–516).

**Keyboard** (`handleKeyDown`, 125–144):
- While the suggestion is active, **every** keydown goes first to `render().onKeyDown({view, event, range})`. Returning `true` consumes the event.
- **Escape always calls `onKeyDown`, then always exits** (129–138), whatever `onKeyDown` returns. **This contradicts changelog 3.4.0**, which says "if it returns `true` the plugin assumes the consumer handled the event". The 3.31.3 code wins.
- **The plugin handles no key of its own besides Escape.** Arrow, Enter and Tab handling is entirely ours.

**Blur:** the plugin has no focus or blur handling. After the editor blurs (or after `commands.blur()`), the suggestion **stays active** (MEASURED C2). Only `dismissOnOutsideClick` closes it, and only for pointer clicks outside when `mount()` is used. **Tabbing away leaves the popup open**, so we must close it on blur ourselves: `onBlur` → `exitSuggestion(view, ourKey)`.

**`exitSuggestion(view, key)`:**
- Needs the **same `PluginKey` instance** the plugin was created with.
- The default key does nothing for Mention, because Mention uses an anonymous key per trigger (MEASURED 6f).
- A **string does not work either**: `getMeta('valuePath')` looks up the literal string, while the plugin reads `meta[key.key]`, which is `'valuePath$'` (prosemirror-state `index.js:661-663`, `createKey` 974–979; MEASURED C1).
- **The docs example `exitSuggestion(editor.view, 'suggestion')` is therefore wrong**, as is the d.ts `pluginKeyRef?: PluginKey`, which rules strings out anyway.
- Pass your own `pluginKey: new PluginKey('valuePath')` to Mention's `suggestion` option and reuse that object.

### 2.4 Positioning with Floating UI (VERIFIED, js 327–422; `@floating-ui/core` `floating-ui.core.mjs` 4–53; `@floating-ui/dom` `floating-ui.dom.mjs` 495–497)

- **Mounting.** `props.mount(el, {onPosition?, autoUpdate?})` appends `el` to `container` (default `document.body`) if it is detached. Unless `onPosition` is given, it sets `visibility:hidden` and `width:max-content` until the first position resolves (376–379 and 400–403).
- **Anchor.** The reference is a virtual element: the decoration span's rect, or the caret rect (`coordsAtPos`) when no decoration exists (IME fallback, 3.4.1) (58–82). `contextElement` is `view.dom`.
- **Updates.** `autoUpdate` repositions on scroll, resize and layout shift.
- **Cleanup.** `mount()` returns `unmount`, which must be called in `onExit`. It tears down autoUpdate and the outside-click listener and removes the element if the plugin added it.
- **RTL.** `-start`/`-end` are logical. `computeCoordsFromPlacement` flips the alignment when `platform.isRTL(floating)`, and `isRTL` is `getComputedStyle(floating).direction === 'rtl'`. So `bottom-start` aligns the popup's **right** edge with the right edge of the `{query` span, but only if the **popup element** computes `direction: rtl`. Because the element is appended to `document.body`, it inherits `dir="rtl"` from `<html>` (`src/app/layout.tsx:75`). Set `dir` on the popup root explicitly anyway, so it stays correct inside LTR islands.
- **Escape hatch.** Skip `mount` and run `computePosition(reference, el, props.floatingUi)` yourself.

### 2.5 A `{` trigger that stores a path, verified end to end (MEASURED, probe §11.1 part 3)

```ts
import { PluginKey } from '@tiptap/pm/state'
import Mention from '@tiptap/extension-mention'

const valuePathKey = new PluginKey('valuePath')
Mention.configure({
  deleteTriggerWithBackspace: true,           // Backspace removes the whole chip
  renderText: ({ node }) => `{{${node.attrs.id}}}`,
  suggestion: {
    char: '{',
    pluginKey: valuePathKey,                   // needed for exitSuggestion
    allowedPrefixes: null,                     // `שלום{` must also open the list
    items: ({ query }) => filterPaths(pathsRef.current, query),
    render: () => { /* ReactRenderer + props.mount, §4.4 */ },
  },
})
```

Measured with jsdom:
1. Typing `שלום {` produces `onStart` (query `""`, items `[]`), then `onUpdate` (loading `true`), then `onUpdate` with three items.
2. Typing `שם` produces `onUpdate` with the filtered list.
3. The decoration `<span class="suggestion" data-decoration-id>` wraps `{שם`.
4. Enter, handled by our `onKeyDown`, inserted the chip, and `onExit` fired.
5. `getText()` returned `שלום {{guest.first_name}} `, and `doc.descendants` collected `["guest.first_name"]`.

---

## 3. Mention in depth

### 3.1 Node spec (VERIFIED, `mention/dist/index.js` 80–229)

- **Shape.** `name:'mention'`, `priority:101`, `group:'inline'`, `inline:true`, **`atom:true`**, **`selectable:false`** (103–106). The node is atomic and inline, but it cannot be node-selected by clicking. Arrow keys step over it as a single position (INFERRED from the PM atom semantics).
- **Attributes** (107–133):
  - `id`: `data-id`, default `null`.
  - `label`: `data-label`, default `null`.
  - `mentionSuggestionChar`: `data-mention-suggestion-char`, **default `'@'`**, always rendered.
- **`parseHTML`:** `span[data-type="mention"]` (134–136).
- **`renderHTML`:**
  - The default is `<span data-type="mention" …HTMLAttributes>{char}{label ?? id}</span>` (91–98 and 137–164). The char is looked up from the node's `mentionSuggestionChar`.
  - **With `char:'{'` the default HTML shows `{שם פרטי`, an unbalanced brace** (MEASURED 3h). Override `renderHTML`, or use a node view.
  - Our `HTMLAttributes` (for example `class`) are merged.
  - A custom `renderHTML` must spread `options.HTMLAttributes` (they carry `data-type="mention"`, `data-id`, `data-label` and `data-mention-suggestion-char`), or chips are lost when HTML is parsed back (MEASURED E3; gotcha 23a).
- **`renderText`:** the default is `{char}{label ?? id}` (86–89 and 194–205). It becomes the schema's `toText`, so `editor.getText()`, `generateText()` and clipboard plain text use it (core `index.js:1542-1543`, 1699–1714, 5526–5552). `renderLabel` is deprecated.
- **Markdown spec:** `[@ id="…" label="…" char="…"]`, through `createInlineMarkdownSpec` (165–193). Relevant only if `@tiptap/markdown` is added.

### 3.2 Inserting (the default `command`) (VERIFIED, js 21–36)

- The default command inserts `[{type:'mention', attrs:{...props, mentionSuggestionChar: char}}, {type:'text', text:' '}]` over the range. It first swallows an existing space after the range (line 24).
- It then calls `window.getSelection().collapseToEnd()`. **In jsdom with no DOM selection this throws `InvalidStateError`** (MEASURED, probe 1 before the patch). Vitest tests must either stub `Selection.prototype.collapseToEnd` or pass their own `command`.
- `props` is whatever the list passes to `props.command(item)`. The whole item object is spread into `attrs`, and only schema attributes survive.
- For a path chip, a custom command is advisable. It avoids the forced trailing space before punctuation, and it keeps `attrs` limited to `{id, label}`.

### 3.3 Reading the ids back (VERIFIED + MEASURED)

- **Walk the document:** `editor.state.doc.descendants(n => { if (n.type.name === 'mention') ids.push(n.attrs.id) })` (MEASURED 3j).
- **Walk JSON on the server:** `getSchema(extensions).nodeFromJSON(json)` + `.check()` + `.descendants()` runs in plain Node with **no DOM** (MEASURED, probe 3). `nodeFromJSON` throws on unknown nodes, so it doubles as validation at the server boundary alongside Zod.
- **Text form:** `editor.getText()` / `generateText(json, extensions)` use our `renderText`, for example `{{guest.first_name}}` (MEASURED 3g, 7b; `generateText` runs without DOM, probe 3).
- **JSON contents:** `getJSON()` contains the node attributes. With the `textDirection` option set, it also carries `dir` on **every** node (MEASURED 3f); see §5.

### 3.4 Multiple triggers (VERIFIED, js 53–75)

- `suggestions: [...]` takes precedence over `suggestion` (line 54).
- Each entry becomes its own Suggestion plugin with its own anonymous key unless you give one.
- The chip stores `mentionSuggestionChar`, and `renderHTML`/`renderText` look the trigger's options up by that char. The lookup falls back to the first trigger (69–75).

### 3.5 Deleting (VERIFIED, js 206–225; MEASURED B1–B10)

| Action | Result |
|---|---|
| Backspace right after a chip, `deleteTriggerWithBackspace:false` (default) | The chip is **replaced by its trigger char** (`{`), which **reopens the suggestion** with an empty query (MEASURED B3–B5: text `היי { סוף`, suggestion active, list shown) |
| Same, with `deleteTriggerWithBackspace:true` | The chip is removed entirely (MEASURED 5c) |
| Backspace after a chip loaded from JSON **without** `mentionSuggestionChar` | The attribute defaults to `'@'`, so an `@` is inserted (MEASURED B9–B10). Always store the char, or use `deleteTriggerWithBackspace:true` |
| Delete (forward) before a chip | Not handled by any Tiptap keymap (MEASURED B6: `false`), so the browser's native contenteditable deletion applies (INFERRED; jsdom cannot simulate it) |
| Deleting a range that spans a chip | The chip goes with the range (MEASURED B8) |

---

## 4. React integration

### 4.1 Editor options that matter here (VERIFIED, core d.ts 1626–1816; defaults at `index.js:6154-6188`)

| Option | Default | Notes |
|---|---|---|
| `element` | a detached `div` (or `null` without `document`) | `useEditor` handles it |
| `content` | `''` | HTML string, JSON, a JSON array, or `null` |
| `extensions` | `[]` | |
| `editable` | `true` | `setEditable(v, emitUpdate = true)` **emits `update` by default** (6311–6318; MEASURED C5) |
| `textDirection` | `undefined` | See §5 |
| `enableInputRules` / `enablePasteRules` | `true` | `false`, or an allow-list of extensions or names (`isExtensionRulesEnabled`, core 2058–2064). Not needed with Document+Paragraph+Text+Mention, which define no input rules |
| `editorProps` | `{}` | ProseMirror `EditorProps`. `attributes` is merged **after** `role:"textbox"` (6469–6474; MEASURED D1). `handleKeyDown` in editorProps runs **before** every plugin (§4.3) |
| `coreExtensionOptions` | `{}` | `tabindex.value` (default `"0"` when editable), `clipboardTextSerializer.blockSeparator`, `delete.{async, filterTransaction}` |
| `enableCoreExtensions` | `true` | `false` or `{keymap:false, …}` |
| `injectCSS` / `injectNonce` | `true` / – | Injects the `.ProseMirror` base CSS (§7). No app-wide CSP exists: `next.config.ts:264` applies CSP to `/sw.js` only |
| `autofocus` | `false` | `'start' \| 'end' \| 'all' \| number \| boolean \| null` |
| `parseOptions` | `{}` | |
| `enableContentCheck` / `emitContentError` | `false` | Validate content and emit `contentError`. The default `onContentError` **throws** (6181–6183) |
| Events | `onBeforeCreate`, `onCreate`, `onMount`, `onUnmount`, `onUpdate`, `onSelectionUpdate`, `onTransaction`, `onFocus`, `onBlur`, `onDestroy`, `onContentError`, `onPaste`, `onDrop`, `onDelete` | `update` fires only when the document actually changed and the transaction has no `preventUpdate` meta (6563) |

**Content get and set:**
- `getJSON()` = `state.doc.toJSON()` (6584–6586).
- `getHTML()` needs the view and DOM serializer (6590–6592).
- `getText({blockSeparator = '\n\n', textSerializers})` (6596–6605).
- `setContent(content, {emitUpdate = true, parseOptions, errorOnInvalidContent})` (core 1061–1079). **It emits `update` by default** (MEASURED C3). Use `{emitUpdate:false}` when pushing a controlled value in (MEASURED C4).

### 4.2 `useEditor`, SSR and Next.js App Router (VERIFIED, react js 236–463)

- **Client only.** `@tiptap/react` is `"use client"`, so the component using `useEditor` must be a Client Component.
- **`immediatelyRender`:**
  - When `typeof window === 'undefined'` it is **forced to `false`**, with a dev warning (266–271).
  - Under Next.js (`window.next` present) it **defaults** to `false` when not given (272–275).
  - Pass `immediatelyRender: false` explicitly: it matches the docs, silences the warning, and makes the first client render return `null` for the editor. Render `EditorContent` with `editor={null}` (an empty `div`), or a skeleton.
- **Option changes without `deps`.** On each render, if the options changed, `setOptions({...options, editable: editor.isEditable})` runs (400–404, `compareOptions` 364–390). **`setOptions` does not rebuild extensions or plugins** (core 6299–6307; MEASURED A3). So a new `extensions` array, or a changed `items` closure inside it, has no effect until the editor is recreated.
- **`deps`.** Passing `deps` destroys and recreates the editor when a dependency changes (415–426).
- **Stale item lists.** `render()` and `items` are captured once, when the plugin is created (suggestion js 583, 600–617). A runtime-changing path list must be read through a **ref**: `items: ({query}) => filter(pathsRef.current, query)`, which picks up new lists without a rebuild (MEASURED A1/A2). Alternatively, recreate the editor through `deps`, which loses the caret and undo history. `initialItems` cannot be made live; it is a captured array.
- **Re-renders.** `shouldRerenderOnTransaction` defaults to **off** (454–461; d.ts `@default false`). The component using `useEditor` does not re-render on typing. **The performance guide's statement that "`useEditor` … will re-render the editor on every change" describes the pre-3.0 behaviour** (upgrade guide §`shouldRerenderOnTransaction`).
- **Cleanup.** On unmount, destruction is scheduled 1 ms later and skipped if the component remounts (StrictMode-safe, 432–445). `EditorContent` unmount moves the DOM out and clears node views (100–113).

### 4.3 A single-line field (no Enter, no new paragraphs)

Tiptap has no "single line" option (VERIFIED by reading all of core, extensions and starter-kit). The pieces:

1. **Schema.** `Document.extend({ content: 'paragraph' })`. `can().splitBlock()` is then `false`, and Enter creates nothing (MEASURED 4b/4c).
2. **Keys.** An extension with `addKeyboardShortcuts: { Enter: () => true, 'Shift-Enter': () => true, 'Mod-Enter': () => true }` keeps the browser from receiving the event. The keymap only works because Mention (priority **101**) sorts before it (priority 100). `ExtensionManager.plugins` orders plugins by priority, and within each extension puts the keymap before its ProseMirror plugins (core 5211–5268). So the suggestion's `handleKeyDown` sees Enter first, and our `onKeyDown` can use it to pick an item (MEASURED 3d, 4a). **Two things break this:**
   - an Enter blocker with a priority above 101;
   - an Enter blocker in `editorProps.handleKeyDown`, because view props run before plugins.

   Either would swallow Enter before the suggestion sees it (INFERRED from the ordering code; the failing case was not probed).
3. **Paste and insert.** With `content:'paragraph'`, inserting two paragraphs **keeps the first and silently drops the rest** (MEASURED 4d: `<p>א</p><p>ב</p>` produced text ending in `א`). Add `editorProps.transformPastedText: t => t.replace(/\s*\n+\s*/g, ' ')`, plus `transformPastedHTML` or `clipboardTextParser`, to flatten newlines (INFERRED; real paste was not probed).
4. **Leave out** HardBreak, TrailingNode, lists and all of StarterKit.
5. Set `aria-multiline="false"` (§6).

### 4.4 Rendering the list as a React component

`ReactRenderer` is the built-in (VERIFIED, react js 599–683):

```ts
render: () => {
  let r: ReactRenderer<PathListHandle, PathListProps> | null = null
  let unmount: (() => void) | null = null
  return {
    onStart: props => {
      r = new ReactRenderer(PathList, { props, editor: props.editor })
      r.element.setAttribute('dir', 'rtl')
      unmount = props.mount(r.element)        // Floating UI, autoUpdate, outside click
    },
    onUpdate: props => r?.updateProps(props),
    onKeyDown: ({ event }) => r?.ref?.onKeyDown(event) ?? false, // Escape: the plugin exits anyway
    onExit: () => { unmount?.(); r?.destroy(); r = null; unmount = null },
  }
}
```

- **Context.** The component renders through `createPortal` inside `EditorContent`'s `Portals` (22–25, 57–63). React context from above `EditorContent` reaches it: our `DirectionProvider`, theme and JSON Forms context. **The portal target is the renderer's own `element`,** and `mount()` moves that into `document.body`.
- **Refs.** With React ≥ 19, `ReactRenderer` passes a callback `ref` prop to any component (630–636), so `useImperativeHandle(props.ref, …)` works in a plain function component. This is what the official demos do (`SuggestionPositioning/React/DropdownList.jsx:28`).
- **Timing.** If `EditorContent` is not initialised yet, the first render is deferred to a microtask (613–619).
- **Keeping focus.** Buttons in the list need `onMouseDown={e => e.preventDefault()}` so clicking does not blur the editor (demo `DropdownList.jsx:56`).

**Alternatives:**
- `props.floatingUi` + `props.clientRect` with your own `computePosition` (docs "Manual positioning").
- Keep React state outside the editor and render the list with our own Popover. The plugin state is readable through `valuePathKey.getState(editor.state)` together with `useEditorState`. This is INFERRED as workable, not probed.

### 4.5 Re-render and performance rules (VERIFIED, perf guide + code)

- Isolate the editor component, and read derived values through `useEditorState` with a selector (deep-equal by default).
- Do not `setState` synchronously inside Tiptap callbacks. Wrap it in `queueMicrotask` to avoid the `flushSync` warning (performance guide, last section).
- `ReactRenderer.updateProps` is shallow-compared and skips identical props (645–662). The suggestion creates a new `props` object on every update, so the list does re-render on each query change.
- The chip as a `ReactNodeViewRenderer` creates one React portal per chip. That is cheap at single-line scale, but a plain `renderHTML` span is cheaper and needs no hydration.

### 4.6 Controlled value in and out (the JSON Forms control)

- **Out:**
  - `onUpdate: ({ editor }) => handleChange(path, toValue(editor))`.
  - `toValue` is either (a) the id of the only chip, or (b) `editor.getText()` with `renderText` for mixed text and chips. See §9, which leaves the choice open.
- **In:**
  - On an external value change, compare it with the current serialized value and, only if it differs, call `editor.commands.setContent(fromValue(v), { emitUpdate: false })`.
  - This avoids an `update → handleChange → setContent` loop (C3/C4) and caret jumps.
- **`enabled`:** call `editor.setEditable(enabled, false)`. The default `emitUpdate = true` would fire `onUpdate` (MEASURED C5/C6). When not editable, `tabindex` is removed and `contenteditable="false"` (MEASURED C8).

---

## 5. RTL and Hebrew

**`textDirection` option** (VERIFIED, core `index.js:5835-5869` and 6407; d.ts 1662–1668):
- When set to `'ltr'`, `'rtl'` or `'auto'`, the core `TextDirection` extension:
  - adds a global `dir` attribute to **every node type except text**, with the option value as default;
  - sets `dir` on the editor root through view `attributes`.
- `setTextDirection` / `unsetTextDirection` set or delete `attrs.dir` on the nodes in a range (2613–2635, 2967–2989).
- **Side effect:** `getJSON()` then stores `dir` on `doc`, on `paragraph` **and on every mention** (MEASURED 3f), and `getHTML()` emits `dir` on each element (3h).
- For a stored field value that is noise and makes values compare unequal. **Recommendation:** leave `textDirection` unset and put `dir` on the root with `editorProps.attributes: { dir: 'rtl' }`, or `'auto'` for mixed content (MEASURED D1/D2: `dir="auto"` on the root, clean JSON).
- The app shell already has `<html lang="he" dir="rtl">` (`src/app/layout.tsx:75`), so the contenteditable inherits RTL even without the attribute.

**Caret and bidi.**
- ProseMirror itself is bidi-aware; `joinBackward` uses the view for "bidi-aware start-of-textblock detection" (d.ts 3531).
- An atom chip is one position. With `dir="rtl"` and Latin path labels inside a chip, visual order is decided by the browser's bidi algorithm (INFERRED). Isolate the chip (`unicode-bidi: isolate` or `<bdi>` in `renderHTML`) so a Latin id does not reorder the surrounding Hebrew punctuation.

**Popup placement:** see §2.4. `-start` follows the popup's computed direction.

**Placeholder:** the docs' CSS uses `float: left`, which is **wrong in RTL**. Use `float: inline-start` (or `right`) with `content: attr(data-placeholder)`, per the repo rule of logical properties only (`.claude/skills/building-rtl-ui/SKILL.md` item 5).

**Known issues from the docs:** VoiceOver can join words across blocks. The accessibility guide suggests a `\200B` after blocks. That hardly matters for a single paragraph.

---

## 6. Accessibility

**Out of the box** (VERIFIED + MEASURED 3i, D1):
- The editor root gets `role="textbox"` (core 6471), `tabindex="0"` when editable (Tabindex 5809–5824), `contenteditable`, and `translate="no"` (from prosemirror-view, MEASURED D1).
- **No** `aria-label`, `aria-multiline`, `aria-autocomplete`, `aria-expanded`, `aria-controls` or `aria-activedescendant`.
- `@tiptap/suggestion` emits **no ARIA at all**. It adds only the inline decoration span (148–160), and announces nothing.
- Mention renders a plain `span` with `data-*` attributes.

**What we must add:**
1. **Name.** A contenteditable cannot be targeted by `<label for>`. Use `editorProps.attributes: { 'aria-labelledby': labelId, 'aria-describedby': helpId, 'aria-multiline': 'false', 'aria-autocomplete': 'list', 'aria-required': … }`. These merge with `role` (MEASURED D1). The official accessibility demo uses `aria-label` / `aria-multiline` the same way (`demos/src/Examples/Accessibility/React/index.tsx:19-26`).
2. **Combobox state on the focused element.** Focus stays in the editor, so screen readers follow `aria-activedescendant` only if it sits on `editor.view.dom`. The list must:
   - render `role="listbox"` with an `id`;
   - render options with `role="option"`, stable `id`s and `aria-selected`.

   On each change, write `aria-expanded`, `aria-controls` and `aria-activedescendant` onto `editor.view.dom` (`setAttribute`), and remove them in `onExit`. Changing `editorProps` through `setOptions` would also work, but it re-runs `view.setProps` on every change.
3. **Result count and empty state.** Use an `aria-live="polite"` region, for example "3 תוצאות" / "אין תוצאות". Nothing built in does this.
4. **Keyboard.** ArrowUp/Down to move, Enter (and optionally Tab) to pick, Escape to close (built in), and close on blur (§2.3).
5. **Chip name.** If a chip label differs from its visible text, give it `aria-label` through `renderHTML` or a node view.

**Why the ready menus don't fit.**
- Base UI `Menu`/`Select`/`Autocomplete` and `@workflowbuilder/ui` `Menu`/`Select` are built around their own trigger or input and **move focus into the popup**. The `@workflowbuilder/ui` Menu is a Base UI `Menu` (`dist/components/menu/placement.d.ts:1`). Moving focus takes it out of the contenteditable, which ends typing-to-filter (INFERRED from their component model; not probed).
- `cmdk` (behind `ui/command.tsx`) puts `role="combobox"` + `aria-activedescendant` on **its own `Command.Input`**, and puts `role="listbox"` + `aria-activedescendant` on `Command.List` (VERIFIED, grep of `cmdk/dist/index.mjs`). Its keyboard handling listens on its own root. With the editor holding focus, neither the keys nor the ARIA reach the user unless we:
  - drive `Command`'s controlled `value` / `onValueChange` from our `onKeyDown`;
  - set `shouldFilter={false}` (we filter in `items()`);
  - mirror the list's `aria-activedescendant` onto the editor element.

  The `value`, `onValueChange`, `shouldFilter`, `loop` and `disablePointerSelection` props exist (VERIFIED, `cmdk/dist/index.d.ts:32-62`). That the mirroring works end to end is INFERRED.

---

## 7. Styling

**CSS that ships** (VERIFIED):
- `@tiptap/core` injects one `<style>` (`injectCSS`, core 6069–6139 and 6291–6293). It covers:
  - `.ProseMirror` position and `white-space: break-spaces`;
  - `[contenteditable=false]` whitespace;
  - `img.ProseMirror-separator`;
  - `.ProseMirror-gapcursor` (+ blink keyframes);
  - `.ProseMirror-hideselection`.
- **No other package ships CSS.** `find node_modules/@tiptap node_modules/@floating-ui/{dom,core,utils} -name '*.css' -o -name '*.scss'` returns 0 files. The suggestion, mention and menus set only inline positioning styles (`position`, `left`, `top`, `visibility`, `width:max-content`).

**Class names and attributes we can target:**

| Hook | Where from |
|---|---|
| `.tiptap.ProseMirror` (root), `.ProseMirror-focused` | core `prependClass` (6502), prosemirror-view |
| `[role=textbox][contenteditable][tabindex][dir]` | §6, §5 |
| `span.suggestion`, `.suggestion.is-empty`, `[data-decoration-id]`, `[data-decoration-content]` | Suggestion decoration (`decorationClass`, `decorationEmptyClass`) |
| `span[data-type="mention"][data-id][data-label][data-mention-suggestion-char]` + our `HTMLAttributes.class` | Mention `renderHTML` |
| `p.is-empty[data-placeholder]`, `.is-editor-empty` | Placeholder |
| `.react-renderer` (+ our `className`) | Every `ReactRenderer` element (606–612) |
| `.node-mention`, `[data-node-view-wrapper]`, `.ProseMirror-selectednode` | Only if the chip uses `ReactNodeViewRenderer` (929, 1028) |

**Class-name clash:** the Placeholder's empty class (`is-empty`) and the suggestion's empty class (`is-empty`) share a default. Scope selectors (`p.is-empty`, `.suggestion.is-empty`), or rename one of them.

**Design tokens:** Tiptap has none. We style with our Tailwind/shadcn tokens:
- **The field:** the `InputGroup` or `Input` classes (`h-8 rounded-lg border-input …`, `focus-visible:ring-*`) applied to the editor root through `editorProps.attributes.class`. Because the root is a `div`, `focus-visible` works, but `aria-invalid` has to be set by us.
- **The chip:** `badgeVariants({variant:'secondary'})` classes, used in `renderHTML`.
- **The popup:** `bg-popover text-popover-foreground ring-1 ring-foreground/10 rounded-lg shadow-md`, the same as `ui/popover.tsx:40`.

---

## 8. What this repo already has to connect to

Read in full: `docs/reference/jsonforms-3.8-capabilities.md`, `src/components/ui/{command,popover,input,direction,badge}.tsx`, `input-group.tsx` (class lists only), `.claude/skills/building-rtl-ui/SKILL.md`, `workflows/[id]/output-paths.ts`, `@workflowbuilder/ui` `menu/*`, `select/*`, `chip/*` and `input/*` `.d.ts`.

| Existing piece | Plug-in point |
|---|---|
| **JSON Forms control** (`withJsonFormsControlProps`, `@jsonforms/react/lib/JsonFormsContext.d.ts:178`; JSON Forms map §4.3–4.4) | A `PathTemplateControl({data, path, handleChange, enabled, errors, label, id, required})` hosts the editor. `data` goes in through `setContent(…, {emitUpdate:false})`, and `onUpdate` calls `handleChange(path, value)`. `enabled` → `setEditable(enabled, false)`. `errors` → `aria-invalid` + `aria-describedby`. The tester is `rankWith(n, optionIs('format', 'kalfa-value-path'))`, the repo's pattern. The runtime path list reaches it through React Context or `config` (map §4.4), and is read from a **ref** in `items()` (§4.2) |
| **`outputPaths()`** (`output-paths.ts`) | Produces the leaf dot-paths (`/^[\w.-]+$/`) and is a ready source for the list. `referenceFor()` shows the workflow grammar is `{{nodes.<id>.<path>}}`, so `renderText` can emit exactly that grammar if the value is text |
| **`ui/command.tsx`** (cmdk 1.1.1) | Visual rows (`CommandList`/`CommandItem`/`CommandEmpty`/`CommandGroup`), with the §6 caveats: no `CommandInput`, `shouldFilter={false}`, controlled `value` |
| **`ui/popover.tsx`** (Base UI Popover) | Provides the popup's visual classes. Its positioner and focus management are **not** used, because Suggestion's `mount()` positions a plain element |
| **`ui/input.tsx` / `ui/input-group.tsx` / `ui/badge.tsx`** | Classes for the field shell and the chip |
| **`ui/direction.tsx`** (Base UI `DirectionProvider`, wired in `layout.tsx`) | Reaches the list through the `ReactRenderer` portal (§4.4). Tiptap itself ignores it; RTL comes from the DOM `dir` (§5) |
| **`@workflowbuilder/ui`** `Menu`/`Select` | **Not suitable** for the list (focus model, §6). `Chip` could render the chip, but outside the workflow editor it needs `html[data-theme]` for its tokens (JSON Forms map §6.1). Inside the workflow editor it is the natural chip |
| **RTL skill** | Logical properties only; `dir="rtl"` on HTML *and* DirectionProvider. Base UI portals ignore DOM `dir`, but our popup is a plain element, so DOM `dir` is what counts |

---

## 9. Fit table for the value-path field

Order of preference: Tiptap built-ins, then `@workflowbuilder/ui`, then our shadcn, then custom.

| Need | 1. Tiptap built-in | 2. `@workflowbuilder/ui` | 3. Our shadcn / Base UI | 4. Custom left |
|---|---|---|---|---|
| Rich single-line input | `@tiptap/react` `useEditor` + `EditorContent`; `Document.extend({content:'paragraph'})`, `Paragraph`, `Text` | – | Field classes from `ui/input` / `input-group` | Enter-blocking keymap extension (3 lines) + paste flattening (§4.3) |
| `{` opens a list | `@tiptap/suggestion` via Mention `suggestion: {char:'{', allowedPrefixes:null, pluginKey}` | – | – | none |
| Filter by query (runtime paths) | `items({query, signal})`, `debounce`, `minQueryLength` | – | – | Filter function over `pathsRef.current`; strip `}` and bidi marks from the query (§2.2) |
| Render the list | `ReactRenderer` + `props.mount()` (positioning, autoUpdate, outside click, RTL `-start`). **Tiptap UI Components `SuggestionMenu` / `MentionDropdownMenu`** also exist (see note) | `Menu` / `Select`: no, they move focus (§6) | `ui/command` rows (cmdk), `ui/popover` styling | The list component: selected index, `onKeyDown` handle, loading and empty states, `onMouseDown` preventDefault |
| Keyboard | Suggestion routes keys to `onKeyDown`; Escape closes | – | – | Up/Down/Enter (±Tab); close on blur |
| Atomic chip storing the id | `@tiptap/extension-mention` (`atom`, `id`, `label`, `mentionSuggestionChar`) | `Chip` (editor-only tokens) | `badgeVariants` classes in `renderHTML` | Custom `renderHTML` (the default shows `{label`; it must spread `options.HTMLAttributes`, gotcha 23a) and a custom `command` (no forced space) |
| Delete a chip | `deleteTriggerWithBackspace:true` | – | – | none |
| Value out/in | `onUpdate`, `getText`/`renderText`, `doc.descendants`, `setContent(…, {emitUpdate:false})`, `generateText` on the server | – | – | `toValue` / `fromValue` + JSON Forms control wrapper |
| Placeholder | `Placeholder` from `@tiptap/extensions` | – | Token colours | RTL CSS (`float: inline-start`) |
| RTL | DOM `dir` via `editorProps.attributes`; Floating UI RTL alignment | – | `DirectionProvider` reaches the list | `dir` on the popup element; chip `unicode-bidi: isolate` |
| Accessibility | `role="textbox"` only | – | cmdk ARIA does not reach the focused editor | Listbox/option ids, `aria-*` mirrored on `view.dom`, live region (§6) |
| SSR (App Router) | `"use client"` bundle; `immediatelyRender:false` | – | – | Skeleton for the first client render |

**Tiptap UI Components note.**
- `SuggestionMenu` (`npx @tiptap/cli add suggestion-menu`) and `MentionDropdownMenu` are **not npm packages**. The CLI copies their source into `components/tiptap-ui*`, adds SCSS (it installs `sass`) and injects `@import`s into `globals.css` (UI docs: getting-started/overview, install/next, style, cli, all read in full).
- The docs **warn they "work best with React 18"** (overview), and our app runs React 19.3.
- Their documented ARIA is `role="listbox"` + `aria-label="Suggestions"`, keyboard navigation and preventing pointer events from stealing focus (`suggestion-menu.md`, "Accessibility"). `floatingOptions: Partial<UseFloatingOptions>` implies `@floating-ui/react`.
- The reference app in `ueberdosis/tiptap-ui-components` depends on `@floating-ui/react`, Radix popover/dropdown and `sass-embedded` (`apps/web/package.json`). The component source itself is **not** in that public repo tree (251 files; no `suggestion-menu`), so its RTL behaviour and dependencies are **INFERRED**.
- Taking it means CLI-generated files, SCSS and probably Radix, alongside our Base-UI/Tailwind stack. That needs approval, and it conflicts with the repo rule "shadcn CLI, never hand-roll" only in the sense that it is a second registry.

**Decision the owner must make: the value shape.** The request says the value is "the selected path id" (singular).
- **(a) One chip only.**
  - The value is the bare id string.
  - The real single-chip guard is a `filterTransaction` (or `appendTransaction`) extension that rejects or strips a second mention. Only that also covers paste, `setContent` and drag.
  - Suggestion's `allow` can additionally keep the list from opening once a chip exists: `allow: ({ state, range }) => !hasMention(state.doc) && <Mention's schema check>`. Two caveats:
    - Use the `state` argument, not `editor.state`. `allow` runs inside the plugin's state `apply` (suggestion js 226–230), which `Editor.dispatchTransaction` calls through `applyTransaction` before `view.updateState` (core 6530/6540), so `editor.state` is still the previous state.
    - A custom `allow` **replaces** Mention's default check that the parent accepts a mention (mention js 37–42, where the override is spread last), so repeat that check.
  - Clear or replace any free text.
- **(b) Text mixed with chips**, a template.
  - The value is `getText()` with `renderText: {{id}}` (or the workflow's `{{nodes.<id>.<path>}}`), or the JSON document.
  - Round-trip needs a parser from text back to chips. Nothing built in does that: the markdown spec expects `[@ id=…]` syntax, not `{{…}}`.

Both shapes are supported by the pieces above. Only (b) needs the extra parser.

**Dependency choice to approve.** `@tiptap/extensions` and `@tiptap/extension-{document,paragraph,text}` are **not** in `package.json`; they resolve only because `starter-kit` depends on them. There are two options:
- **Add them as direct dependencies** (pinned 3.31.3). This needs approval.
- **Avoid them:**
  - define `doc` / `paragraph` / `text` inline with `Node.create` (Document and Text are ~10 lines each; see `extension-document/dist/index.js`, `extension-text/dist/index.js`);
  - or import them through `StarterKit.configure({ … all false except document/paragraph/text })`. That cannot restrict `Document.content` (the `document` option is typed `false` only), and it pulls the whole kit into the bundle (+~94 KB minified, §10).

---

## 10. Gotchas for 3.31.3

**Versions and peers**
1. All `@tiptap/*` peers are **exact** `3.31.3` (`react/package.json` peers). Upgrade every Tiptap package together. StarterKit pins its bundled set (3.30.0).
2. React 19.3 is inside every peer range. `ReactRenderer` uses the React 19 ref-as-prop path (react js 582–636).
3. `@floating-ui/dom` 1.8.0 (a direct dependency) satisfies the suggestion peer `^1.0.0`.
4. Only one `prosemirror-model` is installed. Keep it that way; duplicates break wrapping and splitting (core 5896–5910).

**Behaviour that differs from docs, examples or changelogs** (code wins)

5. **Escape.** The plugin always exits, whatever `onKeyDown` returns (js 129–138), contrary to changelog 3.4.0. The demos' `component.destroy()` on Escape therefore runs before `onExit` destroys it again (harmless).
6. **`exitSuggestion` with a string key** (docs "Exiting open suggestions") is a no-op (MEASURED C1, 6h). Pass the `PluginKey` object.
7. **`@tiptap/react` does not re-render by default.** The performance guide's "re-render the editor on every change" is v2 behaviour (react js 454–461; upgrade guide).
8. **Wrong defaults in the docs:**

   | Item | Docs say | Code says |
   |---|---|---|
   | BubbleMenu `resizeDelay` | 100 | 60 |
   | BubbleMenu `options` default | `{strategy:'absolute', placement:'right'}` | `{placement:'top', offset:8, flip:{}, shift:{}}` (bubble js 62–82) |
   | FloatingMenu `appendTo` default | `document.body` | `view.dom.parentElement` (floating js 187–188) |
   | TrailingNode `notAfter` default | `['paragraph']` | `[]` + the default node (js 609–621) |

9. **Wrong "Minimal Install" subpaths in the docs:**
   - `@tiptap/extensions/gapcursor` and `/dropcursor` do not exist. The exports are `./gap-cursor` and `./drop-cursor` (`extensions/package.json`).
   - CharacterCount's minimal install imports `@tiptap/extension-character-count`, a v2 package that is not installed.
10. **Mention docs.** The collaboration example uses `shouldShow: ({transaction}) => isChangeOrigin(transaction)`. The suggestion docs negate it (`!isChangeOrigin`). Not relevant without collaboration.
11. **Demos predate `props.mount`.** The Mention and Community demos position the list by hand with `updatePosition` + `document.body.appendChild`, and use `text-align:left` (not RTL-safe). Prefer `props.mount` (SuggestionPositioning demo).

**Traps found by reading and probing**

12. **Runtime lists go stale.** `items`, `render` and `initialItems` are captured at plugin creation, and `setOptions` does not rebuild plugins (MEASURED A1–A3). Read the paths from a ref.
13. **Loops.** `setContent` and `setEditable` emit `update` by default (MEASURED C3–C6). Pass `emitUpdate:false` for controlled sync.
14. **`textDirection` pollutes JSON and HTML** with `dir` on every node (MEASURED 3f/3h). Put `dir` on the root instead (D1/D2).
15. **Single paragraph drops content.** `content:'paragraph'` drops extra pasted or inserted paragraphs (MEASURED 4d). Flatten on paste.
16. **Backspace reopens the list.** With the default `deleteTriggerWithBackspace:false`, Backspace turns a chip back into `{` and reopens the list (MEASURED B3–B5). Stored chips without `mentionSuggestionChar` turn into `@` (B9–B10).
17. **Blur does not close the suggestion** (MEASURED C2). Wire `onBlur` → `exitSuggestion(view, key)`.
18. **Every item fetch is async.** Even sync `items()` gives one render with `items: []` + `loading: true` (MEASURED 3a). Render a loading state, not "no results", while `loading`.
19. **Prefixes.** The default `allowedPrefixes: [' ']` blocks `שלום{` and NBSP-preceded triggers (MEASURED 2d/2f/2l). The values are not regex-escaped (2o).
20. **The query keeps `}` and bidi marks** (MEASURED probe 4). Sanitize it.
21. **Vitest/jsdom:** Mention's default `command` throws `InvalidStateError` (`collapseToEnd` with no selection). jsdom also lacks `Range.getClientRects` and `getBoundingClientRect`, which ProseMirror calls. The probes stub them (§11).
22. **Keymap priority.** Mention's priority 101 is what lets the suggestion see Enter before a default-priority Enter blocker. Do not raise the blocker's priority, and do not block Enter in `editorProps.handleKeyDown` (§4.3).
23. **Unbalanced brace.** With `char:'{'`, the default `renderHTML`/`renderText` output `{label` (MEASURED 3h, 7a).
    - The default looks the char up among the **configured triggers** by the node's `mentionSuggestionChar` and falls back to the first trigger (mention js 69–75). A schema built without the `{` trigger (for example a server-side `generateText` with plain `Mention`) prints `@p.q` for a `{` chip (MEASURED E1). Use a custom `renderText` everywhere the schema is built.
23a. **A custom `renderHTML` must keep `options.HTMLAttributes`.** When the override returns an array, Mention returns it unchanged (js 158–163), and `parseHTML` matches only `span[data-type="mention"]` (134–136). The `data-type`, `data-id`, `data-label` and `data-mention-suggestion-char` attributes arrive in `options.HTMLAttributes` (line 152).
    - An override that drops them **loses every chip on a `getHTML()` → `setContent(html)` round trip** (MEASURED E3: 0 chips; E2, which spreads `options.HTMLAttributes`, keeps 1).
    - The same probably applies to copy/paste inside the editor, because ProseMirror's HTML clipboard goes through `toDOM`/`parseDOM` (INFERRED).
24. **Menus crash on the server.** The `@tiptap/react/menus` components call `document.createElement` during render (§1.7). Also, do not import server-side helpers from `@tiptap/react`; use `@tiptap/core` (changelog 3.27.4).
25. **Duplicate extension names** only warn (VERIFIED, core 1618–1622). Registering `Document` twice (for example via StarterKit + our own) probably lets the later node spec win or clash. That consequence is INFERRED and was not probed, so don't do it.

**v2 → v3 differences that affect older examples** (VERIFIED, upgrade guide and changelogs)

26. **tippy.js removed.** Floating UI replaces it; `tippyOptions` → `options`. There are 0 `tippy` references in any `dist` (grep). `@floating-ui/dom` is now a peer.
27. **Menus moved.** `BubbleMenu`/`FloatingMenu` import from `@tiptap/react/menus` (3.20.0).
28. **Extensions moved.**
    - Into `@tiptap/extensions`: `Placeholder`, `CharacterCount`, `Focus`, `Dropcursor`, `Gapcursor`, `History` (now `UndoRedo`), plus the new `TrailingNode` and `Selection`.
    - Into `@tiptap/extension-list`: the list extensions.
    - StarterKit now includes Link, Underline, ListKeymap and TrailingNode, and `history:false` → `undoRedo:false`.
29. **Content commands.** `setContent(content, options)` replaces the positional args, and `setContent`/`clearContent` emit updates by default.
30. **Node views.** `getPos()` may return `undefined`.
31. **Removed.** `editor.getCharacterCount()`.
32. **Storage** is per editor instance, not per extension.
33. **New in 3.x and useful here:**
    - Suggestion `props.mount`, `dismissOnOutsideClick`, async `items` + `debounce`/`minQueryLength`/`initialItems`/`loading` (3.27.0);
    - `shouldShow` (3.15.1);
    - dismissed-stays-dismissed (3.22.0);
    - `textDirection` (core 3.11.0);
    - `coreExtensionOptions.tabindex` (3.23.0);
    - `addDecorations()` + `ReactWidgetRenderer` (3.30.0);
    - "use client" in `@tiptap/react` (3.27.4);
    - the `immediatelyRender` SSR default (3.23.2 / 3.23.5).

**Bundle size** (MEASURED with esbuild 0.28.2, `--bundle --minify --format=esm`, React external, `NODE_ENV=production`; the app builds with webpack, so treat these as indicative):

| Import set | Minified | Gzip |
|---|---|---|
| core + react (`useEditor`, `EditorContent`, `ReactRenderer`, `useEditorState`) + Document/Paragraph/Text + Mention (+ suggestion + floating-ui) + Placeholder subpath | 338,173 B | 106,042 B |
| Same, but with StarterKit instead of the three nodes and without Placeholder | 432,095 B | 138,045 B |
| `@tiptap/react/menus` alone (pulls react + core) | 318,254 B | 98,845 B |

Largest contributors in the first set: prosemirror-view 97,939 B, @tiptap/core 80,462 B, prosemirror-model 44,879 B, prosemirror-transform 31,351 B, prosemirror-state 11,852 B, @tiptap/react 11,048 B, prosemirror-commands 9,516 B, @tiptap/suggestion 9,302 B, @floating-ui/dom 7,122 B. Load the field with `next/dynamic` on the pages that need it.

---

## 11. Probe transcripts

The probes are scratch scripts that import the installed packages from `node_modules`. They wrote nothing to the repo.
- **Environment:** jsdom 26.1.0 on Node 24.21.0, with `Range.getBoundingClientRect/getClientRects` and `Element.getClientRects` stubbed (jsdom has no layout).
- **After the first run:** `Selection.collapseToEnd` was guarded (see gotcha 21).
- **Key presses:** simulated with `view.someProp('handleKeyDown', …)`, which goes through the real plugin order.

### 11.1 Probe 1 (matcher, full editor, Enter/Backspace/Escape)
```
1a escapeForRegEx("{")                      "\\{"
1b new RegExp(`\\s${esc}$`) valid?          true
1c unescaped `[^\s{]*` valid (no u flag)?   ["{ab"]
2a "{"                                      {"range":{"from":1,"to":2},"query":"","text":"{"}
2b "שלום {שם"                               {"range":{"from":6,"to":9},"query":"שם","text":"{שם"}
2c "שלום {guest.first_name"                 query "guest.first_name"
2d "abc{x" (default prefixes)               null
2e "abc{x" allowedPrefixes:null             query "x"
2f "שלום{x" (default)                       null
2g "{שם פרטי" allowSpaces:false             null
2h "{שם פרטי" allowSpaces:true              query "שם פרטי"
2i "{{" default prefixes                    null
2j "{{" allowedPrefixes:null                {"range":{"from":2,"to":3},"query":"","text":"{"}
2k "{a{b" allowToIncludeChar:true           query "a{b"
2l "x {q" (NBSP prefix)                null
2m "x‏{q" (RLM prefix)                 null
2n "({q" allowedPrefixes:[" ","("]          query "q"
2o "]{q" allowedPrefixes:[" ","]"]          null
3a after typing "שלום {"                    onStart("",0 items) → onUpdate("",[],loading:true) → onUpdate("",[3 ids],false)
3b after typing "שם"                        onUpdate("שם",[],true) → onUpdate("שם",["guest.first_name","guest.last_name"],false)
3c decoration element                       [{"cls":"suggestion","id":"set","text":"{שם"}]
3d Enter while suggestion active            handled=true → onKeyDown("Enter"), onExit
3f getJSON() (textDirection:'rtl')          doc/paragraph/mention all carry attrs.dir:"rtl"; mention attrs {id:"guest.first_name", label:"שם פרטי", mentionSuggestionChar:"{"}
3g getText() (renderText {{id}})            "שלום {{guest.first_name}} "
3h getHTML()                                <p dir="rtl">שלום <span class="value-chip" data-type="mention" dir="rtl" data-id="guest.first_name" data-label="שם פרטי" data-mention-suggestion-char="{">{שם פרטי</span> </p>
3i editor root                              role=textbox, dir=rtl, tabindex=0, class "tiptap ProseMirror", no aria-*
3j ids via doc.descendants                  ["guest.first_name"]
4a Enter with no suggestion                 handled=true (SingleLine keymap)
4b paragraph count                          1
4c can().splitBlock() with content:'paragraph'   false
4d insertContent('<p>א</p><p>ב</p>')        1 paragraph; "ב" dropped
5a–5c Backspace after chip, deleteTriggerWithBackspace:true   "היי {{event.date}}" → "היי "
6a "{ev"                                    active, query "ev"
6b/6c Escape                                handled; active=false
6d type "e" after Escape                    still inactive (dismissed)
6e type " {"                                active again
6f exitSuggestion(view) default key         still active (wrong key)
6g exitSuggestion(view, MentionKey)         inactive
6h new PluginKey('suggestion').key          "suggestion$1"
7a generateText, default renderText         "שלום {שם פרטי"
7b generateText, renderText {{id}}          "שלום {{guest.first_name}}"
```

### 11.2 Probe 2 (live items, deletion, keys, events, root attributes)
```
A1 items via ref.current=[a.one]                          ["a.one"]
A2 after mutating ref.current (no rebuild)                ["b.two","b.three"]
A3 setOptions({extensions}) rebuilds ExtensionManager?    false
B3 Backspace after chip (deleteTriggerWithBackspace:false) "היי { סוף"
B4/B5 suggestion reopened                                 true; onStart → onUpdate(["event.date"])
B6 Delete (forward) before chip handled by a keymap       false
B8 deleteRange spanning chip                              chip removed with the range
B9 chip loaded without mentionSuggestionChar              {"id":"event.date","label":null,"mentionSuggestionChar":"@"}
B10 Backspace after it                                    "היי @ סוף"
C1 exitSuggestion(view, "valuePath") (string)             still active
C2 after blur                                             still active
C3 onUpdate after setContent() default                    1
C4 onUpdate after setContent(…, {emitUpdate:false})       0
C5 onUpdate after setEditable(false)                      1
C6 onUpdate after setEditable(true, false)                0
C7/C8 root when editable / not                            tabindex "0", contenteditable "true" / no tabindex, "false"
D1 editorProps.attributes {dir:'auto', aria-labelledby, aria-multiline:'false', class}
   → contenteditable, role=textbox, dir=auto, aria-labelledby=lbl, aria-multiline=false, translate=no, class "tiptap ProseMirror kalfa-field", tabindex=0
D2 getJSON without textDirection                          no dir attributes
E1 default renderHTML, Mention configured without a '{' trigger
   → <p>a <span data-type="mention" data-id="p.q" data-mention-suggestion-char="{">@p.q</span></p>, chips after getHTML→setContent: 1
E2 custom renderHTML spreading options.HTMLAttributes     → <span data-type="mention" data-id="p.q" …>{{p.q}}</span>, chips: 1
E3 custom renderHTML dropping data-type                   → <span class="chip" data-id="p.q">{{p.q}}</span>, chips: 0
```

### 11.3 Probe 3 (plain Node, no DOM globals)
```
typeof window/document                       undefined undefined
generateText(stored, [Document,Paragraph,Text,Mention{renderText {{id}}}])   "שלום {{guest.first_name}}"
getSchema(ext).nodeFromJSON(stored).check() + descendants                    ["guest.first_name"]
nodeFromJSON with unknown node                                               throws "Unknown node type: bogus"
```

### 11.4 Probe 4 (multi-character trigger, closing brace)
```
"{{"        char "{{"   query ""
"{{guest"   char "{{"   query "guest"
"a{{x"      char "{{"   query "x"   (allowedPrefixes:null)
"{g}"                   query "g}"
"{g.a-b_c"              query "g.a-b_c"
"{שם‏"             query "שם‏"
```

---

## 12. Source index

**Packages in `node_modules`:**
- `@tiptap/{core, pm, react, suggestion, extension-mention, extensions, starter-kit, extension-bubble-menu, extension-floating-menu, extension-document, extension-paragraph, extension-text, extension-list, extension-link, extension-blockquote, extension-bold, extension-code, extension-code-block, extension-hard-break, extension-heading, extension-horizontal-rule, extension-italic, extension-strike, extension-underline, extension-bullet-list, extension-ordered-list, extension-list-item, extension-list-keymap, extension-dropcursor, extension-gapcursor}`;
- `@floating-ui/{dom, core, utils}`;
- `prosemirror-state` (`getMeta`, `PluginKey`) and `prosemirror-model` (`textBetween`), targeted reads;
- `cmdk` (d.ts props + a grep of the ARIA attributes).

**Docs** (`tiptap.dev/docs/<path>.md`, the site's Markdown form, fetched with curl and read in full):
- `editor/api/editor`;
- `editor/getting-started/{configure, install/react, install/nextjs}`;
- `editor/api/utilities/suggestion`;
- `editor/extensions/nodes/mention`;
- `editor/extensions/functionality/{starterkit, bubble-menu, floatingmenu, placeholder, character-count, trailing-node, undo-redo, focus, selection, gapcursor, dropcursor, list-kit, listkeymap}`;
- `editor/api/commands/nodes-and-marks/{set,unset}-text-direction`;
- `examples/basics/text-direction`;
- `examples/advanced/{mentions, react-performance}`;
- `examples/experiments/slash-commands`;
- `guides/{accessibility, performance, upgrade-tiptap-v2, output-json-html}`;
- `editor/extensions/custom-extensions/node-views/react`;
- `ui-components/{utils-components/suggestion-menu, components/mention-dropdown-menu, getting-started/{overview, cli, style}, install/next}`.

**Demo sources** (`ueberdosis/tiptap@v3.31.3`, `demos/src/`):
- `Nodes/Mention/React/*`;
- `Examples/Community/React/*`;
- `Examples/SuggestionPositioning/React/{suggestion.js, DropdownList.jsx, index.jsx}`;
- `Examples/MultiMention/React/{suggestions.js, index.jsx}`;
- `Examples/TextDirection/React/index.tsx`;
- `Examples/Performance/React/index.jsx`;
- `Examples/Accessibility/React/{index.tsx, useMenubarNav.ts, InsertMenu.tsx, TextMenu.tsx, MenuBar.tsx}`;
- `Experiments/Commands/Vue/{commands.js, suggestion.js, CommandsList.vue}`;
- `utils/updatePosition.js`.

**Changelogs** (`ueberdosis/tiptap@v3.31.3`, `packages/*/CHANGELOG.md` and `packages-deprecated/*/CHANGELOG.md`): see §13.

**Context7:** `/ueberdosis/tiptap-docs` (library resolution + 2 doc queries).

**Repo files:** see §8.

---

## 13. Coverage

### Installed packages
| File | Status |
|---|---|
| `@tiptap/suggestion` `package.json`, `README.md`, `dist/index.d.ts` (419), `dist/index.js` (656) | fully read |
| `@tiptap/extension-mention` `package.json`, `README.md`, `dist/index.d.ts` (94), `dist/index.js` (235) | fully read |
| `@tiptap/react` `package.json`, `README.md`, `dist/index.d.ts` (632), `dist/index.js` (1297; read in two chunks, 1–700 and 700–1297), `dist/menus/index.d.ts`, `dist/menus/index.js` (443) | fully read |
| `@tiptap/core` `package.json`, `README.md`, `dist/index.d.ts` (5757; read in 6 chunks: 1–1000, 1000–2000, 2000–3100, 3100–4200, 4200–5200, 5200–5758), `dist/jsx-runtime/jsx-runtime.d.ts`, `jsx-runtime/index.d.ts`, `jsx-dev-runtime/index.d.ts` | fully read |
| `@tiptap/core` `dist/index.js` (7886) | **partial, targeted regions read end to end:** 494–763 (focus, insertContent, createNodeFromContent, insertContentAt), 852–905 (keyboardShortcut), 1044–1083 (createDocument, setContent), 1475–1736 (schema, getText*, generate*), 2058–2066 (isExtensionRulesEnabled), 2080–2109 (isNodeEmpty), 2612–2637, 2966–2990 (text-direction commands), 3865–3870 (escapeForRegEx), 5175–5505 (ExtensionManager), 5526–5916 (all core extensions), 6068–6651 (style, Editor). Every other region (other commands, decorations, markdown utilities, input/paste rules, NodeView, ResizableNodeView) **not read**. No claim here depends on them |
| `@tiptap/pm` `package.json`, `README.md`, all 13 `dist/*/index.d.ts` + `index.js` | fully read. ProseMirror sources not read (out of scope), except `prosemirror-state` 661–663 and 974–995, and `prosemirror-model` 117–134 |
| `@tiptap/extensions` `package.json`, `README.md`, `dist/index.d.ts` (321), `dist/index.js` (699), 8 subpath `.d.ts` | fully read. The 8 subpath `.js` files were verified by script to be subsets of `index.js` (0 foreign lines) |
| `@tiptap/starter-kit` `package.json`, `README.md`, `dist/index.d.ts`, `dist/index.js` | fully read |
| `.d.ts` of document, text, paragraph, hard-break, bullet-list, ordered-list, list-item, list-keymap, dropcursor, gapcursor, blockquote, horizontal-rule, underline, strike, heading, bold, italic, code, code-block, link; `extension-list/dist/index.d.ts` (390) | fully read |
| `extension-list` 7 subpath `.d.ts` | verified by script as subsets of `index.d.ts` (one alias-only difference) |
| JS of document, text, paragraph | fully read |
| JS of the other bundled extensions (link, lists, code-block, heading, …) | **not read.** Not used by the field; their behaviour is described from their `.d.ts` only |
| `@tiptap/extension-bubble-menu` and `-floating-menu` `package.json`, `README.md`, `dist/index.d.ts`, `dist/index.js` | fully read |
| All 30 `@tiptap/*/README.md` | fully read (28 identical templates, plus the `pm` and `extensions` variants) |
| 61 `*.d.cts` files | compared by script with their `.d.ts`: 51 identical, 10 differ only in import order or aliases. The `extension-list/kit` 14-line difference was diffed (alias `Node` vs `Node$1`). `core/jsx-runtime/index.d.cts` uses `export *` where `.d.ts` uses `export type *`. Not read line by line otherwise |
| `@floating-ui/dom` `package.json`, `README.md`, `dist/floating-ui.dom.d.ts` (362) | fully read. `.d.mts` identical (diff). `floating-ui.dom.mjs` only lines 490–510 (`isRTL`, platform) |
| `@floating-ui/core` `package.json`, `README.md`, `dist/floating-ui.core.d.ts` (535) | fully read. `.d.mts` identical. `floating-ui.core.mjs` only lines 1–70 (`computeCoordsFromPlacement`) plus a grep of `isRTL` uses |
| `@floating-ui/utils` `package.json`, `README.md`, `dist/floating-ui.utils.d.ts` (105), `floating-ui.utils.dom.d.ts` (47) | fully read. `dom/floating-ui.utils.dom.d.ts` identical (diff) |
| `@floating-ui/react`, `@floating-ui/react-dom` | **not read.** Out of scope: they belong to Mantine / Base UI / the workflow SDK, not to Tiptap (`npm ls`) |
| `cmdk` 1.1.1 | `dist/index.d.ts` props grepped (lines 32–62, 168–198); `dist/index.mjs` grepped for ARIA. Not read in full |
| `@jsonforms/react/lib/JsonFormsContext.d.ts` | line 178 only (the HOC signature); the rest per the JSON Forms map |
| `@workflowbuilder/ui` `dist/components/{menu, select, chip, input}/**/*.d.ts`, `shared/types/list-item.d.ts` | fully read |

### Official docs (tiptap.dev `.md` form; each file saved and read to the end)
| Page | Status |
|---|---|
| editor/api/editor, getting-started/configure, install/react, install/nextjs | fully read |
| editor/api/utilities/suggestion | fully read |
| editor/extensions/nodes/mention | fully read |
| functionality/starterkit, placeholder, character-count, trailing-node, undo-redo, focus, selection, gapcursor, dropcursor, list-kit, listkeymap | fully read |
| functionality/bubble-menu | fully read |
| functionality/floatingmenu | **read as a line diff against bubble-menu:** every differing line read, the identical lines read once through the bubble-menu page |
| examples/basics/text-direction, api/commands/.../set-text-direction, unset-text-direction | fully read |
| guides/accessibility, guides/performance, examples/advanced/react-performance | fully read |
| custom-extensions/node-views/react | fully read |
| examples/advanced/mentions | fully read. The page is only an embedded demo, so its source was read from GitHub (Community demo) |
| examples/experiments/slash-commands ("custom suggestion list") | **re-read after truncation** (the first fetch was cut with `head -30`); the demo source was read from GitHub |
| guides/upgrade-tiptap-v2, guides/output-json-html | fully read |
| ui-components: utils-components/suggestion-menu, components/mention-dropdown-menu, getting-started/overview, getting-started/cli, getting-started/style, install/next | fully read |
| Tiptap UI Components source (`suggestion-menu`) | **not read:** not present in the public `ueberdosis/tiptap-ui-components` tree (251 files). Only `apps/web/package.json` was read. RTL/ARIA/dependency claims about it are INFERRED from the docs |
| Pages linked from the read pages and not followed: `api/events`, `api/commands` index, `node-positions`, `guides/react-composable-api`, `getting-started/style-editor`, `core-concepts/*` (introduction, persistence, schema, extensions, keyboard-shortcuts, decorations), `custom-extensions`, `extend-existing`, `api/utilities/static-renderer`, `extensions/nodes/emoji`, `extensions/marks/*`, `collaboration/*`, `conversion/*`, the Markdown pages, all `embed.tiptap.dev` interactive demos, the floating-ui.com docs, and the MDN/WCAG links in the accessibility guide | **not read.** Not needed for the field: the corresponding APIs were read in the installed `.d.ts`/`.js`, or they are out of scope (collaboration, markdown, conversion, pro) |
| The raw MDX on GitHub (`ueberdosis/tiptap-docs`) | not used: the `.md` endpoints returned full text (HTTP 200). The docs repo tree was listed only to find page paths |

### Changelogs (`ueberdosis/tiptap@v3.31.3`, every 3.x section; lines that only bump dependencies were filtered out by script, and duplicate beta/next entries were collapsed)
| Package | Status |
|---|---|
| suggestion, extension-mention, react, core, extensions, starter-kit, extension-bubble-menu, extension-floating-menu, pm | fully read (non-bump 3.x entries) |
| extension-link, extension-code-block, extension-blockquote, extension-horizontal-rule, extension-document, extension-paragraph, extension-text, extension-hard-break, extension-bold, extension-italic, extension-strike, extension-underline, extension-code, extension-heading, extension-ordered-list | fully read (non-bump 3.x entries; several have none) |
| extension-list, extension-bullet-list | **re-read after truncation.** The first pass capped each entry at 1,500 characters. 3.27.3 (list) and 3.0.1 (bullet-list) were re-read in full |
| extension-list-item, extension-list-keymap, extension-dropcursor, extension-gapcursor | HTTP 404 under `packages/` at v3.31.3. Read from `packages-deprecated/` (200): distinct 3.x entries listed. They contain only the list repackaging note, `86250c6` (list-keymap: "Improve selected text deletion at the end of list items"), the `ef909f1` dropcursor color types, and build/dependency notes |
| No `CHANGELOG.md` ships inside any installed package | VERIFIED (`find`) |

### Context7 cross-check
| Command | Status |
|---|---|
| `ctx7 library Tiptap "mention suggestion react"` | read. It chose `/ueberdosis/tiptap-docs` (High, 7,680 snippets) |
| `ctx7 docs … "Mention extension with suggestion render ReactRenderer props.mount onKeyDown in React"` | **truncated to the first 150 lines** (`head`). It matched the suggestion/mention pages already read, and surfaced `MentionDropdownMenu` |
| `ctx7 docs … "Tiptap UI Components SuggestionMenu …"` | **truncated to the first 120 lines**. Its content was then read in full from the `.md` pages above |

### Repo files
| File | Status |
|---|---|
| `docs/reference/jsonforms-3.8-capabilities.md` | fully read (two chunks: 1–480, 480–610) |
| `src/components/ui/command.tsx`, `popover.tsx`, `input.tsx`, `direction.tsx`, `badge.tsx` | fully read |
| `src/components/ui/input-group.tsx` | only the function names and class strings (grep) |
| `.claude/skills/building-rtl-ui/SKILL.md` | fully read |
| `src/app/(admin)/admin/workflows/[id]/output-paths.ts` | fully read |
| `package.json` | the Tiptap, floating-ui, base-ui, cmdk, mantine and workflowbuilder lines (grep) |
| `next.config.ts` | lines 250–270 (the CSP header scope) plus a grep |
| `src/app/layout.tsx` | line 75 via grep |
| `eslint.config.mjs` | grep for import rules only (no `no-extraneous-dependencies` rule found) |
