import {
  readRuntimeContextField,
  readRuntimeContextFormat,
} from "@skillset/toolkit/runtime";

import { assertBooleanOption } from "./cli-arg-reader";
import type { CliArgReader, CliOptionToken } from "./cli-arg-reader";
import {
  readClaudeSettingSources,
  readLookupTarget,
  readPositiveInteger,
  readTargetName,
  readTargetNames,
  tokenizeCsv,
} from "./cli-arg-values";

export const rejectProjectionForeignOption = (
  reader: CliArgReader,
  option: CliOptionToken
): boolean => {
  switch (option.flag) {
    case "--append":
    case "--staged": {
      assertBooleanOption(option);
      throw new Error(
        "skillset: change options are only supported with change commands"
      );
    }
    case "--bump":
    case "--group":
    case "--reason":
    case "--reason-file":
    case "--ref": {
      reader.readRequiredOptionValue(option);
      throw new Error(
        "skillset: change options are only supported with change commands"
      );
    }
    case "--runner": {
      const value = reader.readRequiredOptionValue(option);
      if (
        value !== "git" &&
        value !== "husky" &&
        value !== "lefthook" &&
        value !== "pre-commit"
      ) {
        throw new Error(
          "skillset: expected --runner lefthook, husky, pre-commit, or git"
        );
      }
      throw new Error(
        "skillset: hook options are only supported with hooks print"
      );
    }
    case "--target": {
      readTargetName(reader.readRequiredOptionValue(option));
      throw new Error(
        "skillset: hook options are only supported with hooks print"
      );
    }
    case "--agent-runtime":
    case "--pre-commit":
    case "--pre-push": {
      assertBooleanOption(option);
      throw new Error(
        "skillset: hook options are only supported with hooks print"
      );
    }
    case "--event": {
      reader.readRequiredOptionValue(option);
      throw new Error(
        "skillset: hook context options are only supported with hooks context"
      );
    }
    case "--format": {
      readRuntimeContextFormat(reader.readRequiredOptionValue(option));
      throw new Error(
        "skillset: hook context options are only supported with hooks context"
      );
    }
    case "--context-fields": {
      const fields = tokenizeCsv(reader.readRequiredOptionValue(option));
      if (fields.length === 0) {
        throw new Error(
          "skillset: --context-fields requires at least one field"
        );
      }
      for (const field of fields) {
        readRuntimeContextField(field);
      }
      throw new Error(
        "skillset: hook context options are only supported with hooks context"
      );
    }
    case "--compat": {
      for (const value of reader.readOptionalOptionValues(option)) {
        for (const target of tokenizeCsv(value)) {
          readLookupTarget(target);
        }
      }
      throw new Error("skillset: lookup flags are only supported with lookup");
    }
    case "--frontmatter":
    case "--fields":
    case "--values":
    case "--events":
    case "--examples":
    case "--schema": {
      assertBooleanOption(option);
      throw new Error("skillset: lookup flags are only supported with lookup");
    }
    case "--field": {
      reader.readRequiredOptionValue(option);
      throw new Error("skillset: lookup flags are only supported with lookup");
    }
    case "--prompt":
    case "--prompt-file":
    case "--plugin": {
      reader.readRequiredOptionValue(option);
      throw new Error(
        "skillset: ad hoc test options are only supported with test"
      );
    }
    case "--claude-setting-sources": {
      readClaudeSettingSources(
        reader.readRequiredOptionValue(option),
        "--claude-setting-sources"
      );
      throw new Error(
        "skillset: ad hoc test options are only supported with test"
      );
    }
    case "--timeout-ms":
    case "--lines": {
      readPositiveInteger(reader.readRequiredOptionValue(option), option.flag);
      throw new Error(
        "skillset: ad hoc test options are only supported with test"
      );
    }
    case "--background": {
      assertBooleanOption(option);
      throw new Error(
        "skillset: ad hoc test options are only supported with test"
      );
    }
    case "--adopt": {
      reader.readRequiredOptionValue(option);
      throw new Error(
        "skillset: --adopt and init acquisition --from are only supported with init"
      );
    }
    case "--include": {
      const includes = tokenizeCsv(reader.readRequiredOptionValue(option));
      if (includes.length === 0) {
        throw new Error("skillset: --include requires at least one value");
      }
      if (includes.some((include) => include !== "ci")) {
        throw new Error("skillset: expected --include ci");
      }
      throw new Error("skillset: setup options are only supported with init");
    }
    case "--targets": {
      readTargetNames(reader.readRequiredOptionValue(option));
      throw new Error("skillset: setup options are only supported with init");
    }
    case "--id":
    case "--in":
    case "--preset": {
      reader.readRequiredOptionValue(option);
      throw new Error("skillset: new options are only supported with new");
    }
    case "--use": {
      const value = reader.readRequiredOptionValue(option);
      if (value !== "source" && value !== "output") {
        throw new Error("skillset: --use expects source or output");
      }
      throw new Error("skillset: --use is only supported with reconcile");
    }
    default: {
      return false;
    }
  }
};
