> מקור: https://www.workflowbuilder.io/docs/api/components/syntaxhighlighterlazy/
> נשמר: 2026-09-09

# SyntaxHighlighterLazy

**SyntaxHighlighterLazy**(`props`): `Element`

Code-editor input with syntax highlighting. Lazy-loads the heavy `ace-builds` chunk — until it arrives, falls back to a plain `<TextArea>` so the consumer never sees a blank tile during the load.

Use it inside custom JsonForms renderers when a property accepts code (JSON, JS expressions, etc.). Pass `mode` to pick the highlighter grammar (`'json'`, `'javascript'`, …) and `value` / `onChange` to wire it to your form state.

## Parameters

### props

`SyntaxHighlighterProps`

## Returns

`Element`
