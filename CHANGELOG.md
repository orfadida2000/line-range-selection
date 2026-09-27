# Changelog

All notable changes to **Advanced Line Range Selection** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [1.1.0]

### Added

- Added proportional line positions using `<line>.<proportion>` syntax, independent of the configured integer coordinate mode.
- Added `advanced-line-range-selection.proportionSnap` with `nearest`, `before`, and `after` snapping modes for proportional positions.
- Proportional positions use accumulated logical line width and snap to Unicode grapheme boundaries, with tabs advancing to the next editor tab stop.
- Added non-interactive command invocation: `advanced-line-range-selection.selectLineRange` now accepts an optional range string argument, allowing programmatic use without opening the input box.

### Changed

- Renamed the extension from **Precise Line Range Selection** to **Advanced Line Range Selection**.
- Changed the extension package identifier from `precise-line-range-selection` to `advanced-line-range-selection`.
- Changed the command identifier from `precise-line-range-selection.selectLineRange` to `advanced-line-range-selection.selectLineRange`.
- Changed the configuration setting from `precise-line-range-selection.coordinateMode` to `advanced-line-range-selection.coordinateMode`.
- Refactored endpoint resolution around Unicode grapheme boundaries so character, column, and proportional positions share a common boundary representation.

## [1.0.0]

### Changed

- Renamed the extension from **Line Range Selection** to **Precise Line Range Selection**.
- Changed the extension package identifier from `line-range-selection` to `precise-line-range-selection`.
- Changed the command identifier from `line-range-selection.selectLineRange` to `precise-line-range-selection.selectLineRange`.
- Changed the configuration setting from `line-range-selection.coordinateMode` to `precise-line-range-selection.coordinateMode`.
- Character and column coordinates now use Unicode grapheme clusters instead of individual Unicode code points, so combining sequences and multi-code-point emoji are treated as single user-perceived characters.

## [0.0.2]

### Added

- Configurable coordinate semantics through the `line-range-selection.coordinateMode` setting.
- New `column` coordinate mode, where secondary coordinates represent 1-based logical text positions between Unicode code points.
- Unicode-aware logical column translation that preserves whole Unicode code points, including surrogate-pair characters such as emoji.
- Logical column support for empty lines, where column 1 represents the single line boundary.

### Changed

- The existing character-based behavior is now the `character` coordinate mode and remains the default.
- Input-box terminology, syntax guidance, and validation messages now reflect the configured coordinate mode.
- Secondary-coordinate resolution is now shared between character and column modes.
- Line analysis is reused by both coordinate modes for translation to the UTF-16 offsets required by the VS Code API.
- Explicit column coordinates map directly to logical text boundaries, while explicit character coordinates retain inclusive endpoint semantics.

## [0.0.1]

### Added

- Initial release of the **Select Line Range** command (`line-range-selection.selectLineRange`).
- 1-based line-number input with optional 1-based character specifiers.
- Unicode code-point character numbering, with translation to the UTF-16 offsets required by the VS Code API.
- Inclusive explicit character endpoints.
- Forward and backward range selection with preserved anchor/active direction.
- Negative line indexing relative to the end of the document.
- Negative character indexing relative to the Unicode code-point count of the resolved line.
- Automatic clipping of out-of-bounds line and character numbers.
- Semantic beginning-of-line and end-of-line handling for omitted character specifiers.
- Graceful handling of empty lines and completely empty documents.
- Omitted end-specifier behavior that selects through the end of the document.
- Managed input-box validation with informational guidance for incomplete input and strict acceptance of complete input only.
- Support for leading zeros on non-zero numeric components.
- Command Palette integration.
- Editor context-menu integration.
- Default keyboard chord:
  - Windows/Linux: `Ctrl+[` then `Ctrl+]`
  - macOS: `Cmd+[` then `Cmd+]`
