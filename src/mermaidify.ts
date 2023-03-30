import path from 'path';
import { Graph, Node, OptionValues, Relation } from './models';

/** ディレクトリツリーを表現するオブジェクト */
type DirAndNodesTree = {
  currentDir: string;
  nodes: Node[];
  children: DirAndNodesTree[];
};
type Options = Partial<OptionValues> & {
  rootDir: string;
};

const indent = '    ';
const CLASSNAME_DIR = 'dir';
const CLASSNAME_HIGHLIGHT = 'highlight';

export default async function mermaidify(
  write: (arg: string) => void,
  graph: Graph,
  options: Options,
) {
  // フローチャートの方向を指定
  if (options.LR) {
    write(`flowchart LR\n`);
  } else if (options.TB) {
    write(`flowchart TB\n`);
  } else {
    write(`flowchart\n`);
  }

  // 抽象化フラグが立っている場合は、クラス定義を追加
  if (options.abstraction)
    write(`${indent}classDef ${CLASSNAME_DIR} fill:#0000,stroke:#999\n`);

  // ハイライトフラグが立っている場合は、クラス定義を追加
  if (options.highlight)
    write(`${indent}classDef ${CLASSNAME_HIGHLIGHT} fill:yellow,color:black\n`);

  const dirAndNodesTree = createDirAndNodesTree(graph);
  writeFileNodesWithSubgraph(write, dirAndNodesTree);
  writeRelations(write, graph.relations);

  if (options.mermaidLink) {
    writeFileLink(write, dirAndNodesTree, options.rootDir);
  }
}

/**
 * Graph からディレクトリツリーを再現した DirAndNodesTree の配列を生成する
 */
function createDirAndNodesTree(graph: Graph): DirAndNodesTree[] {
  function getDirectoryPath(filePath: string) {
    const array = filePath.split('/');
    if (array.includes('node_modules')) {
      // node_modules より深いディレクトリ階層の情報は捨てる
      // node_modules 内の node の name はパッケージ名のようなものになっているのでそれで良い
      return 'node_modules';
    } else if (array.length === 1) {
      // トップレベルのファイルの場合
      return undefined;
    } else {
      // 末尾のファイル名は不要
      return path.join(...array.slice(0, array.length - 1));
    }
  }

  const allDir = graph.nodes
    .map(({ path }) => getDirectoryPath(path))
    .map(dirPath => {
      if (!dirPath) return undefined;
      const dirArray = dirPath.split('/');
      return dirArray.reduce((prev, current) => {
        const prevValue = prev.at(-1);
        if (prevValue) {
          prev.push(path.join(prevValue, current));
        } else {
          prev.push(current);
        }
        return prev;
      }, new Array<string>());
    })
    .flat()
    .reduce((pre, current) => {
      if (!current) return pre;
      // 重複除去
      if (pre.some(filePath => filePath === current)) return pre;
      pre.push(current);
      return pre;
    }, new Array<string>());

  type DirAndNodes = {
    currentDir: string;
    dirHierarchy: string[];
    nodes: Node[];
  };

  const dirAndNodes: DirAndNodes[] = allDir.map(currentDir => ({
    currentDir,
    dirHierarchy: currentDir.split('/'),
    nodes: graph.nodes.filter(
      node => getDirectoryPath(node.path) === currentDir,
    ),
  }));

  function isChild(parentDirHierarchy: string[], candidate: string[]) {
    if (parentDirHierarchy.length !== candidate.length - 1) return false;
    return parentDirHierarchy.every(
      (tmpdirname, i) => tmpdirname === candidate[i],
    );
  }

  function createDirAndNodesRecursive({
    currentDir,
    nodes,
    dirHierarchy,
  }: DirAndNodes): DirAndNodesTree[] {
    if (
      nodes.length === 0 &&
      dirAndNodes.filter(item => isChild(dirHierarchy, item.dirHierarchy))
        .length <= 1
    ) {
      return dirAndNodes
        .filter(item => isChild(dirHierarchy, item.dirHierarchy))
        .map(createDirAndNodesRecursive)
        .flat();
    }
    return [
      {
        currentDir,
        nodes,
        children: dirAndNodes
          .filter(item => isChild(dirHierarchy, item.dirHierarchy))
          .map(createDirAndNodesRecursive)
          .flat(),
      },
    ];
  }

  const dirAndNodesTree = dirAndNodes
    .filter(dirAndNode => dirAndNode.dirHierarchy.length === 1)
    .map(createDirAndNodesRecursive)
    .flat();
  return dirAndNodesTree;
}

function writeRelations(write: (arg: string) => void, relations: Relation[]) {
  relations
    .map(relation => ({
      from: {
        ...relation.from,
        mermaidId: fileNameToMermaidId(relation.from.path),
      },
      to: {
        ...relation.to,
        mermaidId: fileNameToMermaidId(relation.to.path),
      },
    }))
    .forEach(relation => {
      write(`    ${relation.from.mermaidId}-->${relation.to.mermaidId}`);
      write('\n');
    });
}

function fileNameToMermaidId(fileName: string): string {
  return fileName
    .split(/@|\[|\]|-|>|<|{|}|\(|\)|=|&|\|~|,|"|%|\^|\*|_/)
    .join('//')
    .replaceAll('/graph/', '/_graph_/')
    .replaceAll('style', 'style_')
    .replaceAll('graph', 'graph_')
    .replaceAll('class', 'class_');
}
function fileNameToMermaidName(fileName: string): string {
  return fileName.split(/"/).join('//');
}

function writeFileNodesWithSubgraph(
  write: (arg: string) => void,
  trees: DirAndNodesTree[],
) {
  trees.forEach(tree => addGraph(write, tree));
}

function addGraph(
  write: (arg: string) => void,
  tree: DirAndNodesTree,
  indentNumber = 0,
  parent?: string,
) {
  let _indent = indent;
  for (let i = 0; i < indentNumber; i++) {
    _indent = _indent + indent;
  }
  write(
    `${_indent}subgraph ${fileNameToMermaidId(
      tree.currentDir,
    )}["${fileNameToMermaidName(
      parent ? tree.currentDir.replace(parent, '') : tree.currentDir,
    )}"]`,
  );
  write('\n');
  tree.nodes
    .map(node => ({ ...node, mermaidId: fileNameToMermaidId(node.path) }))
    .forEach(node => {
      write(
        `${_indent}${indent}${node.mermaidId}["${fileNameToMermaidName(
          node.name,
        )}"]${
          node.highlight
            ? `:::${CLASSNAME_HIGHLIGHT}`
            : node.isDirectory
            ? `:::${CLASSNAME_DIR}`
            : ''
        }`,
      );
      write('\n');
    });
  tree.children.forEach(child =>
    addGraph(write, child, indentNumber + 1, tree.currentDir),
  );
  write(`${_indent}end`);
  write('\n');
}
function writeFileLink(
  write: (arg: string) => void,
  trees: DirAndNodesTree[],
  rootDir: string,
) {
  trees.forEach(tree => addLink(write, tree, rootDir));
}

function addLink(
  write: (arg: string) => void,
  tree: DirAndNodesTree,
  rootDir: string,
): void {
  tree.nodes
    .map(node => ({ ...node, mermaidId: fileNameToMermaidId(node.path) }))
    .forEach(node => {
      write(
        `${indent}click ${node.mermaidId} href "vscode://file/${path.join(
          rootDir,
          node.path,
        )}" _blank`,
      );
      write('\n');
    });
  tree.children.forEach(child => addLink(write, child, rootDir));
}
