# Advanced Line Range Selection

**Advanced Line Range Selection** is a focused Visual Studio Code extension for selecting exact text ranges using human-readable line coordinates.

It supports:

- 1-based line numbers;
- optional character or column coordinates;
- proportional positions within a line;
- negative indexing from the end of the document or line;
- Unicode grapheme-cluster-aware character and column semantics;
- inclusive explicit character endpoints;
- forward and backward selections;
- automatic clipping of out-of-bounds integer coordinates;
- configurable proportional-position snapping;
- tab-aware logical width for proportional positions;
- interactive input with live validation;
- direct programmatic invocation without opening the input box;
- Command Palette, editor context-menu, and keyboard access.

## Installation

Install **Advanced Line Range Selection** from the Visual Studio Code Extensions view, or use:

```sh
code --install-extension orfadida.advanced-line-range-selection
```

To uninstall it:

```sh
code --uninstall-extension orfadida.advanced-line-range-selection
```

## Command

| Command               | ID                                              |
| --------------------- | ----------------------------------------------- |
| **Select Line Range** | `advanced-line-range-selection.selectLineRange` |

The normal UI entry points are available when a text editor has focus.

## Usage

Run **Advanced Line Range Selection: Select Line Range** and enter either one line specifier or a start/end pair.

A line specifier has one of these forms:

```text
<line>
<line>:<coordinate>
<line>.<proportion-digits>
```

For `:` syntax, `<coordinate>` is interpreted as either a **character** or a **column** according to the configured coordinate mode.

A complete input is:

```text
<start-specifier> [<end-specifier>]
```

The two specifiers are separated by whitespace.

The `:` and `.` forms intentionally use different coordinate systems:

- `:` introduces an integer character or column number, according to `coordinateMode`;
- `.` introduces a proportional position within the line and is independent of `coordinateMode`.

### Basic examples

The following examples assume the default `character` coordinate mode.

| Input         | Meaning                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------- |
| `13`          | Select from the beginning of line 13 to the end of the document.                                |
| `13:5`        | Select from character 5 of line 13 through the end of the document.                             |
| `13 20`       | Select from the beginning of line 13 through the end of line 20.                                |
| `13:2 20:8`   | Select from character 2 of line 13 through character 8 of line 20, inclusive.                   |
| `20 13`       | Select the same full-line range as `13 20`, but backward.                                       |
| `20:8 13:2`   | Select the same explicit character range as `13:2 20:8`, but backward.                          |
| `2:3 2:3`     | Select exactly character 3 on line 2.                                                           |
| `13.25`       | Select from 25% of the logical width of line 13 through the end of the document.                |
| `13.25 20.75` | Select between proportional positions on lines 13 and 20.                                       |
| `13:5 20.75`  | Mix an integer character coordinate with a proportional position.                               |
| `13.`         | Start at the explicit end boundary of line 13 and select through the end of the document.       |
| `13.0`        | Start at the explicit beginning boundary of line 13 and select through the end of the document. |

When the end specifier is omitted entirely, the selection extends to the end of the document.

## Input Syntax

### Line numbers

A line number is a non-zero signed integer:

```text
1
25
+25
-1
-20
```

Leading zeros are allowed:

```text
001
+005
-010
```

Zero is invalid:

```text
0
+0
-0
```

Negative line numbers count backward from the end of the document:

```text
-1 = last line
-2 = second-to-last line
...
```

After negative indexing is resolved, out-of-bounds line numbers are clipped to the document.

### Integer `:` coordinates

The `:` form requires a non-zero signed integer after the colon:

```text
13:5
13:+5
13:-1
```

A colon without a coordinate is not complete input:

```text
13:
```

The interpretation of the integer is controlled by:

```text
advanced-line-range-selection.coordinateMode
```

Negative character or column numbers count backward from the end of their respective coordinate domain.

After negative indexing is resolved, out-of-bounds character or column numbers are clipped to the valid range of the line.

### Proportional `.` positions

The digits following `.` represent the fractional digits of a proportion between `0` and `1`.

For example:

```text
13.0      -> proportion 0
13.1      -> proportion 0.1
13.25     -> proportion 0.25
13.500    -> proportion 0.5
13.999    -> proportion 0.999
```

A bare dot represents the exact proportion `1`:

```text
13.       -> proportion 1
```

Therefore:

```text
13
```

and:

```text
13.
```

are not equivalent.

`13` has no explicit secondary position, so its eventual line boundary depends on selection direction.

`13.` explicitly identifies the end boundary of line 13.

Negative proportional values are not supported. A negative sign before the line still applies to the line number, so:

```text
-1.5
```

means proportion `0.5` of the last line.

## Unicode Grapheme Clusters

Character and column coordinates operate on **Unicode grapheme clusters**, which correspond closely to user-perceived characters.

For example, the decomposed text:

```text
éX
```

contains two grapheme clusters:

```text
1 = é
2 = X
```

even though the first grapheme consists of `e` followed by a combining acute accent.

Likewise:

```text
A👨‍👩‍👧‍👦B
```

contains three grapheme clusters:

```text
1 = A
2 = 👨‍👩‍👧‍👦
3 = B
```

Internally, the extension maps grapheme boundaries to the UTF-16 positions required by the VS Code `Position` API.

## Coordinate Modes

The setting:

```text
advanced-line-range-selection.coordinateMode
```

controls only integer coordinates introduced by `:`.

It does not affect proportional positions introduced by `.`.

### Character mode

The default mode is:

```json
"advanced-line-range-selection.coordinateMode": "character"
```

A `:` coordinate identifies a 1-based grapheme character number.

For:

```text
ABCDEF
```

the character numbers are:

```text
1 = A
2 = B
3 = C
4 = D
5 = E
6 = F
```

Explicit character endpoints are inclusive.

For example:

```text
2:1 2:3
```

selects:

```text
ABC
```

The reverse input:

```text
2:3 2:1
```

selects the same text backward.

Negative character numbers count backward from the end of the line.

An empty line has no valid explicit character target.

### Column mode

Column mode is enabled with:

```json
"advanced-line-range-selection.coordinateMode": "column"
```

A column identifies a 1-based boundary between grapheme clusters.

For:

```text
ABC
```

the columns are:

```text
Column 1 = before A
Column 2 = between A and B
Column 3 = between B and C
Column 4 = after C
```

A line containing `N` grapheme clusters therefore has `N + 1` columns.

Columns identify boundaries directly. They are not inclusive character endpoints and do not change meaning according to selection direction.

Negative columns count backward from the final boundary.

An empty line still has one valid column: column `1`.

Column mode is a logical grapheme-boundary coordinate system. It is not VS Code's rendered visual-column measurement.

A tab is one grapheme and therefore advances by one column in this coordinate mode.

## Proportional Positions

A proportional position identifies a point along the line's **logical width**.

Examples:

```text
5.0    -> beginning of line 5
5.25   -> 25% of line 5
5.5    -> 50% of line 5
5.75   -> 75% of line 5
5.     -> end of line 5
```

Proportional positions always resolve to grapheme boundaries.

They are independent of `coordinateMode`, so the same proportional input has the same meaning in character and column mode.

### Logical width

Every non-tab grapheme cluster contributes a logical width of `1`.

For example:

```text
ABCDE
```

has cumulative grapheme-boundary widths:

```text
0, 1, 2, 3, 4, 5
```

A proportion of `0.4` targets logical width:

```text
0.4 * 5 = 2
```

which exactly matches the boundary after `B`.

### Tabs

Tabs are treated specially for proportional positions.

A tab advances to the next tab stop according to the editor's effective tab size.

For:

```text
A<TAB>B
```

with a tab size of `4`, the cumulative logical widths are:

```text
0, 1, 4, 5
```

This logical-width model is deterministic and does not attempt to reproduce rendered pixel width.

Non-tab grapheme clusters, including emoji and wide characters, each contribute logical width `1`.

### Proportional snapping

A requested proportional position may fall between two selectable grapheme boundaries.

The setting:

```text
advanced-line-range-selection.proportionSnap
```

controls which boundary is selected.

| Value     | Behavior                                                                                                    |
| --------- | ----------------------------------------------------------------------------------------------------------- |
| `nearest` | Select the nearest grapheme boundary. Equal-distance ties select the boundary after the requested position. |
| `before`  | Select the nearest grapheme boundary at or before the requested position.                                   |
| `after`   | Select the nearest grapheme boundary at or after the requested position.                                    |

The default is:

```json
"advanced-line-range-selection.proportionSnap": "nearest"
```

If the requested position effectively matches an existing grapheme boundary, that boundary is used regardless of the snapping mode.

An empty line has only one boundary, so every proportional position resolves to that boundary.

## Omitted Secondary Positions

A line specifier does not need a character, column, or proportional position.

For example:

```text
13 20
```

contains two line-only specifiers.

An omitted secondary position is resolved only after the selection direction is known.

For a forward selection:

- omitted start position -> beginning of the start line;
- omitted end position -> end of the end line.

For a backward selection:

- omitted start position -> end of the start line;
- omitted end position -> beginning of the end line.

This makes line-only ranges symmetric:

```text
13 20
```

and:

```text
20 13
```

select the same text with opposite selection directions.

When both resolved line numbers are the same and at least one endpoint does not provide a usable explicit target, the selection is treated as forward.

## Selection Direction

Direction is determined after line numbers and explicit secondary positions have been resolved.

The rules are:

1. If the resolved start line is before the resolved end line, the selection is forward.
2. If the resolved start line is after the resolved end line, the selection is backward.
3. If both resolved lines are the same and both endpoints have explicit usable targets, their positions within the line determine the direction.
4. Equality is considered forward.
5. If both resolved lines are the same and either endpoint has no usable explicit target, the selection is forward.

Character targets and boundary targets can be mixed on the same line.

Their ordering follows:

```text
line start
character 1
boundary after character 1
character 2
boundary after character 2
...
line end
```

This allows character coordinates and boundary-based column or proportional positions to determine direction consistently.

The first resolved endpoint becomes the VS Code selection anchor. The second becomes the active endpoint.

## Empty Lines

An empty line contains zero grapheme clusters but still has one grapheme boundary.

The coordinate types behave as follows:

- character mode has no valid explicit character;
- column mode has exactly one valid column, column `1`;
- every proportional position resolves to the line's only boundary.

If an explicit character coordinate resolves to an empty line, there is no character to target. That endpoint is therefore treated like an omitted secondary position.

If both final VS Code positions are identical, the command performs no selection change.

A completely empty document is handled by the same rules.

## Input Validation

Interactive use employs a managed VS Code input box with separate live validation and strict acceptance.

### Live validation

As you type, the extension distinguishes between:

- complete valid input;
- incomplete input that can still become valid;
- structurally invalid input.

Incomplete input uses informational guidance such as:

```text
Keep typing...
```

rather than an error state.

### Strict acceptance

Pressing Enter only accepts input that matches the complete grammar.

Leading and trailing whitespace are ignored.

Leading zeros are accepted for non-zero integer components:

```text
005
+005
005:003
005:-003
```

The following integer forms are invalid:

```text
0
+0
-0
5:
```

Zero is valid in proportional syntax:

```text
5.0
```

A bare proportional dot is also complete input:

```text
5.
```

## Programmatic Invocation

The command can also be invoked directly with a range string.

When a string argument is supplied, the command skips the input box and sends the string through the same parser and range-resolution logic used by interactive input.

For example, another extension can invoke:

```js
await vscode.commands.executeCommand("advanced-line-range-selection.selectLineRange", "13:2 20.75");
```

A keybinding can also pass a fixed range:

```json
{
  "key": "ctrl+alt+r",
  "command": "advanced-line-range-selection.selectLineRange",
  "args": "13:2 20.75",
  "when": "editorTextFocus"
}
```

If no argument is supplied, the normal interactive input box is shown.

If the supplied argument is not a string, or if the string does not match the accepted input grammar, the command performs no selection change.

Programmatic invocation operates on the current active text editor. If there is no active text editor, the command returns without making a change.

## Configuration

### Coordinate mode

Setting:

```text
advanced-line-range-selection.coordinateMode
```

Default:

```text
character
```

Available values:

| Value       | Meaning                                                                                       |
| ----------- | --------------------------------------------------------------------------------------------- |
| `character` | `:` numbers identify 1-based grapheme characters. Explicit character endpoints are inclusive. |
| `column`    | `:` numbers identify 1-based grapheme boundaries.                                             |

### Proportional snapping

Setting:

```text
advanced-line-range-selection.proportionSnap
```

Default:

```text
nearest
```

Available values:

| Value     | Meaning                                                           |
| --------- | ----------------------------------------------------------------- |
| `nearest` | Snap to the nearest grapheme boundary; ties snap after.           |
| `before`  | Snap to the nearest boundary at or before the requested position. |
| `after`   | Snap to the nearest boundary at or after the requested position.  |

Both settings are resource-scoped.

## Keyboard Shortcut

| Platform        | Shortcut               |
| --------------- | ---------------------- |
| Windows / Linux | `Ctrl+[` then `Ctrl+]` |
| macOS           | `Cmd+[` then `Cmd+]`   |

The shortcut is active when a text editor has focus.

## Other Ways to Run the Command

The command is also available from:

- **Command Palette** -> `Advanced Line Range Selection: Select Line Range`
- **Editor context menu** -> `Select Line Range`

The editor context-menu entry is placed in the selection group.

## Requirements

- Visual Studio Code `1.68.0` or later.

The extension has no external runtime dependencies.

## Development

Install development dependencies:

```sh
npm install
```

Package the extension:

```sh
npm run package
```

Publish the current version:

```sh
npm run publish
```

The package manifest also provides semantic-version publishing scripts:

```sh
npm run publish:patch
npm run publish:minor
npm run publish:major
```

Publishing requires the normal Visual Studio Marketplace publisher credentials and `vsce` authentication.

## Repository

- [GitHub repository](https://github.com/orfadida2000/advanced-line-range-selection)
- [Issues](https://github.com/orfadida2000/advanced-line-range-selection/issues)

## License

This project is licensed under the MIT License.<br>
See **[LICENSE](LICENSE)** for details.

## Author

- **Name:** Or Fadida
- **Email:** [or@fadida.net](mailto:or@fadida.net)
- **GitHub:** [orfadida2000](https://github.com/orfadida2000)
- **Marketplace:** [orfadida](https://marketplace.visualstudio.com/publishers/orfadida)
