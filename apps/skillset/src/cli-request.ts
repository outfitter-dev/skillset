import type { BuildCommandRequest, DiffCommandRequest } from "./build-cli";
import type { ChangeCommandRequest } from "./change-cli";
import type { CheckCommandRequest } from "./check-cli";
import type { DevCommandRequest } from "./dev-cli";
import type {
  DistributionCommandRequest,
  MarketplaceCommandRequest,
} from "./distribution-cli";
import type { HooksCommandRequest } from "./hooks-cli";
import type { InitCommandRequest } from "./init-cli";
import type {
  ExplainCommandRequest,
  ListCommandRequest,
  LookupFeaturesCommandRequest,
  LookupRouteRequest,
  StatusCommandRequest,
} from "./inspect-cli";
import type {
  ReconcileCommandRequest,
  RestoreCommandRequest,
} from "./recovery-cli";
import type { ReleaseCommandRequest } from "./release-cli";
import type { ImportCommandRequest, NewCommandRequest } from "./source-cli";
import type { TestCommandRequest } from "./test-cli";
import type { UpdateCommandRequest } from "./update-cli";

export type CliRequest =
  | { readonly command: "build"; readonly request: BuildCommandRequest }
  | { readonly command: "change"; readonly request: ChangeCommandRequest }
  | { readonly command: "check"; readonly request: CheckCommandRequest }
  | { readonly command: "dev"; readonly request: DevCommandRequest }
  | { readonly command: "diff"; readonly request: DiffCommandRequest }
  | {
      readonly command: "distribute";
      readonly request: DistributionCommandRequest;
    }
  | { readonly command: "explain"; readonly request: ExplainCommandRequest }
  | { readonly command: "hooks"; readonly request: HooksCommandRequest }
  | { readonly command: "import"; readonly request: ImportCommandRequest }
  | { readonly command: "init"; readonly request: InitCommandRequest }
  | { readonly command: "list"; readonly request: ListCommandRequest }
  | {
      readonly command: "lookup";
      readonly request:
        | {
            readonly kind: "features";
            readonly value: LookupFeaturesCommandRequest;
          }
        | { readonly kind: "query"; readonly value: LookupRouteRequest };
    }
  | {
      readonly command: "marketplace";
      readonly request: MarketplaceCommandRequest;
    }
  | { readonly command: "new"; readonly request: NewCommandRequest }
  | {
      readonly command: "reconcile";
      readonly request: ReconcileCommandRequest;
    }
  | { readonly command: "release"; readonly request: ReleaseCommandRequest }
  | { readonly command: "restore"; readonly request: RestoreCommandRequest }
  | { readonly command: "status"; readonly request: StatusCommandRequest }
  | { readonly command: "test"; readonly request: TestCommandRequest }
  | { readonly command: "update"; readonly request: UpdateCommandRequest };
