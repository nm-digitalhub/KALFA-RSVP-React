'use client';

// Ported from the reference app's components/execution/highlighting.tsx.
//
// The approach is theirs and it is the only one available: the SDK renders nodes
// and edges itself, and exposes no prop to colour one by execution status. So a
// stylesheet is generated from the store and appended to <head>, keyed on the
// data attributes ReactFlow puts in the DOM.
//
// THAT IS A COUPLING TO SDK INTERNALS. `[class*="node-panel-wrapper"]` matches a
// hashed CSS-module class by prefix; an SDK upgrade that renames it stops
// matching, silently, with no error and no failing test. The browser check on
// this page is the only thing that catches it — recorded here because the next
// person to bump the SDK needs to know to look.
import { getStoreEdges } from '@workflowbuilder/sdk';
import { useEffect, useMemo } from 'react';

import './highlighting.css';

import { useExecutionStore, type NodeExecutionState } from './use-execution-store';

const STYLE_ELEMENT_ID = 'kalfa-workflow-highlighting';

// Ids reach an attribute selector verbatim. React Flow generates safe ones, but
// an imported diagram's ids are arbitrary strings and an unescaped quote would
// terminate the selector early and corrupt every rule after it.
function escapeAttr(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

const nodeSelector = (nodeId: string) =>
  `[data-id="${escapeAttr(nodeId)}"]:not(.selected) [class*="node-panel-wrapper"] > div`;
const edgeSelector = (edgeId: string) =>
  `g:not(.selected) > [data-edge-id="${escapeAttr(edgeId)}"]`;

function appendCSS(styleContent: string) {
  let element = document.querySelector<HTMLStyleElement>(`#${STYLE_ELEMENT_ID}`);
  if (!element) {
    element = document.createElement('style');
    element.id = STYLE_ELEMENT_ID;
    document.head.append(element);
  }
  element.textContent = styleContent;
}

export function ExecutionHighlighting() {
  const nodeStates = useExecutionStore((s) => s.nodeStates);

  const cssContent = useMemo(() => {
    const byStatus = { running: [] as string[], completed: [] as string[], failed: [] as string[] };
    const nonIdleNodes = new Set<string>();

    for (const [nodeId, state] of Object.entries(nodeStates) as [string, NodeExecutionState][]) {
      // A skipped node is deliberately excluded from `nonIdleNodes`: its edges
      // must stay dark, because "skipped" IS the branch the run did not take,
      // and lighting it would say the opposite of what happened.
      if (state.status !== 'idle' && state.status !== 'skipped') {
        nonIdleNodes.add(nodeId);
      }

      switch (state.status) {
        case 'running':
          byStatus.running.push(nodeId);
          break;
        case 'completed':
          byStatus.completed.push(nodeId);
          break;
        case 'failed':
          byStatus.failed.push(nodeId);
          break;
      }
    }

    // An edge lights only when BOTH ends ran.
    const activeEdgeIds: string[] = [];
    if (nonIdleNodes.size > 0) {
      for (const edge of getStoreEdges()) {
        if (nonIdleNodes.has(edge.source) && nonIdleNodes.has(edge.target)) {
          activeEdgeIds.push(edge.id);
        }
      }
    }

    let css = '';

    if (activeEdgeIds.length > 0) {
      css += `${activeEdgeIds.map(edgeSelector).join(', ')} {
        stroke: var(--kalfa-wf-edge-color--active) !important;
        stroke-width: 5 !important;
      }`;
    }
    if (byStatus.running.length > 0) {
      css += `${byStatus.running.map(nodeSelector).join(', ')} { box-shadow: var(--kalfa-wf-node-shadow--active) !important; }`;
    }
    if (byStatus.completed.length > 0) {
      css += `${byStatus.completed.map(nodeSelector).join(', ')} { box-shadow: var(--kalfa-wf-node-shadow--completed) !important; }`;
    }
    if (byStatus.failed.length > 0) {
      css += `${byStatus.failed.map(nodeSelector).join(', ')} { box-shadow: var(--kalfa-wf-node-shadow--failed) !important; }`;
    }

    return css;
  }, [nodeStates]);

  useEffect(() => {
    appendCSS(cssContent);
  }, [cssContent]);

  // Removed on unmount. The reference app leaves its <style> in <head> for the
  // life of the page, which is right for a single-purpose app and wrong here:
  // /admin is a long-lived shell, so a stale sheet would keep styling node ids
  // on whatever route the admin navigated to next.
  useEffect(() => {
    return () => {
      document.querySelector(`#${STYLE_ELEMENT_ID}`)?.remove();
    };
  }, []);

  return null;
}
