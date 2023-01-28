import { createWriteStream } from 'fs';
import path from 'path';
import { Graph, isSameNode, Node, Relation } from './models';

type DirAndNodesTree = {
  currentDir: string;
  nodes: Node[];
  children: DirAndNodesTree[];
};

export default async function mermaidify(markdownTitle: string, graph: Graph) {
  const dirAndNodesTree = createDirAndNodesTree(graph);
  await writeMarkdown(markdownTitle, dirAndNodesTree, graph.relations);
}

/**
 * ディレクトリツリーの形を再現する。
 */
function createDirAndNodesTree(graph: Graph) {
  function getDirectoryPath(filePath: string) {
    const array = filePath.split('/');
    if (array.includes('node_modules')) {
      // node_modules より深いディレクトリ階層の情報は捨てる
      // node_modules 内の node の name はパッケージ名のようなものになっているのでそれで良い
      return 'node_modules';
    } else {
      // 末尾のファイル名は不要
      return path.join(...array.slice(0, array.length - 1));
    }
  }

  const allDir = graph.nodes
    .map(({ path }) => getDirectoryPath(path))
    .map(dirPath => {
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

async function writeMarkdown(
  title: string,
  dirAndNodesTree: DirAndNodesTree[],
  relations: Relation[],
) {
  return new Promise((resolve, reject) => {
    const ws = createWriteStream(`./${title}.md`);
    ws.on('finish', resolve);
    ws.on('error', reject);
    ws.write('# typescript graph on mermaid\n');
    ws.write('\n');
    ws.write('```mermaid\n');
    ws.write('flowchart LR');
    ws.write('\n');
    const indent = '    ';
    function addGraph(tree: DirAndNodesTree) {
      ws.write(
        `${indent}subgraph ${fileNameToMermaidId(tree.currentDir)}["${
          tree.currentDir
        }"]`,
      );
      ws.write('\n');
      tree.nodes
        .map(node => ({ ...node, mermaidId: fileNameToMermaidId(node.path) }))
        .forEach(node => {
          ws.write(`${indent}${indent}${node.mermaidId}["${node.fileName}"]`);
          ws.write('\n');
        });
      tree.children.forEach(addGraph);
      ws.write(`${indent}end`);
      ws.write('\n');
    }

    dirAndNodesTree.forEach(addGraph);

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
        ws.write(`    ${relation.from.mermaidId}-->${relation.to.mermaidId}`);
        ws.write('\n');
      });
    ws.end('```\n');
  });
}

function fileNameToMermaidId(fileName: string): string {
  return fileName.split(/@|\[|\]/).join('__');
}