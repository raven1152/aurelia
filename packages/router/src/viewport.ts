import { RouteRecognizer, RouteHandler, ConfigurableRoute, RecognizeResult } from './route-recognizer';
import { IContainer, Reporter } from '@aurelia/kernel';
import { IRenderContext, LifecycleFlags, IController } from '@aurelia/runtime';
import { ComponentAppellation, INavigatorInstruction, IRouteableComponent, ReentryBehavior, IRoute, RouteableComponentType } from './interfaces';
import { INavigatorFlags } from './navigator';
import { FoundRoute } from './found-route';
import { IRouter } from './router';
import { arrayRemove } from './utils';
import { ViewportContent } from './viewport-content';
import { ViewportInstruction } from './viewport-instruction';
import { RouteTable } from './route-table';
import { NavigationInstructionResolver } from './type-resolvers';

export interface IFindViewportsResult {
  foundViewports: ViewportInstruction[];
  remainingInstructions: ViewportInstruction[];
}

export interface IViewportOptions {
  scope?: boolean;
  usedBy?: string | string[];
  default?: string;
  noLink?: boolean;
  noHistory?: boolean;
  stateful?: boolean;
  forceDescription?: boolean;
}

export class Viewport {
  public scope: Viewport | null = null;

  public content: ViewportContent;
  public nextContent: ViewportContent | null = null;

  public enabled: boolean = true;
  public forceRemove: boolean = false;

  public parent: Viewport | null = null;
  public children: Viewport[] = [];

  public routeTable: RouteTable | null = null;
  public path: string | null = null;

  private clear: boolean = false;
  private elementResolve?: ((value?: void | PromiseLike<void>) => void) | null = null;

  private previousViewportState: Viewport | null = null;

  private cache: ViewportContent[] = [];
  private historyCache: ViewportContent[] = [];

  public constructor(
    public readonly router: IRouter,
    public name: string,
    public element: Element | null,
    public context: IRenderContext | IContainer | null,
    public owningScope: Viewport | null,
    scope: boolean,
    public options: IViewportOptions = {}
  ) {
    this.scope = scope ? this : null;
    this.content = new ViewportContent();
  }

  public get doForceRemove(): boolean {
    let viewport: Viewport = this;
    let forceRemove = viewport.forceRemove;
    while (!forceRemove && viewport.parent !== null) {
      viewport = viewport.parent;
      forceRemove = viewport.forceRemove;
    }
    return forceRemove;
  }

  public setNextContent(content: ComponentAppellation | ViewportInstruction, instruction: INavigatorInstruction): boolean {
    let viewportInstruction: ViewportInstruction;
    if (content instanceof ViewportInstruction) {
      viewportInstruction = content;
    } else {
      if (typeof content === 'string') {
        viewportInstruction = this.router.instructionResolver.parseViewportInstruction(content);
      } else {
        viewportInstruction = new ViewportInstruction(content);
      }
    }
    viewportInstruction.setViewport(this);
    this.clear = this.router.instructionResolver.isClearViewportInstruction(viewportInstruction);

    // Can have a (resolved) type or a string (to be resolved later)
    this.nextContent = new ViewportContent(!this.clear ? viewportInstruction : void 0, instruction, this.context);

    this.nextContent.fromHistory = this.nextContent.componentInstance && instruction.navigation
      ? !!instruction.navigation.back || !!instruction.navigation.forward
      : false;

    if (this.options.stateful) {
      // TODO: Add a parameter here to decide required equality
      const cached = this.cache.find((item) => (this.nextContent as ViewportContent).isCacheEqual(item));
      if (cached) {
        this.nextContent = cached;
        this.nextContent.fromCache = true;
      } else {
        this.cache.push(this.nextContent);
      }
    }

    // If we get the same _instance_, don't do anything (happens with cached and history)
    if (this.nextContent.componentInstance !== null && this.content.componentInstance === this.nextContent.componentInstance) {
      this.nextContent = null;
      return false;
    }

    // ReentryBehavior 'refresh' takes precedence
    if (!this.content.equalComponent(this.nextContent) ||
      (instruction.navigation as INavigatorFlags).refresh ||
      this.content.reentryBehavior() === ReentryBehavior.refresh) {
      return true;
    }

    // Explicitly don't allow navigation back to the same component again
    if (this.content.reentryBehavior() === ReentryBehavior.disallow) {
      this.nextContent = null;
      return false;
    }

    // ReentryBehavior is now 'enter' or 'default'

    if (!this.content.equalParameters(this.nextContent) ||
      this.content.reentryBehavior() === ReentryBehavior.enter) {
      this.content.reentry = true;

      this.nextContent.content.setComponent(this.content.componentInstance!);
      this.nextContent.contentStatus = this.content.contentStatus;
      this.nextContent.reentry = this.content.reentry;
      return true;
    }

    this.nextContent = null;
    return false;
  }

  public setElement(element: Element, context: IRenderContext | IContainer, options: IViewportOptions): void {
    options = options || {};
    if (this.element !== element) {
      // TODO: Restore this state on navigation cancel
      this.previousViewportState = { ...this };
      this.clearState();
      this.element = element;
      if (options.usedBy) {
        this.options.usedBy = options.usedBy;
      }
      if (options.default) {
        this.options.default = options.default;
      }
      if (options.noLink) {
        this.options.noLink = options.noLink;
      }
      if (options.noHistory) {
        this.options.noHistory = options.noHistory;
      }
      if (options.stateful) {
        this.options.stateful = options.stateful;
      }
      if (this.elementResolve) {
        this.elementResolve();
      }
    }
    // TODO: Might not need this? Figure it out
    // if (context) {
    //   context['viewportName'] = this.name;
    // }
    if (this.context !== context) {
      this.context = context;
    }

    if (!this.content.componentInstance && (!this.nextContent || !this.nextContent.componentInstance) && this.options.default) {
      const instructions = this.router.instructionResolver.parseViewportInstructions(this.options.default);
      for (const instruction of instructions) {
        instruction.setViewport(this);
        instruction.default = true;
      }
      this.router.goto(instructions, { append: true }).catch(error => { throw error; });
    }
  }

  public async remove(element: Element | null, context: IRenderContext | IContainer | null): Promise<boolean> {
    if (this.element === element && this.context === context) {
      if (this.content.componentInstance) {
        await this.content.freeContent(
          this.element as Element,
          (this.nextContent ? this.nextContent.instruction : null),
          this.historyCache,
          this.doForceRemove ? false : this.router.statefulHistory || this.options.stateful
        ); // .catch(error => { throw error; });
      }
      if (this.doForceRemove) {
        await Promise.all(this.historyCache.map(content => content.freeContent(
          null,
          null,
          this.historyCache,
          false,
        )));
        this.historyCache = [];
      }
      return true;
    }
    return false;
  }

  public async canLeave(): Promise<boolean> {
    const results = await Promise.all(this.children.map((child) => child.canLeave()));
    if (results.some(result => result === false)) {
      return false;
    }
    return this.content.canLeave(this.nextContent ? this.nextContent.instruction : null);
  }

  public async canEnter(): Promise<boolean | ViewportInstruction[]> {
    if (this.clear) {
      return true;
    }

    if (((this.nextContent as ViewportContent).content || null) === null) {
      return false;
    }

    await this.waitForElement();

    (this.nextContent as ViewportContent).createComponent(this.context as IRenderContext);

    return (this.nextContent as ViewportContent).canEnter(this, this.content.instruction);
  }

  public async enter(): Promise<boolean> {
    Reporter.write(10000, 'Viewport enter', this.name);

    if (this.clear) {
      return true;
    }

    if (!this.nextContent || !this.nextContent.componentInstance) {
      return false;
    }

    await this.nextContent.enter(this.content.instruction);
    await this.nextContent.loadComponent(this.context as IRenderContext, this.element as Element, this);
    this.nextContent.initializeComponent((this.element as Element & { $controller: IController }).$controller);
    return true;
  }

  public async loadContent(): Promise<boolean> {
    Reporter.write(10000, 'Viewport loadContent', this.name);

    // No need to wait for next component activation
    if (this.content.componentInstance && !(this.nextContent as ViewportContent).componentInstance) {
      await this.content.leave((this.nextContent as ViewportContent).instruction);
      await this.unloadContent();
    }

    if ((this.nextContent as ViewportContent).componentInstance) {
      if (this.content.componentInstance !== (this.nextContent as ViewportContent).componentInstance) {
        (this.nextContent as ViewportContent).addComponent(this.element as Element);
      }
      // Only when next component activation is done
      if (this.content.componentInstance) {
        await this.content.leave((this.nextContent as ViewportContent).instruction);
        if (!this.content.reentry && this.content.componentInstance !== (this.nextContent as ViewportContent).componentInstance) {
          await this.unloadContent();
        }
      }

      this.content = (this.nextContent as ViewportContent);
      this.content.reentry = false;
    }

    if (this.clear) {
      this.content = new ViewportContent(void 0, (this.nextContent as ViewportContent).instruction);
    }

    this.nextContent = null;

    return true;
  }

  public clearTaggedNodes(): void {
    if ((this.content || null) !== null) {
      this.content.clearTaggedNodes();
    }
    if (this.nextContent) {
      this.nextContent.clearTaggedNodes();
    }
  }

  public finalizeContentChange(): void {
    this.previousViewportState = null;
  }
  public async abortContentChange(): Promise<void> {
    await (this.nextContent as ViewportContent).freeContent(
      this.element as Element,
      (this.nextContent as ViewportContent).instruction,
      this.historyCache,
      this.router.statefulHistory || this.options.stateful);
    if (this.previousViewportState) {
      Object.assign(this, this.previousViewportState);
    }
  }

  // TODO: Deal with non-string components
  public wantComponent(component: ComponentAppellation): boolean {
    let usedBy = this.options.usedBy || [];
    if (typeof usedBy === 'string') {
      usedBy = usedBy.split(',');
    }
    return usedBy.includes(component as string);
  }
  // TODO: Deal with non-string components
  public acceptComponent(component: ComponentAppellation): boolean {
    if (component === '-' || component === null) {
      return true;
    }
    let usedBy = this.options.usedBy;
    if (!usedBy || !usedBy.length) {
      return true;
    }
    if (typeof usedBy === 'string') {
      usedBy = usedBy.split(',');
    }
    if (usedBy.includes(component as string)) {
      return true;
    }
    if (usedBy.filter((value) => value.includes('*')).length) {
      return true;
    }
    return false;
  }

  public binding(flags: LifecycleFlags): void {
    if (this.content.componentInstance) {
      this.content.initializeComponent((this.element as Element & { $controller: IController }).$controller);
    }
  }

  public async attaching(flags: LifecycleFlags): Promise<void> {
    Reporter.write(10000, 'ATTACHING viewport', this.name, this.content, this.nextContent);
    this.enabled = true;
    if (this.content.componentInstance) {
      // Only acts if not already entered
      await this.content.enter(this.content.instruction);
      this.content.addComponent(this.element as Element);
    }
  }

  public async detaching(flags: LifecycleFlags): Promise<void> {
    Reporter.write(10000, 'DETACHING viewport', this.name);
    if (this.content.componentInstance) {
      // Only acts if not already left
      await this.content.leave(this.content.instruction);
      this.content.removeComponent(
        this.element as Element,
        this.doForceRemove ? false : this.router.statefulHistory || this.options.stateful
      );
    }
    this.enabled = false;
  }

  public async unbinding(flags: LifecycleFlags): Promise<void> {
    if (this.content.componentInstance) {
      await this.content.terminateComponent(this.doForceRemove ? false : this.router.statefulHistory || this.options.stateful);
    }
  }

  public addChild(viewport: Viewport): void {
    if (!this.children.some(vp => vp === viewport)) {
      if (viewport.parent !== null) {
        viewport.parent.removeChild(viewport);
      }
      this.children.push(viewport);
      viewport.parent = this;
    }
  }

  public removeChild(viewport: Viewport): void {
    const index = this.children.indexOf(viewport);
    if (index >= 0) {
      this.children.splice(index, 1);
      viewport.parent = null;
    }
  }

  public getEnabledViewports(): Record<string, Viewport> {
    return this.getOwnedViewports().filter(viewport => viewport.enabled).reduce(
      (viewports: Record<string, Viewport>, viewport) => {
        viewports[viewport.name] = viewport;
        return viewports;
      },
      {});
  }

  public getOwnedViewports(includeDisabled: boolean = false): Viewport[] {
    return this.router.allViewports(includeDisabled).filter(viewport => viewport.owningScope === this);
  }

  public findViewports(instructions: ViewportInstruction[], alreadyFound: ViewportInstruction[], disregardViewports: boolean = false): IFindViewportsResult {
    const foundViewports: ViewportInstruction[] = [];
    let remainingInstructions: ViewportInstruction[] = [];

    // Get a shallow copy of all available viewports
    const availableViewports: Record<string, Viewport | null> = { ...this.getEnabledViewports() };
    for (const instruction of alreadyFound.filter(found => found.scope === this)) {
      availableViewports[instruction.viewportName!] = null;
    }

    const viewportInstructions = instructions.slice();

    // The viewport is already known
    if (!disregardViewports) {
      for (let i = 0; i < viewportInstructions.length; i++) {
        const instruction = viewportInstructions[i];
        if (instruction.viewport) {
          const remaining = this.foundViewport(instruction, instruction.viewport, disregardViewports);
          foundViewports.push(instruction);
          remainingInstructions.push(...remaining);
          availableViewports[instruction.viewport.name] = null;
          viewportInstructions.splice(i--, 1);
        }
      }
    }

    // Configured viewport is ruling
    for (let i = 0; i < viewportInstructions.length; i++) {
      const instruction = viewportInstructions[i];
      instruction.needsViewportDescribed = true;
      for (const name in availableViewports) {
        const viewport: Viewport | null = availableViewports[name];
        // TODO: Also check if (resolved) component wants a specific viewport
        if (viewport && viewport.wantComponent(instruction.componentName as string)) {
          const remaining = this.foundViewport(instruction, viewport, disregardViewports, true);
          foundViewports.push(instruction);
          remainingInstructions.push(...remaining);
          availableViewports[name] = null;
          viewportInstructions.splice(i--, 1);
          break;
        }
      }
    }

    // Next in line is specified viewport (but not if we're disregarding viewports)
    if (!disregardViewports) {
      for (let i = 0; i < viewportInstructions.length; i++) {
        const instruction = viewportInstructions[i];
        const name = instruction.viewportName;
        if (!name || !name.length) {
          continue;
        }
        const newScope = instruction.ownsScope;
        if (!this.getEnabledViewports()[name]) {
          this.addViewport(name, null, null, { scope: newScope, forceDescription: true });
          availableViewports[name] = this.getEnabledViewports()[name];
        }
        const viewport = availableViewports[name];
        if (viewport && viewport.acceptComponent(instruction.componentName as string)) {
          const remaining = this.foundViewport(instruction, viewport, disregardViewports, true);
          foundViewports.push(instruction);
          remainingInstructions.push(...remaining);
          availableViewports[name] = null;
          viewportInstructions.splice(i--, 1);
        }
      }
    }

    // Finally, only one accepting viewport left?
    for (let i = 0; i < viewportInstructions.length; i++) {
      const instruction = viewportInstructions[i];
      const remainingViewports: Viewport[] = [];
      for (const name in availableViewports) {
        const viewport: Viewport | null = availableViewports[name];
        if (viewport && viewport.acceptComponent(instruction.componentName as string)) {
          remainingViewports.push(viewport);
        }
      }
      if (remainingViewports.length === 1) {
        const viewport: Viewport = remainingViewports.shift() as Viewport;
        const remaining = this.foundViewport(instruction, viewport, disregardViewports, true);
        foundViewports.push(instruction);
        remainingInstructions.push(...remaining);
        availableViewports[viewport.name] = null;
        viewportInstructions.splice(i--, 1);
      }
    }

    // If we're ignoring viewports, we now match them anyway
    if (disregardViewports) {
      for (let i = 0; i < viewportInstructions.length; i++) {
        const instruction = viewportInstructions[i];
        let viewport = instruction.viewport;
        if (!viewport) {
          const name = instruction.viewportName;
          if (!name || !name.length) {
            continue;
          }
          const newScope = instruction.ownsScope;
          if (!this.getEnabledViewports()[name]) {
            this.addViewport(name, null, null, { scope: newScope, forceDescription: true });
            availableViewports[name] = this.getEnabledViewports()[name];
          }
          viewport = availableViewports[name];
        }
        if (viewport && viewport.acceptComponent(instruction.componentName as string)) {
          const remaining = this.foundViewport(instruction, viewport, disregardViewports);
          foundViewports.push(instruction);
          remainingInstructions.push(...remaining);
          availableViewports[viewport.name] = null;
          viewportInstructions.splice(i--, 1);
        }
      }
    }

    remainingInstructions = [...viewportInstructions, ...remainingInstructions];
    return {
      foundViewports,
      remainingInstructions,
    };
  }

  public foundViewport(instruction: ViewportInstruction, viewport: Viewport, withoutViewports: boolean, doesntNeedViewportDescribed: boolean = false): ViewportInstruction[] {
    instruction.setViewport(viewport);
    if (doesntNeedViewportDescribed) {
      instruction.needsViewportDescribed = false;
    }
    const remaining: ViewportInstruction[] = (instruction.nextScopeInstructions || []).slice();
    for (const rem of remaining) {
      if (rem.scope === null) {
        rem.scope = viewport.scope || viewport.owningScope;
      }
    }
    return remaining;
  }

  public addViewport(name: string, element: Element | null, context: IRenderContext | IContainer | null, options: IViewportOptions = {}): Viewport {
    let viewport: Viewport | null = this.getEnabledViewports()[name];
    // Each au-viewport element has its own Viewport
    if (element && viewport && viewport.element !== null && viewport.element !== element) {
      viewport.enabled = false;
      viewport = this.getOwnedViewports(true).find(child => child.name === name && child.element === element) || null;
      if (viewport) {
        viewport.enabled = true;
      }
    }
    if (!viewport) {
      viewport = new Viewport(this.router, name, null, null, this.scope || this.owningScope, !!options.scope, options);
      this.addChild(viewport);
    }
    // TODO: Either explain why || instead of && here (might only need one) or change it to && if that should turn out to not be relevant
    if (element || context) {
      viewport.setElement(element as Element, context as IRenderContext, options);
    }
    return viewport;
  }
  public removeViewport(viewport: Viewport, element: Element | null, context: IRenderContext | IContainer | null): boolean {
    if ((!element && !context) || viewport.remove(element, context)) {
      this.removeChild(viewport);
      return true;
    }
    return false;
  }

  public allViewports(includeDisabled: boolean = false, includeReplaced: boolean = false): Viewport[] {
    let viewports: Viewport[] = this.children.filter((viewport) => viewport.enabled || includeDisabled);
    if (!includeReplaced && this.nextContent !== null) {
      const nextViewports: Viewport[] = this.router.instructionResolver
        .flattenViewportInstructions([this.nextContent.content])
        .filter(instruction => instruction.viewport !== null)
        .map(instruction => instruction.viewport) as Viewport[];
      let replacedViewports: Viewport[] = (this.router.instructionResolver
        .flattenViewportInstructions([this.content.content]) as ViewportInstruction[])
        .filter(instruction => instruction.viewport !== null)
        .map(instruction => instruction.viewport) as Viewport[];
      replacedViewports = replacedViewports.filter(replaced => !nextViewports.includes(replaced));
      viewports = viewports.filter(viewport => !replacedViewports.includes(viewport));
    }
    for (const scope of viewports) {
      viewports.push(...scope.allViewports(includeDisabled, includeReplaced));
    }
    return viewports;
  }

  public reparentViewportInstructions(): ViewportInstruction[] | null {
    const enabledViewports = this.children.filter(viewport => viewport.enabled
      && viewport.content.content
      && viewport.content.content.componentName);
    if (!enabledViewports.length) {
      return null;
    }
    for (const viewport of enabledViewports) {
      if (viewport.content.content !== void 0 && viewport.content.content !== null) {
        const childInstructions = viewport.reparentViewportInstructions();
        viewport.content.content.nextScopeInstructions = childInstructions !== null && childInstructions.length > 0 ? childInstructions : null;
      }
    }
    return enabledViewports.map(viewport => viewport.content.content);
  }

  public async freeContent(component: IRouteableComponent) {
    const content = this.historyCache.find(cached => cached.componentInstance === component);
    if (content !== void 0) {
      this.forceRemove = true;
      await content.freeContent(
        null,
        null,
        this.historyCache,
        false,
      );
      this.forceRemove = false;
      arrayRemove(this.historyCache, (cached => cached === content));
    }
  }

  public addRoutes(routes: IRoute[]): IRoute[] {
    if (this.routeTable === null) {
      this.routeTable = new RouteTable();
    }
    return this.routeTable.addRoutes(this.router, routes);
  }
  public removeRoutes(routes: IRoute[] | string[]): void {
    if (this.routeTable !== null) {
      this.routeTable.removeRoutes(this.router, routes);
    }
  }
  public findMatchingRoute(path: string): FoundRoute | null {
    let componentType: RouteableComponentType | null =
      this.nextContent !== null
        && this.nextContent.content !== null
        ? this.nextContent.content.componentType
        : this.content.content.componentType;
    if (componentType === null) {
      componentType = (this.context! as any).componentType;
    }
    let routes: IRoute[] = (componentType as RouteableComponentType & { routes: IRoute[] }).routes;
    if (routes !== null && routes !== void 0) {
      routes = routes.map(route => this.ensureProperRoute(route))
      const recognizableRoutes: ConfigurableRoute[] = routes.map(route => ({ path: route.path, handler: { name: route.id, route } }));
      for (let i: number = 0, ilen: number = recognizableRoutes.length; i < ilen; i++) {
        const newRoute: ConfigurableRoute = { ...recognizableRoutes[i] };
        newRoute.path += '/*remainingPath';
        recognizableRoutes.push(newRoute);
      }
      const found: FoundRoute = new FoundRoute();
      let params: Record<string, unknown> = {};
      if (path.startsWith('/') || path.startsWith('+')) {
        path = path.slice(1);
      }
      const recognizer: RouteRecognizer = new RouteRecognizer();
      recognizer.add(recognizableRoutes);
      const result: RecognizeResult[] = recognizer.recognize(path);
      if (result !== void 0 && result.length > 0) {
        found.match = (result[0].handler as RouteHandler & { route: IRoute }).route;
        found.matching = path;
        params = result[0].params;
        if (params.remainingPath !== void 0 && (params.remainingPath as string).length > 0) {
          found.remaining = params.remainingPath as string;
          delete params['remainingPath'];
          found.matching = found.matching.slice(0, found.matching.indexOf(found.remaining));
        }
      }
      if (found.foundConfiguration) {
        // clone it so config doesn't get modified
        found.instructions = this.router.instructionResolver.cloneViewportInstructions(found.match!.instructions as ViewportInstruction[]);
        for (const instruction of found.instructions) {
          instruction.setParameters(params);
        }
      }
      return found;
    }
    return null;
  }

  private ensureProperRoute(route: IRoute): IRoute {
    if (route.id === void 0) {
      route.id = route.path;
    }
    route.instructions = NavigationInstructionResolver.toViewportInstructions(this.router, route.instructions);
    return route;
  }

  private async unloadContent(): Promise<void> {
    this.content.removeComponent(this.element as Element, this.router.statefulHistory || this.options.stateful);
    await this.content.terminateComponent(this.router.statefulHistory || this.options.stateful);
    this.content.unloadComponent(this.historyCache, this.router.statefulHistory || this.options.stateful);
    this.content.destroyComponent();
  }

  private clearState(): void {
    this.options = {};

    this.content = new ViewportContent();
    this.cache = [];
  }

  private async waitForElement(): Promise<void> {
    if (this.element) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.elementResolve = resolve;
    });
  }
}
