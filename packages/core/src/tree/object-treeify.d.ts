declare module "object-treeify" {
  interface TreeifyOptions {
    joined?: boolean;
    spacerNoNeighbour?: string;
    spacerNeighbour?: string;
    keyNoNeighbour?: string;
    keyNeighbour?: string;
    separator?: string;
    renderFn?: (node: unknown) => string | undefined;
    sortFn?: ((a: string, b: string) => number) | null;
    breakCircularWith?: string | null;
  }

  function treeify(
    tree: Record<string, unknown>,
    options?: TreeifyOptions
  ): string;
  function treeify(
    tree: Record<string, unknown>,
    options?: TreeifyOptions & { joined: false }
  ): string[];

  export default treeify;
}
