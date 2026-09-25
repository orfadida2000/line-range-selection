# Changelog

All notable changes to **Line Range Selection** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

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
