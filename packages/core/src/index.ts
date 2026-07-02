export {
  doctorSkillset,
  explainPath,
  listFeatureCapabilities,
  listGeneratedEntries,
  summarizeFeatureCapabilities,
  type DoctorReport,
  type ExplainKind,
  type ExplainResult,
  type FeatureCapability,
  type FeatureCapabilitySummary,
  type FeatureSupportCapability,
} from "./authoring";
export {
  buildSkillset,
  buildSkillsetResult,
  verifySkillset,
  verifySkillsetResult,
  diffSkillset,
  diffSkillsetResult,
  ISOLATED_OUT_ROOT,
  type SkillsetBuildResult,
  type SkillsetVerifyResult,
  type SkillsetDiff,
  type SkillsetDiffResult,
} from "./build";
export {
  readHookAttachments,
  resolveAdaptiveHookAttachments,
  type AdaptiveHookAttachmentIssue,
  type AdaptiveHookResolution,
  type ResolvedAdaptiveHookAttachment,
} from "./adaptive-hook-attachments";
export {
  adaptiveHookIntentIsRenderable,
  classifyAdaptiveHookIntent,
  type AdaptiveHookIntentClassification,
  type AdaptiveHookIntentStatus,
  type AdaptiveHookRenderSurface,
} from "./adaptive-hook-classifier";
export {
  classifyNativeHookLiftDiagnostics,
  type NativeHookLiftDiagnostic,
  type NativeHookLiftDiagnosticCode,
  type NativeHookLiftDiagnosticsOptions,
} from "./adaptive-hook-native-lift";
export {
  assertAdapterConformance,
  checkAdapterConformance,
  formatAdapterConformanceReport,
  type AdapterConformanceCase,
  type AdapterConformanceIssue,
  type AdapterConformanceIssueCode,
  type AdapterConformanceReport,
} from "./adapter-conformance";
export {
  createAdapterConformanceCoverageReport,
  formatAdapterConformanceCoverageReport,
  type AdapterConformanceCoverageEntry,
  type AdapterConformanceCoverageReport,
  type AdapterConformanceCoverageStatus,
} from "./adapter-conformance-coverage";
export {
  checkProviderFormatConformance,
  formatProviderFormatConformanceReport,
  providerFormatConformanceFiles,
  type ProviderFormatConformanceFile,
  type ProviderFormatConformanceIssue,
  type ProviderFormatConformanceIssueCode,
  type ProviderFormatConformanceReport,
} from "./provider-format-conformance";
export {
  assertDeterministicProjection,
  formatDeterministicProjectionReport,
  runDeterministicProjection,
  type DeterministicProjectionOptions,
  type DeterministicProjectionReport,
  type DeterministicProjectionRunContext,
  type DeterministicProjectionRunName,
  type DeterministicProjectionRunSummary,
} from "./deterministic-projection";
export {
  DESTINATION_OWNERSHIP_VALUES,
  classifyDestinationOwnership,
  type DestinationOwnership,
  type DestinationOwnershipClassification,
  type DestinationOwnershipEntry,
} from "./destination-ownership";
export {
  planDistributions,
  type DistributionDestinationPlan,
  type DistributionFileStatus,
  type DistributionFromPlan,
  type DistributionNoOp,
  type DistributionPlan,
  type DistributionPlanFile,
  type DistributionPlanReport,
  type DistributionSelectorKind,
} from "./distribution";
export {
  checkMarketplaces,
  type MarketplaceCheckEntryReport,
  type MarketplaceCheckReport,
  type MarketplaceCheckSourceReport,
  type MarketplaceLockEntry,
  type MarketplaceReadinessState,
  type MarketplaceSourceKind,
} from "./marketplace-check";
export {
  updateMarketplaces,
  type MarketplaceUpdateFile,
  type MarketplaceUpdateOptions,
  type MarketplaceUpdateReport,
} from "./marketplace-update";
export {
  FEATURE_STATUS_VALUES,
  RUNTIME_SUPPORT_STATUS_VALUES,
  SKILLSET_RUNTIME_IDS,
  TARGET_SUPPORT_STATUS_VALUES,
  assertFeatureIdsUnique,
  defineFeatureRegistry,
  getSkillsetFeature,
  listSkillsetFeatures,
  listSkillsetFeaturesByRuntime,
  listSkillsetFeaturesByTarget,
  type SkillsetEvidenceKind,
  type SkillsetFeatureEntry,
  type SkillsetFeatureEvidence,
  type SkillsetFeatureId,
  type SkillsetFeatureKind,
  type SkillsetFeatureRegistry,
  type SkillsetFeatureStatus,
  type SkillsetRuntimeId,
  type SkillsetRuntimeSupport,
  type SkillsetRuntimeSupportStatus,
  type SkillsetTargetSupport,
  type SkillsetTargetSupportStatus,
} from "./feature-registry";
export {
  checkFeatureRegistryDrift,
  type FeatureRegistryDriftCode,
  type FeatureRegistryDriftIssue,
  type FeatureRegistryDriftReport,
} from "./feature-registry-check";
export {
  defaultTargetNames,
  isTargetName,
  targetNames,
  targetRecord,
} from "./targets";
export {
  assertNoHostLeaks,
  detectHostLeaks,
  detectHostLeaksInBytes,
  type HostLeakDetectionOptions,
  type HostLeakIssue,
  type HostLeakKind,
  type HostLeakMatch,
} from "./host-leak";
export {
  CLAUDE_HOOK_EVENTS,
  CODEX_HOOK_EVENTS,
  CODEX_HOOK_HANDLER_TYPES,
  classifyAdaptiveHookUnitPath,
  hookEventSupported,
  hookProviderCapabilities,
  validateAdaptiveHookUnitPaths,
  type AdaptiveHookPathIssue,
  type AdaptiveHookUnitPath,
  type HookCapabilityProvider,
  type HookMatcherKind,
  type HookProviderCapability,
  type HookScope,
  type HookScopeSupport,
} from "./hook-capabilities";
export {
  inspectSkillset,
  lintBuildGraph,
  lintSkillset,
} from "./lint";
export {
  lookupSkillsetReference,
  type LookupCompatibility,
  type LookupDiagnostic,
  type LookupDiagnosticSeverity,
  type LookupEvent,
  type LookupEventField,
  type LookupExample,
  type LookupField,
  type LookupQuery,
  type LookupReport,
  type LookupSubject,
  type LookupSubjectSummary,
  type LookupView,
} from "./lookup";
export {
  readSkillsetWorkspaceConfig,
  resolveRepoCacheKey,
  resolveRepoCachePath,
  resolveSkillsetXdgPaths,
  type RepoCacheKeyOptions,
  type RepoCacheKeyResult,
  type RepoCacheKeySource,
  type RepoCachePathOptions,
  type RepoCachePathResult,
  type SkillsetWorkspaceConfig,
  type SkillsetXdgKind,
  type SkillsetXdgOptions,
  type SkillsetXdgPaths,
} from "./xdg";
export {
  knownSkillsetsIndexPath,
  normalizeKnownSkillsetIdentity,
  readKnownSkillsetsIndex,
  recordKnownSkillsetWorkspace,
  resolveKnownSkillsetWorkspace,
  writeKnownSkillsetsIndex,
  type KnownSkillsetEntry,
  type KnownSkillsetsIndex,
  type RecordKnownSkillsetOptions,
  type ResolveKnownSkillsetOptions,
} from "./known-skillsets";
export {
  createOperationalPathContext,
  isRepoOperationalCachePath,
  logicalOperationalPath,
  REPO_OPERATIONAL_CACHE_ROOT,
  resolveOperationalPath,
  resolveRepoOperationalCachePath,
  type OperationalCacheOptions,
  type OperationalPathContext,
} from "./operational-cache";
export {
  WORKSPACE_CHANGES_DIR,
  workspaceChangeFile,
  workspaceChangesDir,
} from "./workspace-state";
export type {
  AdaptiveHookScope,
  AdaptiveHookScopeKind,
  JsonValue,
  LintIssue,
  LintResult,
  SourceAdaptiveHook,
  SourceAdaptiveHookScriptReference,
  SourceHookAttachment,
} from "./types";
export {
  RENDER_RESULT_SCHEMA,
  RENDER_RESULT_STATUS_VALUES,
  SkillsetRenderResultError,
  assertRenderResult,
  defineRenderResult,
  normalizeRenderResult,
  serializeRenderResult,
  type SkillsetRenderResult,
  type SkillsetRenderResultDiagnosticRef,
  type SkillsetRenderResultInput,
  type SkillsetRenderResultOutput,
  type SkillsetRenderResultPolicy,
  type SkillsetRenderResultStatus,
} from "./render-result";
export {
  compareNormalizedOutputTreeEntries,
  compareNormalizedOutputTrees,
  formatNormalizedTreeComparison,
  readNormalizedOutputTree,
  type NormalizedOutputTree,
  type NormalizedOutputTreeEntry,
  type NormalizedOutputTreeOptions,
  type NormalizedTreeComparison,
  type NormalizedTreeDifference,
  type NormalizedTreeDifferenceKind,
} from "./normalized-output-tree";
export {
  SkillsetFeatureDiagnosticError,
} from "./operation-result";
export type {
  SkillsetDiagnostic,
  SkillsetDiagnosticSeverity,
  SkillsetOperation,
  SkillsetOperationResult,
  SkillsetWriteMode,
  SkillsetWriteSummary,
} from "./operation-result";
export {
  OUTPUT_BACKUP_ROOT,
  restoreOutputBackup,
  type OutputBackupAction,
  type OutputBackupManifest,
  type OutputBackupReason,
  type OutputBackupRecord,
  type OutputBackupRestoreReport,
  type OutputBackupSummary,
} from "./output-safety";
export type { SkillsetOptions } from "./types";
export {
  VERSION_DRIFT_STATUS_VALUES,
  auditVersions,
  type VersionAuditReport,
  type VersionAuthority,
  type VersionDriftStatus,
  type VersionLocus,
} from "./version-audit";
