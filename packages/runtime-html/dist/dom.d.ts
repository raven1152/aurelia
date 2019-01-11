import { IContainer, IResolver } from '@aurelia/kernel';
import { IDOM, INode, IRenderLocation } from '@aurelia/runtime';
export declare const enum NodeType {
    Element = 1,
    Attr = 2,
    Text = 3,
    CDATASection = 4,
    EntityReference = 5,
    Entity = 6,
    ProcessingInstruction = 7,
    Comment = 8,
    Document = 9,
    DocumentType = 10,
    DocumentFragment = 11,
    Notation = 12
}
export declare class HTMLDOM implements IDOM {
    readonly Node: typeof Node;
    readonly Element: typeof Element;
    readonly HTMLElement: typeof HTMLElement;
    private readonly wnd;
    private readonly doc;
    constructor(wnd: Window, doc: Document, TNode: typeof Node, TElement: typeof Element, THTMLElement: typeof HTMLElement);
    addEventListener(eventName: string, subscriber: EventListenerOrEventListenerObject, publisher?: Node, options?: boolean | AddEventListenerOptions): void;
    appendChild(parent: Node, child: Node): void;
    cloneNode<T>(node: T, deep?: boolean): T;
    convertToRenderLocation(node: Node): IRenderLocation;
    createDocumentFragment(markupOrNode?: string | Node): DocumentFragment;
    createElement(name: string): HTMLElement;
    createNodeObserver(node: Node, cb: MutationCallback, init: MutationObserverInit): MutationObserver;
    createTemplate(markup?: unknown): HTMLTemplateElement;
    createTextNode(text: string): Text;
    insertBefore(nodeToInsert: Node, referenceNode: Node): void;
    isMarker(node: unknown): node is HTMLElement;
    isNodeInstance(potentialNode: unknown): potentialNode is Node;
    isRenderLocation(node: unknown): node is IRenderLocation;
    makeTarget(node: unknown): void;
    registerElementResolver(container: IContainer, resolver: IResolver): void;
    remove(node: Node): void;
    removeEventListener(eventName: string, subscriber: EventListenerOrEventListenerObject, publisher?: Node, options?: boolean | EventListenerOptions): void;
    setAttribute(node: Element, name: string, value: unknown): void;
}
export interface AuMarker extends INode {
}
//# sourceMappingURL=dom.d.ts.map