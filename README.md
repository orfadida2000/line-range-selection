# Precise Line Range Selection

Select text ranges in Visual Studio Code by entering line numbers with optional secondary coordinates.

The extension supports:

- 1-based line numbers
- Negative indexing from the end
- Automatic clipping of out-of-range values
- Forward and backward selections
- Unicode-aware coordinates
- Two configurable coordinate modes:
  - **Character mode** — inclusive user-perceived character numbers
  - **Column mode** — logical text positions between user-perceived characters
- Selection to the end of the document when the end specifier is omitted

## Installation

### Visual Studio Code

Install **Precise Line Range Selection** from the Visual Studio Code Extensions view:

1. Open the Extensions view.
2. Search for **Precise Line Range Selection**.
3. Select the extension published by **Or Fadida**.
4. Click **Install**.

### Command Line

You can also install the extension using the VS Code CLI:

```text
code --install-extension orfadida.precise-line-range-selection
```

To uninstall it:

```text
code --uninstall-extension orfadida.precise-line-range-selection
```

## Usage

Run:

**Precise Line Range Selection: Select Line Range**

from the Command Palette or editor context menu, or use the default keybinding:

| Platform        | Keybinding      |
| --------------- | --------------- |
| Windows / Linux | `Ctrl+[ Ctrl+]` |
| macOS           | `Cmd+[ Cmd+]`   |

Enter a range using:

```text
<line>[:<coordinate>] [<line>[:<coordinate>]]
```

The two line specifiers are separated by whitespace.

Examples:

```text
13
13:5
13 20
13:5 20:8
20:8 13:5
-1
-5:2 -1:4
```

A hyphen is used only as the sign of a negative number. It is not a range separator.

## Line Numbers

Line numbers are always 1-based.

For example:

```text
1
```

refers to the first line.

Negative line numbers count backward from the end of the document:

```text
-1
```

refers to the last line,

```text
-2
```

to the second-to-last line, and so on.

After negative indexing is resolved, out-of-range line numbers are clipped to the document.

For example, a value before the first line resolves to line 1, while a value beyond the last line resolves to the last line.

## Coordinate Modes

The optional secondary coordinate is controlled by:

```json
"precise-line-range-selection.coordinateMode": "character"
```

Supported values are:

```text
character
column
```

The default is:

```text
character
```

Both modes operate on Unicode **grapheme clusters**, which correspond to user-perceived characters rather than UTF-16 code units or individual Unicode code points.

For example, the line:

```text
A😀B
```

contains three user-perceived characters:

```text
1: A
2: 😀
3: B
```

Likewise, a combining sequence such as:

```text
é
```

where the displayed character may internally consist of `e` followed by a combining acute accent, is treated as one character.

Multi-code-point emoji sequences are also treated as a single character when Unicode grapheme segmentation defines them as one grapheme cluster.

### Character Mode

Configure:

```json
"precise-line-range-selection.coordinateMode": "character"
```

The secondary coordinate is a **1-based user-perceived character number**.

Characters are determined using Unicode grapheme-cluster boundaries.

Explicit character endpoints are inclusive.

For:

```text
ABCDEF
```

the characters are:

```text
1: A
2: B
3: C
4: D
5: E
6: F
```

For example:

```text
2:1 2:3
```

selects characters 1 through 3 on line 2:

```text
ABC
```

Likewise:

```text
2:3 2:1
```

selects the same text backward.

If both explicit endpoints refer to the same character:

```text
2:3 2:3
```

that character is selected.

For a line such as:

```text
éX
```

the displayed `é` is treated as character 1 and `X` as character 2, even if `é` is internally represented by multiple Unicode code points.

### Column Mode

Configure:

```json
"precise-line-range-selection.coordinateMode": "column"
```

The secondary coordinate is a **1-based logical text position between user-perceived characters**.

Column 1 is the beginning of the line. Every Unicode grapheme cluster advances the logical column by exactly one.

For:

```text
ABC
```

the logical columns are:

```text
Column 1: before A
Column 2: after A / before B
Column 3: after B / before C
Column 4: after C
```

For:

```text
A😀B
```

the logical columns are:

```text
Column 1: before A
Column 2: after A / before 😀
Column 3: after 😀 / before B
Column 4: after B
```

Likewise, for:

```text
éX
```

the logical columns are:

```text
Column 1: before é
Column 2: after é / before X
Column 3: after X
```

A user-perceived character therefore advances the logical column by one regardless of how many Unicode code points or UTF-16 code units are required to represent it internally.

Tabs behave the same way: a literal tab advances the logical column by one. This mode does **not** use VS Code's visual/status-bar column calculation and is independent of `tabSize`.

If both explicit endpoints specify the same column:

```text
2:3 2:3
```

both endpoints identify the same text position, so there is nothing to select and the command performs no selection.

An empty line has one valid logical column:

```text
Column 1
```

which is both the beginning and end of that line.

## Negative Coordinates

Negative secondary coordinates count backward from the end of the relevant coordinate domain.

In character mode, a line containing `N` user-perceived characters has valid character numbers:

```text
1 .. N
```

so:

```text
-1
```

means the last character.

In column mode, the same line has valid logical columns:

```text
1 .. N + 1
```

so:

```text
-1
```

means the final position after the last character.

After negative indexing is resolved, coordinates outside the valid range are clipped.

## Omitted Coordinates

An omitted secondary coordinate refers to the appropriate line boundary based on selection direction.

For a forward selection:

- an omitted start coordinate means the beginning of the start line;
- an omitted end coordinate means the end of the end line.

For a backward selection:

- an omitted start coordinate means the end of the start line;
- an omitted end coordinate means the beginning of the end line.

For example:

```text
5 10
```

selects forward from the beginning of line 5 through the end of line 10.

Likewise:

```text
10 5
```

selects backward from the end of line 10 to the beginning of line 5.

## Omitted End Specifier

If the entire end specifier is omitted, the selection extends to the end of the document.

For example:

```text
13
```

selects from the beginning of line 13 through the end of the document.

In character mode:

```text
13:5
```

selects from character 5 on line 13, including that character, through the end of the document.

In column mode:

```text
13:5
```

selects from logical column 5 on line 13 through the end of the document.

## Selection Direction

Direction is determined after line numbers and usable explicit coordinates have been normalized and clipped.

If the resolved start line is before the resolved end line, the selection is forward.

If the resolved start line is after the resolved end line, the selection is backward.

If both endpoints are on the same resolved line and both explicit coordinates are available:

- start coordinate less than or equal to end coordinate → forward;
- start coordinate greater than end coordinate → backward.

If either coordinate is omitted or otherwise unavailable on the same line, the selection defaults to forward.

The original direction is preserved in the resulting VS Code selection, including which endpoint is the active cursor position.

## Empty Lines

Character mode has no actual character number on an empty line.

If an explicit character number resolves to an empty line, it is treated as having no usable character target. The final endpoint is then resolved to the appropriate line boundary after selection direction is known.

Column mode has exactly one valid coordinate on an empty line:

```text
Column 1
```

Both the beginning and end of an empty line map to the same physical VS Code position.

If both final endpoints resolve to the same position, the command performs no selection.

## Input Validation

The input must contain one or two line specifiers:

```text
<line>[:<coordinate>] [<line>[:<coordinate>]]
```

Each numeric component must be a non-zero signed integer.

Valid examples include:

```text
1
+1
001
+01
-1
-001
15:3
15:-2
```

Zero is not valid:

```text
0
+0
-0
15:0
```

Leading zeros are allowed and are normalized numerically.

The input box performs live validation while typing and only accepts a complete value that matches the range grammar.

## Configuration

### `precise-line-range-selection.coordinateMode`

Controls how the optional secondary coordinate is interpreted.

Type:

```text
string
```

Default:

```text
character
```

Allowed values:

| Value       | Meaning                                                                    |
| ----------- | -------------------------------------------------------------------------- |
| `character` | 1-based user-perceived character numbers with inclusive explicit endpoints |
| `column`    | 1-based logical text positions between user-perceived characters           |

Example:

```json
{
  "precise-line-range-selection.coordinateMode": "column"
}
```

## Unicode and VS Code Positions

VS Code's `Position.character` value is a UTF-16 code-unit offset.

The extension does not expose those raw offsets to the user.

Instead, it analyzes the relevant lines using Unicode grapheme clusters and translates the configured user-facing coordinate semantics into the UTF-16 offsets required by the VS Code API.

This keeps coordinates aligned with user-perceived character boundaries, including combining sequences, surrogate-pair characters such as many emoji, and multi-code-point grapheme clusters.

## Requirements

Visual Studio Code:

```text
1.68.0 or newer
```

## Development

Install dependencies:

```text
npm install
```

Package the extension:

```text
npm run package
```

Other versioned publishing scripts are available through `package.json`.

## License

This project is licensed under the MIT License.
