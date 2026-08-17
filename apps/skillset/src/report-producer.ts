import { createHash } from "node:crypto";

import {
  createAdoptionReport,
  createExternalFixtureReport,
  createImportReport,
  createOperationReport,
  type CreateOperationReportInput,
} from "@skillset/core/internal/report";
import type {
  SkillsetAdoptionReportPayload,
  SkillsetExternalFixtureReportPayload,
  SkillsetExternalFixtureReportWorkspace,
  SkillsetImportReportPayload,
  SkillsetReportWorkspace,
  SkillsetTypedReportExitCode,
} from "@skillset/schema";

import { cliVersion } from "./cli-version";

export interface ExternalFixtureManifestEntryIdentity {
  readonly name: string;
  readonly notes?: string;
  readonly ref: string;
  readonly repo: string;
  readonly targets?: SkillsetExternalFixtureReportPayload["fixture"]["targets"];
}

/**
 * Hashes the parsed selected manifest entry after expanding its default target.
 * JSON keys are emitted in the fixed name, notes, ref, repo, targets order.
 */
export function externalFixtureManifestEntrySha256(
  entry: ExternalFixtureManifestEntryIdentity
): string {
  const canonicalJson = JSON.stringify({
    name: entry.name,
    ...(entry.notes === undefined ? {} : { notes: entry.notes }),
    ref: entry.ref,
    repo: entry.repo,
    targets: entry.targets ?? ["claude"],
  });
  return createHash("sha256").update(canonicalJson, "utf8").digest("hex");
}

export interface CreateCliOperationReportInput {
  readonly command: CreateOperationReportInput["command"];
  readonly exitCode: CreateOperationReportInput["exitCode"];
  readonly sentinels?: readonly string[] | undefined;
  readonly workspace: SkillsetReportWorkspace;
}

/** Creates a CLI-owned receipt without exposing Skillset-owned version or identity facts. */
export function createCliOperationReport(input: CreateCliOperationReportInput) {
  return createOperationReport({
    ...input,
    skillsetVersion: cliVersion,
  });
}

interface CreateCliTypedReportInput<
  Payload,
  Workspace extends SkillsetReportWorkspace = SkillsetReportWorkspace,
> {
  readonly exitCode: SkillsetTypedReportExitCode;
  readonly payload: Payload;
  readonly sentinels?: readonly string[] | undefined;
  readonly workspace: Workspace;
}

export function createCliAdoptionReport(
  input: CreateCliTypedReportInput<SkillsetAdoptionReportPayload>
) {
  return createAdoptionReport({ ...input, skillsetVersion: cliVersion });
}

export function createCliImportReport(
  input: CreateCliTypedReportInput<SkillsetImportReportPayload>
) {
  return createImportReport({ ...input, skillsetVersion: cliVersion });
}

export function createCliExternalFixtureReport(
  input: CreateCliTypedReportInput<
    SkillsetExternalFixtureReportPayload,
    SkillsetExternalFixtureReportWorkspace
  >
) {
  return createExternalFixtureReport({ ...input, skillsetVersion: cliVersion });
}
