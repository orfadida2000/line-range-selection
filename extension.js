/**
 * @import {
 *   CoordinateMode,
 *   HistoryEntry,
 *   LineAnalysis,
 *   LineAnalysisCache,
 *   LineRange,
 *   LineRangeValidation,
 *   LineReference,
 *   LineSpecifier,
 *   NonZeroComponentResult,
 *   ParsedLineRange,
 *   ParsedLineRangesInput,
 *   ProportionSnap,
 *   ResolvedLineRange,
 *   SecondaryInput,
 *   SelectionTarget,
 * } from "./types/range-types"
 */

const vscode = require("vscode");

const COMMAND_NAME = "advanced-line-range-selection.selectLineRange";

const PROPORTION_EPSILON = 1e-12;

const HISTORY_LIMIT = 10;
const HISTORY_STORAGE_PREFIX = "advanced-line-range-selection.history:";

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
 * Kinds of line references accepted by a line specifier.
 *
 * ABSOLUTE:
 *   A signed non-zero 1-based document line number. Negative values count from
 *   the end of the document.
 *
 * CURRENT:
 *   The line containing the primary active caret when the command starts,
 *   optionally shifted by a signed non-zero line offset.
 */
const LineReferenceKind = Object.freeze({
  ABSOLUTE: "absolute",
  CURRENT: "current",
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
const relativeLineOffsetPattern = "[+-]0*[1-9][0-9]*";
const lineReferencePattern = `(?:${nonZeroPattern}|@(?:${relativeLineOffsetPattern})?)`;

/*
 * A specifier is one of:
 *
 *   <line-reference>
 *   <line-reference>:<coordinate>
 *   <line-reference>.<proportion-digits>
 *
 * A line reference is either an absolute line number or:
 *
 *   @       -> current line
 *   @+5     -> five lines after the current line
 *   @-3     -> three lines before the current line
 *
 * Zero relative offsets are intentionally rejected. Use "@" for the current
 * line itself.
 *
 * For proportional syntax:
 *
 *   5.      -> proportion 1
 *   5.0     -> proportion 0
 *   5.25    -> proportion 0.25
 *   @.5     -> proportion 0.5 of the current line
 *   @+5.25  -> proportion 0.25 of the line five lines after the current line
 *
 * The line reference is always resolved first; the optional secondary position
 * is then interpreted within that resolved line.
 */
const lineSpecifierPattern = `(${lineReferencePattern})(?::(${nonZeroPattern})|\\.([0-9]*))?`;

const lineRangeRegex = new RegExp(`^${lineSpecifierPattern}(?:\\s+${lineSpecifierPattern})?$`);

const strictNonZeroRegex = new RegExp(`^${nonZeroPattern}$`);
const strictLineReferenceRegex = new RegExp(`^${lineReferencePattern}$`);

// --- PERMISSIVE REGEXES (live typing-state analysis) ---

const permissiveNonZeroPattern = "[+-]?[0-9]*";
const permissiveLineReferencePattern = `(?:${permissiveNonZeroPattern}|@(?:[+-][0-9]*)?)`;

const permissiveLineSpecifierPattern =
  `(${permissiveLineReferencePattern})` + `(?:(:(${permissiveNonZeroPattern}))|(\\.([0-9]*)))?`;

const permissiveLineRangeRegex = new RegExp(
  `^${permissiveLineSpecifierPattern}` + `(?:\\s+${permissiveLineSpecifierPattern})?$`,
);

/**
 * Parse one non-zero signed integer component after permissive matching.
 *
 * @param {string} text
 * @returns {NonZeroComponentResult}
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
 * Build one parsed line reference after strict syntactic validation.
 *
 * @param {string} lineReferenceText
 * @returns {LineReference}
 */
const buildLineReference = (lineReferenceText) => {
  if (lineReferenceText.startsWith("@")) {
    return {
      kind: LineReferenceKind.CURRENT,
      offset: lineReferenceText === "@" ? 0 : parseInt(lineReferenceText.slice(1), 10),
    };
  }

  return {
    kind: LineReferenceKind.ABSOLUTE,
    lineNumber: parseInt(lineReferenceText, 10),
  };
};

/**
 * Build one parsed range specifier after strict syntactic validation.
 *
 * @param {string} lineReferenceText
 * @param {string | undefined} coordinateText
 * @param {string | undefined} proportionDigits
 * @returns {LineSpecifier}
 */
const buildSpecifier = (lineReferenceText, coordinateText, proportionDigits) => {
  /** @type {SecondaryInput | null} */
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
    lineReference: buildLineReference(lineReferenceText),
    secondaryInput,
  };
};

/**
 * Build the canonical textual form of one strictly valid line reference.
 *
 * Absolute line numbers and current-line offsets are normalized numerically,
 * while "@" remains relative to the primary active-caret line at execution
 * time.
 *
 * @param {string} lineReferenceText
 * @returns {string}
 */
const getCanonicalLineReferenceText = (lineReferenceText) => {
  if (lineReferenceText === "@") {
    return "@";
  }

  if (lineReferenceText.startsWith("@")) {
    const offset = parseInt(lineReferenceText.slice(1), 10);

    return offset > 0 ? `@+${offset}` : `@${offset}`;
  }

  return String(parseInt(lineReferenceText, 10));
};

/**
 * Build the canonical textual form of one strictly valid line specifier.
 *
 * Integer line and ":" coordinate components are normalized numerically.
 * Proportional digits remain textual because they are not integer coordinates
 * and are not resolved against document content at history-storage time.
 *
 * @param {string} lineReferenceText
 * @param {string | undefined} coordinateText
 * @param {string | undefined} proportionDigits
 * @returns {string}
 */
const getCanonicalSpecifierText = (lineReferenceText, coordinateText, proportionDigits) => {
  let canonicalText = getCanonicalLineReferenceText(lineReferenceText);

  if (coordinateText !== undefined) {
    canonicalText += `:${parseInt(coordinateText, 10)}`;
  } else if (proportionDigits !== undefined) {
    canonicalText += `.${proportionDigits}`;
  }

  return canonicalText;
};

/**
 * Parse one complete accepted line range.
 *
 * Each specifier contains a required line reference and optionally either:
 *
 * - an integer coordinate introduced by ":";
 * - a proportion introduced by ".".
 *
 * The returned canonical text normalizes integer syntax without resolving
 * negative absolute lines, "@" references, clipping, or proportional positions
 * against the current document.
 *
 * @param {string} text
 * @returns {ParsedLineRange | null}
 */
const parseLineRange = (text) => {
  const match = text.trim().match(lineRangeRegex);

  if (!match) {
    return null;
  }

  const startSpecifier = buildSpecifier(match[1], match[2], match[3]);

  const endSpecifier = match[4] === undefined ? null : buildSpecifier(match[4], match[5], match[6]);

  const canonicalStart = getCanonicalSpecifierText(match[1], match[2], match[3]);

  const canonicalEnd =
    match[4] === undefined ? null : getCanonicalSpecifierText(match[4], match[5], match[6]);

  return {
    range: {
      startSpecifier,
      endSpecifier,
    },
    canonicalText: canonicalEnd === null ? canonicalStart : `${canonicalStart} ${canonicalEnd}`,
    usesCoordinateMode: match[2] !== undefined || match[5] !== undefined,
  };
};

/**
 * Parse the complete command input as one or more comma-separated line ranges.
 *
 * Empty comma-separated parts are ignored. Every non-empty part must be one
 * complete valid line range; otherwise the entire input is rejected.
 *
 * The returned canonical text preserves range order and uses ", " between
 * ranges. Integer syntax is normalized once during parsing for history
 * deduplication and recall.
 *
 * @param {string} text
 * @returns {ParsedLineRangesInput | null}
 */
const parseLineRangesInput = (text) => {
  /** @type {LineRange[]} */
  const ranges = [];

  /** @type {string[]} */
  const canonicalRangeTexts = [];

  let usesCoordinateMode = false;

  for (const part of text.split(",")) {
    const rangeText = part.trim();

    if (rangeText === "") {
      continue;
    }

    const parsedRange = parseLineRange(rangeText);

    if (parsedRange === null) {
      return null;
    }

    ranges.push(parsedRange.range);
    canonicalRangeTexts.push(parsedRange.canonicalText);
    usesCoordinateMode ||= parsedRange.usesCoordinateMode;
  }

  return {
    ranges,
    canonicalText: canonicalRangeTexts.join(", "),
    usesCoordinateMode,
  };
};

/**
 * Build a human-readable description of one valid line reference while
 * performing live input validation.
 *
 * @param {string} lineReferenceText
 * @returns {string}
 */
const getLineReferenceDescription = (lineReferenceText) => {
  if (!lineReferenceText.startsWith("@")) {
    return `line ${parseInt(lineReferenceText, 10)}`;
  }

  if (lineReferenceText === "@") {
    return "the current line";
  }

  const offset = parseInt(lineReferenceText.slice(1), 10);

  return offset > 0 ? `the current line + ${offset}` : `the current line - ${Math.abs(offset)}`;
};

/**
 * Build a human-readable description of one optional secondary input while
 * performing live input validation.
 *
 * @param {string} coordinateWithColon
 * @param {NonZeroComponentResult} coordinateData
 * @param {string} proportionWithDot
 * @param {string} proportionDigits
 * @param {CoordinateMode} coordinateMode
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
 * Analyze the live validation state of one line range.
 *
 * A syntactically possible but incomplete typing state is returned as
 * incomplete with Info severity. The complete-input validator decides whether
 * that transitional state is allowed based on the range's position.
 *
 * @param {string} text
 * @param {CoordinateMode} coordinateMode
 * @returns {LineRangeValidation}
 */
const getLineRangeValidation = (text, coordinateMode) => {
  const match = text.match(permissiveLineRangeRegex);

  if (!match) {
    return {
      complete: false,
      message:
        `Invalid format. Use '<line>', '<line>:<${coordinateMode}>', or ` +
        `'<line>.<proportion-digits>' with an absolute line or '@' line reference. ` +
        `Absolute lines and ':' ${coordinateMode} numbers must be non-zero signed integers; ` +
        "relative line offsets use '@+n' or '@-n' with non-zero n; a bare '.' means proportion 1.",
      severity: vscode.InputBoxValidationSeverity.Error,
    };
  }

  const startLineReference = match[1] || "";
  const startCoordinateWithColon = match[2] || "";
  const startCoordinate = match[3] || "";
  const startProportionWithDot = match[4] || "";
  const startProportionDigits = match[5] ?? "";

  const endLineReference = match[6] || "";
  const endCoordinateWithColon = match[7] || "";
  const endCoordinate = match[8] || "";
  const endProportionWithDot = match[9] || "";
  const endProportionDigits = match[10] ?? "";

  const startLineReferenceValid = strictLineReferenceRegex.test(startLineReference);
  const startCoordinateData = parseNonZeroComponent(startCoordinate);

  const endLineReferenceValid = strictLineReferenceRegex.test(endLineReference);
  const endCoordinateData = parseNonZeroComponent(endCoordinate);

  const startSpecifierValid =
    startLineReferenceValid && (startCoordinateWithColon === "" || startCoordinateData.valid);

  const endSpecifierValid =
    endLineReferenceValid && (endCoordinateWithColon === "" || endCoordinateData.valid);

  const hasStartedEndSpecifier =
    endLineReference !== "" || endCoordinateWithColon !== "" || endProportionWithDot !== "";

  if (
    (startCoordinateWithColon !== "" || startProportionWithDot !== "") &&
    !startLineReferenceValid
  ) {
    return {
      complete: false,
      message:
        startCoordinateWithColon !== ""
          ? `Finish a valid start line reference before adding a ${coordinateMode} number.`
          : "Finish a valid start line reference before adding a proportion.",
      severity: vscode.InputBoxValidationSeverity.Error,
    };
  }

  if (hasStartedEndSpecifier && !startSpecifierValid) {
    return {
      complete: false,
      message: "Finish a valid start specifier before adding the end specifier.",
      severity: vscode.InputBoxValidationSeverity.Error,
    };
  }

  if ((endCoordinateWithColon !== "" || endProportionWithDot !== "") && !endLineReferenceValid) {
    return {
      complete: false,
      message:
        endCoordinateWithColon !== ""
          ? `Finish a valid end line reference before adding a ${coordinateMode} number.`
          : "Finish a valid end line reference before adding a proportion.",
      severity: vscode.InputBoxValidationSeverity.Error,
    };
  }

  const isFullyValid = startSpecifierValid && (!hasStartedEndSpecifier || endSpecifierValid);

  if (!isFullyValid) {
    return {
      complete: false,
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

  const startDescription =
    getLineReferenceDescription(startLineReference) + startSecondaryDescription;

  let message;

  if (hasStartedEndSpecifier) {
    const endDescription = getLineReferenceDescription(endLineReference) + endSecondaryDescription;

    message = `Will select from ${startDescription} to ${endDescription}`;
  } else {
    message = `Will select from ${startDescription} to the end of the document`;
  }

  message +=
    ` (absolute line and ${coordinateMode} numbers are shown before ` +
    "negative-index normalization and clipping).";

  return {
    complete: true,
    message,
    severity: vscode.InputBoxValidationSeverity.Info,
  };
};

/**
 * Build the live validation message for the complete comma-separated input.
 *
 * Empty comma-separated parts are ignored. Every non-empty part is validated
 * independently using the single-range grammar. Transitional incomplete states
 * are allowed only for the last non-empty range; every earlier range must
 * already be complete before another range is started.
 *
 * @param {string} text
 * @param {CoordinateMode} coordinateMode
 * @returns {vscode.InputBoxValidationMessage | undefined}
 */
const getValidationMessage = (text, coordinateMode) => {
  const rangeTexts = text
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");

  if (rangeTexts.length === 0) {
    return undefined;
  }

  /** @type {LineRangeValidation[]} */
  const validations = [];

  for (let index = 0; index < rangeTexts.length; index += 1) {
    const validation = getLineRangeValidation(rangeTexts[index], coordinateMode);
    validations.push(validation);

    if (!validation.complete) {
      const isLastRange = index === rangeTexts.length - 1;

      if (!isLastRange) {
        return {
          message:
            `Range ${index + 1}: Complete this range before starting the next range. ` +
            validation.message,
          severity: vscode.InputBoxValidationSeverity.Error,
        };
      }

      return {
        message:
          rangeTexts.length === 1
            ? validation.message
            : `Range ${index + 1}: ${validation.message}`,
        severity: validation.severity,
      };
    }
  }

  if (validations.length === 1) {
    return {
      message: validations[0].message,
      severity: validations[0].severity,
    };
  }

  return {
    message: `Will create ${validations.length} selections.`,
    severity: vscode.InputBoxValidationSeverity.Info,
  };
};

/**
 * Return the persistent history-storage key for one document.
 *
 * @param {vscode.TextDocument} document
 * @returns {string}
 */
const getHistoryStorageKey = (document) => `${HISTORY_STORAGE_PREFIX}${document.uri.toString()}`;

/**
 * Read the stored command history for one document.
 *
 * @param {vscode.ExtensionContext} context
 * @param {vscode.TextDocument} document
 * @returns {HistoryEntry[]}
 */
const getHistoryEntries = (context, document) => {
  const history = /** @type {HistoryEntry[]} */ (
    context.globalState.get(getHistoryStorageKey(document), [])
  );

  return history;
};

/**
 * Return history entries compatible with the current integer coordinate mode.
 *
 * Entries that contain no ":" coordinates are mode-independent and therefore
 * remain available in both character and column modes.
 *
 * @param {HistoryEntry[]} history
 * @param {CoordinateMode} coordinateMode
 * @returns {HistoryEntry[]}
 */
const getCompatibleHistoryEntries = (history, coordinateMode) =>
  history.filter((entry) => !entry.usesCoordinateMode || entry.coordinateMode === coordinateMode);

/**
 * Determine whether two history entries represent the same command input.
 *
 * Coordinate mode contributes to identity only when the input actually uses
 * ":" coordinates.
 *
 * @param {HistoryEntry} left
 * @param {HistoryEntry} right
 * @returns {boolean}
 */
const areHistoryEntriesEquivalent = (left, right) =>
  left.text === right.text &&
  left.usesCoordinateMode === right.usesCoordinateMode &&
  (!left.usesCoordinateMode || left.coordinateMode === right.coordinateMode);

/**
 * Store one successfully executed GUI input in per-document history.
 *
 * Every entry records the coordinate mode active when it was executed.
 * Deduplication treats coordinate mode as part of the entry identity only when
 * the input contains at least one ":" coordinate. Range order is preserved
 * because it determines the primary selection.
 *
 * @param {vscode.ExtensionContext} context
 * @param {vscode.TextDocument} document
 * @param {ParsedLineRangesInput} parsedInput
 * @param {CoordinateMode} coordinateMode
 * @returns {Thenable<void>}
 */
const addHistoryEntry = (context, document, parsedInput, coordinateMode) => {
  /** @type {HistoryEntry} */
  const newEntry = {
    text: parsedInput.canonicalText,
    coordinateMode: coordinateMode,
    usesCoordinateMode: parsedInput.usesCoordinateMode,
  };

  const history = getHistoryEntries(context, document);

  const updatedHistory = [
    newEntry,
    ...history.filter((entry) => !areHistoryEntriesEquivalent(entry, newEntry)),
  ].slice(0, HISTORY_LIMIT);

  return context.globalState.update(getHistoryStorageKey(document), updatedHistory);
};

/**
 * Show the managed input box used by the command.
 *
 * Unlike vscode.window.showInputBox(), this explicitly controls acceptance.
 * Informational validation states therefore remain non-blocking visually while
 * Enter is accepted only when every non-empty comma-separated range satisfies
 * the strict grammar.
 *
 * Previous/next buttons navigate compatible per-document history. One history
 * record represents the complete comma-separated command input.
 *
 * @param {CoordinateMode} coordinateMode
 * @param {ProportionSnap} proportionSnap
 * @param {HistoryEntry[]} historyEntries Newest entry first.
 * @returns {Promise<ParsedLineRangesInput | undefined>}
 */
const showLineRangeInputBox = (coordinateMode, proportionSnap, historyEntries) =>
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
      "Enter one or more ranges separated by commas. " +
      `Each range uses one or two specifiers: '<line>', '<line>:<${coordinateMode}>', ` +
      "or '<line>.<proportion-digits>'. " +
      "Use '@' as the current primary-caret line, optionally followed by a non-zero " +
      "relative offset such as '@+5' or '@-3'. " +
      "Absolute line numbers are 1-based. " +
      coordinateSemantics +
      "For proportional syntax, '.25' means proportion 0.25, '.0' means " +
      "the beginning of the resolved line, and a bare '.' means proportion 1. " +
      proportionSnapSemantics +
      `Negative absolute line and ${coordinateMode} numbers count from the end. ` +
      "An omitted end specifier means the end of the document, and " +
      `out-of-bounds line and ${coordinateMode} numbers are clipped.`;

    inputBox.placeholder = "e.g. 13:2 20, @-2.25 @+2.75, @:5, 30. 25:3";

    const previousHistoryButton = {
      iconPath: new vscode.ThemeIcon("chevron-up"),
      tooltip: "Previous history entry",
    };

    const nextHistoryButton = {
      iconPath: new vscode.ThemeIcon("chevron-down"),
      tooltip: "Next history entry",
    };

    if (historyEntries.length > 0) {
      inputBox.buttons = [previousHistoryButton, nextHistoryButton];
    }

    /** @type {ParsedLineRangesInput | undefined} */
    let acceptedValue;

    let settled = false;

    /*
     * -1 represents the current editable draft. Non-negative values index the
     * newest-first historyEntries array.
     */
    let historyIndex = -1;
    let draftValue = "";

    /** @type {vscode.Disposable[]} */
    const disposables = [];

    /**
     * Set the input-box value and place the caret at its end.
     *
     * @param {string} value
     * @returns {void}
     */
    const setInputValue = (value) => {
      inputBox.value = value;
      inputBox.valueSelection = [value.length, value.length];
    };

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
        if (historyIndex === -1) {
          draftValue = value;
        }

        inputBox.validationMessage = getValidationMessage(value, coordinateMode);
      }),
    );

    disposables.push(
      inputBox.onDidTriggerButton((button) => {
        if (button === previousHistoryButton) {
          if (historyEntries.length === 0 || historyIndex >= historyEntries.length - 1) {
            return;
          }

          if (historyIndex === -1) {
            draftValue = inputBox.value;
          }

          historyIndex += 1;
          setInputValue(historyEntries[historyIndex].text);
          return;
        }

        if (button !== nextHistoryButton || historyIndex === -1) {
          return;
        }

        historyIndex -= 1;

        setInputValue(historyIndex === -1 ? draftValue : historyEntries[historyIndex].text);
      }),
    );

    disposables.push(
      inputBox.onDidAccept(() => {
        const parsedInput = parseLineRangesInput(inputBox.value);

        if (parsedInput === null) {
          return;
        }

        if (parsedInput.ranges.length === 0) {
          inputBox.hide();
          return;
        }

        acceptedValue = parsedInput;
        inputBox.hide();
      }),
    );

    disposables.push(inputBox.onDidHide(finish));

    inputBox.show();
  });

/**
 * Clip a 1-based line number to the document without applying negative-index
 * semantics.
 *
 * @param {number} lineNumber
 * @param {number} lineCount
 * @returns {number}
 */
const clipLineNumber = (lineNumber, lineCount) => {
  if (lineNumber < 1) {
    return 1;
  }

  if (lineNumber > lineCount) {
    return lineCount;
  }

  return lineNumber;
};

/**
 * Normalize a signed absolute 1-based line number and clip it to the document.
 *
 * @param {number} lineNumber
 * @param {number} lineCount
 * @returns {number} A valid 1-based line number.
 */
const normalizeAndClipLineNumber = (lineNumber, lineCount) => {
  const resolvedLineNumber = lineNumber < 0 ? lineCount + 1 + lineNumber : lineNumber;

  return clipLineNumber(resolvedLineNumber, lineCount);
};

/**
 * Resolve one parsed line reference to a valid 1-based document line number.
 *
 * Absolute negative numbers use end-relative document indexing. Current-line
 * references use the captured primary active-caret line plus their relative
 * offset, then clip directly to the document bounds.
 *
 * @param {LineReference} lineReference
 * @param {number} currentLineNumber
 * @param {number} lineCount
 * @returns {number}
 */
const resolveLineReference = (lineReference, currentLineNumber, lineCount) => {
  if (lineReference.kind === LineReferenceKind.CURRENT) {
    return clipLineNumber(currentLineNumber + lineReference.offset, lineCount);
  }

  return normalizeAndClipLineNumber(lineReference.lineNumber, lineCount);
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
 * @returns {LineAnalysis}
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
 * Return a cached analysis for one resolved 1-based line number.
 *
 * The cache is local to one command invocation, so analyses are never reused
 * across document edits or editor-option changes between invocations.
 *
 * @param {vscode.TextDocument} document
 * @param {number} lineNumber
 * @param {number} tabSize
 * @param {LineAnalysisCache} lineAnalysisByLineNumber
 * @returns {LineAnalysis}
 */
const getLineAnalysis = (document, lineNumber, tabSize, lineAnalysisByLineNumber) => {
  let lineAnalysis = lineAnalysisByLineNumber.get(lineNumber);

  if (lineAnalysis === undefined) {
    lineAnalysis = analyzeLine(document, lineNumber, tabSize);
    lineAnalysisByLineNumber.set(lineNumber, lineAnalysis);
  }

  return lineAnalysis;
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
 * @param {LineAnalysis} lineAnalysis
 * @param {CoordinateMode} coordinateMode
 * @returns {SelectionTarget | null}
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
 * @param {LineAnalysis} lineAnalysis
 * @param {number} proportion
 * @param {ProportionSnap} proportionSnap
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
 * @param {SecondaryInput} secondaryInput
 * @param {LineAnalysis} lineAnalysis
 * @param {CoordinateMode} coordinateMode
 * @param {ProportionSnap} proportionSnap
 * @returns {SelectionTarget | null}
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
 * @param {SelectionTarget} target
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
 * @param {SelectionTarget | null} startTarget
 * @param {SelectionTarget | null} endTarget
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
 * @param {LineAnalysis} lineAnalysis
 * @param {SelectionTarget | null} target
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
 * @param {LineAnalysis} lineAnalysis
 * @param {number} boundaryIndex
 * @returns {number}
 */
const getVscodePositionIndex = (lineAnalysis, boundaryIndex) =>
  lineAnalysis.boundaryVscodePositions[boundaryIndex];

/**
 * Resolve one already-parsed line range without mutating the editor.
 *
 * The caller supplies the current primary-caret line captured before any new
 * selections are applied. Both returned positions are preserved even when they
 * are equal; the caller decides how zero-length selections should be handled.
 *
 * @param {LineRange} parsedRange
 * @param {vscode.TextDocument} document
 * @param {number} currentLineNumber
 * @param {CoordinateMode} coordinateMode
 * @param {ProportionSnap} proportionSnap
 * @param {number} tabSize
 * @param {LineAnalysisCache} lineAnalysisByLineNumber
 * @returns {ResolvedLineRange}
 */
const resolveLineRange = (
  parsedRange,
  document,
  currentLineNumber,
  coordinateMode,
  proportionSnap,
  tabSize,
  lineAnalysisByLineNumber,
) => {
  const lineCount = document.lineCount;

  // -----------------------------------------------------------------------
  // Stage 1: Resolve start/end line references.
  // -----------------------------------------------------------------------

  const startLineNumber = resolveLineReference(
    parsedRange.startSpecifier.lineReference,
    currentLineNumber,
    lineCount,
  );

  const endLineNumber =
    parsedRange.endSpecifier === null
      ? lineCount
      : resolveLineReference(parsedRange.endSpecifier.lineReference, currentLineNumber, lineCount);

  // -----------------------------------------------------------------------
  // Stage 2: Obtain cached analyses for the resolved endpoint lines.
  // -----------------------------------------------------------------------

  const startLineAnalysis = getLineAnalysis(
    document,
    startLineNumber,
    tabSize,
    lineAnalysisByLineNumber,
  );

  const endLineAnalysis = getLineAnalysis(
    document,
    endLineNumber,
    tabSize,
    lineAnalysisByLineNumber,
  );

  // -----------------------------------------------------------------------
  // Stage 3: Resolve explicitly supplied secondary inputs to semantic
  // targets. Omitted or unusable targets remain null until direction is known.
  // -----------------------------------------------------------------------

  const startTarget =
    parsedRange.startSpecifier.secondaryInput === null
      ? null
      : resolveExplicitTarget(
          parsedRange.startSpecifier.secondaryInput,
          startLineAnalysis,
          coordinateMode,
          proportionSnap,
        );

  const endTarget =
    parsedRange.endSpecifier === null || parsedRange.endSpecifier.secondaryInput === null
      ? null
      : resolveExplicitTarget(
          parsedRange.endSpecifier.secondaryInput,
          endLineAnalysis,
          coordinateMode,
          proportionSnap,
        );

  // -----------------------------------------------------------------------
  // Stage 4: Determine direction while character targets and boundary targets
  // still retain their distinct semantics.
  // -----------------------------------------------------------------------

  const forwardSelection = isForwardSelection(
    startLineNumber,
    endLineNumber,
    startTarget,
    endTarget,
  );

  // -----------------------------------------------------------------------
  // Stage 5: Resolve both endpoints to concrete grapheme boundary indices.
  // -----------------------------------------------------------------------

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

  // -----------------------------------------------------------------------
  // Stage 6: Translate grapheme boundary indices to VS Code positions.
  // -----------------------------------------------------------------------

  const anchor = new vscode.Position(
    startLineNumber - 1,
    getVscodePositionIndex(startLineAnalysis, startBoundaryIndex),
  );

  const active = new vscode.Position(
    endLineNumber - 1,
    getVscodePositionIndex(endLineAnalysis, endBoundaryIndex),
  );

  return {
    anchor,
    active,
  };
};

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

      /*
       * Capture the primary active-caret line before any asynchronous UI work
       * or selection changes. Every "@" in this invocation resolves from this
       * same 1-based line.
       */
      const currentLineNumber = editor.selection.active.line + 1;

      const configuration = vscode.workspace.getConfiguration(
        "advanced-line-range-selection",
        editor.document.uri,
      );

      const configuredCoordinateMode = /** @type {CoordinateMode} */ (
        configuration.get("coordinateMode", CoordinateMode.CHARACTER)
      );

      const coordinateMode =
        configuredCoordinateMode === CoordinateMode.COLUMN
          ? CoordinateMode.COLUMN
          : CoordinateMode.CHARACTER;

      const configuredProportionSnap = /** @type {ProportionSnap} */ (
        configuration.get("proportionSnap", ProportionSnap.NEAREST)
      );

      const proportionSnap =
        configuredProportionSnap === ProportionSnap.BEFORE
          ? ProportionSnap.BEFORE
          : configuredProportionSnap === ProportionSnap.AFTER
            ? ProportionSnap.AFTER
            : ProportionSnap.NEAREST;

      /** @type {ParsedLineRangesInput | undefined} */
      let parsedInput;

      let shouldAddToHistory = false;

      if (rangeInput === undefined) {
        const compatibleHistory = getCompatibleHistoryEntries(
          getHistoryEntries(context, editor.document),
          coordinateMode,
        );

        parsedInput = await showLineRangeInputBox(
          coordinateMode,
          proportionSnap,
          compatibleHistory,
        );

        if (parsedInput === undefined) {
          return;
        }

        shouldAddToHistory = true;
      } else {
        if (typeof rangeInput !== "string") {
          return;
        }

        const directlyParsedInput = parseLineRangesInput(rangeInput);

        if (directlyParsedInput === null) {
          return;
        }

        parsedInput = directlyParsedInput;
      }

      if (parsedInput.ranges.length === 0) {
        return;
      }

      const document = editor.document;
      const tabSize = getEffectiveTabSize(editor);

      /** @type {LineAnalysisCache} */
      const lineAnalysisByLineNumber = new Map();

      /** @type {vscode.Selection[]} */
      const selections = [];

      for (const parsedRange of parsedInput.ranges) {
        const resolvedRange = resolveLineRange(
          parsedRange,
          document,
          currentLineNumber,
          coordinateMode,
          proportionSnap,
          tabSize,
          lineAnalysisByLineNumber,
        );

        /*
         * Preserve the command's existing behavior for zero-length results.
         * The resolver deliberately returns them; this caller chooses to skip
         * them rather than create or move a caret.
         */
        if (resolvedRange.anchor.isEqual(resolvedRange.active)) {
          continue;
        }

        selections.push(new vscode.Selection(resolvedRange.anchor, resolvedRange.active));
      }

      if (selections.length === 0) {
        return;
      }

      /*
       * Let VS Code apply its normal multiple-selection behavior, including the
       * user's editor.multiCursorMergeOverlapping preference.
       */
      editor.selections = selections;

      if (shouldAddToHistory) {
        await addHistoryEntry(context, document, parsedInput, coordinateMode);
      }

      // Keep the active end of the primary resulting selection visible.
      editor.revealRange(editor.selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    },
  );

  context.subscriptions.push(disposable);
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
