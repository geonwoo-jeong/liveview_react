defmodule LiveViewReactExamplesWeb.Layouts do
  @moduledoc """
  This module holds different layouts used by your application.

  See the `layouts` directory for all templates available.
  The "root" layout is a skeleton rendered as part of the
  application router. The "app" layout is set as the default
  layout on both `use LiveViewReactExamplesWeb, :controller` and
  `use LiveViewReactExamplesWeb, :live_view`.
  """
  use LiveViewReactExamplesWeb, :html

  embed_templates "layouts/*"

  def vite_dev_server? do
    Application.get_env(:liveview_react_examples, :vite, [])[:dev_server] == true
  end

  def vite_asset(path) do
    config = Application.fetch_env!(:liveview_react_examples, :vite)
    URI.merge(config[:url], path) |> to_string()
  end
end
