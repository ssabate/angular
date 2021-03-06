/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {assertDefined} from '../util/assert';

import {ACTIVE_INDEX, LContainer, NATIVE, VIEWS} from './interfaces/container';
import {TNode} from './interfaces/node';
import {LQueries} from './interfaces/query';
import {RComment, RElement} from './interfaces/renderer';
import {StylingContext} from './interfaces/styling';
import {BINDING_INDEX, CHILD_HEAD, CHILD_TAIL, CLEANUP, CONTENT_QUERIES, CONTEXT, DECLARATION_VIEW, FLAGS, HEADER_OFFSET, HOST, INJECTOR, LView, LViewFlags, NEXT, PARENT, QUERIES, RENDERER, RENDERER_FACTORY, SANITIZER, TVIEW, TView, T_HOST} from './interfaces/view';
import {unwrapRNode} from './util/view_utils';

/*
 * This file contains conditionally attached classes which provide human readable (debug) level
 * information for `LView`, `LContainer` and other internal data structures. These data structures
 * are stored internally as array which makes it very difficult during debugging to reason about the
 * current state of the system.
 *
 * Patching the array with extra property does change the array's hidden class' but it does not
 * change the cost of access, therefore this patching should not have significant if any impact in
 * `ngDevMode` mode. (see: https://jsperf.com/array-vs-monkey-patch-array)
 *
 * So instead of seeing:
 * ```
 * Array(30) [Object, 659, null, …]
 * ```
 *
 * You get to see:
 * ```
 * LViewDebug {
 *   views: [...],
 *   flags: {attached: true, ...}
 *   nodes: [
 *     {html: '<div id="123">', ..., nodes: [
 *       {html: '<span>', ..., nodes: null}
 *     ]}
 *   ]
 * }
 * ```
 */


export function attachLViewDebug(lView: LView) {
  (lView as any).debug = new LViewDebug(lView);
}

export function attachLContainerDebug(lContainer: LContainer) {
  (lContainer as any).debug = new LContainerDebug(lContainer);
}

export function toDebug(obj: LView): LViewDebug;
export function toDebug(obj: LView | null): LViewDebug|null;
export function toDebug(obj: LView | LContainer | null): LViewDebug|LContainerDebug|null;
export function toDebug(obj: any): any {
  if (obj) {
    const debug = (obj as any).debug;
    assertDefined(debug, 'Object does not have a debug representation.');
    return debug;
  } else {
    return obj;
  }
}

/**
 * Use this method to unwrap a native element in `LView` and convert it into HTML for easier
 * reading.
 *
 * @param value possibly wrapped native DOM node.
 * @param includeChildren If `true` then the serialized HTML form will include child elements (same
 * as `outerHTML`). If `false` then the serialized HTML form will only contain the element itself
 * (will not serialize child elements).
 */
function toHtml(value: any, includeChildren: boolean = false): string|null {
  const node: HTMLElement|null = unwrapRNode(value) as any;
  if (node) {
    const isTextNode = node.nodeType === Node.TEXT_NODE;
    const outerHTML = (isTextNode ? node.textContent : node.outerHTML) || '';
    if (includeChildren || isTextNode) {
      return outerHTML;
    } else {
      const innerHTML = node.innerHTML;
      return outerHTML.split(innerHTML)[0] || null;
    }
  } else {
    return null;
  }
}

export class LViewDebug {
  constructor(private readonly _raw_lView: LView) {}

  /**
   * Flags associated with the `LView` unpacked into a more readable state.
   */
  get flags() {
    const flags = this._raw_lView[FLAGS];
    return {
      __raw__flags__: flags,
      initPhaseState: flags & LViewFlags.InitPhaseStateMask,
      creationMode: !!(flags & LViewFlags.CreationMode),
      firstViewPass: !!(flags & LViewFlags.FirstLViewPass),
      checkAlways: !!(flags & LViewFlags.CheckAlways),
      dirty: !!(flags & LViewFlags.Dirty),
      attached: !!(flags & LViewFlags.Attached),
      destroyed: !!(flags & LViewFlags.Destroyed),
      isRoot: !!(flags & LViewFlags.IsRoot),
      indexWithinInitPhase: flags >> LViewFlags.IndexWithinInitPhaseShift,
    };
  }
  get parent(): LViewDebug|LContainerDebug|null { return toDebug(this._raw_lView[PARENT]); }
  get host(): string|null { return toHtml(this._raw_lView[HOST], true); }
  get context(): {}|null { return this._raw_lView[CONTEXT]; }
  /**
   * The tree of nodes associated with the current `LView`. The nodes have been normalized into a
   * tree structure with relevant details pulled out for readability.
   */
  get nodes(): DebugNode[]|null {
    const lView = this._raw_lView;
    const tNode = lView[TVIEW].firstChild;
    return toDebugNodes(tNode, lView);
  }
  /**
   * Additional information which is hidden behind a property. The extra level of indirection is
   * done so that the debug view would not be cluttered with properties which are only rarely
   * relevant to the developer.
   */
  get __other__() {
    return {
      tView: this._raw_lView[TVIEW],
      cleanup: this._raw_lView[CLEANUP],
      injector: this._raw_lView[INJECTOR],
      rendererFactory: this._raw_lView[RENDERER_FACTORY],
      renderer: this._raw_lView[RENDERER],
      sanitizer: this._raw_lView[SANITIZER],
      childHead: toDebug(this._raw_lView[CHILD_HEAD]),
      next: toDebug(this._raw_lView[NEXT]),
      childTail: toDebug(this._raw_lView[CHILD_TAIL]),
      declarationView: toDebug(this._raw_lView[DECLARATION_VIEW]),
      contentQueries: this._raw_lView[CONTENT_QUERIES],
      queries: this._raw_lView[QUERIES],
      tHost: this._raw_lView[T_HOST],
      bindingIndex: this._raw_lView[BINDING_INDEX],
    };
  }

  /**
   * Normalized view of child views (and containers) attached at this location.
   */
  get childViews(): Array<LViewDebug|LContainerDebug> {
    const childViews: Array<LViewDebug|LContainerDebug> = [];
    let child = this.__other__.childHead;
    while (child) {
      childViews.push(child);
      child = child.__other__.next;
    }
    return childViews;
  }
}

export interface DebugNode {
  html: string|null;
  native: Node;
  nodes: DebugNode[]|null;
  component: LViewDebug|null;
}

/**
 * Turns a flat list of nodes into a tree by walking the associated `TNode` tree.
 *
 * @param tNode
 * @param lView
 */
export function toDebugNodes(tNode: TNode | null, lView: LView): DebugNode[]|null {
  if (tNode) {
    const debugNodes: DebugNode[] = [];
    let tNodeCursor: TNode|null = tNode;
    while (tNodeCursor) {
      const rawValue = lView[tNode.index];
      const native = unwrapRNode(rawValue);
      const componentLViewDebug = toDebug(readLViewValue(rawValue));
      debugNodes.push({
        html: toHtml(native),
        native: native as any,
        nodes: toDebugNodes(tNode.child, lView),
        component: componentLViewDebug
      });
      tNodeCursor = tNodeCursor.next;
    }
    return debugNodes;
  } else {
    return null;
  }
}

export class LContainerDebug {
  constructor(private readonly _raw_lContainer: LContainer) {}

  get activeIndex(): number { return this._raw_lContainer[ACTIVE_INDEX]; }
  get views(): LViewDebug[] {
    return this._raw_lContainer[VIEWS].map(toDebug as(l: LView) => LViewDebug);
  }
  get parent(): LViewDebug|LContainerDebug|null { return toDebug(this._raw_lContainer[PARENT]); }
  get queries(): LQueries|null { return this._raw_lContainer[QUERIES]; }
  get host(): RElement|RComment|StylingContext|LView { return this._raw_lContainer[HOST]; }
  get native(): RComment { return this._raw_lContainer[NATIVE]; }
  get __other__() {
    return {
      next: toDebug(this._raw_lContainer[NEXT]),
    };
  }
}

/**
 * Return an `LView` value if found.
 *
 * @param value `LView` if any
 */
export function readLViewValue(value: any): LView|null {
  while (Array.isArray(value)) {
    // This check is not quite right, as it does not take into account `StylingContext`
    // This is why it is in debug, not in util.ts
    if (value.length >= HEADER_OFFSET - 1) return value as LView;
    value = value[HOST];
  }
  return null;
}
