// @flow
import React from "react";
import ReactDom from "react-dom";
import isEqual from "lodash.isequal";
import smoothScrollIntoView from "./smoothScrollIntoView";

export type Validation = {
    error: boolean,
    level: "error" | "warning",
    behaviour: "immediate" | "lostfocus" | "submit",
};

export interface IValidationContextSettings {
    scroll: { horizontalOffset: number, verticalOffset: number },
}

export interface IValidationContext {
    register(wrapper: ValidationWrapper): void,
    unregister(wrapper: ValidationWrapper): void,
    instanceProcessBlur(wrapper: ValidationWrapper): void,
    onValidationUpdated(wrapper: ValidationWrapper, isValid: boolean): void,
    getSettings(): IValidationContextSettings,
    isAnyWrapperInChangingMode(): boolean,
}

export type RenderErrorMessage = (
    control: React.Element<*>,
    hasError: boolean,
    validation: ?Validation
) => React.Element<*>;

type ValidationWrapperProps = {
    children?: any,
    validations: Validation[],
    errorMessage: RenderErrorMessage,
};

type ValidationState = {
    visible?: boolean,
};

type ValidationWrapperState = {
    validationStates: ValidationState[],
};

export default class ValidationWrapper extends React.Component {
    props: ValidationWrapperProps;
    state: ValidationWrapperState = {
        validationStates: [],
    };
    context: {
        validationContext: IValidationContext,
    };

    static contextTypes = {
        validationContext: React.PropTypes.any,
    };

    child: React.Component<*, *, *>;
    isChanging: boolean = false;

    _scrollTimer = null;

    componentWillMount() {
        this.syncWithState(this.props);
    }

    componentDidMount() {
        if (this.context.validationContext) {
            this.context.validationContext.register(this);
        }
    }

    componentWillUnmount() {
        if (this.context.validationContext) {
            this.context.validationContext.unregister(this);
        }
    }

    componentWillReceiveProps(nextProps: ValidationWrapperProps) {
        if (!isEqual(this.props.validations, nextProps.validations)) {
            this.syncWithState(nextProps);
        }
    }

    syncWithState(props: ValidationWrapperProps) {
        this.setState({
            validationStates: props.validations.map(x => this.createState(x)),
        });
    }

    createState(validation: Validation): ValidationState {
        if (validation.behaviour === "immediate") {
            return {};
        } else if (validation.behaviour === "lostfocus") {
            if (this.context.validationContext.isAnyWrapperInChangingMode()) {
                return { visible: false };
            }

            return { visible: true };
        } else if (validation.behaviour === "submit") {
            return { visible: false };
        }
        throw new Error(`Unknown behaviour: ${validation.behaviour}`);
    }

    emulateBlur() {
        const { validations } = this.props;
        validations.forEach((x, i) => this.processBlur(x, this.state.validationStates[i], i));
        this.isChanging = false;
    }

    handleBlur() {
        const { validations } = this.props;
        validations.forEach((x, i) => this.processBlur(x, this.state.validationStates[i], i));
        this.context.validationContext.instanceProcessBlur(this);
        this.isChanging = false;
    }

    async processSubmit(): Promise<void> {
        this.isChanging = false;
        const { validations } = this.props;
        await Promise.all(
            validations.map((x, i) => this.processValidationSubmit(x, this.state.validationStates[i], i))
        );
    }

    processValidationSubmit(validation: Validation, validationState: ValidationState, index: number): Promise<void> {
        return new Promise(resolve => {
            if (validation.behaviour !== "immediate") {
                this.setState(
                    {
                        validationStates: [
                            ...this.state.validationStates.slice(0, index),
                            { ...validationState, visible: true },
                            ...this.state.validationStates.slice(index + 1),
                        ],
                    },
                    resolve
                );
            } else {
                resolve();
            }
        });
    }

    processBlur(validation: Validation, validationState: ValidationState, index: number) {
        this.isChanging = false;
        if (validation.behaviour === "lostfocus") {
            let validationStates;
            if (validation.error) {
                validationStates = [
                    ...this.state.validationStates.slice(0, index),
                    { ...validationState, visible: true },
                    ...this.state.validationStates.slice(index + 1),
                ];
            } else {
                validationStates = [
                    ...this.state.validationStates.slice(0, index),
                    { ...validationState, visible: false },
                    ...this.state.validationStates.slice(index + 1),
                ];
            }
            this.setState({
                validationStates: validationStates,
            });
            const isValid = !validationStates.find(x => x.visible);
            this.context.validationContext.onValidationUpdated(this, isValid);
        }
    }

    activateValidationMessageIfNeed() {
        if (this.refs.errorMessage && this.refs.errorMessage.setOpened) {
            this.refs.errorMessage.setOpened(true);
        }
    }

    async focus(): Promise<void> {
        if (this.child) {
            const childDomElement = ReactDom.findDOMNode(this.child);
            if (childDomElement != null && childDomElement instanceof HTMLElement) {
                await smoothScrollIntoView(
                    childDomElement,
                    this.context.validationContext.getSettings().scroll.verticalOffset || 50
                );
                if (typeof this.child.focus === "function") {
                    this.child.focus();
                }
            }
            this.isChanging = false;
        }
    }

    getControlPosition(): ?{ x: number, y: number } {
        if (this.child) {
            const childDomElement = ReactDom.findDOMNode(this.child);
            if (childDomElement != null && childDomElement instanceof HTMLElement) {
                return {
                    x: childDomElement.getBoundingClientRect().top,
                    y: childDomElement.getBoundingClientRect().left,
                };
            }
        }
        return null;
    }

    isErrorOrWarning(validation: Validation, index: number): boolean {
        if (validation.behaviour === "immediate") {
            return validation.error;
        }
        return Boolean(validation.error && this.state.validationStates[index].visible);
    }

    isError(validation: Validation, index: number): boolean {
        if (validation.behaviour === "immediate") {
            return validation.error && validation.level === "error";
        }
        return Boolean(validation.error && validation.level === "error" && this.state.validationStates[index].visible);
    }

    hasError(): boolean {
        const { validations } = this.props;
        const validation = validations.find((x, i) => this.isError(x, i));
        return Boolean(validation && validation.error);
    }

    render(): React.Element<*> {
        const { children, validations, errorMessage } = this.props;
        const validation = validations.find((x, i) => this.isErrorOrWarning(x, i));

        const clonedChild: React.Element<any> = children
            ? React.cloneElement(children, {
                  ref: x => {
                      if (children && children.ref) {
                          children.ref(x);
                      }
                      this.child = x;
                  },
                  error: this.isChanging
                      ? false
                      : Boolean(validation && validation.error && validation.level === "error"),
                  warning: this.isChanging
                      ? false
                      : Boolean(validation && validation.error && validation.level === "warning"),
                  onBlur: () => {
                      this.handleBlur();
                      if (children && children.props && children.props.onBlur) {
                          children.props.onBlur();
                      }
                  },
                  onChange: (...args) => {
                      this.isChanging = true;
                      if (children && children.props && children.props.onChange) {
                          children.props.onChange(...args);
                      }
                  },
              })
            : <span />;
        const childWithError = React.cloneElement(
            errorMessage(clonedChild, Boolean(validation && validation.error), validation),
            { ref: "errorMessage" }
        );
        return childWithError;
    }
}
