/**
 * ABACO — Minimal JSX runtime shim
 * --------------------------------------------------------------------
 * The button-bar component is intentionally host-agnostic: it doesn't
 * import React or any other UI library. Instead it uses this tiny
 * `h(...)` factory that produces a `VNode`-compatible object tree.
 *
 * Why?
 *  - The same `.tsx` source can be rendered by React 18, Preact, or
 *    a custom harness renderer that understands the shape `{ type,
 *    props, children }`.
 *  - No build step is required for this file — the host shell wires
 *    the appropriate renderer (React.createElement, preact's h, etc.)
 *    in one place, and every ABACO feature consumes it for free.
 *
 * If the host already uses React, just do:
 *
 *     import { createElement as h } from 'react';
 *     import type * as React from 'react';
 *     export * from 'react';
 *
 * and delete this file.
 */

export type MouseEvent = {
    currentTarget: HTMLElement;
    preventDefault: () => void;
    stopPropagation: () => void;
};

export type CSSProperties = Record<string, string | number>;

export type VNodeProps = {
    [key: string]: unknown;
    children?: VNode | VNode[] | string | (VNode | string)[];
    style?: CSSProperties;
    className?: string;
    onClick?: (ev: MouseEvent) => void;
    onMouseEnter?: (ev: MouseEvent) => void;
    onMouseLeave?: (ev: MouseEvent) => void;
    onMouseDown?: (ev: MouseEvent) => void;
    onMouseUp?: (ev: MouseEvent) => void;
    dangerouslySetInnerHTML?: { __html: string };
};

export interface VNode {
    type: string;
    props: VNodeProps;
}

const flatten = (children: unknown[]): VNode[] => {
    const out: VNode[] = [];
    for (const c of children) {
        if (c == null || c === false) continue;
        if (Array.isArray(c)) out.push(...flatten(c));
        else if (typeof c === 'string') out.push({ type: '__text', props: { children: c } });
        else out.push(c as VNode);
    }
    return out;
};

export function h(
    type: string,
    props: VNodeProps | null,
    ...children: unknown[]
): VNode {
    const safeProps = props ?? {};
    return {
        type,
        props: {
            ...safeProps,
            children: flatten(children),
        },
    };
}
