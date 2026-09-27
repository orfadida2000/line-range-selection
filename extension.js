const vscode = require("vscode");

const COMMAND_NAME = "advanced-line-range-selection.selectLineRange";

const PROPORTION_EPSILON = 1e-12;

/**
 * Supported interpretations of an explicit integer secondary coordinate.
 *
 * CHARACTER:
 *   The coordinate is a 1-based user-perceived character number.
 *   Characters are Unicode grapheme clusters, and explicit character
 *   endpoints are inclusive.
 *
 * COLUMN:
 *   The coordinate is a 1-based text position between Unicode grapheme
 *   clusters. Column 1 is the beginning of the line.
 *
 * Proportional coordinates use separate ".<digits>" syntax and are independent
 * of this setting.
 */
const CoordinateMode = Object.freeze({
  CHARACTER: "character",
  COLUMN: "column",
});

/**
 * Supported snapping behaviors for proportional coordinates.
 *
 * NEAREST:
 *   Choose the grapheme boundary nearest to the requested proportion.
 *   An effective tie resolves to the boundary after the requested position.
 *
 * BEFORE:
 *   Choose the nearest grapheme boundary at or before the requested proportion.
 *
 * AFTER:
 *   Choose the nearest grapheme boundary at or after the requested proportion.
 */
const ProportionSnap = Object.freeze({
  NEAREST: "nearest",
  BEFORE: "before",
  AFTER: "after",
});

/**
 * Kinds of explicit secondary input accepted by a line specifier.
 */
const SecondaryInputKind = Object.freeze({
  COORDINATE: "coordinate",
  PROPORTION: "proportion",
});

/**
 * Internal target kinds used before final conversion to a grapheme boundary.
 *
 * CHARACTER:
 *   Identifies a 1-based grapheme character number. Its final boundary depends
 *   on selection direction and whether it is the start or end endpoint.
 *
 * BOUNDARY:
 *   Identifies a 0-based grapheme boundary index directly.
 */
const TargetKind = Object.freeze({
  CHARACTER: "character",
  BOUNDARY: "boundary",
});

// --- STRICT REGEXES (final acceptance/parsing) ---

const nonZeroPattern = "[+-]?0*[1-9][0-9]*";

/*
 * A specifier is one of:
 *
 *   <line>
 *   <line>:<coordinate>
 *   <line>.<proportion-digits>
 *
 * For proportional syntax:
 *
 *   5.     -> proportion 1
 *   5.0    -> proportion 0
 *   5.25   -> proportion 0.25
 *
 * The digits following "." therefore represent the fractional digits directly.
 */
const lineSpecifierPattern = `(${nonZeroPattern})(?::(${nonZeroPattern})|\\.([0-9]*))?`;

const lineRangeRegex = new RegExp(`^${lineSpecifierPattern}(?:\\s+${lineSpecifierPattern})?$`);

const strictNonZeroRegex = new RegExp(`^${nonZeroPattern}$`);

// --- PERMISSIVE REGEXES (live typing-state analysis) ---

const permissiveNonZeroPattern = "[+-]?[0-9]*";

const permissiveLineSpecifierPattern =
  `(${permissiveNonZeroPattern})` + `(?:(:(${permissiveNonZeroPattern}))|(\\.([0-9]*)))?`;

const permissiveLineRangeRegex = new RegExp(
  `^${permissiveLineSpecifierPattern}` + `(?:\\s+${permissiveLineSpecifierPattern})?$`,
);

/**
 * Parse one non-zero signed integer component after permissive matching.
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
 * Convert the digits following proportional "." syntax to a proportion.
 *
 * An empty digit sequence is the explicit proportion 1.
 * Otherwise the digits are interpreted as the fractional part of 0.<digits>.
 *
 * @param {string} digits
 * @returns {number}
 */
const parseProportionDigits = (digits) => {
  if (digits === "") {
    return 1;
  }

  return Number(`0.${digits}`);
};

/**
 * Parse a complete accepted line-range input.
 *
 * Each specifier contains a required signed non-zero line number and optionally
 * either:
 *
 * - an integer coordinate introduced by ":";
 * - a proportion introduced by ".".
 *
 * @param {string} text
 * @returns {{
 *   startSpecifier: {
 *     lineNumber: number,
 *     secondaryInput:
 *       | null
 *       | { kind: string, value: number },
 *   },
 *   endSpecifier:
 *     | null
 *     | {
 *         lineNumber: number,
 *         secondaryInput:
 *           | null
 *           | { kind: string, value: number },
 *       },
 * } | null}
 */
const parseLineRangeInput = (text) => {
  const match = text.trim().match(lineRangeRegex);

  if (!match) {
    return null;
  }

  /**
   * @param {string} lineText
   * @param {string | undefined} coordinateText
   * @param {string | undefined} proportionDigits
   */
  const buildSpecifier = (lineText, coordinateText, proportionDigits) => {
    let secondaryInput = null;

    if (coordinateText !== undefined) {
      secondaryInput = {
        kind: SecondaryInputKind.COORDINATE,
        value: parseInt(coordinateText, 10),
      };
    } else if (proportionDigits !== undefined) {
      secondaryInput = {
        kind: SecondaryInputKind.PROPORTION,
        value: parseProportionDigits(proportionDigits),
      };
    }

    return {
      lineNumber: parseInt(lineText, 10),
      secondaryInput,
    };
  };

  const startSpecifier = buildSpecifier(match[1], match[2], match[3]);

  const endSpecifier = match[4] === undefined ? null : buildSpecifier(match[4], match[5], match[6]);

  return {
    startSpecifier,
    endSpecifier,
  };
};

/**
 * Build a human-readable description of one optional secondary input while
 * performing live input validation.
 *
 * @param {string} coordinateWithColon
 * @param {{ valid: boolean, value: number }} coordinateData
 * @param {string} proportionWithDot
 * @param {string} proportionDigits
 * @param {(typeof CoordinateMode)[keyof typeof CoordinateMode]} coordinateMode
 * @returns {string}
 */
const getSecondaryInputDescription = (
  coordinateWithColon,
  coordinateData,
  proportionWithDot,
  proportionDigits,
  coordinateMode,
) => {
  if (coordinateWithColon !== "" && coordinateData.valid) {
    return ` ${coordinateMode} ${coordinateData.value}`;
  }

  if (proportionWithDot !== "") {
    return ` proportion ${parseProportionDigits(proportionDigits)}`;
  }

  return "";
};

/**
 * Build the live validation message for the input box.
 *
 * Integer secondary coordinates use ":" and follow the configured coordinate
 * mode. Proportional secondary coordinates use "." and are independent of the
 * coordinate mode.
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
        `Invalid format. Use '<line>', '<line>:<${coordinateMode}>', or ` +
        `'<line>.<proportion-digits>' for one or two specifiers. ` +
        `Lines and ':' ${coordinateMode} numbers must be non-zero signed integers; ` +
        "a bare '.' means proportion 1.",
      severity: vscode.InputBoxValidationSeverity.Error,
    };
  }

  const startLine = match[1] || "";
  const startCoordinateWithColon = match[2] || "";
  const startCoordinate = match[3] || "";
  const startProportionWithDot = match[4] || "";
  const startProportionDigits = match[5] ?? "";

  const endLine = match[6] || "";
  const endCoordinateWithColon = match[7] || "";
  const endCoordinate = match[8] || "";
  const endProportionWithDot = match[9] || "";
  const endProportionDigits = match[10] ?? "";

  const startLineData = parseNonZeroComponent(startLine);
  const startCoordinateData = parseNonZeroComponent(startCoordinate);

  const endLineData = parseNonZeroComponent(endLine);
  const endCoordinateData = parseNonZeroComponent(endCoordinate);

  const startSpecifierValid =
    startLineData.valid && (startCoordinateWithColon === "" || startCoordinateData.valid);

  const endSpecifierValid =
    endLineData.valid && (endCoordinateWithColon === "" || endCoordinateData.valid);

  const hasStartedEndSpecifier =
    endLine !== "" || endCoordinateWithColon !== "" || endProportionWithDot !== "";

  if ((startCoordinateWithColon !== "" || startProportionWithDot !== "") && !startLineData.valid) {
    return {
      message:
        startCoordinateWithColon !== ""
          ? `Finish a valid start line before adding a ${coordinateMode} number.`
          : "Finish a valid start line before adding a proportion.",
      severity: vscode.InputBoxValidationSeverity.Error,
    };
  }

  if (hasStartedEndSpecifier && !startSpecifierValid) {
    return {
      message: "Finish a valid start specifier before adding the end specifier.",
      severity: vscode.InputBoxValidationSeverity.Error,
    };
  }

  if ((endCoordinateWithColon !== "" || endProportionWithDot !== "") && !endLineData.valid) {
    return {
      message:
        endCoordinateWithColon !== ""
          ? `Finish a valid end line before adding a ${coordinateMode} number.`
          : "Finish a valid end line before adding a proportion.",
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

  const startSecondaryDescription = getSecondaryInputDescription(
    startCoordinateWithColon,
    startCoordinateData,
    startProportionWithDot,
    startProportionDigits,
    coordinateMode,
  );

  const endSecondaryDescription = getSecondaryInputDescription(
    endCoordinateWithColon,
    endCoordinateData,
    endProportionWithDot,
    endProportionDigits,
    coordinateMode,
  );

  let message;

  if (hasStartedEndSpecifier) {
    message =
      `Will select from line ${startLineData.value}` +
      `${startSecondaryDescription} ` +
      `to line ${endLineData.value}${endSecondaryDescription}`;
  } else {
    message =
      `Will select from line ${startLineData.value}` +
      `${startSecondaryDescription} to the end of the document`;
  }

  message +=
    ` (line and ${coordinateMode} numbers are shown before ` +
    "negative-index normalization and clipping).";

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
 * @param {(typeof ProportionSnap)[keyof typeof ProportionSnap]} proportionSnap
 * @returns {Promise<string | undefined>}
 */
const showLineRangeInputBox = (coordinateMode, proportionSnap) =>
  new Promise((resolve) => {
    const inputBox = vscode.window.createInputBox();

    const coordinateSemantics =
      coordinateMode === CoordinateMode.CHARACTER
        ? "':' character numbers are 1-based user-perceived character numbers, " +
          "and explicit character endpoints are inclusive. "
        : "':' column numbers are 1-based text positions between " +
          "user-perceived characters; column 1 is the beginning of the line. ";

    const proportionSnapSemantics =
      proportionSnap === ProportionSnap.BEFORE
        ? "Proportions snap to the nearest grapheme boundary at or before " +
          "the requested position. "
        : proportionSnap === ProportionSnap.AFTER
          ? "Proportions snap to the nearest grapheme boundary at or after " +
            "the requested position. "
          : "Proportions snap to the nearest grapheme boundary; ties snap after. ";

    inputBox.title = "Select Line Range";

    inputBox.prompt =
      `Enter one or two specifiers using '<line>', ` +
      `'<line>:<${coordinateMode}>', or '<line>.<proportion-digits>'. ` +
      "Line numbers are 1-based. " +
      coordinateSemantics +
      "For proportional syntax, '.25' means proportion 0.25, '.0' means " +
      "the beginning of the line, and a bare '.' means proportion 1. " +
      proportionSnapSemantics +
      `Negative line and ${coordinateMode} numbers count from the end. ` +
      "An omitted end specifier means the end of the document, and " +
      `out-of-bounds line and ${coordinateMode} numbers are clipped.`;

    inputBox.placeholder = "e.g. 13, 13:2 20, 13.25 20.75, 13. -1:6";

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

        if (parseLineRangeInput(value) === null) {
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
 * Return the effective positive integer tab size for the active editor.
 *
 * TextEditor.options reflects the editor's effective tab-size choice, including
 * file-specific indentation detection when applicable.
 *
 * @param {vscode.TextEditor} editor
 * @returns {number}
 */
const getEffectiveTabSize = (editor) => {
  const tabSize = Number(editor.options.tabSize);

  if (Number.isInteger(tabSize) && tabSize > 0) {
    return tabSize;
  }

  return 4;
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
 * Analyze one document line in terms of grapheme boundaries.
 *
 * Both returned arrays use the same 0-based grapheme boundary index:
 *
 *   0 .. graphemeCount
 *
 * boundaryVscodePositions[k]:
 *   The numeric value to use as vscode.Position.character for boundary k.
 *
 * boundaryLogicalWidths[k]:
 *   The accumulated logical display width from the beginning of the line to
 *   boundary k.
 *
 * Each non-tab grapheme contributes logical width 1. A tab advances to the
 * next tab stop according to tabSize.
 *
 * For the decomposed text "éX":
 *
 *   graphemeCount = 2
 *   boundaryVscodePositions = [0, 2, 3]
 *   boundaryLogicalWidths = [0, 1, 2]
 *
 * For "A<TAB>B" with tabSize 4:
 *
 *   graphemeCount = 3
 *   boundaryVscodePositions = [0, 1, 2, 3]
 *   boundaryLogicalWidths = [0, 1, 4, 5]
 *
 * @param {vscode.TextDocument} document
 * @param {number} lineNumber 1-based line number.
 * @param {number} tabSize
 * @returns {{
 *   lineNumber: number,
 *   graphemeCount: number,
 *   boundaryVscodePositions: number[],
 *   boundaryLogicalWidths: number[],
 * }}
 */
const analyzeLine = (document, lineNumber, tabSize) => {
  const text = document.lineAt(lineNumber - 1).text;

  const boundaryVscodePositions = [0];
  const boundaryLogicalWidths = [0];

  let vscodePosition = 0;
  let logicalWidth = 0;

  for (const { segment } of graphemeSegmenter.segment(text)) {
    vscodePosition += segment.length;

    if (segment === "\t") {
      logicalWidth += tabSize - (logicalWidth % tabSize);
    } else {
      logicalWidth += 1;
    }

    boundaryVscodePositions.push(vscodePosition);
    boundaryLogicalWidths.push(logicalWidth);
  }

  return {
    lineNumber,
    graphemeCount: boundaryVscodePositions.length - 1,
    boundaryVscodePositions,
    boundaryLogicalWidths,
  };
};

/**
 * Normalize and clip a signed 1-based integer coordinate.
 *
 * Negative values count backward from maximumCoordinate.
 *
 * @param {number} coordinateNumber
 * @param {number} maximumCoordinate
 * @returns {number}
 */
const normalizeAndClipCoordinate = (coordinateNumber, maximumCoordinate) => {
  let resolvedCoordinate =
    coordinateNumber < 0 ? maximumCoordinate + 1 + coordinateNumber : coordinateNumber;

  if (resolvedCoordinate < 1) {
    resolvedCoordinate = 1;
  } else if (resolvedCoordinate > maximumCoordinate) {
    resolvedCoordinate = maximumCoordinate;
  }

  return resolvedCoordinate;
};

/**
 * Resolve an explicit ":" integer coordinate into an internal target.
 *
 * Character mode:
 *   Valid coordinates are 1..graphemeCount.
 *   An empty line has no valid character target and resolves to null.
 *
 * Column mode:
 *   Valid coordinates are 1..graphemeCount + 1.
 *   Column n resolves directly to boundary index n - 1.
 *
 * @param {number} coordinateNumber
 * @param {{ graphemeCount: number }} lineAnalysis
 * @param {(typeof CoordinateMode)[keyof typeof CoordinateMode]} coordinateMode
 * @returns {{
 *   kind: string,
 *   characterNumber?: number,
 *   boundaryIndex?: number,
 * } | null}
 */
const resolveCoordinateTarget = (coordinateNumber, lineAnalysis, coordinateMode) => {
  const maximumCoordinate =
    coordinateMode === CoordinateMode.CHARACTER
      ? lineAnalysis.graphemeCount
      : lineAnalysis.graphemeCount + 1;

  if (maximumCoordinate === 0) {
    return null;
  }

  const resolvedCoordinate = normalizeAndClipCoordinate(coordinateNumber, maximumCoordinate);

  if (coordinateMode === CoordinateMode.CHARACTER) {
    return {
      kind: TargetKind.CHARACTER,
      characterNumber: resolvedCoordinate,
    };
  }

  return {
    kind: TargetKind.BOUNDARY,
    boundaryIndex: resolvedCoordinate - 1,
  };
};

/**
 * Resolve a proportional coordinate to a grapheme boundary index.
 *
 * The user-facing proportion is in [0, 1]. Internally, it is multiplied by the
 * line's total logical width. Actual selectable boundaries remain represented
 * by exact accumulated integer logical widths.
 *
 * Floating-point tolerance is checked before applying the configured snapping
 * behavior so a mathematically exact boundary is not accidentally skipped.
 *
 * @param {{
 *   graphemeCount: number,
 *   boundaryLogicalWidths: number[],
 * }} lineAnalysis
 * @param {number} proportion
 * @param {(typeof ProportionSnap)[keyof typeof ProportionSnap]} proportionSnap
 * @returns {number} A valid grapheme boundary index.
 */
const resolveProportionBoundaryIndex = (lineAnalysis, proportion, proportionSnap) => {
  const logicalWidths = lineAnalysis.boundaryLogicalWidths;

  const totalLogicalWidth = logicalWidths[lineAnalysis.graphemeCount];

  if (totalLogicalWidth === 0) {
    return 0;
  }

  const targetLogicalWidth = proportion * totalLogicalWidth;

  const widthTolerance = PROPORTION_EPSILON * totalLogicalWidth;

  /*
   * Find the first boundary whose logical width is greater than or equal to
   * the requested target.
   */
  let low = 0;
  let high = logicalWidths.length - 1;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);

    if (logicalWidths[middle] < targetLogicalWidth) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  const afterIndex = low;

  const beforeIndex =
    logicalWidths[afterIndex] > targetLogicalWidth ? Math.max(0, afterIndex - 1) : afterIndex;

  const afterDistance = Math.abs(logicalWidths[afterIndex] - targetLogicalWidth);

  if (afterDistance <= widthTolerance) {
    return afterIndex;
  }

  const beforeDistance = Math.abs(targetLogicalWidth - logicalWidths[beforeIndex]);

  if (beforeDistance <= widthTolerance) {
    return beforeIndex;
  }

  if (proportionSnap === ProportionSnap.BEFORE) {
    return beforeIndex;
  }

  if (proportionSnap === ProportionSnap.AFTER) {
    return afterIndex;
  }

  /*
   * NEAREST is the default. An effective tie deliberately resolves after.
   */
  if (Math.abs(beforeDistance - afterDistance) <= widthTolerance) {
    return afterIndex;
  }

  return beforeDistance < afterDistance ? beforeIndex : afterIndex;
};

/**
 * Resolve one explicit secondary input into an internal target.
 *
 * Integer ":" coordinates are interpreted according to coordinateMode.
 * Proportional "." coordinates always resolve directly to a boundary target.
 *
 * @param {{
 *   kind: string,
 *   value: number,
 * }} secondaryInput
 * @param {{
 *   graphemeCount: number,
 *   boundaryLogicalWidths: number[],
 * }} lineAnalysis
 * @param {(typeof CoordinateMode)[keyof typeof CoordinateMode]} coordinateMode
 * @param {(typeof ProportionSnap)[keyof typeof ProportionSnap]} proportionSnap
 * @returns {{
 *   kind: string,
 *   characterNumber?: number,
 *   boundaryIndex?: number,
 * } | null}
 */
const resolveExplicitTarget = (secondaryInput, lineAnalysis, coordinateMode, proportionSnap) => {
  if (secondaryInput.kind === SecondaryInputKind.PROPORTION) {
    return {
      kind: TargetKind.BOUNDARY,
      boundaryIndex: resolveProportionBoundaryIndex(
        lineAnalysis,
        secondaryInput.value,
        proportionSnap,
      ),
    };
  }

  return resolveCoordinateTarget(secondaryInput.value, lineAnalysis, coordinateMode);
};

/**
 * Return a common ordering value for an explicit target on one line.
 *
 * Grapheme boundaries and grapheme characters interleave as:
 *
 *   B0 < C1 < B1 < C2 < B2 < ...
 *
 * Mapping them to integers gives:
 *
 *   boundary k  -> 2k
 *   character n -> 2n - 1
 *
 * This allows character targets and boundary targets to participate in the
 * same direction comparison before character targets are converted to their
 * final inclusive boundaries.
 *
 * @param {{
 *   kind: string,
 *   characterNumber?: number,
 *   boundaryIndex?: number,
 * }} target
 * @returns {number}
 */
const getTargetOrder = (target) => {
  if (target.kind === TargetKind.BOUNDARY) {
    return target.boundaryIndex * 2;
  }

  return target.characterNumber * 2 - 1;
};

/**
 * Determine selection direction after line numbers and all usable explicit
 * targets have been resolved.
 *
 * Different resolved line numbers determine direction directly.
 *
 * On the same line, explicit targets determine direction only when both are
 * available. Character and boundary targets are compared using their common
 * interleaved ordering.
 *
 * Equality is considered forward.
 *
 * If either target is null on the same line, the selection defaults to
 * forward.
 *
 * @param {number} startLineNumber
 * @param {number} endLineNumber
 * @param {{
 *   kind: string,
 *   characterNumber?: number,
 *   boundaryIndex?: number,
 * } | null} startTarget
 * @param {{
 *   kind: string,
 *   characterNumber?: number,
 *   boundaryIndex?: number,
 * } | null} endTarget
 * @returns {boolean}
 */
const isForwardSelection = (startLineNumber, endLineNumber, startTarget, endTarget) => {
  if (startLineNumber < endLineNumber) {
    return true;
  }

  if (startLineNumber > endLineNumber) {
    return false;
  }

  if (startTarget !== null && endTarget !== null) {
    return getTargetOrder(startTarget) <= getTargetOrder(endTarget);
  }

  return true;
};

/**
 * Resolve one endpoint to a concrete grapheme boundary index.
 *
 * Boundary targets already identify an exact boundary and therefore do not
 * depend on selection direction or endpoint role.
 *
 * Character targets use inclusive endpoint semantics:
 *
 * Forward:
 *   start character n -> boundary n - 1
 *   end character n   -> boundary n
 *
 * Backward:
 *   start character n -> boundary n
 *   end character n   -> boundary n - 1
 *
 * A null target represents an omitted or unusable secondary coordinate:
 *
 * Forward:
 *   start -> line-start boundary 0
 *   end   -> line-end boundary graphemeCount
 *
 * Backward:
 *   start -> line-end boundary graphemeCount
 *   end   -> line-start boundary 0
 *
 * @param {{
 *   graphemeCount: number,
 * }} lineAnalysis
 * @param {{
 *   kind: string,
 *   characterNumber?: number,
 *   boundaryIndex?: number,
 * } | null} target
 * @param {boolean} isStart
 * @param {boolean} forwardSelection
 * @returns {number}
 */
const resolveTargetBoundaryIndex = (lineAnalysis, target, isStart, forwardSelection) => {
  if (target === null) {
    if (isStart) {
      return forwardSelection ? 0 : lineAnalysis.graphemeCount;
    }

    return forwardSelection ? lineAnalysis.graphemeCount : 0;
  }

  if (target.kind === TargetKind.BOUNDARY) {
    return target.boundaryIndex;
  }

  if (isStart) {
    return forwardSelection ? target.characterNumber - 1 : target.characterNumber;
  }

  return forwardSelection ? target.characterNumber : target.characterNumber - 1;
};

/**
 * Translate one valid grapheme boundary index to the numeric
 * vscode.Position.character value for that boundary.
 *
 * The valid boundary-index domain is:
 *
 *   0 .. graphemeCount
 *
 * @param {{
 *   boundaryVscodePositions: number[],
 * }} lineAnalysis
 * @param {number} boundaryIndex
 * @returns {number}
 */
const getVscodePositionIndex = (lineAnalysis, boundaryIndex) =>
  lineAnalysis.boundaryVscodePositions[boundaryIndex];

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  const disposable = vscode.commands.registerCommand(
    COMMAND_NAME,
    async (
      /** @type {string | undefined} */
      rangeInput,
    ) => {
      const editor = vscode.window.activeTextEditor;

      if (editor === undefined) {
        return;
      }

      const configuration = vscode.workspace.getConfiguration(
        "advanced-line-range-selection",
        editor.document.uri,
      );

      const configuredCoordinateMode = configuration.get(
        "coordinateMode",
        CoordinateMode.CHARACTER,
      );

      const coordinateMode =
        configuredCoordinateMode === CoordinateMode.COLUMN
          ? CoordinateMode.COLUMN
          : CoordinateMode.CHARACTER;

      const configuredProportionSnap = configuration.get("proportionSnap", ProportionSnap.NEAREST);

      const proportionSnap =
        configuredProportionSnap === ProportionSnap.BEFORE
          ? ProportionSnap.BEFORE
          : configuredProportionSnap === ProportionSnap.AFTER
            ? ProportionSnap.AFTER
            : ProportionSnap.NEAREST;

      let input;

      if (rangeInput === undefined) {
        input = await showLineRangeInputBox(coordinateMode, proportionSnap);

        if (input === undefined) {
          return;
        }
      } else {
        if (typeof rangeInput !== "string") {
          return;
        }

        input = rangeInput;
      }

      const parsedInput = parseLineRangeInput(input);

      /*
       * Defensive check
       */
      if (parsedInput === null) {
        return;
      }

      const document = editor.document;
      const lineCount = document.lineCount;
      const tabSize = getEffectiveTabSize(editor);

      // -------------------------------------------------------------------
      // Stage 1: Resolve start/end line numbers.
      // -------------------------------------------------------------------

      const startLineNumber = normalizeAndClipLineNumber(
        parsedInput.startSpecifier.lineNumber,
        lineCount,
      );

      const endLineNumber =
        parsedInput.endSpecifier === null
          ? lineCount
          : normalizeAndClipLineNumber(parsedInput.endSpecifier.lineNumber, lineCount);

      // -------------------------------------------------------------------
      // Stage 2: Analyze the resolved endpoint lines.
      // -------------------------------------------------------------------

      const startLineAnalysis = analyzeLine(document, startLineNumber, tabSize);

      const endLineAnalysis =
        endLineNumber === startLineNumber
          ? startLineAnalysis
          : analyzeLine(document, endLineNumber, tabSize);

      // -------------------------------------------------------------------
      // Stage 3: Resolve explicitly supplied secondary inputs to semantic
      // targets. Omitted or unusable targets remain null until direction is
      // known.
      // -------------------------------------------------------------------

      const startTarget =
        parsedInput.startSpecifier.secondaryInput === null
          ? null
          : resolveExplicitTarget(
              parsedInput.startSpecifier.secondaryInput,
              startLineAnalysis,
              coordinateMode,
              proportionSnap,
            );

      const endTarget =
        parsedInput.endSpecifier === null || parsedInput.endSpecifier.secondaryInput === null
          ? null
          : resolveExplicitTarget(
              parsedInput.endSpecifier.secondaryInput,
              endLineAnalysis,
              coordinateMode,
              proportionSnap,
            );

      // -------------------------------------------------------------------
      // Stage 4: Determine direction while character targets and boundary
      // targets still retain their distinct semantics.
      // -------------------------------------------------------------------

      const forwardSelection = isForwardSelection(
        startLineNumber,
        endLineNumber,
        startTarget,
        endTarget,
      );

      // -------------------------------------------------------------------
      // Stage 5: Resolve both endpoints to concrete grapheme boundary
      // indices.
      // -------------------------------------------------------------------

      const startBoundaryIndex = resolveTargetBoundaryIndex(
        startLineAnalysis,
        startTarget,
        true,
        forwardSelection,
      );

      const endBoundaryIndex = resolveTargetBoundaryIndex(
        endLineAnalysis,
        endTarget,
        false,
        forwardSelection,
      );

      // -------------------------------------------------------------------
      // Stage 6: Translate grapheme boundary indices to the UTF-16 numeric
      // positions required by vscode.Position.
      // -------------------------------------------------------------------

      const startCharacterPosition = getVscodePositionIndex(startLineAnalysis, startBoundaryIndex);

      const endCharacterPosition = getVscodePositionIndex(endLineAnalysis, endBoundaryIndex);

      const startPos = new vscode.Position(startLineNumber - 1, startCharacterPosition);

      const endPos = new vscode.Position(endLineNumber - 1, endCharacterPosition);

      /*
       * If both endpoints resolve to the same physical VS Code position,
       * there is no text to select.
       */
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
