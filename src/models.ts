type FileName = string;
type FilePath = string;
export type Node = { path: FilePath; fileName: FileName };
export type Relation = { from: Node; to: Node; fullText: string };

export function isSameNode(a: Node, b: Node): boolean {
  return a.path === b.path;
}
export function isSameRelation(a: Relation, b: Relation): boolean {
  return isSameNode(a.from, b.from) && isSameNode(a.to, b.to);
}
