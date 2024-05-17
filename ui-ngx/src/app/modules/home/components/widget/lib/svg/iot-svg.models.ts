///
/// Copyright © 2016-2024 The Thingsboard Authors
///
/// Licensed under the Apache License, Version 2.0 (the "License");
/// you may not use this file except in compliance with the License.
/// You may obtain a copy of the License at
///
///     http://www.apache.org/licenses/LICENSE-2.0
///
/// Unless required by applicable law or agreed to in writing, software
/// distributed under the License is distributed on an "AS IS" BASIS,
/// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
/// See the License for the specific language governing permissions and
/// limitations under the License.
///

import { ValueType } from '@shared/models/constants';
import { Box, Element, Runner, SVG, Svg, Text } from '@svgdotjs/svg.js';
import '@svgdotjs/svg.panzoom.js';
import {
  DataToValueType,
  GetValueAction,
  GetValueSettings,
  SetValueAction,
  SetValueSettings,
  ValueToDataType
} from '@shared/models/action-widget-settings.models';
import {
  createLabelFromSubscriptionEntityInfo,
  formatValue,
  isDefinedAndNotNull,
  isUndefinedOrNull,
  mergeDeep,
  parseFunction
} from '@core/utils';
import { BehaviorSubject, forkJoin, Observable, Observer } from 'rxjs';
import { map, share } from 'rxjs/operators';
import { ValueAction, ValueGetter, ValueSetter } from '@home/components/widget/lib/action/action-widget.models';
import { WidgetContext } from '@home/models/widget-component.models';
import { ColorProcessor, constantColor, Font } from '@shared/models/widget-settings.models';
import { AttributeScope } from '@shared/models/telemetry/telemetry.models';
import { UtilsService } from '@core/services/utils.service';
import { WidgetAction, WidgetActionType } from '@shared/models/widget.models';

export interface IotSvgApi {
  formatValue: (value: any, dec?: number, units?: string, showZeroDecimals?: boolean) => string | undefined;
  text: (element: Element | Element[], text: string) => void;
  font: (element: Element | Element[], font: Font, color: string) => void;
  animate: (element: Element, duration: number) => Runner;
  disable: (element: Element | Element[]) => void;
  enable: (element: Element | Element[]) => void;
  callAction: (event: Event, behaviorId: string, value?: any, observer?: Partial<Observer<void>>) => void;
  setValue: (valueId: string, value: any) => void;
}

export interface IotSvgContext {
  api: IotSvgApi;
  tags: {[id: string]: Element[]};
  values: {[id: string]: any};
  properties: {[id: string]: any};
}

export type IotSvgStateRenderFunction = (svg: Svg, ctx: IotSvgContext) => void;

export type IotSvgTagStateRenderFunction = (element: Element, ctx: IotSvgContext) => void;

export type IotSvgActionTrigger = 'click';

export type IotSvgActionFunction = (event: Event, ctx: IotSvgContext) => void;
export interface IotSvgAction {
  actionFunction?: string;
  action?: IotSvgActionFunction;
}

export interface IotSvgTag {
  tag: string;
  stateRenderFunction?: string;
  stateRender?: IotSvgTagStateRenderFunction;
  actions?: {[trigger: string]: IotSvgAction};
}

export enum IotSvgBehaviorType {
  value = 'value',
  action = 'action',
  widgetAction = 'widgetAction'
}

export interface IotSvgBehaviorBase {
  id: string;
  name: string;
  hint?: string;
  type: IotSvgBehaviorType;
}

export interface IotSvgBehaviorValue extends IotSvgBehaviorBase {
  valueType: ValueType;
  defaultValue: any;
  valueId: string;
  trueLabel?: string;
  falseLabel?: string;
  stateLabel?: string;
}

export interface IotSvgBehaviorAction extends IotSvgBehaviorBase {
  valueToDataType: ValueToDataType;
  constantValue: any;
  valueToDataFunction: string;
}

export type IotSvgBehavior = IotSvgBehaviorValue | IotSvgBehaviorAction;

export type IotSvgPropertyType = 'string' | 'number' | 'color' | 'color-settings' | 'font' | 'units' | 'switch';

export interface IotSvgPropertyBase {
  id: string;
  name: string;
  type: IotSvgPropertyType;
  default: any;
  required?: boolean;
  subLabel?: string;
  divider?: boolean;
  fieldSuffix?: string;
  disableOnProperty?: string;
  rowClass?: string;
  fieldClass?: string;
}

export interface IotSvgNumberProperty extends IotSvgPropertyBase {
  min?: number;
  max?: number;
  step?: number;
}

export type IotSvgProperty = IotSvgPropertyBase & IotSvgNumberProperty;

export interface IotSvgMetadata {
  title: string;
  stateRenderFunction?: string;
  stateRender?: IotSvgStateRenderFunction;
  tags: IotSvgTag[];
  behavior: IotSvgBehavior[];
  properties: IotSvgProperty[];
}

export const emptyMetadata = (): IotSvgMetadata => ({
  title: '',
  tags: [],
  behavior: [],
  properties: []
});


export const parseIotSvgMetadataFromContent = (svgContent: string): IotSvgMetadata => {
  try {
    const svgDoc = new DOMParser().parseFromString(svgContent, 'image/svg+xml');
    return parseIotSvgMetadataFromDom(svgDoc);
  } catch (_e) {
    return emptyMetadata();
  }
};

const parseIotSvgMetadataFromDom = (svgDoc: Document): IotSvgMetadata => {
  try {
    const elements = svgDoc.getElementsByTagName('tb:metadata');
    if (elements.length) {
      return JSON.parse(elements[0].textContent);
    } else {
      return emptyMetadata();
    }
  } catch (_e) {
    console.error(_e);
    return emptyMetadata();
  }
};

export const updateIotSvgMetadataInContent = (svgContent: string, metadata: IotSvgMetadata): string => {
  const svgDoc = new DOMParser().parseFromString(svgContent, 'image/svg+xml');
  updateIotSvgMetadataInDom(svgDoc, metadata);
  return svgDoc.documentElement.outerHTML;
};

const updateIotSvgMetadataInDom = (svgDoc: Document, metadata: IotSvgMetadata) => {
  svgDoc.documentElement.setAttribute('xmlns:tb', 'https://thingsboard.io/svg');
  let metadataElement: Node;
  const elements = svgDoc.getElementsByTagName('tb:metadata');
  if (elements?.length) {
    metadataElement = elements[0];
    metadataElement.textContent = '';
  } else {
    metadataElement = svgDoc.createElement('tb:metadata');
    svgDoc.documentElement.insertBefore(metadataElement, svgDoc.documentElement.firstChild);
  }
  const content = JSON.stringify(metadata, null, 2);
  const cdata = svgDoc.createCDATASection(content);
  metadataElement.appendChild(cdata);
};

const defaultGetValueSettings = (get: IotSvgBehaviorValue): GetValueSettings<any> => ({
    action: GetValueAction.DO_NOTHING,
    defaultValue: get.defaultValue,
    executeRpc: {
    method: 'getState',
      requestTimeout: 5000,
      requestPersistent: false,
      persistentPollingInterval: 1000
    },
    getAttribute: {
      key: 'state',
        scope: null
    },
    getTimeSeries: {
      key: 'state'
    },
    dataToValue: {
      type: DataToValueType.NONE,
      compareToValue: true,
      dataToValueFunction: '/* Should return boolean value */\nreturn data;'
    }
  });

const defaultSetValueSettings = (set: IotSvgBehaviorAction): SetValueSettings => ({
  action: SetValueAction.EXECUTE_RPC,
  executeRpc: {
    method: 'setState',
    requestTimeout: 5000,
    requestPersistent: false,
    persistentPollingInterval: 1000
  },
  setAttribute: {
    key: 'state',
    scope: AttributeScope.SERVER_SCOPE
  },
  putTimeSeries: {
    key: 'state'
  },
  valueToData: {
    type: set.valueToDataType,
    constantValue: set.constantValue,
    valueToDataFunction: set.valueToDataFunction ? set.valueToDataFunction :
      '/* Convert input boolean value to RPC parameters or attribute/time-series value */\nreturn value;'
  }
});

const defaultWidgetActionSettings = (widgetAction: IotSvgBehavior): WidgetAction => ({
  type: WidgetActionType.updateDashboardState,
  targetDashboardStateId: null,
  openRightLayout: false,
  setEntityId: true,
  stateEntityParamName: null
});

export const defaultIotSvgObjectSettings = (metadata: IotSvgMetadata): IotSvgObjectSettings => {
  const settings: IotSvgObjectSettings = {};
  for (const behavior of metadata.behavior) {
    if (behavior.type === IotSvgBehaviorType.value) {
      settings[behavior.id] = defaultGetValueSettings(behavior as IotSvgBehaviorValue);
    } else if (behavior.type === IotSvgBehaviorType.action) {
      settings[behavior.id] = defaultSetValueSettings(behavior as IotSvgBehaviorAction);
    } else if (behavior.type === IotSvgBehaviorType.widgetAction) {
      settings[behavior.id] = defaultWidgetActionSettings(behavior);
    }
  }
  for (const property of metadata.properties) {
    settings[property.id] = property.default;
  }
  return settings;
};

export type IotSvgObjectSettings = {[id: string]: any};

const parseError = (ctx: WidgetContext, err: any): string =>
  ctx.$injector.get(UtilsService).parseException(err).message || 'Unknown Error';

export class IotSvgObject {

  private metadata: IotSvgMetadata;
  private settings: IotSvgObjectSettings;
  private context: IotSvgContext;

  private rootElement: HTMLElement;
  private svgShape: Svg;
  private box: Box;
  private targetWidth: number;
  private targetHeight: number;

  private loadingSubject = new BehaviorSubject(false);
  private valueGetters: ValueGetter<any>[] = [];
  private valueActions: ValueAction[] = [];
  private valueSetters: {[behaviorId: string]: ValueSetter<any>} = {};

  private stateValueSubjects: {[id: string]: BehaviorSubject<any>} = {};

  loading$ = this.loadingSubject.asObservable().pipe(share());

  private _onError: (error: string) => void = () => {};

  constructor(private ctx: WidgetContext,
              private svgPath: string,
              private inputSettings: IotSvgObjectSettings) {}

  public init(): Observable<any> {
    return this.ctx.http.get(this.svgPath, {responseType: 'text'}).pipe(
      map((inputSvgContent) => {
        const doc: XMLDocument = new DOMParser().parseFromString(inputSvgContent, 'image/svg+xml');
        this.metadata = parseIotSvgMetadataFromDom(doc);
        const defaults = defaultIotSvgObjectSettings(this.metadata);
        this.settings = mergeDeep<IotSvgObjectSettings>({}, defaults, this.inputSettings || {});
        this.prepareMetadata();
        this.prepareSvgShape(doc);
        this.initialize();
      })
    );
  }

  public onError(onError: (error: string) => void) {
    this._onError = onError;
  }

  public addTo(element: HTMLElement) {
    this.rootElement = element;
    if (this.svgShape) {
      this.svgShape.addTo(element);
    }
  }

  public destroy() {
    for (const stateValueId of Object.keys(this.stateValueSubjects)) {
      this.stateValueSubjects[stateValueId].complete();
      this.stateValueSubjects[stateValueId].unsubscribe();
    }
    this.valueActions.forEach(v => v.destroy());
    this.loadingSubject.complete();
    this.loadingSubject.unsubscribe();
  }

  public setSize(targetWidth: number, targetHeight: number) {
    this.targetWidth = targetWidth;
    this.targetHeight = targetHeight;
    if (this.svgShape) {
      this.resize();
    }
  }

  private prepareMetadata() {
    this.metadata.stateRender = parseFunction(this.metadata.stateRenderFunction, ['svg', 'ctx']) || (() => {});
    for (const tag of this.metadata.tags) {
      tag.stateRender = parseFunction(tag.stateRenderFunction, ['element', 'ctx']) || (() => {});
      if (tag.actions) {
        for (const trigger of Object.keys(tag.actions)) {
          const action = tag.actions[trigger];
          action.action = parseFunction(action.actionFunction, ['event', 'ctx']) || (() => {});
        }
      }
    }
  }

  private prepareSvgShape(doc: XMLDocument) {
    const elements = doc.getElementsByTagName('tb:metadata');
    for (let i=0;i<elements.length;i++) {
      elements.item(i).remove();
    }
    this.svgShape = SVG().svg(doc.documentElement.innerHTML);
    this.svgShape.node.style.overflow = 'visible';
    this.svgShape.node.style['user-select'] = 'none';
    this.box = this.svgShape.bbox();
    this.svgShape.size(this.box.width, this.box.height);
    if (this.rootElement) {
      this.svgShape.addTo(this.rootElement);
    }
    if (this.targetWidth && this.targetHeight) {
      this.resize();
    }
  }

  private initialize() {
    this.context = {
      api: {
        formatValue,
        text: this.setElementText.bind(this),
        font: this.setElementFont.bind(this),
        animate: this.animate.bind(this),
        disable: this.disableElement.bind(this),
        enable: this.enableElement.bind(this),
        callAction: this.callAction.bind(this),
        setValue: this.setValue.bind(this)
      },
      tags: {},
      properties: {},
      values: {}
    };
    const taggedElements = this.svgShape.find(`[tb\\:tag]`);
    for (const element of taggedElements) {
      const tag = element.attr('tb:tag');
      let elements = this.context.tags[tag];
      if (!elements) {
        elements = [];
        this.context.tags[tag] = elements;
      }
      elements.push(element);
    }
    for (const property of this.metadata.properties) {
      this.context.properties[property.id] = this.getPropertyValue(property.id);
    }
    for (const tag of this.metadata.tags) {
      if (tag.actions) {
        const elements = this.svgShape.find(`[tb\\:tag="${tag.tag}"]`);
        for (const trigger of Object.keys(tag.actions)) {
          const action = tag.actions[trigger];
          elements.forEach(element => {
            element.attr('cursor', 'pointer');
            element.on(trigger, (event) => {
              action.action(event, this.context);
            });
          });
        }
      }
    }
    for (const behavior of this.metadata.behavior) {
      if (behavior.type === IotSvgBehaviorType.value) {
        const getBehavior = behavior as IotSvgBehaviorValue;
        let getValueSettings: GetValueSettings<any> = this.settings[getBehavior.id];
        getValueSettings = {...getValueSettings, actionLabel: getBehavior.name};
        const stateValueSubject = new BehaviorSubject<any>(getValueSettings.defaultValue);
        this.stateValueSubjects[getBehavior.valueId] = stateValueSubject;
        this.context.values[getBehavior.valueId] = getValueSettings.defaultValue;
        stateValueSubject.subscribe((value) => {
          this.onStateValueChanged(getBehavior.valueId, value);
        });
        const valueGetter =
          ValueGetter.fromSettings(this.ctx, getValueSettings, getBehavior.valueType, {
            next: (val) => {this.onValue(getBehavior.id, val);},
            error: (err) => {
              const message = parseError(this.ctx, err);
              this._onError(message);
            }
          });
        this.valueGetters.push(valueGetter);
        this.valueActions.push(valueGetter);
      } else if (behavior.type === IotSvgBehaviorType.action) {
        const setBehavior = behavior as IotSvgBehaviorAction;
        let setValueSettings: SetValueSettings = this.settings[setBehavior.id];
        setValueSettings = {...setValueSettings, actionLabel: setBehavior.name};
        const valueSetter = ValueSetter.fromSettings<any>(this.ctx, setValueSettings);
        this.valueSetters[setBehavior.id] = valueSetter;
        this.valueActions.push(valueSetter);
      } else if (behavior.type === IotSvgBehaviorType.widgetAction) {
        // TODO:
      }
    }
    this.renderState();
    if (this.valueGetters.length) {
      const getValueObservables: Array<Observable<any>> = [];
      this.valueGetters.forEach(valueGetter => {
        getValueObservables.push(valueGetter.getValue());
      });
      this.loadingSubject.next(true);
      forkJoin(getValueObservables).subscribe(
        {
          next: () => {
            this.loadingSubject.next(false);
          },
          error: () => {
            this.loadingSubject.next(false);
          }
        }
      );
    }
  }

  private callAction(event: Event, behaviorId: string, value?: any, observer?: Partial<Observer<void>>) {
    const behavior = this.metadata.behavior.find(b => b.id === behaviorId);
    if (behavior) {
      if (behavior.type === IotSvgBehaviorType.action) {
        const valueSetter = this.valueSetters[behaviorId];
        if (valueSetter) {
          this.loadingSubject.next(true);
          valueSetter.setValue(value).subscribe(
            {
              next: () => {
                if (observer?.next) {
                  observer.next();
                }
                this.loadingSubject.next(false);
              },
              error: (err) => {
                this.loadingSubject.next(false);
                if (observer?.error) {
                  observer.error(err);
                }
                const message = parseError(this.ctx, err);
                this._onError(message);
              }
            }
          );
        }
      } else if (behavior.type === IotSvgBehaviorType.widgetAction) {
        const widgetAction: WidgetAction = this.settings[behavior.id];
        this.ctx.actionsApi.onWidgetAction(event, widgetAction);
      }
    }
  }

  private resize() {
    let scale: number;
    if (this.targetWidth < this.targetHeight) {
      scale = this.targetWidth / this.box.width;
    } else {
      scale = this.targetHeight / this.box.height;
    }
    this.svgShape.node.style.transform = `scale(${scale})`;
  }

  private onValue(id: string, value: any) {
    const valueBehavior = this.metadata.behavior.find(b => b.id === id) as IotSvgBehaviorValue;
    value = this.normalizeValue(value, valueBehavior.valueType);
    const valueId = valueBehavior.valueId;
    this.setValue(valueId, value);
  }

  private setValue(valueId: string, value: any) {
    const stateValueSubject = this.stateValueSubjects[valueId];
    if (stateValueSubject && stateValueSubject.value !== value) {
      stateValueSubject.next(value);
    }
  }

  private onStateValueChanged(id: string, value: any) {
    if (this.context.values[id] !== value) {
      this.context.values[id] = value;
      this.renderState();
    }
  }

  private renderState(): void {
    this.metadata.stateRender(this.svgShape, this.context);
    for (const tag of this.metadata.tags) {
      const elements = this.svgShape.find(`[tb\\:tag="${tag.tag}"]`);
      elements.forEach(element => {
        tag.stateRender(element, this.context);
      });
    }
  }

  private normalizeValue(value: any, type: ValueType): any {
    if (isUndefinedOrNull(value)) {
      switch (type) {
        case ValueType.STRING:
          return '';
        case ValueType.INTEGER:
        case ValueType.DOUBLE:
          return 0;
        case ValueType.BOOLEAN:
          return false;
        case ValueType.JSON:
          return {};
      }
    } else {
      return value;
    }
  }

  private setElementText(e: Element | Element[], text: string) {
    this.elements(e).forEach(element => {
      let textElement: Text;
      if (element.type === 'text') {
        const children = element.children();
        if (children.length && children[0].type === 'tspan') {
          textElement = children[0] as Text;
        } else {
          textElement = element as Text;
        }
      } else if (element.type === 'tspan') {
        textElement = element as Text;
      }
      if (textElement) {
        textElement.text(text);
      }
    });
  }

  private setElementFont(e: Element | Element[], font: Font, color: string) {
    this.elements(e).forEach(element => {
      if (element.type === 'text') {
        const textElement = element as Text;
        if (font) {
          textElement.font({
            family: font.family,
            size: (isDefinedAndNotNull(font.size) && isDefinedAndNotNull(font.sizeUnit)) ?
              font.size + font.sizeUnit : null,
            weight: font.weight,
            style: font.style
          });
        }
        if (color) {
          textElement.fill(color);
        }
      }
    });
  }

  private animate(element: Element, duration: number): Runner {
    element.timeline().finish();
    return element.animate(duration, 0, 'now');
  }

  private disableElement(e: Element | Element[]) {
    this.elements(e).forEach(element => {
      element.attr({'pointer-events': 'none'});
    });
  }

  private enableElement(e: Element | Element[]) {
    this.elements(e).forEach(element => {
      element.attr({'pointer-events': null});
    });
  }

  private elements(element: Element | Element[]): Element[] {
    return Array.isArray(element) ? element : [element];
  }

  private getProperty(id: string): IotSvgProperty {
    return this.metadata.properties.find(p => p.id === id);
  }

  private getPropertyValue(id: string): any {
    const property = this.getProperty(id);
    if (property) {
      const value = this.settings[id];
      if (isDefinedAndNotNull(value)) {
        if (property.type === 'color-settings') {
          return ColorProcessor.fromSettings(value);
        } else if (property.type === 'string') {
          const result =  this.ctx.utilsService.customTranslation(value, value);
          const entityInfo = this.ctx.defaultSubscription.getFirstEntityInfo();
          return createLabelFromSubscriptionEntityInfo(entityInfo, result);
        }
        return value;
      } else {
        switch (property.type) {
          case 'string':
            return '';
          case 'number':
            return 0;
          case 'color':
            return '#000';
          case 'color-settings':
            return ColorProcessor.fromSettings(constantColor('#000'));
        }
      }
    } else {
      return '';
    }
  }
}