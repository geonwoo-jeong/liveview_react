<p align="center">
  <img
    src="guides/images/liveview_react_logo.png"
    alt="暖色のフェニックスが React のシアンへと移り変わる LiveViewReact のロゴ"
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
  <strong>Phoenix LiveView に主導権を持たせたまま、その中で React 19 を動かします。</strong>
</p>

<p align="center">
  <a href="https://hexdocs.pm/liveview_react">HexDocs</a> ·
  <a href="https://hex.pm/packages/liveview_react">Hex</a> ·
  <a href="https://github.com/geonwoo-jeong/liveview_react/blob/main/guides/getting_started.md">はじめに</a> ·
  <a href="https://github.com/geonwoo-jeong/liveview_react/blob/main/guides/comparison.md">比較</a> ·
  <a href="https://github.com/geonwoo-jeong/liveview_react/blob/main/guides/limitations.md">制限事項</a>
</p>

LiveViewReact は、Phoenix LiveView の中に通常の React ルートをマウントします。
ルーティング、アプリケーションの正となるサーバー状態、バリデーション、再接続、DOM の置換は、
引き続き LiveView が担います。React が管理するのは、明示的にマウントした
コンポーネントツリーだけです。第 2 のソケットや、ページ全体を覆う隠れたルート、
SPA ランタイムはありません。

採用を検討する際は、まず[選ぶ理由](#選ぶ理由)、[実行時モデル](#実行時モデル)、
[境界](#境界)をご覧ください。

## 特徴

- **本物の React 19 ルート** — `<.react>` の呼び出しごとに、明示的かつ独立して
  管理されるルートを 1 つ作成
- **エンドツーエンドの LiveView リアクティビティ** — アプリケーションの正となる状態をブラウザーへ
  移すことなく、イミュータブルなスナップショットとコピーオンライトのパッチを通じて、
  サーバーの assign から React の props を更新
- **SSR とハイドレーション** — 同一のコンポーネントレジストリを、開発時 SSR、
  本番環境の Node.js SSR、JavaScript なしの HTML、ブラウザーでのハイドレーションに使用
- **効率的な転送** — コンパクトな props の差分と Phoenix Streams の操作により、
  React のローカル状態を維持したまま既存のルートを更新
- **LiveView との相互運用** — イベント、Promise による応答、ナビゲーション、接続状態、
  フォーム、アップロード、`phx-*` 属性の直接利用に対応
- **非活性な HTML スロット** — HEEx 要素の本文は React の `children` として、
  `<:slot name="...">` の各エントリーは同名の props として、文書化された
  [非インタラクティブ境界](guides/slots.md)の範囲内で受け渡し
- **安全なライフサイクル** — 条件付き削除、時間のかかる Live Navigation、再接続、
  遅延インポート、繰り返しの破棄でも、終了処理を厳密に 1 回だけ実行
- **型安全な Vite 統合** — 厳格な TypeScript、仮想コンポーネントレジストリ、
  React Refresh、対応するブラウザー／サーバー用エントリーポイント
- **1 コマンドでセットアップ** — Igniter インストーラーが PhoenixVite、React、
  TypeScript、SSR、および任意で動作するサンプルを設定

## 選ぶ理由

Phoenix の画面の多くでは、純粋な LiveView が今も適切な第一選択です。
ページ内の限定された一部分で React 自体が必要な場合に、LiveViewReact を使用してください。

- React 専用のコンポーネントライブラリ
- 命令的なフックを多数書くことになりかねない、高度なローカル操作
- Context、portal、Suspense、transition、canvas、WebGL
- サーバーが管理する LiveView ページ内にとどめたいクライアント側ウィジェット

ページ全体のシェル、ルーティング、リモートデータのライフサイクルを React に
管理させたい場合は、SPA または Inertia 形式のアーキテクチャを使用してください。

## インストール

Phoenix アプリケーションのルートで実行します。

```sh
mix igniter.install liveview_react
```

インストーラーが PhoenixVite、React、TypeScript、ブラウザー用エントリーポイント、
SSR 用エントリーポイント、コンポーネントレジストリを接続します。

便利なオプション：

- `mix igniter.install liveview_react --bun`
- `mix igniter.install liveview_react --no-demo`

umbrella 構成では、umbrella のルートではなく Phoenix 子アプリケーションで
インストーラーを実行してください。

`mix igniter.install` を利用できない場合は、まず
`mix archive.install hex igniter_new` で Igniter archive をインストールしてください。
次に `mix assets.setup` と `mix phx.server` を実行します。生成されたデモは
`/liveview-react` で確認できます。生成されるファイルとアセットのワークフロー全体については、
[インストール](guides/installation.md)をご覧ください。

## 最初のコンポーネント

`assets/react-components/Counter.tsx` を作成します。

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

LiveView からレンダリングします。

```heex
<.react
  id="account-counter"
  component="Counter"
  socket={@socket}
  count={@count}
/>
```

LiveView でサーバー状態を初期化し、イベントを処理します。

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

デフォルトのレジストリでは、`assets/react-components` 以下の拡張子を除いた
パスがコンポーネント名になります。そのため、
`assets/react-components/Counter.tsx` は `"Counter"` になります。

## 実行時モデル

LiveView が管理するもの：

- アプリケーションの正となる状態
- ルーティングと Live Navigation
- バリデーションと永続化
- 再接続と置換のライフサイクル
- アップロードとサーバーイベント

React が管理するもの：

- マウントされた 1 つのルート内にあるローカル UI 状態
- そのルート内の Context
- 制御された入力、アニメーション、サードパーティ製ウィジェット
- そのルートが作成する portal

通常の props 更新では、既存のルートが再レンダリングされ、React のローカル状態は
維持されます。`<.react>` 要素を削除するか、その `id` または `component` を変更すると、
意図的な再マウントの境界になります。

## クライアント API

LiveViewReact は以下をエクスポートします。

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

ブリッジコマンドはエフェクトまたはイベントハンドラーから呼び出し、レンダリング中には
決して呼び出さないでください。`useLiveViewReact()` が返す低レベルコマンドは、
SSR とハイドレーションのレンダリング段階で意図的に例外を送出します。組み込みフックは、
文書化されたコミット後のハイドレーション動作を提供します。詳しくは
[クライアントフック](guides/client_hooks.md)をご覧ください。

最小構成のクライアント用エントリーポイント：

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

最小構成の SSR 用エントリーポイント：

```tsx
import components from "virtual:liveview-react/components";
import { createLiveViewReactServer } from "liveview_react/server";

export const { render } = createLiveViewReactServer({ components });
```

## ストリーム、スロット、ナビゲーション

- Phoenix の `stream/3` データは props として直接渡せます。React は
  `__dom_id` を含む、実体化されたイミュータブルな配列を受け取ります。
- HEEx 要素の本文と各 `<:slot name="...">` エントリーは、非活性な HTML ラッパーとして
  React へ転送されます。
- Live Navigation ではクリーンアップが厳密に維持され、破棄済みのフックに React が
  遅れてマウントされることを防ぎます。

## 境界

以下は互換性上の不足ではなく、意図的な製品上の制約です。

- 各 `<.react>` は個別の React ルートです。ルートをまたぐ Context は利用できません。
  複数のウィジェットで 1 つのプロバイダーツリーを共有する必要がある場合は、
  それらを 1 つの大きなルートにまとめてください。
- 外側の LiveView 要素は転送専用です。公開ラッパーのスタイル指定は契約に含まれません。
- スロットの HTML には、不許可を既定とする受動的マークアップの許可リストが適用されます。
  リンク、フォームコントロール、リソースを参照するタグ、イベント／スタイル／URL 属性、`phx-*`、
  `phx-hook`、ネストした LiveView、ネストした LiveViewReact ルートは拒否されます。
- ファイル入力は、React が管理する対象の外側で、Phoenix の
  `<.live_file_input>` を使ってレンダリングする必要があります。React から Phoenix の
  アップロード内部処理を再現することはできません。
- SSR には React のストリーミング SSR ではなく、`renderToString` を使用します。
- 本番環境の SSR には、個別にビルドしたサーバーバンドル、任意の `nodejs` 依存関係と
  Supervisor、リリースイメージ内の Node.js が必要です。詳しくは
  [デプロイ](guides/deployment.md)をご覧ください。
- 初期の公式ブラウザーサポート対象は Chromium のみです。Firefox と WebKit は、
  同等のブラウザーライフサイクルのテストレーンが CI で動作するまで対象に含まれません。
- このライブラリはページ全体の SPA ルーターではなく、リモートデータ取得の管理を
  React に移すものでもありません。

## 要件

- Elixir 1.20+
- OTP 27+
- Phoenix 1.8+
- Phoenix LiveView 1.2.11+
- React および ReactDOM 19.x
- 生成される TypeScript セットアップでは TypeScript 7.x
- 生成されるアセット統合では Vite 8.x
- デフォルトのアセットおよび SSR セットアップでは Node.js 24+

## ガイド

- [はじめに](guides/getting_started.md)
- [インストール](guides/installation.md)
- [コンポーネント API](guides/component_api.md)
- [クライアントフック](guides/client_hooks.md)
- [イベント](guides/events.md)
- [フォーム](guides/forms.md)
- [アップロード](guides/uploads.md)
- [ストリーム](guides/streams.md)
- [スロット](guides/slots.md)
- [SSR](guides/ssr.md)
- [遅延読み込み](guides/lazy_loading.md)
- [アーキテクチャ](guides/architecture.md)
- [比較](guides/comparison.md)
- [制限事項](guides/limitations.md)
- [テスト](guides/testing.md)
- [開発](guides/development.md)
- [デプロイ](guides/deployment.md)
- [アンインストール](guides/uninstallation.md)
- [リリース](guides/releasing.md)
- [実行可能な Phoenix サンプル](https://github.com/geonwoo-jeong/liveview_react/tree/main/liveview_react_examples)

## 開発

プロジェクトの検証コマンド：

```sh
mix quality
npm run quality
npm run test:e2e
```

このリポジトリには、SSR、ライフサイクル、ストリーム、スロット、ナビゲーションの検証用として、
`liveview_react_examples` 以下に Phoenix サンプルアプリケーションが含まれています。

メンテナー向けの検証では、`mix quality_full`、`npm run quality:ci`、
ホスト環境で実行される Release Please ワークフローも使用します。リリース PR をマージする前に、
[テスト](guides/testing.md)と[リリース](guides/releasing.md)をご覧ください。

## クレジット

LiveViewReact は、Baptiste Chaleil（Mrdotb）による
[LiveReact](https://github.com/mrdotb/live_react) のフォークとして始まりました。
その後、独自のパッケージ識別子、公開 API、ランタイム、転送プロトコルを備えた
独立プロジェクトとして、大幅な再設計と再実装が行われています。コードベースの継承部分には、
オリジナルの MIT 著作権表示が引き続き適用されます。

また、本プロジェクトは [LiveVue](https://github.com/Valian/live_vue) と
[LiveSvelte](https://github.com/woutdp/live_svelte) からも大きな着想を得ています。
特に LiveView 統合、SSR、ストリーム、スロット、開発者体験に関する設計を参考にしています。

## ライセンス

Copyright (c) 2026 Geonwoo Jeong. Portions copyright (c) 2024 Mrdotb.
[MIT License](LICENSE.md) に基づいて公開されています。
