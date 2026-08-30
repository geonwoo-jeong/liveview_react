import {
  Component,
  Suspense,
  createContext,
  forwardRef,
  lazy,
  memo,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from "react";
import { createPortal } from "react-dom";

import { DualRangeSlider } from "../../assets/react-components/ui/dual-range-slider";
import { recordRootError } from "./e2e-harness";

const CompatRootContext = createContext("missing-root-context");
const lazyModule = Object.freeze({ default: CompatLazyReady });

let nextInstanceNumber = 0;
let nextMemoRenderNumber = 0;
let releaseLazyModule;
let lazyModuleResolved = false;

const lazyModulePromise = new Promise((resolve) => {
  releaseLazyModule = resolve;
});

const CompatLazy = lazy(() => lazyModulePromise);

function allocateInstanceId() {
  nextInstanceNumber += 1;
  return `compat-instance-${nextInstanceNumber}`;
}

function allocateMemoRenderNumber() {
  nextMemoRenderNumber += 1;
  return nextMemoRenderNumber;
}

async function resolveSuspense() {
  const didResolve = !lazyModuleResolved;

  if (didResolve) {
    lazyModuleResolved = true;
    releaseLazyModule(lazyModule);
  }

  await Promise.resolve();
  return didResolve;
}

if (typeof window !== "undefined") {
  Object.defineProperty(window, "__liveViewReactCompat", {
    configurable: true,
    value: Object.freeze({ resolveSuspense }),
  });
}

function CompatLazyReady() {
  return <output data-testid="compat-lazy-ready">ready</output>;
}

const CompatMemoProbe = memo(function CompatMemoProbe() {
  return (
    <output data-testid="compat-memo-renders">
      {allocateMemoRenderNumber()}
    </output>
  );
});

const CompatFocusableInput = forwardRef(
  function CompatFocusableInput(properties, ref) {
    return <input {...properties} ref={ref} />;
  },
);

class CompatClassCounter extends Component {
  state = Object.freeze({ count: 0 });

  increment = () => {
    this.setState(({ count }) => Object.freeze({ count: count + 1 }));
  };

  render() {
    return (
      <section aria-label="class component counter">
        <output data-testid="compat-class-count">{this.state.count}</output>
        <button
          data-testid="compat-class-increment"
          type="button"
          onClick={this.increment}
        >
          increment class counter
        </button>
      </section>
    );
  }
}

class CompatErrorBoundary extends Component {
  state = Object.freeze({ message: null });

  static getDerivedStateFromError(error) {
    return Object.freeze({
      message: error instanceof Error ? error.message : String(error),
    });
  }

  render() {
    if (this.state.message !== null) {
      return (
        <output data-testid="compat-error-fallback">
          {this.state.message}
        </output>
      );
    }

    return this.props.children;
  }
}

function CompatThrowingChild({ shouldThrow }) {
  if (shouldThrow) {
    throw new Error("compat boundary failure");
  }

  return null;
}

function CompatPortalContent() {
  const rootContext = useContext(CompatRootContext);

  return (
    <aside aria-label="React portal content">
      <button data-testid="compat-portal-button" type="button">
        portal event
      </button>
      <output data-testid="compat-portal-context">{rootContext}</output>
    </aside>
  );
}

function CompatCanvas2DProbe() {
  const canvasRef = useRef(null);
  const [pixel, setPixel] = useState("pending");

  useEffect(() => {
    const context = canvasRef.current?.getContext("2d", {
      willReadFrequently: true,
    });

    if (!context) {
      setPixel("unsupported");
      return;
    }

    context.fillStyle = "rgb(255, 0, 0)";
    context.fillRect(0, 0, 2, 2);
    setPixel(Array.from(context.getImageData(0, 0, 1, 1).data).join(","));
  }, []);

  return (
    <section aria-label="Canvas 2D compatibility">
      <canvas ref={canvasRef} width="2" height="2" />
      <output data-testid="compat-canvas-2d">{pixel}</output>
    </section>
  );
}

function CompatWebGLProbe() {
  const canvasRef = useRef(null);
  const [pixel, setPixel] = useState("pending");

  useEffect(() => {
    const context = canvasRef.current?.getContext("webgl", {
      preserveDrawingBuffer: true,
    });

    if (!context) {
      setPixel("unsupported");
      return;
    }

    const pixelBytes = new Uint8Array(4);
    context.clearColor(1, 0, 0, 1);
    context.clear(context.COLOR_BUFFER_BIT);
    context.readPixels(
      0,
      0,
      1,
      1,
      context.RGBA,
      context.UNSIGNED_BYTE,
      pixelBytes,
    );
    setPixel(Array.from(pixelBytes).join(","));
  }, []);

  return (
    <section aria-label="WebGL compatibility">
      <canvas ref={canvasRef} width="2" height="2" />
      <output data-testid="compat-webgl">{pixel}</output>
    </section>
  );
}

export const e2eRootOptions = Object.freeze({
  onCaughtError(error, info) {
    recordRootError("caught", error, info);
  },
  onRecoverableError(error, info) {
    recordRootError("recoverable", error, info);
  },
  onUncaughtError(error, info) {
    recordRootError("uncaught", error, info);
  },
  wrapRoot({ children, componentName, element }) {
    const value = `${componentName}:${element?.id ?? "server"}`;
    return (
      <CompatRootContext.Provider value={value}>
        {children}
      </CompatRootContext.Provider>
    );
  },
});

export function E2EReactCompatProbe({ serverVersion }) {
  const generatedId = useId();
  const rootContext = useContext(CompatRootContext);
  const focusableInputRef = useRef(null);
  const [instanceId] = useState(allocateInstanceId);
  const [controlledValue, setControlledValue] = useState("");
  const [transitionValue, setTransitionValue] = useState(0);
  const [isTransitionPending, startTransition] = useTransition();
  const [shouldThrow, setShouldThrow] = useState(false);
  const [richHtml, setRichHtml] = useState("<p>editable</p>");
  const [sliderValue, setSliderValue] = useState(25);
  const [portalBubbles, setPortalBubbles] = useState(0);

  const portalHost = document.getElementById("compat-portal-host");

  return (
    <section aria-label="React compatibility probe">
      <output data-testid="compat-function">function</output>
      <output data-testid="compat-instance">{instanceId}</output>
      <output data-testid="compat-server-version">{serverVersion}</output>
      <output data-testid="compat-root-context">{rootContext}</output>

      <label htmlFor={generatedId}>React useId input</label>
      <input id={generatedId} readOnly value="useId" />
      <output data-testid="compat-id">{generatedId}</output>

      <CompatMemoProbe />
      <CompatClassCounter />

      <label>
        Controlled value
        <input
          data-testid="compat-controlled"
          value={controlledValue}
          onChange={(event) => setControlledValue(event.target.value)}
        />
      </label>
      <output data-testid="compat-controlled-value">{controlledValue}</output>

      <CompatFocusableInput
        ref={focusableInputRef}
        data-testid="compat-ref-input"
        defaultValue="forward ref"
      />
      <button
        data-testid="compat-focus-ref"
        type="button"
        onClick={() => focusableInputRef.current?.focus()}
      >
        focus forwarded ref
      </button>

      <button
        data-testid="compat-transition"
        type="button"
        onClick={() => {
          startTransition(() => {
            setTransitionValue((value) => value + 1);
          });
        }}
      >
        {isTransitionPending ? "transition pending" : "start transition"}
      </button>
      <output data-testid="compat-transition-value">{transitionValue}</output>

      <Suspense
        fallback={
          <output data-testid="compat-suspense-fallback">loading</output>
        }
      >
        <CompatLazy />
      </Suspense>

      <CompatErrorBoundary>
        <button
          data-testid="compat-error-trigger"
          type="button"
          onClick={() => setShouldThrow(true)}
        >
          throw inside boundary
        </button>
        <CompatThrowingChild shouldThrow={shouldThrow} />
      </CompatErrorBoundary>

      <div
        data-testid="compat-rich-editor"
        contentEditable
        suppressContentEditableWarning
        dangerouslySetInnerHTML={{ __html: richHtml }}
        onInput={(event) => setRichHtml(event.currentTarget.innerHTML)}
      />
      <output data-testid="compat-rich-html">{richHtml}</output>

      <CompatCanvas2DProbe />
      <CompatWebGLProbe />

      <section aria-label="Radix slider compatibility">
        <DualRangeSlider
          data-testid="compat-third-party-slider"
          max={100}
          min={0}
          step={5}
          value={[sliderValue]}
          onValueChange={(values) => setSliderValue(values[0] ?? sliderValue)}
        />
        <output data-testid="compat-third-party-value">{sliderValue}</output>
      </section>

      <div onClick={() => setPortalBubbles((count) => count + 1)}>
        {portalHost ? createPortal(<CompatPortalContent />, portalHost) : null}
      </div>
      <output data-testid="compat-portal-bubbles">{portalBubbles}</output>
    </section>
  );
}

export function E2EUncaughtErrorProbe({ shouldThrow }) {
  if (shouldThrow) {
    throw new Error("compat uncaught failure");
  }

  return <output data-testid="compat-uncaught-ready">ready</output>;
}
