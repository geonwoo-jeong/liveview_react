defmodule LiveViewReactExamplesWeb.PageControllerTest do
  use LiveViewReactExamplesWeb.ConnCase

  test "GET / redirects to the first example", %{conn: conn} do
    conn = get(conn, ~p"/")
    assert redirected_to(conn) == ~p"/simple"
  end

  test "GET /simple renders the canonical React root", %{conn: conn} do
    conn = get(conn, ~p"/simple")
    body = html_response(conn, 200)

    assert body =~ ~s(id="simple-demo")
    assert body =~ ~s(data-component="Simple")
    assert body =~ ~s(phx-hook="LiveViewReactHook")
  end
end
