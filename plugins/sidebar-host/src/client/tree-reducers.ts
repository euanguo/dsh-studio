/**
 * Pure SplitNode tree reducers (M3): every operation that walks or mutates
 * the split-pane workbench tree — map/first/clear/find/traverse, split a
 * leaf, insert a leaf beside one, remove a leaf, resize a split. All are
 * pure functions over the node; the state-level reducers in state.ts
 * delegate to these.
 */
import { uid, type SidebarLeaf, type SidebarSplit, type SidebarTab, type SplitNode } from './state.ts'


/** Whether a tree node (or any descendant) carries the given pane/split id. */
export function treeHasId(node: SplitNode, id: string): boolean {
  if (node.id === id) return true
  if (node.kind === 'split') return node.children.some(child => treeHasId(child, id))
  return false
}

/** Walk the tree and apply `visit` to the leaf with the given id. */
export function mapLeaf(node: SplitNode, paneId: string, visit: (leaf: SidebarLeaf) => void): SplitNode {
  if (node.kind === 'leaf') {
    if (node.id === paneId) {
      const copy: SidebarLeaf = { ...node, tabs: [...node.tabs] }
      visit(copy)
      return copy
    }
    return node
  }
  const split = node
  return {
    ...split,
    sizes: [...split.sizes],
    children: split.children.map(child => mapLeaf(child, paneId, visit)),
  }
}

/** The first leaf of the tree (fallback pane when activePane is gone). */
export function firstLeaf(node: SplitNode): SidebarLeaf {
  if (node.kind === 'leaf') return node
  return firstLeaf(node.children[0]!)
}

/** Empty every leaf of a tree (the bottom tree after its tabs migrate out). */
export function clearAllTabs(node: SplitNode): SplitNode {
  if (node.kind === 'leaf') return { ...node, tabs: [], active: null }
  return { ...node, children: node.children.map(clearAllTabs) }
}

/** Find the leaf containing a tab id, if any. */
export function leafWithTab(node: SplitNode, tabId: string): SidebarLeaf | undefined {
  if (node.kind === 'leaf') {
    return node.tabs.some(tab => tab.id === tabId) ? node : undefined
  }
  for (const child of node.children) {
    const found = leafWithTab(child, tabId)
    if (found !== undefined) return found
  }
  return undefined
}

/** All leaves of the tree, depth-first. */
export function allLeaves(node: SplitNode): SidebarLeaf[] {
  if (node.kind === 'leaf') return [node]
  return node.children.flatMap(allLeaves)
}

/** Replace a leaf with a split of it plus a fresh empty leaf. */
export function splitLeafAt(node: SplitNode, paneId: string, dir: 'row' | 'col'): SplitNode {
  const fresh: SidebarLeaf = { kind: 'leaf', id: uid('pane'), tabs: [], active: null }
  return mapLeaf(node, paneId, (leaf) => {
    const target: SidebarLeaf = { ...leaf }
    const split: SidebarSplit = {
      kind: 'split',
      id: uid('split'),
      dir,
      sizes: [0.5, 0.5],
      children: [target, fresh],
    }
    Object.assign(leaf, split)
  })
}

/**
 * Split a leaf by inserting a fresh leaf holding `tab` beside it — the
 * VSCode drag-to-edge gesture. `dir` is the split direction ('row' for
 * left/right, 'col' for up/down); `front` places the new leaf first (left/
 * up) or second (right/down).
 * @returns the new tree plus the fresh leaf's id (the drop's active pane).
 */
export function insertLeafAt(
  node: SplitNode,
  paneId: string,
  dir: 'row' | 'col',
  tab: SidebarTab,
  front: boolean,
): { node: SplitNode; leafId: string } {
  const fresh: SidebarLeaf = { kind: 'leaf', id: uid('pane'), tabs: [tab], active: tab.id }
  const leafId = fresh.id
  const next = mapLeaf(node, paneId, (leaf) => {
    const target: SidebarLeaf = { ...leaf }
    const split: SidebarSplit = {
      kind: 'split',
      id: uid('split'),
      dir,
      sizes: [0.5, 0.5],
      children: front ? [fresh, target] : [target, fresh],
    }
    Object.assign(leaf, split)
  })
  return { node: next, leafId }
}

/**
 * Remove a leaf from the tree. A split left with one child promotes that
 * child; removing the last leaf yields an empty leaf.
 */
export function removeLeafAt(node: SplitNode, paneId: string): SplitNode {
  if (node.kind === 'leaf') return node.id === paneId ? { ...node, tabs: [], active: null } : node
  const children = node.children.filter(child => !(child.kind === 'leaf' && child.id === paneId))
  if (children.length === node.children.length) {
    return {
      ...node,
      sizes: [...node.sizes],
      children: node.children.map(child => removeLeafAt(child, paneId)),
    }
  }
  if (children.length === 1) return children[0]!
  return { ...node, sizes: [...node.sizes], children }
}

/** Adjust one split divider: `i` is the left/top child index, delta in fractions. */
export function resizeSplit(node: SplitNode, splitId: string, index: number, delta: number): SplitNode {
  if (node.kind === 'leaf') return node
  if (node.id === splitId) {
    const sizes = [...node.sizes]
    const left = Math.min(0.92, Math.max(0.08, sizes[index]! + delta))
    const right = Math.min(0.92, Math.max(0.08, sizes[index + 1]! - delta))
    sizes[index] = left
    sizes[index + 1] = right
    return { ...node, sizes }
  }
  return {
    ...node,
    sizes: [...node.sizes],
    children: node.children.map(child => resizeSplit(child, splitId, index, delta)),
  }
}
