import type { SchemaJsonRecord, SkillsetCliDiagnostic } from "@skillset/schema";

import { renderCliDataResult } from "./cli-output";

export interface FiniteCommandWriter {
  readonly stderr: Pick<NodeJS.WritableStream, "write">;
  readonly stdout: Pick<NodeJS.WritableStream, "write">;
}

export interface FiniteCommandJsonProjection {
  readonly command: string;
  readonly data: unknown;
  readonly diagnostics?: readonly SkillsetCliDiagnostic[];
  readonly kind?: string;
}

export interface FiniteCommandOptions<Result> {
  readonly execute: () => Result | Promise<Result>;
  readonly exitCode: (result: Result) => number;
  readonly json: (result: Result) => FiniteCommandJsonProjection;
  readonly jsonOutput: boolean;
  readonly renderHuman: (
    result: Result,
    writer: FiniteCommandWriter
  ) => void | Promise<void>;
  readonly writer?: FiniteCommandWriter;
}

export const runFiniteCommand = async <Result>(
  options: FiniteCommandOptions<Result>
): Promise<void> => {
  const result = await options.execute();
  const exitCode = options.exitCode(result);
  const writer = options.writer ?? {
    stderr: process.stderr,
    stdout: process.stdout,
  };
  if (options.jsonOutput) {
    const projection = options.json(result);
    writer.stdout.write(
      renderCliDataResult({
        command: projection.command,
        data: projection.data as SchemaJsonRecord,
        ...(projection.diagnostics === undefined
          ? {}
          : { diagnostics: projection.diagnostics }),
        exitCode,
        ...(projection.kind === undefined ? {} : { kind: projection.kind }),
      })
    );
  } else {
    await options.renderHuman(result, writer);
  }
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
};
