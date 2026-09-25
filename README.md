# Line Range Selection

**Line Range Selection** is a focused Visual Studio Code extension for selecting an exact text range by entering human-readable line and character coordinates.

The extension provides one command, **Select Line Range**, with support for:

- 1-based line numbers;
- optional 1-based character numbers;
- negative indexing from the end of the document or line;
- inclusive explicit character endpoints;
- forward and backward selections;
- automatic clipping of out-of-bounds coordinates;
- Unicode-aware character numbering by code point;
- live input guidance with strict acceptance;
- Command Palette, editor context-menu, and keyboard access.

## Command

| Command | ID |
| --- | --- |
| **Select Line Range** | `line-range-selection.selectLineRange` |

The command is available when a text editor has focus.

## Usage

Run **Line Range Selection: Select Line Range** and enter either a start specifier or a start/end pair.

The syntax is:

```text
<start-line>[:<start-character>] [<end-line>[:<end-character>]]
```

The two specifiers are separated by whitespace.

The minus sign is used only for negative indexing; it is **not** a range delimiter.

### Basic examples

| Input | Meaning |
| --- | --- |
| `13` | Select from the beginning of line 13 to the end of the document. |
| `13:5` | Select from character 5 of line 13 through the end of the document. |
| `13 20` | Select from the beginning of line 13 through the end of line 20. |
| `13:2 20:8` | Select from character 2 of line 13 through character 8 of line 20, inclusive. |
| `20 13` | Select the same full-line range as `13 20`, but backward. |
| `20:8 13:2` | Select the same explicit character range as `13:2 20:8`, but backward. |
| `2:3 2:3` | Select exactly character 3 on line 2. |

When the end specifier is omitted entirely, the end coordinate resolves to the end of the document.

## Coordinate Semantics

### Line numbers

Line numbers are 1-based:

```text
1
2
3
...
```

Negative line numbers count backward from the end of the document:

```text
-1  = last line
-2  = second-to-last line
...
```

Line `0` is invalid.

After negative indexing is resolved, out-of-bounds line numbers are clipped to the document:

- values before the first line become line `1`;
- values after the last line become the last line.

A VS Code text document always has at least one line, even when the document is completely empty.

### Character numbers

Character numbers are also 1-based:

```text
1
2
3
...
```

An explicit character number identifies an actual character on the resolved line.

Negative character numbers count backward from the end of that line:

```text
-1  = last character
-2  = second-to-last character
...
```

Character `0` is invalid.

After negative indexing is resolved, an explicit character number is clipped to the valid character range of the line.

### Unicode character counting

Character numbers count **Unicode code points**, not UTF-16 code units.

For example:

```text
A😀B
```

contains three character numbers:

```text
1 = A
2 = 😀
3 = B
```

Although `😀` occupies two UTF-16 code units internally, it is one Unicode code point and therefore one character number in this extension.

This is distinct from Unicode grapheme clusters. A visual symbol composed from multiple Unicode code points is counted as multiple character numbers.

Internally, the extension translates these user-facing code-point character numbers into the UTF-16 offsets required by the VS Code `Position` API.

## Inclusive Character Endpoints

Explicit character endpoints are inclusive.

For a line containing:

```text
ABCDEF
```

this input:

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

Internally, a forward selection starts immediately before the start character and ends immediately after the end character. A backward selection uses the opposite boundaries so the same characters remain selected while the anchor/active direction is reversed.

If both explicit coordinates are identical:

```text
2:3 2:3
```

the selection is treated as forward and selects exactly character 3, leaving the active cursor after that character.

## Omitted Character Numbers

An omitted character number represents a line boundary, but the boundary is resolved only after the selection direction is known.

For a forward selection:

- omitted start character → beginning of the start line;
- omitted end character → end of the end line.

For a backward selection:

- omitted start character → end of the start line;
- omitted end character → beginning of the end line.

This makes line-only ranges symmetric:

```text
13 20
```

and:

```text
20 13
```

select the same text with opposite selection directions.

When both resolved line numbers are the same and at least one character number is omitted, the selection is treated as forward. Therefore, for a line containing `ABCDEF`:

```text
2 2:3
```

selects `ABC`, while:

```text
2:3 2
```

selects `CDEF`.

## Empty Lines

An empty line has no valid character number, but it still has one valid text boundary: the beginning and end of the line are both VS Code character position `0`.

If an explicit character number resolves to an empty line, there is no actual character to target. The extension therefore defers that endpoint and resolves it to the appropriate line boundary after selection direction is known.

If both final VS Code positions are identical—for example, when both endpoints resolve to the same empty line—the command performs no selection change.

A completely empty document is handled naturally by the same rule.

## Negative Indexing and Clipping

Negative indexing is resolved before clipping.

For a line with three Unicode code-point characters:

```text
A😀B
```

the character inputs resolve as follows:

| Input | Resolved character |
| ---: | --- |
| `-1` | `3` (`B`) |
| `-2` | `2` (`😀`) |
| `-3` | `1` (`A`) |
| `-999` | clipped to `1` |
| `999` | clipped to `3` |

Line numbers follow the same normalization-and-clipping principle using the document's line count.

## Selection Direction

Direction is determined from the fully resolved coordinates.

The rules are:

1. If the resolved start line is before the resolved end line, the selection is forward.
2. If the resolved start line is after the resolved end line, the selection is backward.
3. If both resolved lines are the same and both resolved character numbers are available:
   - start character <= end character → forward;
   - start character > end character → backward.
4. If both resolved lines are the same and at least one character target is unavailable or omitted, the selection is forward.

The first resolved endpoint becomes the VS Code selection anchor. The second becomes the active endpoint, so reversing a range also reverses the final cursor position.

## Input Validation

The command uses a managed VS Code input box with two layers of validation.

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

Pressing Enter only accepts the value when it matches the complete input grammar.

This means an informational transitional state can remain visually non-blocking without accidentally closing the input box and executing an incomplete command.

Leading and trailing whitespace are ignored.

Leading zeros are accepted for non-zero numeric components and are parsed as ordinary decimal integers:

```text
005
005:003 010:007
-005
```

Explicit zero and negative zero are invalid:

```text
0
-0
```

## Keyboard Shortcut

| Platform | Shortcut |
| --- | --- |
| Windows / Linux | `Ctrl+[` then `Ctrl+]` |
| macOS | `Cmd+[` then `Cmd+]` |

The shortcut is active when a text editor has focus.

## Other Ways to Run the Command

The command is also available from:

- **Command Palette** → `Line Range Selection: Select Line Range`
- **Editor context menu** → `Select Line Range`

The editor context-menu entry is placed in the selection group.

## Requirements

- Visual Studio Code `1.68.0` or later.

The extension has no runtime settings and no external runtime dependencies.

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

Source code:

https://github.com/orfadida2000/line-range-selection

Issues:

https://github.com/orfadida2000/line-range-selection/issues

## License

This project is licensed under the MIT License.
