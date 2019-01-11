import { DI, Registration, IContainer } from '@aurelia/kernel';
import { IDOMInitializer, IDOM } from '@aurelia/runtime';
import { BasicConfiguration, HTMLDOM } from '@aurelia/runtime-html';
import { JSDOM } from 'jsdom';

class JSDOMInitializer {
    constructor(container) {
        this.container = container;
        this.jsdom = new JSDOM();
    }
    static register(container) {
        return Registration.singleton(IDOMInitializer, this).register(container);
    }
    initialize(config) {
        if (this.container.has(IDOM, false)) {
            return this.container.get(IDOM);
        }
        let dom;
        if (config !== undefined) {
            if (config.dom !== undefined) {
                dom = config.dom;
            }
            else if (config.host.ownerDocument) {
                dom = new HTMLDOM(this.jsdom.window, config.host.ownerDocument, this.jsdom.window.Node, this.jsdom.window.Element, this.jsdom.window.HTMLElement);
            }
            else {
                if (config.host) {
                    this.jsdom.window.document.body.appendChild(config.host);
                }
                dom = new HTMLDOM(this.jsdom.window, this.jsdom.window.document, this.jsdom.window.Node, this.jsdom.window.Element, this.jsdom.window.HTMLElement);
            }
        }
        else {
            dom = new HTMLDOM(this.jsdom.window, this.jsdom.window.document, this.jsdom.window.Node, this.jsdom.window.Element, this.jsdom.window.HTMLElement);
        }
        Registration.instance(IDOM, dom).register(this.container);
        return dom;
    }
}
JSDOMInitializer.inject = [IContainer];
const IDOMInitializerRegistration = JSDOMInitializer;
/**
 * Default HTML-specific, jsdom-specific implementations for the following interfaces:
 * - `IDOMInitializer`
 */
const DefaultComponents = [
    IDOMInitializerRegistration
];
/**
 * A DI configuration object containing html-specific, jsdom-specific registrations:
 * - `BasicConfiguration` from `@aurelia/runtime-html`
 * - `DefaultComponents`
 */
const BasicConfiguration$1 = {
    /**
     * Apply this configuration to the provided container.
     */
    register(container) {
        return BasicConfiguration
            .register(container)
            .register(...DefaultComponents);
    },
    /**
     * Create a new container with this configuration applied to it.
     */
    createContainer() {
        return this.register(DI.createContainer());
    }
};

export { IDOMInitializerRegistration, DefaultComponents, BasicConfiguration$1 as BasicConfiguration };
//# sourceMappingURL=index.es6.js.map
