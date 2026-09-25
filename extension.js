const vscode = require("vscode");

const COMMAND_NAME = "line-range-selection.selectLineRange";

/*
 * Semantic boundary targets used only after selection direction is known.
 *
 * Explicit character specifiers remain positive 1-based Unicode code-point
 * numbers. An omitted or unusable character specifier is initially represented
 * by null and is converted to LINE_START or LINE_END only after direction has
 * been determined.
 */
const CharacterTarget = Object.freeze({
  LINE_START: "LINE_START",
  LINE_END: "LINE_END",
});

// --- STRICT REGEXES (final acceptance/parsing) ---

const nonZeroPattern = "-?0*[1-9][0-9]*";
const lineSpecifierPattern = `(${nonZeroPattern})(?::(${nonZeroPattern}))?`;
const lineRangeRegex = new RegExp(`^${lineSpecifierPattern}(?:\\s+${lineSpecifierPattern})?$`);

const strictNonZeroRegex = new RegExp(`^${nonZeroPattern}$`);

// --- PERMISSIVE REGEXES (live typing-state analysis) ---

const permissiveNonZeroPattern = "-?[0-9]*";
const permissiveLineSpecifierPattern = `(${permissiveNonZeroPattern})(:(${permissiveNonZeroPattern}))?`;
const permissiveLineRangeRegex = new RegExp(
  `^${permissiveLineSpecifierPattern}(?:\\s+${permissiveLineSpecifierPattern})?$`,
);

/**
 * Parse one line/character component after strict syntactic validation.
 *
 * @param {string} text
 * @returns {{ valid: boolean, value: number }}
 */
const parseNonZeroComponent = (text) => {
  if (!strictNonZeroRegex.test(text)) {
    return { valid: false, value: 0 };
  }

  return { valid: true, value: parseInt(text, 10) };
};

/**
 * Build the live validation message for the input box.
 *
 * Character numbers in the UI are 1-based Unicode code-point numbers.
 * Negative line numbers count from the end of the document; negative character
 * numbers count from the end of the corresponding line.
 *
 * @param {string} text
 * @returns {vscode.InputBoxValidationMessage | undefined}
 */
const getValidationMessage = (text) => {
  text = text.trim();

  if (text === "") {
    return undefined;
  }

  const match = text.match(permissiveLineRangeRegex);

  if (!match) {
    return {
      message:
        "Invalid format. Use '<line>[:<character>] [<line>[:<character>]]' with non-zero integers.",
      severity: vscode.InputBoxValidationSeverity.Error,
    };
  }

  const startLine = match[1] || "";
  const startCharacterWithColon = match[2] || "";
  const startCharacter = match[3] || "";
  const endLine = match[4] || "";
  const endCharacterWithColon = match[5] || "";
  const endCharacter = match[6] || "";

  const startLineData = parseNonZeroComponent(startLine);
  const startCharacterData = parseNonZeroComponent(startCharacter);
  const endLineData = parseNonZeroComponent(endLine);
  const endCharacterData = parseNonZeroComponent(endCharacter);

  const startSpecifierValid =
    startLineData.valid && (startCharacterWithColon === "" || startCharacterData.valid);

  const endSpecifierValid =
    endLineData.valid && (endCharacterWithColon === "" || endCharacterData.valid);

  const hasStartedEndSpecifier = endLine !== "" || endCharacterWithColon !== "";

  // Error states that are already structurally invalid, rather than merely
  // incomplete.
  if (startCharacterWithColon !== "" && !startLineData.valid) {
    return {
      message: "Finish a valid start line before adding a character number.",
      severity: vscode.InputBoxValidationSeverity.Error,
    };
  }

  if (hasStartedEndSpecifier && !startSpecifierValid) {
    return {
      message: "Finish a valid start specifier before adding the end specifier.",
      severity: vscode.InputBoxValidationSeverity.Error,
    };
  }

  if (endCharacterWithColon !== "" && !endLineData.valid) {
    return {
      message: "Finish a valid end line before adding a character number.",
      severity: vscode.InputBoxValidationSeverity.Error,
    };
  }

  const isFullyValid = startSpecifierValid && (!hasStartedEndSpecifier || endSpecifierValid);

  if (!isFullyValid) {
    return {
      message: "Keep typing...",
      severity: vscode.InputBoxValidationSeverity.Info,
    };
  }

  const startCharacterDescription = startCharacterData.valid
    ? ` character ${startCharacterData.value}`
    : "";

  const endCharacterDescription = endCharacterData.valid
    ? ` character ${endCharacterData.value}`
    : "";

  let message;

  if (hasStartedEndSpecifier) {
    message =
      `Will select from line ${startLineData.value}${startCharacterDescription} ` +
      `to line ${endLineData.value}${endCharacterDescription}`;
  } else {
    message =
      `Will select from line ${startLineData.value}${startCharacterDescription} ` +
      "to the end of the document";
  }

  message += " (values are before negative-index normalization and clipping).";

  return {
    message,
    severity: vscode.InputBoxValidationSeverity.Info,
  };
};

/**
 * Show the managed input box used by the command.
 *
 * Unlike vscode.window.showInputBox(), this explicitly controls acceptance.
 * Informational validation states therefore remain non-blocking visually while
 * Enter is accepted only when the complete value matches the strict grammar.
 *
 * @returns {Promise<string | undefined>}
 */
const showLineRangeInputBox = () =>
  new Promise((resolve) => {
    const inputBox = vscode.window.createInputBox();

    inputBox.title = "Select Line Range";
    inputBox.prompt =
      "Enter '<line>[:<character>] [<line>[:<character>]]'. " +
      "Line and character numbers are 1-based; character numbers count Unicode code points. " +
      "Negative values count from the end of the document or line. " +
      "Explicit character endpoints are inclusive, an omitted end specifier means the end of the document, " +
      "and out-of-bounds values are clipped.";

    inputBox.placeholder = "e.g. 13, 13:2 20, 13 -1:6, 13:5";

    /** @type {string | undefined} */
    let acceptedValue;

    let settled = false;

    /** @type {vscode.Disposable[]} */
    const disposables = [];

    const finish = () => {
      if (settled) {
        return;
      }

      settled = true;

      for (const disposable of disposables) {
        disposable.dispose();
      }

      inputBox.dispose();
      resolve(acceptedValue);
    };

    disposables.push(
      inputBox.onDidChangeValue((value) => {
        inputBox.validationMessage = getValidationMessage(value);
      }),
    );

    disposables.push(
      inputBox.onDidAccept(() => {
        const value = inputBox.value.trim();

        // Preserve the no-op behavior for empty input.
        if (value === "") {
          inputBox.hide();
          return;
        }

        // Info/Warning messages do not inherently prevent acceptance in the
        // Quick Input API, so enforce the strict grammar explicitly.
        if (!lineRangeRegex.test(value)) {
          return;
        }

        acceptedValue = value;
        inputBox.hide();
      }),
    );

    disposables.push(inputBox.onDidHide(finish));

    inputBox.show();
  });

/**
 * Normalize a signed 1-based line number and clip it to the document.
 *
 * @param {number} lineNumber
 * @param {number} lineCount
 * @returns {number} A valid 1-based line number.
 */
const normalizeAndClipLineNumber = (lineNumber, lineCount) => {
  let resolvedLineNumber = lineNumber < 0 ? lineCount + 1 + lineNumber : lineNumber;

  if (resolvedLineNumber < 1) {
    resolvedLineNumber = 1;
  } else if (resolvedLineNumber > lineCount) {
    resolvedLineNumber = lineCount;
  }

  return resolvedLineNumber;
};

/**
 * Analyze one resolved document line.
 *
 * User-facing character numbers count Unicode code points. VS Code
 * Position.character values, however, are UTF-16 code-unit offsets.
 *
 * afterOffsets is indexed by the 1-based user character number:
 *
 *   afterOffsets[n] = UTF-16 offset immediately after character n
 *
 * afterOffsets[0] is the line-start boundary (offset 0), which also means the
 * UTF-16 offset immediately before character 1.
 *
 * JavaScript's string iterator advances by Unicode code point, while each
 * yielded string has a UTF-16 length of either 1 or 2 code units. Accumulating
 * those lengths constructs the translation between the two coordinate systems.
 *
 * @param {vscode.TextDocument} document
 * @param {number} lineNumber - Resolved 1-based line number.
 * @returns {{
 *   lineNumber: number,
 *   characterCount: number,
 *   utf16Length: number,
 *   afterOffsets: number[]
 * }}
 */
const analyzeLine = (document, lineNumber) => {
  const text = document.lineAt(lineNumber - 1).text;

  const afterOffsets = [0];
  let utf16Offset = 0;

  for (const character of text) {
    utf16Offset += character.length;
    afterOffsets.push(utf16Offset);
  }

  return {
    lineNumber,
    characterCount: afterOffsets.length - 1,
    utf16Length: text.length,
    afterOffsets,
  };
};

/**
 * Resolve an explicitly supplied signed character number.
 *
 * Negative normalization and clipping occur in the user-facing character
 * domain, using the line's Unicode code-point count rather than its UTF-16
 * length.
 *
 * If the line is empty, no real character number exists, so null is returned.
 * null is intentionally deferred until selection direction is known; it will
 * later become LINE_START or LINE_END.
 *
 * @param {number | null} characterNumber
 * @param {{ characterCount: number }} lineAnalysis
 * @returns {number | null}
 */
const resolveExplicitCharacterNumber = (characterNumber, lineAnalysis) => {
  if (characterNumber === null) {
    return null;
  }

  const { characterCount } = lineAnalysis;

  if (characterCount === 0) {
    return null;
  }

  let resolvedCharacterNumber =
    characterNumber < 0 ? characterCount + 1 + characterNumber : characterNumber;

  if (resolvedCharacterNumber < 1) {
    resolvedCharacterNumber = 1;
  } else if (resolvedCharacterNumber > characterCount) {
    resolvedCharacterNumber = characterCount;
  }

  return resolvedCharacterNumber;
};

/**
 * Determine selection direction after lines and all usable explicit character
 * numbers have been resolved.
 *
 * Different resolved line numbers determine direction directly.
 *
 * On the same resolved line, character numbers determine direction only when
 * both are real resolved character numbers. Equality is forward, so selecting
 * n -> n selects exactly character n and leaves the active cursor after it.
 *
 * If either character target is null on the same line (because it was omitted,
 * or because an explicitly supplied character resolved against an empty line),
 * the selection is defined as forward.
 *
 * @param {number} startLineNumber
 * @param {number} endLineNumber
 * @param {number | null} startCharacterTarget
 * @param {number | null} endCharacterTarget
 * @returns {boolean}
 */
const isForwardSelection = (
  startLineNumber,
  endLineNumber,
  startCharacterTarget,
  endCharacterTarget,
) => {
  if (startLineNumber < endLineNumber) {
    return true;
  }

  if (startLineNumber > endLineNumber) {
    return false;
  }

  if (startCharacterTarget !== null && endCharacterTarget !== null) {
    return startCharacterTarget <= endCharacterTarget;
  }

  return true;
};

/**
 * Get the UTF-16 position immediately before a valid resolved character.
 *
 * @param {{ afterOffsets: number[] }} lineAnalysis
 * @param {number} characterNumber - Valid 1-based character number.
 * @returns {number}
 */
const getPositionBeforeCharacter = (lineAnalysis, characterNumber) =>
  lineAnalysis.afterOffsets[characterNumber - 1];

/**
 * Get the UTF-16 position immediately after a valid resolved character.
 *
 * @param {{ afterOffsets: number[] }} lineAnalysis
 * @param {number} characterNumber - Valid 1-based character number.
 * @returns {number}
 */
const getPositionAfterCharacter = (lineAnalysis, characterNumber) =>
  lineAnalysis.afterOffsets[characterNumber];

/**
 * Convert one fully resolved semantic character target into the UTF-16
 * character offset expected by vscode.Position.
 *
 * LINE_START and LINE_END map directly to line boundaries.
 *
 * Explicit character endpoints are inclusive:
 *
 * Forward selection:
 *   start -> before(start character)
 *   end   -> after(end character)
 *
 * Backward selection:
 *   start -> after(start character)
 *   end   -> before(end character)
 *
 * @param {{
 *   utf16Length: number,
 *   afterOffsets: number[]
 * }} lineAnalysis
 * @param {number | string} characterTarget
 * @param {boolean} isStart
 * @param {boolean} forwardSelection
 * @returns {number}
 */
const characterTargetToPosition = (lineAnalysis, characterTarget, isStart, forwardSelection) => {
  if (characterTarget === CharacterTarget.LINE_START) {
    return 0;
  }

  if (characterTarget === CharacterTarget.LINE_END) {
    return lineAnalysis.utf16Length;
  }

  if (isStart) {
    return forwardSelection
      ? getPositionBeforeCharacter(lineAnalysis, characterTarget)
      : getPositionAfterCharacter(lineAnalysis, characterTarget);
  }

  return forwardSelection
    ? getPositionAfterCharacter(lineAnalysis, characterTarget)
    : getPositionBeforeCharacter(lineAnalysis, characterTarget);
};

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  const disposable = vscode.commands.registerTextEditorCommand(
    COMMAND_NAME,
    async (/** @type {vscode.TextEditor} */ editor) => {
      const input = await showLineRangeInputBox();

      if (input === undefined) {
        return;
      }

      const match = input.match(lineRangeRegex);

      // Defensive invariant: accepted input should always satisfy the strict
      // grammar because showLineRangeInputBox() checks it before hiding.
      if (!match) {
        return;
      }

      /*
       * Raw parsed values.
       *
       * Explicit zero is impossible by grammar, so null can safely represent an
       * omitted line/character component.
       */
      const startLineInput = parseInt(match[1], 10);
      const startCharacterInput = match[2] !== undefined ? parseInt(match[2], 10) : null;
      const endLineInput = match[3] !== undefined ? parseInt(match[3], 10) : null;
      const endCharacterInput = match[4] !== undefined ? parseInt(match[4], 10) : null;

      const document = editor.document;
      const lineCount = document.lineCount;

      // ---------------------------------------------------------------------
      // Stage 1: Resolve start/end line numbers.
      // ---------------------------------------------------------------------

      const startLineNumber = normalizeAndClipLineNumber(startLineInput, lineCount);

      const endLineNumber =
        endLineInput === null ? lineCount : normalizeAndClipLineNumber(endLineInput, lineCount);

      // ---------------------------------------------------------------------
      // Stage 2: Analyze the resolved boundary lines and resolve only
      // explicitly supplied character numbers.
      // ---------------------------------------------------------------------

      const startLineAnalysis = analyzeLine(document, startLineNumber);

      const endLineAnalysis =
        endLineNumber === startLineNumber
          ? startLineAnalysis
          : analyzeLine(document, endLineNumber);

      let startCharacterTarget = resolveExplicitCharacterNumber(
        startCharacterInput,
        startLineAnalysis,
      );

      let endCharacterTarget = resolveExplicitCharacterNumber(endCharacterInput, endLineAnalysis);

      // ---------------------------------------------------------------------
      // Stage 3: Determine direction, then resolve remaining null character
      // targets to semantic line boundaries.
      // ---------------------------------------------------------------------

      const forwardSelection = isForwardSelection(
        startLineNumber,
        endLineNumber,
        startCharacterTarget,
        endCharacterTarget,
      );

      if (startCharacterTarget === null) {
        startCharacterTarget = forwardSelection
          ? CharacterTarget.LINE_START
          : CharacterTarget.LINE_END;
      }

      if (endCharacterTarget === null) {
        endCharacterTarget = forwardSelection
          ? CharacterTarget.LINE_END
          : CharacterTarget.LINE_START;
      }

      // ---------------------------------------------------------------------
      // Stage 4: Translate semantic endpoints into VS Code positions.
      // ---------------------------------------------------------------------

      const startCharacterPosition = characterTargetToPosition(
        startLineAnalysis,
        startCharacterTarget,
        true,
        forwardSelection,
      );

      const endCharacterPosition = characterTargetToPosition(
        endLineAnalysis,
        endCharacterTarget,
        false,
        forwardSelection,
      );

      const startPos = new vscode.Position(startLineNumber - 1, startCharacterPosition);

      const endPos = new vscode.Position(endLineNumber - 1, endCharacterPosition);

      // Under the current semantics this normally occurs only when both
      // endpoints resolve to the same empty line. Test the actual VS Code
      // positions directly because that is the invariant that matters.
      if (startPos.isEqual(endPos)) {
        return;
      }

      const selection = new vscode.Selection(startPos, endPos);

      editor.selection = selection;

      // Keep the active end of the selection visible.
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
