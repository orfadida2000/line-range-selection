const vscode = require("vscode");

const COMMAND_NAME = "line-range-selection.selectLineRange";

// --- STRICT REGEXES (For final parsing) ---
const nonZeroPattern = "-?0*[1-9][0-9]*";
const lineSpecifierPattern = `(${nonZeroPattern})(?::(${nonZeroPattern}))?`;
const lineRangeRegex = new RegExp(`^${lineSpecifierPattern}(?:\\s+${lineSpecifierPattern})?$`);

// Used in live validation to check if a single component is fully valid
const strictNonZeroRegex = new RegExp(`^${nonZeroPattern}$`);

// --- PERMISSIVE REGEXES (For live typing state analysis) ---
const permissiveNonZeroPattern = "-?[0-9]*";
const permissiveLineSpecifierPattern = `(${permissiveNonZeroPattern})(:(${permissiveNonZeroPattern}))?`;
// Note: We use \s* so trailing/leading spaces don't break the permissive groups as they type
const permissiveLineRangeRegex = new RegExp(
  `^${permissiveLineSpecifierPattern}(?:\\s+${permissiveLineSpecifierPattern})?$`,
);

/**
 * Parses a single component (line or column) and returns an object indicating validity and the parsed value.
 * @param {string} text - The text to parse.
 * @returns {{ valid: boolean, value: number }} - An object with 'valid' indicating if the component is valid, and 'value' being the parsed integer (0 if invalid).
 */
const parseNonZeroComponent = (text) => {
  if (!strictNonZeroRegex.test(text)) {
    return {
      valid: false,
      value: 0,
    };
  }
  return {
    valid: true,
    value: parseInt(text, 10),
  };
};

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  const disposable = vscode.commands.registerTextEditorCommand(
    COMMAND_NAME,
    async (/** @type {vscode.TextEditor} */ editor) => {
      // 1. Show Input Box
      let input = await vscode.window.showInputBox({
        prompt:
          "Enter a line specifier (<start specifier>) or line range specifier (<start specifier> <end specifier>), each line specifier has a line number and an optional column number ('<line>:<column>' format).\n" +
          "Negative numbers are allowed, and will be counted from the end of the document/line respectively. Out of bounds numbers will be clamped to the document/line bounds.",
        placeHolder: "e.g. `13`, `13:2 20`, `13 -1:6`, `13:5`",
        title: "Enter Line Range",
        validateInput: (/** @type {string} */ text) => {
          text = text.trim();

          // Allow empty input (treated as cancel)
          if (text === "") {
            return null;
          }

          const match = text.match(permissiveLineRangeRegex);

          if (!match) {
            return {
              message: "Invalid characters. Use numbers, colons, spaces, and minus signs.",
              severity: vscode.InputBoxValidationSeverity.Error,
            };
          }

          // 1. Extract strings
          const startLine = match[1] || "";
          const startColWithColon = match[2] || "";
          const startCol = match[3] || "";
          const endLine = match[4] || "";
          const endColWithColon = match[5] || "";
          const endCol = match[6] || "";

          // 2. Evaluate validity exactly ONCE per component
          const startLineData = parseNonZeroComponent(startLine);
          const startColData = parseNonZeroComponent(startCol);
          const endLineData = parseNonZeroComponent(endLine);
          const endColData = parseNonZeroComponent(endCol);

          // 3. Evaluate the combined validity of each specifier
          const startSpecifierValid =
            startLineData.valid && (startColWithColon === "" || startColData.valid);
          const endSpecifierValid =
            endLineData.valid && (endColWithColon === "" || endColData.valid);

          const hasStartedEndSpecifier = endLine !== "" || endColWithColon !== "";

          // --- 4. ERROR STATES ---
          if (startColWithColon !== "" && !startLineData.valid) {
            return {
              message: "Finish a valid start line before adding a column.",
              severity: vscode.InputBoxValidationSeverity.Error,
            };
          }

          if (hasStartedEndSpecifier && !startSpecifierValid) {
            return {
              message: "Finish a valid start specifier before adding the end specifier.",
              severity: vscode.InputBoxValidationSeverity.Error,
            };
          }

          if (endColWithColon !== "" && !endLineData.valid) {
            return {
              message: "Finish a valid end line before adding a column.",
              severity: vscode.InputBoxValidationSeverity.Error,
            };
          }

          // --- 5. TRANSITIONAL OR FULLY VALID STATES ---
          const isFullyValid =
            startSpecifierValid && (!hasStartedEndSpecifier || endSpecifierValid);

          if (!isFullyValid) {
            return {
              message: "Keep typing...",
              severity: vscode.InputBoxValidationSeverity.Info,
            };
          }

          const sC = startColData.valid ? ` col ${startColData.value}` : "";
          const eC = endColData.valid ? ` col ${endColData.value}` : "";

          let msg = hasStartedEndSpecifier
            ? `Will select from line ${startLineData.value}${sC} to line ${endLineData.value}${eC}`
            : `Will select from line ${startLineData.value}${sC} to the end of the document`;
          msg += " (values are pre negative normalization and clipping).";

          return {
            message: msg,
            severity: vscode.InputBoxValidationSeverity.Info,
          };
        },
      });

      if (!input) {
        return; // User canceled the input box or provided empty input
      }

      input = input.trim();

      // 2. Parse Logic
      const match = input.match(lineRangeRegex);

      // Sanity check: This should never happen due to the validation above, but we check just in case.
      if (!match) {
        return;
      }

      // Parse the line specifiers (0 means not given)
      const startLine = parseInt(match[1], 10);
      const startColumn = match[2] ? parseInt(match[2], 10) : 0;
      const endLine = match[3] ? parseInt(match[3], 10) : 0;
      const endColumn = match[4] ? parseInt(match[4], 10) : 0;

      const document = editor.document;
      const lineCount = document.lineCount;

      // Helper to normalize and clip lines (1-based human input -> 0-based API index)
      const normalizeAndClipLine = (num) => {
        let index = num < 0 ? lineCount + num : num - 1;
        if (index < 0) index = 0;
        if (index >= lineCount) index = lineCount - 1;
        return index;
      };

      // Helper to normalize and clip columns (1-based human input -> 0-based API index)
      const normalizeAndClipCol = (num, lineLength) => {
        let index = num < 0 ? lineLength + 1 + num : num - 1;
        if (index < 0) index = 0;
        if (index > lineLength) index = lineLength;
        return index;
      };

      // 3. Resolve Start Specifier
      let startLineIndex = normalizeAndClipLine(startLine);
      let startColIndex = 0; // Defaults to col 1 (index 0)

      if (startColumn !== 0) {
        const startLineLength = document.lineAt(startLineIndex).text.length;
        startColIndex = normalizeAndClipCol(startColumn, startLineLength);
      }
      const startPos = new vscode.Position(startLineIndex, startColIndex);

      // 4. Resolve End Specifier
      let endLineIndex = lineCount - 1; // Default to last line if not provided
      let endColIndex;

      if (endLine !== 0) {
        endLineIndex = normalizeAndClipLine(endLine);
      }

      const endLineLength = document.lineAt(endLineIndex).text.length;

      // When endLine is not provided (i.e., endLine === 0), endColumn is by regex definition also not provided (i.e., endColIndex will be endLineLength).
      if (endColumn === 0) {
        // End col not provided: defaults to the last col in the normalized clipped end line
        endColIndex = endLineLength;
      } else {
        endColIndex = normalizeAndClipCol(endColumn, endLineLength);
      }
      const endPos = new vscode.Position(endLineIndex, endColIndex);

      // 5. Check if nothing to select
      if (startPos.isEqual(endPos)) {
        return; // Do nothing
      }

      // 6. Apply Selection & Cursor Position
      // The VS Code Selection constructor takes (anchor, active).
      // "anchor" is where the selection starts, "active" is where the blinking cursor ends up.
      const selection = new vscode.Selection(startPos, endPos);

      editor.selection = selection;

      // Scroll the viewport to ensure the cursor (the active position) is visible
      editor.revealRange(selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    },
  );

  context.subscriptions.push(disposable);
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
