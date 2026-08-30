defmodule LiveViewReactExamplesWeb.PageControllerTest do
  use LiveViewReactExamplesWeb.ConnCase

  test "GET / redirects to the comprehensive sample", %{conn: conn} do
    conn = get(conn, ~p"/")
    assert redirected_to(conn) == ~p"/sample"
  end

  test "GET /sample renders the comprehensive React root", %{conn: conn} do
    conn = get(conn, ~p"/sample")
    body = html_response(conn, 200)

    assert body =~ ~s(id="all-features-demo")
    assert body =~ ~s(data-component="AllFeatures")
    assert body =~ ~s(id="sample-forms-uploads-demo")
    assert body =~ ~s(data-component="SampleFormsUploads")
    assert body =~ ~s(id="sample-portal-outlet")
    assert body =~ ~s(Phoenix href reload)
    assert body =~ ~s(id="vite-discovered-demo")
    assert body =~ ~s(data-component="RegistryBadge")
    assert body =~ ~s(phx-hook="LiveViewReactHook")
  end

  test "GET /simple still exposes the original basic sample route", %{conn: conn} do
    conn = get(conn, ~p"/simple")
    body = html_response(conn, 200)

    assert body =~ ~s(id="simple-demo")
    assert body =~ ~s(data-component="Simple")
    assert body =~ ~s(phx-hook="LiveViewReactHook")
  end
end
