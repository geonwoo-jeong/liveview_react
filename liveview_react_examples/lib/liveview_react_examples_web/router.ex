defmodule LiveViewReactExamplesWeb.Router do
  use LiveViewReactExamplesWeb, :router

  pipeline :browser do
    plug :accepts, ["html"]
    plug :fetch_session
    plug :fetch_live_flash
    plug :put_root_layout, html: {LiveViewReactExamplesWeb.Layouts, :root}
    plug :protect_from_forgery
    plug :put_secure_browser_headers
  end

  scope "/", LiveViewReactExamplesWeb do
    pipe_through :browser

    get "/", PageController, :home
    live "/lazy", LiveLazy
    live "/simple", LiveSimple
    live "/simple-props", LiveSimpleProps
    live "/typescript", LiveTypescript

    live "/live-counter", LiveCounter
    live "/context", LiveContext
    live "/log-list", LiveLogList
    live "/flash-sonner", LiveFlashSonner
    live "/ssr", LiveSSR
    live "/hybrid-form", LiveHybridForm
    live "/slot", LiveSlot
    live "/link-demo", LiveLinkDemo
    live "/link-usage", LiveLinkUsage
    live "/stream-demo", LiveStreamDemo
  end
end
