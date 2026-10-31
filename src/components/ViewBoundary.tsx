import { Component, type ReactNode } from "react";
import { Notice, type Translate } from "./ui";
export class ViewBoundary extends Component<
  { children: ReactNode; t: Translate; measure: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <Notice kind="error">
        {this.props.t("error.generic")}
        <button className="text-button" onClick={this.props.measure}>
          {this.props.t("nav.measure")}
        </button>
      </Notice>
    ) : (
      this.props.children
    );
  }
}
