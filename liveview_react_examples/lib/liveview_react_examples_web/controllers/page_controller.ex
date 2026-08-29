defmodule LiveViewReactExamplesWeb.PageController do
  use LiveViewReactExamplesWeb, :controller

  def home(conn, _params) do
    redirect(conn, to: ~p"/simple")
  end
end
