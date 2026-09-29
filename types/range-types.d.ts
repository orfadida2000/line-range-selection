import type * as vscode from "vscode";

export type CoordinateMode = "character" | "column";

export type ProportionSnap = "nearest" | "before" | "after";

export type LineReference =
  | {
      kind: "current";
      offset: number;
    }
  | {
      kind: "absolute";
      lineNumber: number;
    };

export type SecondaryInputKind = "coordinate" | "proportion";

export type SecondaryInput = {
  kind: SecondaryInputKind;
  value: number;
};

export type LineSpecifier = {
  lineReference: LineReference;
  secondaryInput: SecondaryInput | null;
};

export type LineRange = {
  startSpecifier: LineSpecifier;
  endSpecifier: LineSpecifier | null;
};

export type ParsedLineRange = {
  range: LineRange;
  canonicalText: string;
  usesCoordinateMode: boolean;
};

export type ParsedLineRangesInput = {
  ranges: LineRange[];
  canonicalText: string;
  usesCoordinateMode: boolean;
};

export type HistoryEntry = {
  text: string;
  coordinateMode: CoordinateMode;
  usesCoordinateMode: boolean;
};

export type NonZeroComponentResult = {
  valid: boolean;
  value: number;
};

export type LineRangeValidation = {
  complete: boolean;
  message: string;
  severity: vscode.InputBoxValidationSeverity;
};

export type LineAnalysis = {
  lineNumber: number;
  graphemeCount: number;
  boundaryVscodePositions: number[];
  boundaryLogicalWidths: number[];
};

export type LineAnalysisCache = Map<number, LineAnalysis>;

export type SelectionTarget =
  | {
      kind: "character";
      characterNumber: number;
    }
  | {
      kind: "boundary";
      boundaryIndex: number;
    };

export type ResolvedLineRange = {
  anchor: vscode.Position;
  active: vscode.Position;
};
