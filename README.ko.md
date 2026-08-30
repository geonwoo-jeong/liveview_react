<p align="center">
  <img
    src="guides/images/liveview_react_logo.png"
    alt="따뜻한 색조의 피닉스가 React 시안 색상으로 물들어 가는 LiveViewReact 로고"
    width="220"
  />
</p>

<p align="center">
  <a href="https://github.com/geonwoo-jeong/liveview_react/blob/main/README.md">English</a> ·
  <a href="https://github.com/geonwoo-jeong/liveview_react/blob/main/README.ko.md">한국어</a> ·
  <a href="https://github.com/geonwoo-jeong/liveview_react/blob/main/README.ja.md">日本語</a> ·
  <a href="https://github.com/geonwoo-jeong/liveview_react/blob/main/README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <strong>Phoenix LiveView가 주도권을 유지하면서 그 안에서 React 19를 사용합니다.</strong>
</p>

<p align="center">
  <a href="https://hexdocs.pm/liveview_react">HexDocs</a> ·
  <a href="https://hex.pm/packages/liveview_react">Hex</a> ·
  <a href="https://github.com/geonwoo-jeong/liveview_react/blob/main/guides/getting_started.md">시작하기</a> ·
  <a href="https://github.com/geonwoo-jeong/liveview_react/blob/main/guides/comparison.md">비교</a> ·
  <a href="https://github.com/geonwoo-jeong/liveview_react/blob/main/guides/limitations.md">제한 사항</a>
</p>

LiveViewReact는 Phoenix LiveView 안에 일반적인 React 루트를 마운트합니다. 라우팅,
기준이 되는 서버 상태, 유효성 검사, 재연결, DOM 교체는 계속해서 LiveView가
담당합니다. React는 명시적으로 마운트한 컴포넌트 트리만 담당합니다. 별도의 두 번째
소켓이나 숨겨진 페이지 전체 루트, SPA 런타임은 없습니다.

도입 적합성을 검토하고 있다면 [왜 필요한가](#왜-필요한가),
[런타임 모델](#런타임-모델), [경계](#경계)를 먼저 읽어보세요.

## 주요 기능

- **진정한 React 19 루트** — 각 `<.react>` 호출마다 명시적이고 독립적으로 관리되는
  루트 하나를 생성합니다
- **엔드투엔드 LiveView 반응성** — 기준 상태를 브라우저로 옮기지 않고,
  서버 assign이 불변 스냅샷과 쓰기 시 복사 패치를 통해 React prop을 업데이트합니다
- **SSR과 하이드레이션** — 동일한 컴포넌트 레지스트리가 개발 환경 SSR, 프로덕션
  Node.js SSR, JavaScript 없는 HTML, 브라우저 하이드레이션을 모두 지원합니다
- **효율적인 전송** — 간결한 prop diff와 Phoenix Streams 연산으로 로컬 React
  상태를 보존하면서 기존 루트를 업데이트합니다
- **LiveView 상호 운용성** — 이벤트, Promise 응답, 내비게이션, 연결 상태, 폼,
  업로드, 직접 지정하는 `phx-*` 속성을 지원합니다
- **비활성 HTML 슬롯** — HEEx 요소 본문은 React `children`으로 전달되고,
  `<:slot name="...">` 항목은 문서화된 [비대화형 경계](guides/slots.md) 안에서
  같은 이름의 prop으로 전달됩니다
- **안전한 생명주기** — 조건부 제거, 느린 라이브 내비게이션, 재연결, 지연 import,
  반복적인 소멸 상황에서도 정리가 정확히 한 번만 수행됩니다
- **타입 안전한 Vite 통합** — 엄격한 TypeScript, 가상 컴포넌트 레지스트리,
  React Refresh, 서로 일치하는 브라우저·서버 엔트리포인트를 제공합니다
- **명령어 하나로 설정** — Igniter 설치 프로그램이 PhoenixVite, React,
  TypeScript, SSR과 선택 가능한 실행 예제를 구성합니다

## 왜 필요한가

대부분의 Phoenix 화면에는 순수 LiveView가 여전히 올바른 기본 선택입니다. 페이지의
제한된 일부 영역에 React 자체가 필요할 때 LiveViewReact를 사용하세요.

- React 전용 컴포넌트 라이브러리
- 그렇지 않으면 명령형 hook이 되어버릴 만큼 복잡한 로컬 상호작용
- Context, 포털, Suspense, 트랜지션, 캔버스 또는 WebGL
- 서버가 소유하는 LiveView 페이지 안에 유지해야 하는 클라이언트 측 위젯

React가 전체 페이지 셸과 라우팅, 원격 데이터 생명주기를 담당해야 한다면 SPA나
Inertia 스타일 아키텍처를 사용하세요.

## 설치

Phoenix 애플리케이션 루트에서 실행하세요.

```sh
mix igniter.install liveview_react
```

설치 프로그램은 PhoenixVite, React, TypeScript, 브라우저 엔트리포인트, SSR
엔트리포인트와 컴포넌트 레지스트리를 연결합니다.

유용한 옵션:

- `mix igniter.install liveview_react --bun`
- `mix igniter.install liveview_react --no-demo`

엄브렐러 프로젝트에서는 엄브렐러 루트가 아니라 Phoenix 자식 애플리케이션에서
설치 프로그램을 실행하세요.

`mix igniter.install`을 사용할 수 없다면 먼저
`mix archive.install hex igniter_new`로 Igniter 아카이브를 설치하세요. 그런 다음
`mix assets.setup`과 `mix phx.server`를 실행하면 생성된 데모를
`/liveview-react`에서 확인할 수 있습니다. 생성되는 전체 파일과 에셋 워크플로는
[설치](guides/installation.md)를 참조하세요.

## 첫 번째 컴포넌트

`assets/react-components/Counter.tsx`를 만드세요.

```tsx
import { useState } from "react";
import { useLiveViewReact } from "liveview_react";

type CounterProps = {
  readonly count: number;
};

export default function Counter({ count }: CounterProps) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { pushEvent } = useLiveViewReact();

  async function increment() {
    setErrorMessage(null);

    try {
      await pushEvent("increment", { by: 1 });
    } catch {
      setErrorMessage("The server could not process the increment");
    }
  }

  return (
    <>
      <button type="button" onClick={() => void increment()}>
        Count: {count}
      </button>
      {errorMessage && <p role="alert">{errorMessage}</p>}
    </>
  );
}
```

LiveView에서 렌더링하세요.

```heex
<.react
  id="account-counter"
  component="Counter"
  socket={@socket}
  count={@count}
/>
```

LiveView에서 서버 상태를 초기화하고 이벤트를 처리하세요.

```elixir
def mount(_params, _session, socket) do
  {:ok, assign(socket, count: 0)}
end

def handle_event("increment", %{"by" => by}, socket)
    when is_integer(by) and by in 1..10 do
  socket = update(socket, :count, &(&1 + by))
  {:reply, %{count: socket.assigns.count}, socket}
end

def handle_event("increment", _params, socket) do
  {:reply, %{error: "increment must be an integer from 1 through 10"}, socket}
end
```

기본 레지스트리는 `assets/react-components` 아래에서 확장자를 제외한 경로로
컴포넌트 이름을 지정합니다. 따라서 `assets/react-components/Counter.tsx`는
`"Counter"`가 됩니다.

## 런타임 모델

LiveView가 담당하는 것:

- 애플리케이션의 기준 상태
- 라우팅과 라이브 내비게이션
- 유효성 검사와 영속성
- 재연결과 교체 생명주기
- 업로드와 서버 이벤트

React가 담당하는 것:

- 마운트된 하나의 루트 안에 있는 로컬 UI 상태
- 해당 루트 안의 Context
- 제어 입력, 애니메이션, 서드파티 위젯
- 해당 루트가 생성한 포털

일반적인 prop 업데이트는 기존 루트를 다시 렌더링하며 로컬 React 상태를 보존합니다.
`<.react>` 요소를 제거하거나 `id` 또는 `component`를 변경하면 의도적으로 다시
마운트하는 경계가 됩니다.

## 클라이언트 API

LiveViewReact가 내보내는 항목:

- `createLiveViewReact`
- `createLiveViewReactServer`
- `useLiveViewReact`
- `useLiveEvent`
- `useEventReply`
- `useLiveConnection`
- `useLiveNavigation`
- `useLiveForm`
- `useLiveUpload`
- `Link`

브리지 명령은 렌더링 중이 아니라 이펙트나 이벤트 핸들러에서 호출하세요.
`useLiveViewReact()`가 반환하는 저수준 명령은 의도적으로 SSR과 하이드레이션 렌더
단계에서 예외를 발생시키며, 내장 hook은 문서화된 커밋 후 하이드레이션 동작을
제공합니다. [클라이언트 hook](guides/client_hooks.md)을 참조하세요.

최소 클라이언트 엔트리포인트:

```tsx
import { Socket } from "phoenix";
import { LiveSocket } from "phoenix_live_view";
import components from "virtual:liveview-react/components";
import { createLiveViewReact } from "liveview_react";

const liveViewReact = createLiveViewReact({ components });

const liveSocket = new LiveSocket("/live", Socket, {
  hooks: {
    ...liveViewReact.hooks,
  },
  params: { _csrf_token: csrfToken },
});
```

최소 SSR 엔트리포인트:

```tsx
import components from "virtual:liveview-react/components";
import { createLiveViewReactServer } from "liveview_react/server";

export const { render } = createLiveViewReactServer({ components });
```

## 스트림, 슬롯, 내비게이션

- Phoenix `stream/3` 데이터는 prop으로 직접 전달할 수 있습니다. React는
  `__dom_id`를 포함해 구체화된 불변 배열을 받습니다.
- HEEx 요소 본문과 각 `<:slot name="...">` 항목은 비활성 HTML 래퍼로 React에
  전달됩니다.
- 라이브 내비게이션은 정확한 정리를 보장하고, hook이 소멸한 뒤 React가 뒤늦게
  마운트되는 것을 방지합니다.

## 경계

다음은 호환성의 결함이 아니라 의도적인 제품 제약입니다.

- 각 `<.react>`는 별도의 React 루트입니다. 루트 간 Context 공유는 불가능합니다.
  여러 위젯이 하나의 provider 트리를 사용해야 한다면 더 큰 루트 하나에 속해야
  합니다.
- 바깥쪽 LiveView 요소는 전송 전용입니다. 공개 wrapper 스타일링 옵션은 계약에
  포함되지 않습니다.
- 슬롯 HTML은 명시적으로 허용되지 않은 항목을 차단하는 비대화형 마크업 허용 목록을
  사용합니다. 링크, 폼 컨트롤, 리소스를 포함하는 태그, 이벤트·스타일·URL 속성, `phx-*`,
  `phx-hook`, 중첩 LiveView, 중첩 LiveViewReact 루트는 거부됩니다.
- 파일 입력은 React가 소유하는 대상 바깥에서 Phoenix의 `<.live_file_input>`으로
  렌더링해야 합니다. React는 Phoenix의 업로드 내부 동작을 재현할 수 없습니다.
- SSR은 React 스트리밍 SSR이 아니라 `renderToString`을 사용합니다.
- 프로덕션 SSR에는 별도로 빌드한 서버 번들, 선택 사항인 `nodejs` 의존성과
  슈퍼바이저, 릴리스 이미지의 Node.js가 필요합니다.
  [배포](guides/deployment.md)를 참조하세요.
- 최초 공개 브라우저 지원 계약은 Chromium만 대상으로 합니다. Firefox와 WebKit은
  동등한 브라우저 생명주기 검증이 CI에서 실행되기 전까지 지원을 보장하지 않습니다.
- 이 라이브러리는 페이지 전체 SPA 라우터가 아니며, 원격 데이터 가져오기의 소유권을
  React에 넘기지 않습니다.

## 요구 사항

- Elixir 1.20+
- OTP 27+
- Phoenix 1.8+
- Phoenix LiveView 1.2.11+
- React 및 ReactDOM 19.x
- 생성된 TypeScript 설정에는 TypeScript 7.x
- 생성된 에셋 통합에는 Vite 8.x
- 기본 에셋 및 SSR 설정에는 Node.js 24+

## 가이드

- [시작하기](guides/getting_started.md)
- [설치](guides/installation.md)
- [컴포넌트 API](guides/component_api.md)
- [클라이언트 hook](guides/client_hooks.md)
- [이벤트](guides/events.md)
- [폼](guides/forms.md)
- [업로드](guides/uploads.md)
- [스트림](guides/streams.md)
- [슬롯](guides/slots.md)
- [SSR](guides/ssr.md)
- [지연 로딩](guides/lazy_loading.md)
- [아키텍처](guides/architecture.md)
- [비교](guides/comparison.md)
- [제한 사항](guides/limitations.md)
- [테스트](guides/testing.md)
- [개발](guides/development.md)
- [배포](guides/deployment.md)
- [제거](guides/uninstallation.md)
- [릴리스](guides/releasing.md)
- [실행 가능한 Phoenix 예제](https://github.com/geonwoo-jeong/liveview_react/tree/main/liveview_react_examples)

## 개발

프로젝트 검사:

```sh
mix quality
npm run quality
npm run test:e2e
```

이 저장소에는 SSR, 생명주기, 스트림, 슬롯, 내비게이션을 검증하기 위한 Phoenix 예제
애플리케이션이 `liveview_react_examples` 아래에 포함되어 있습니다.

유지관리자 수준의 검증에는 `mix quality_full`, `npm run quality:ci`와 호스팅되는
Release Please 워크플로가 추가됩니다. 릴리스 PR을 병합하기 전에
[테스트](guides/testing.md)와 [릴리스](guides/releasing.md)를 참조하세요.

## 크레딧

LiveViewReact는 Baptiste Chaleil(Mrdotb)이 만든
[LiveReact](https://github.com/mrdotb/live_react)의 포크로 시작했습니다. 이후 고유한
패키지 정체성, 공개 API, 런타임, 전송 프로토콜을 갖춘 독립 프로젝트로 대폭
재설계하고 다시 구현했습니다. 코드베이스에서 계승한 부분에는 원본 MIT 저작권
고지가 그대로 유지됩니다.

이 프로젝트는 특히 LiveView 통합, SSR, 스트림, 슬롯, 개발자 경험과 관련해
[LiveVue](https://github.com/Valian/live_vue)와
[LiveSvelte](https://github.com/woutdp/live_svelte)에서도 큰 영감을 받았습니다.

## 라이선스

Copyright (c) 2026 Geonwoo Jeong. Portions copyright (c) 2024 Mrdotb.
[MIT License](LICENSE.md)에 따라 배포됩니다.
