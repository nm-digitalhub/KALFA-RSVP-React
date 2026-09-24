// The handle ids every starter template in this folder wires its edges with.
//
// ⚠️ NO 'use client', AND THAT IS DELIBERATE. This module imports nothing and
// holds two strings; it reaches the client graph only through the template
// files, which are 'use client' themselves. The directive would add nothing
// there, and would turn these plain strings into client references for any
// server module that imported them.
//
// `sourceHandle` on a plain node's only output. The SDK spells the outer
// handles with the bare type name; `getHandleId({ handleType: 'source' })`
// returns exactly this string.
export const SOURCE = 'source';
export const TARGET = 'target';
