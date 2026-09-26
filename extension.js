const vscode = require("vscode");

const COMMAND_NAME = "precise-line-range-selection.selectLineRange";

/**
 * Supported interpretations of the optional secondary coordinate.
 *
 * CHARACTER:
 *   The coordinate is a 1-based Unicode code-point character number.
 *   Explicit character endpoints are inclusive.
 *
 * COLUMN:
 *   The coordinate is a 1-based logical text position between Unicode
 *   code points. Column 1 is the beginning of the line, and each Unicode
 *   code point advances the column by one.
 */
const CoordinateMode = Object.freeze({
  CHARACTER: "character",
  COLUMN: "column",
});

/*
 * Semantic boundary targets used only after selection direction is known.
 *
 * An explicit secondary coordinate remains a positive resolved integer.
 * An omitted or unusable coordinate is initially represented by null and is
 * converted to LINE_START or LINE_END only after direction has been determined.
 */
const CoordinateTarget = Object.freeze({
  LINE_START: "LINE_START",
  LINE_END: "LINE_END",
});

// --- STRICT REGEXES (final acceptance/parsing) ---

const nonZeroPattern = "[+-]?0*[1-9][0-9]*";
const lineSpecifierPattern = `(${nonZeroPattern})(?::(${nonZeroPattern}))?`;
const lineRangeRegex = new RegExp(`^${lineSpecifierPattern}(?:\\s+${lineSpecifierPattern})?$`);

const strictNonZeroRegex = new RegExp(`^${nonZeroPattern}$`);

// --- PERMISSIVE REGEXES (live typing-state analysis) ---

const permissiveNonZeroPattern = "[+-]?[0-9]*";
const permissiveLineSpecifierPattern = `(${permissiveNonZeroPattern})(:(${permissiveNonZeroPattern}))?`;
const permissiveLineRangeRegex = new RegExp(
  `^${permissiveLineSpecifierPattern}(?:\\s+${permissiveLineSpecifierPattern})?$`,
);

/**
 * Parse one numeric component after strict syntactic validation.
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
 * Line numbers are always 1-based. The optional secondary coordinate is either
 * a 1-based Unicode code-point character number or a 1-based logical column
 * position, depending on the configured coordinate mode.
 *
 * @param {string} text
 * @param {(typeof CoordinateMode)[keyof typeof CoordinateMode]} coordinateMode
 * @returns {vscode.InputBoxValidationMessage | undefined}
 */
const getValidationMessage = (text, coordinateMode) => {
  text = text.trim();

  if (text === "") {
    return undefined;
  }

  const match = text.match(permissiveLineRangeRegex);

  if (!match) {
    return {
      message:
        `Invalid format. Use '<line>[:<${coordinateMode}>] ` +
        `[<line>[:<${coordinateMode}>]]' with non-zero integers.`,
      severity: vscode.InputBoxValidationSeverity.Error,
    };
  }

  const startLine = match[1] || "";
  const startCoordinateWithColon = match[2] || "";
  const startCoordinate = match[3] || "";
  const endLine = match[4] || "";
  const endCoordinateWithColon = match[5] || "";
  const endCoordinate = match[6] || "";

  const startLineData = parseNonZeroComponent(startLine);
  const startCoordinateData = parseNonZeroComponent(startCoordinate);
  const endLineData = parseNonZeroComponent(endLine);
  const endCoordinateData = parseNonZeroComponent(endCoordinate);

  const startSpecifierValid =
    startLineData.valid && (startCoordinateWithColon === "" || startCoordinateData.valid);

  const endSpecifierValid =
    endLineData.valid && (endCoordinateWithColon === "" || endCoordinateData.valid);

  const hasStartedEndSpecifier = endLine !== "" || endCoordinateWithColon !== "";

  if (startCoordinateWithColon !== "" && !startLineData.valid) {
    return {
      message: `Finish a valid start line before adding a ${coordinateMode} number.`,
      severity: vscode.InputBoxValidationSeverity.Error,
    };
  }

  if (hasStartedEndSpecifier && !startSpecifierValid) {
    return {
      message: "Finish a valid start specifier before adding the end specifier.",
      severity: vscode.InputBoxValidationSeverity.Error,
    };
  }

  if (endCoordinateWithColon !== "" && !endLineData.valid) {
    return {
      message: `Finish a valid end line before adding a ${coordinateMode} number.`,
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

  const startCoordinateDescription = startCoordinateData.valid
    ? ` ${coordinateMode} ${startCoordinateData.value}`
    : "";

  const endCoordinateDescription = endCoordinateData.valid
    ? ` ${coordinateMode} ${endCoordinateData.value}`
    : "";

  let message;

  if (hasStartedEndSpecifier) {
    message =
      `Will select from line ${startLineData.value}${startCoordinateDescription} ` +
      `to line ${endLineData.value}${endCoordinateDescription}`;
  } else {
    message =
      `Will select from line ${startLineData.value}${startCoordinateDescription} ` +
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
 * @param {(typeof CoordinateMode)[keyof typeof CoordinateMode]} coordinateMode
 * @returns {Promise<string | undefined>}
 */
const showLineRangeInputBox = (coordinateMode) =>
  new Promise((resolve) => {
    const inputBox = vscode.window.createInputBox();

    const coordinateSemantics =
      coordinateMode === CoordinateMode.CHARACTER
        ? "Character numbers are 1-based Unicode code-point numbers, and explicit character endpoints are inclusive. "
        : "Column numbers are 1-based logical text positions between Unicode code points; column 1 is the beginning of the line. ";

    inputBox.title = "Select Line Range";
    inputBox.prompt =
      `Enter '<line>[:<${coordinateMode}>] ` +
      `[<line>[:<${coordinateMode}>]]'. ` +
      "Line numbers are 1-based. " +
      coordinateSemantics +
      "Negative values count from the end of the document or line. " +
      "An omitted end specifier means the end of the document, " +
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
        inputBox.validationMessage = getValidationMessage(value, coordinateMode);
      }),
    );

    disposables.push(
      inputBox.onDidAccept(() => {
        const value = inputBox.value.trim();

        if (value === "") {
          inputBox.hide();
          return;
        }

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
 * Segments strings into user-perceived characters (Unicode grapheme clusters).
 *
 * Grapheme segmentation keeps sequences such as a base character followed by
 * combining marks, surrogate-pair characters, and multi-code-point emoji
 * sequences together as a single character.
 */
const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: "grapheme",
});

/**
 * Analyzes a document line using Unicode grapheme clusters as characters.
 *
 * The returned boundary offsets map user-facing character boundaries to the
 * UTF-16 offsets required by the VS Code API. Index 0 represents the beginning
 * of the line, and each subsequent index represents the position immediately
 * after the corresponding character.
 *
 * For example, for the decomposed text "éX", where "é" consists of "e"
 * followed by a combining acute accent, the result contains:
 *
 *   characterCount = 2
 *   utf16Length = 3
 *   characterBoundaryOffsets = [0, 2, 3]
 *
 * @param {vscode.TextDocument} document The document containing the line.
 * @param {number} lineNumber The 1-based line number to analyze.
 * @returns {{
 *   lineNumber: number,
 *   characterCount: number,
 *   utf16Length: number,
 *   characterBoundaryOffsets: number[],
 * }} Analysis of the line and its UTF-16 character-boundary offsets.
 */
const analyzeLine = (document, lineNumber) => {
  const text = document.lineAt(lineNumber - 1).text;

  const characterBoundaryOffsets = [0];
  let utf16Offset = 0;

  for (const { segment } of graphemeSegmenter.segment(text)) {
    utf16Offset += segment.length;
    characterBoundaryOffsets.push(utf16Offset);
  }

  return {
    lineNumber,
    characterCount: characterBoundaryOffsets.length - 1,
    utf16Length: text.length,
    characterBoundaryOffsets,
  };
};

/**
 * Resolve an explicitly supplied signed secondary coordinate.
 *
 * Character mode:
 *   valid coordinates are 1..characterCount.
 *   An empty line has no valid character coordinate and therefore resolves
 *   an explicit value to null.
 *
 * Column mode:
 *   valid coordinates are 1..characterCount + 1.
 *   Even an empty line therefore has one valid column: column 1.
 *
 * Negative normalization and clipping occur entirely in the corresponding
 * user-facing coordinate domain.
 *
 * @param {number | null} coordinateNumber
 * @param {{ characterCount: number }} lineAnalysis
 * @param {(typeof CoordinateMode)[keyof typeof CoordinateMode]} coordinateMode
 * @returns {number | null}
 */
const resolveExplicitCoordinate = (coordinateNumber, lineAnalysis, coordinateMode) => {
  if (coordinateNumber === null) {
    return null;
  }

  const maximumCoordinate =
    coordinateMode === CoordinateMode.CHARACTER
      ? lineAnalysis.characterCount
      : lineAnalysis.characterCount + 1;

  if (maximumCoordinate === 0) {
    return null;
  }

  let resolvedCoordinateNumber =
    coordinateNumber < 0 ? maximumCoordinate + 1 + coordinateNumber : coordinateNumber;

  if (resolvedCoordinateNumber < 1) {
    resolvedCoordinateNumber = 1;
  } else if (resolvedCoordinateNumber > maximumCoordinate) {
    resolvedCoordinateNumber = maximumCoordinate;
  }

  return resolvedCoordinateNumber;
};

/**
 * Determine selection direction after lines and all usable explicit secondary
 * coordinates have been resolved.
 *
 * Different resolved line numbers determine direction directly.
 *
 * On the same resolved line, the explicit secondary coordinates determine
 * direction only when both are available. Equality is considered forward.
 *
 * In character mode, equal coordinates later produce a one-character
 * selection. In column mode, equal coordinates later produce equal VS Code
 * positions and therefore a no-op.
 *
 * If either coordinate target is null on the same line, the selection is
 * defined as forward.
 *
 * @param {number} startLineNumber
 * @param {number} endLineNumber
 * @param {number | null} startCoordinateTarget
 * @param {number | null} endCoordinateTarget
 * @returns {boolean}
 */
const isForwardSelection = (
  startLineNumber,
  endLineNumber,
  startCoordinateTarget,
  endCoordinateTarget,
) => {
  if (startLineNumber < endLineNumber) {
    return true;
  }

  if (startLineNumber > endLineNumber) {
    return false;
  }

  if (startCoordinateTarget !== null && endCoordinateTarget !== null) {
    return startCoordinateTarget <= endCoordinateTarget;
  }

  return true;
};

/**
 * Get the UTF-16 position immediately before a valid resolved character.
 *
 * @param {{ characterBoundaryOffsets: number[] }} lineAnalysis
 * @param {number} characterNumber - Valid 1-based character number.
 * @returns {number}
 */
const getPositionBeforeCharacter = (lineAnalysis, characterNumber) =>
  lineAnalysis.characterBoundaryOffsets[characterNumber - 1];

/**
 * Get the UTF-16 position immediately after a valid resolved character.
 *
 * @param {{ characterBoundaryOffsets: number[] }} lineAnalysis
 * @param {number} characterNumber - Valid 1-based character number.
 * @returns {number}
 */
const getPositionAfterCharacter = (lineAnalysis, characterNumber) =>
  lineAnalysis.characterBoundaryOffsets[characterNumber];

/**
 * Get the UTF-16 position represented by a valid 1-based logical column.
 *
 * Column 1 is the line-start boundary. Any later column n is the position
 * immediately after Unicode code-point character n - 1.
 *
 * @param {{ characterBoundaryOffsets: number[] }} lineAnalysis
 * @param {number} columnNumber - Valid 1-based logical column number.
 * @returns {number}
 */
const getPositionAtColumn = (lineAnalysis, columnNumber) => {
  if (columnNumber === 1) {
    return 0;
  }

  return getPositionAfterCharacter(lineAnalysis, columnNumber - 1);
};

/**
 * Convert one fully resolved semantic coordinate target into the UTF-16
 * character offset expected by vscode.Position.
 *
 * LINE_START and LINE_END map directly to physical line boundaries in both
 * modes.
 *
 * Character mode uses inclusive explicit character endpoints:
 *
 * Forward:
 *   start -> before(start character)
 *   end   -> after(end character)
 *
 * Backward:
 *   start -> after(start character)
 *   end   -> before(end character)
 *
 * Column mode already specifies a text boundary directly, so selection
 * direction and endpoint role do not affect conversion.
 *
 * @param {{
 *   utf16Length: number,
 *   characterBoundaryOffsets: number[]
 * }} lineAnalysis
 * @param {number | (typeof CoordinateTarget)[keyof typeof CoordinateTarget]} coordinateTarget
 * @param {boolean} isStart
 * @param {boolean} forwardSelection
 * @param {(typeof CoordinateMode)[keyof typeof CoordinateMode]} coordinateMode
 * @returns {number}
 */
const coordinateTargetToPosition = (
  lineAnalysis,
  coordinateTarget,
  isStart,
  forwardSelection,
  coordinateMode,
) => {
  if (coordinateTarget === CoordinateTarget.LINE_START) {
    return 0;
  }

  if (coordinateTarget === CoordinateTarget.LINE_END) {
    return lineAnalysis.utf16Length;
  }

  if (coordinateMode === CoordinateMode.COLUMN) {
    return getPositionAtColumn(lineAnalysis, coordinateTarget);
  }

  if (isStart) {
    return forwardSelection
      ? getPositionBeforeCharacter(lineAnalysis, coordinateTarget)
      : getPositionAfterCharacter(lineAnalysis, coordinateTarget);
  }

  return forwardSelection
    ? getPositionAfterCharacter(lineAnalysis, coordinateTarget)
    : getPositionBeforeCharacter(lineAnalysis, coordinateTarget);
};

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  const disposable = vscode.commands.registerTextEditorCommand(
    COMMAND_NAME,
    async (/** @type {vscode.TextEditor} */ editor) => {
      const configuredCoordinateMode = vscode.workspace
        .getConfiguration("precise-line-range-selection", editor.document.uri)
        .get("coordinateMode", CoordinateMode.CHARACTER);

      const coordinateMode =
        configuredCoordinateMode === CoordinateMode.COLUMN
          ? CoordinateMode.COLUMN
          : CoordinateMode.CHARACTER;

      const input = await showLineRangeInputBox(coordinateMode);

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
       * omitted line or secondary-coordinate component.
       */
      const startLineInput = parseInt(match[1], 10);
      const startCoordinateInput = match[2] !== undefined ? parseInt(match[2], 10) : null;
      const endLineInput = match[3] !== undefined ? parseInt(match[3], 10) : null;
      const endCoordinateInput = match[4] !== undefined ? parseInt(match[4], 10) : null;

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
      // explicitly supplied secondary coordinates.
      // ---------------------------------------------------------------------

      const startLineAnalysis = analyzeLine(document, startLineNumber);

      const endLineAnalysis =
        endLineNumber === startLineNumber
          ? startLineAnalysis
          : analyzeLine(document, endLineNumber);

      let startCoordinateTarget = resolveExplicitCoordinate(
        startCoordinateInput,
        startLineAnalysis,
        coordinateMode,
      );

      let endCoordinateTarget = resolveExplicitCoordinate(
        endCoordinateInput,
        endLineAnalysis,
        coordinateMode,
      );

      // ---------------------------------------------------------------------
      // Stage 3: Determine direction, then resolve remaining null coordinate
      // targets to semantic line boundaries.
      // ---------------------------------------------------------------------

      const forwardSelection = isForwardSelection(
        startLineNumber,
        endLineNumber,
        startCoordinateTarget,
        endCoordinateTarget,
      );

      if (startCoordinateTarget === null) {
        startCoordinateTarget = forwardSelection
          ? CoordinateTarget.LINE_START
          : CoordinateTarget.LINE_END;
      }

      if (endCoordinateTarget === null) {
        endCoordinateTarget = forwardSelection
          ? CoordinateTarget.LINE_END
          : CoordinateTarget.LINE_START;
      }

      // ---------------------------------------------------------------------
      // Stage 4: Translate semantic endpoints into VS Code positions.
      // ---------------------------------------------------------------------

      const startCharacterPosition = coordinateTargetToPosition(
        startLineAnalysis,
        startCoordinateTarget,
        true,
        forwardSelection,
        coordinateMode,
      );

      const endCharacterPosition = coordinateTargetToPosition(
        endLineAnalysis,
        endCoordinateTarget,
        false,
        forwardSelection,
        coordinateMode,
      );

      const startPos = new vscode.Position(startLineNumber - 1, startCharacterPosition);

      const endPos = new vscode.Position(endLineNumber - 1, endCharacterPosition);

      // If both semantic endpoints resolve to the same physical VS Code
      // position, there is no text to select. Test the final positions directly
      // because that is the invariant that matters in both coordinate modes.
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
