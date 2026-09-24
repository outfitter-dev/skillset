interface GeneratedOperation {
  readonly kind: "create" | "delete" | "update";
  readonly path: string;
}

export const publicGeneratedOperation = (operation: GeneratedOperation) => ({
  kind: operation.kind,
  path: operation.path,
});
