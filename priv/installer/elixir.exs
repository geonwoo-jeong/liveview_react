defmodule LiveViewReact.Installer.Elixir do
  @moduledoc false

  alias Igniter.Code.Common
  alias LiveViewReact.Installer.Templates
  alias Sourceror.Zipper

  @route_macros ~w(connect delete get head live options patch post put trace)a

  @spec ensure_html_import(Igniter.t(), module()) :: Igniter.t()
  def ensure_html_import(igniter, web_module) when is_atom(web_module) do
    case Igniter.Project.Module.find_and_update_module(igniter, web_module, &add_html_import/1) do
      {:ok, igniter} ->
        igniter

      {:error, igniter} ->
        Igniter.add_issue(
          igniter,
          "Could not find selected Phoenix web module #{inspect(web_module)}"
        )
    end
  end

  @spec ensure_demo_module(Igniter.t(), module()) :: Igniter.t()
  def ensure_demo_module(igniter, demo_module) when is_atom(demo_module) do
    generated = Templates.demo_live_view(demo_module)
    generated_ast = Sourceror.parse_string!(generated)

    case Igniter.Project.Module.find_module(igniter, demo_module) do
      {:error, igniter} ->
        path = Igniter.Project.Module.proper_location(igniter, demo_module)
        Igniter.create_new_file(igniter, path, generated)

      {:ok, {igniter, source, _zipper}} ->
        existing_ast = Rewrite.Source.get(source, :quoted)

        if Common.nodes_equal?(existing_ast, generated_ast) do
          igniter
        else
          Igniter.add_issue(
            igniter,
            "Refusing to overwrite existing demo module #{inspect(demo_module)} in #{source.path}"
          )
        end
    end
  end

  @spec ensure_demo_route(Igniter.t(), module(), module()) :: Igniter.t()
  def ensure_demo_route(igniter, router, demo_module)
      when is_atom(router) and is_atom(demo_module) do
    case Igniter.Project.Module.find_and_update_module(
           igniter,
           router,
           &add_demo_route(&1, demo_module)
         ) do
      {:ok, igniter} ->
        igniter

      {:error, igniter} ->
        Igniter.add_issue(igniter, "Could not find selected Phoenix router #{inspect(router)}")
    end
  end

  defp add_html_import(zipper) do
    helpers = Common.find_all(zipper, &html_helpers_definition?/1)

    case helpers do
      [] ->
        {:error,
         "Could not find a single html_helpers/0 definition in the selected Phoenix web module"}

      [helper] ->
        update_html_helpers(helper)

      _multiple ->
        {:error, "Found multiple html_helpers/0 definitions in the selected Phoenix web module"}
    end
  end

  defp html_helpers_definition?(%Zipper{node: node}), do: html_helpers_definition?(node)

  defp html_helpers_definition?({kind, _, [{:html_helpers, _, args}, body]})
       when kind in [:def, :defp] and args in [nil, []] and is_list(body),
       do: match?({:ok, _value}, fetch_keyword(body, :do))

  defp html_helpers_definition?(_node), do: false

  defp update_html_helpers(%Zipper{node: helper_node} = helper) do
    case helper_quote(helper_node) do
      {:ok, quote_node} ->
        apply_html_import_update(helper, helper_node, live_view_react_imports(quote_node))

      :error ->
        {:error, "Could not find the quoted html helper body in the selected Phoenix web module"}
    end
  end

  defp helper_quote({_kind, _meta, [_head, body]}) do
    case fetch_keyword(body, :do) do
      {:ok, {:quote, _, args} = quote_node} when is_list(args) -> {:ok, quote_node}
      _ -> :error
    end
  end

  defp live_view_react_imports(quote_node) do
    {_node, imports} =
      Macro.prewalk(quote_node, [], fn
        {:import, _, [module | _]} = node, imports ->
          if module_ast?(module, LiveViewReact),
            do: {node, [node | imports]},
            else: {node, imports}

        node, imports ->
          {node, imports}
      end)

    Enum.reverse(imports)
  end

  defp put_import_in_helper({kind, meta, [head, body]}) do
    {:ok, quote_node} = fetch_keyword(body, :do)
    updated_quote = update_quote_body(quote_node)
    {kind, meta, [head, put_keyword(body, :do, updated_quote)]}
  end

  defp update_quote_body({:quote, meta, args}) do
    {options, body_keyword} = split_quote_args(args)
    {:ok, body} = fetch_keyword(body_keyword, :do)
    import = Sourceror.parse_string!("import LiveViewReact")
    updated_body = append_expression(body, import)
    {:quote, meta, options ++ [put_keyword(body_keyword, :do, updated_body)]}
  end

  defp split_quote_args([body]) when is_list(body), do: {[], body}
  defp split_quote_args([options, body]) when is_list(body), do: {[options], body}

  defp add_demo_route(zipper, demo_module) do
    routes = Common.find_all(zipper, &demo_path_route?/1)
    scopes = Common.find_all(zipper, &browser_root_scope?/1)

    with {:ok, scope} <- select_browser_scope(scopes) do
      update_demo_route(zipper, routes, scope, demo_module)
    end
  end

  defp select_browser_scope([scope]), do: {:ok, scope}

  defp select_browser_scope([]) do
    {:error,
     "Could not find a root Phoenix scope that pipes through :browser; " <>
       "refusing to guess where /liveview-react belongs"}
  end

  defp select_browser_scope(_multiple) do
    {:error,
     "Found multiple root Phoenix scopes that pipe through :browser; " <>
       "refusing to choose one for /liveview-react"}
  end

  defp demo_path_route?(%Zipper{node: {name, _, [path | _]}})
       when name in @route_macros,
       do: literal(path) == "/liveview-react"

  defp demo_path_route?(_zipper), do: false

  defp desired_demo_route?(
         {:live, _, [path, module_ast, action | _]} = route,
         demo_module,
         scope_node
       ) do
    literal(path) == "/liveview-react" and literal(action) == :index and
      direct_scope_expression?(scope_node, route) and
      expected_module_reference?(module_ast, scope_node, demo_module)
  end

  defp desired_demo_route?(_node, _demo_module, _scope_node), do: false

  defp add_route_to_browser_scope(scope, demo_module) do
    case route_module_reference(scope.node, demo_module) do
      {:ok, module_reference} ->
        route =
          Sourceror.parse_string!(~s(live "/liveview-react", #{module_reference}, :index))

        updated_scope = update_scope_body(scope.node, &append_expression(&1, route))
        {:ok, Common.replace_code(scope, updated_scope)}

      :error ->
        {:error,
         "Could not resolve the selected browser scope alias for the demo route; " <>
           "refusing to guess its module reference"}
    end
  end

  defp browser_root_scope?(%Zipper{node: {:scope, _, [path | _] = args}}) do
    with "/" <- literal(path),
         body when is_list(body) <- List.last(args),
         {:ok, contents} <- fetch_keyword(body, :do) do
      browser_pipeline?(contents)
    else
      _other -> false
    end
  end

  defp browser_root_scope?(_zipper), do: false

  defp browser_pipeline?(nil), do: false

  defp browser_pipeline?(body) do
    body
    |> body_expressions()
    |> Enum.any?(&browser_pipeline_expression?/1)
  end

  defp body_expressions({:__block__, _, expressions}) when is_list(expressions), do: expressions
  defp body_expressions(expression), do: [expression]

  defp browser_pipeline_expression?({:pipe_through, _, [pipeline]}),
    do: browser_pipeline_value?(pipeline)

  defp browser_pipeline_expression?(_expression), do: false

  defp browser_pipeline_value?(pipeline) do
    case literal(pipeline) do
      :browser -> true
      pipelines when is_list(pipelines) -> :browser in Enum.map(pipelines, &literal/1)
      _pipeline -> false
    end
  end

  defp update_scope_body({:scope, meta, args}, updater) do
    body_keyword = List.last(args)
    {:ok, body} = fetch_keyword(body_keyword, :do)
    updated_keyword = put_keyword(body_keyword, :do, updater.(body))
    {:scope, meta, Enum.drop(args, -1) ++ [updated_keyword]}
  end

  defp direct_scope_expression?({:scope, _, args}, expected) do
    with body_keyword when is_list(body_keyword) <- List.last(args),
         {:ok, body} <- fetch_keyword(body_keyword, :do) do
      body
      |> body_expressions()
      |> Enum.any?(&(&1 == expected))
    else
      _other -> false
    end
  end

  defp expected_module_reference?(module_ast, scope_node, demo_module) do
    with {:ok, expected} <- route_module_parts(scope_node, demo_module),
         {:ok, actual} <- module_parts(module_ast) do
      actual == expected
    else
      _other -> false
    end
  end

  defp route_module_reference(scope_node, demo_module) do
    case route_module_parts(scope_node, demo_module) do
      {:ok, parts} -> {:ok, Enum.join(parts, ".")}
      :error -> :error
    end
  end

  defp route_module_parts({:scope, _, args}, demo_module) do
    demo_parts = Module.split(demo_module)

    case scope_alias(args) do
      :none ->
        {:ok, demo_parts}

      {:ok, scope_module} ->
        scope_parts = Module.split(scope_module)

        case Enum.split(demo_parts, length(scope_parts)) do
          {^scope_parts, [_ | _] = relative_parts} -> {:ok, relative_parts}
          _other -> :error
        end

      :error ->
        :error
    end
  end

  defp scope_alias([_path, alias_ast, body_keyword]) when is_list(body_keyword),
    do: module_from_ast(alias_ast)

  defp scope_alias([_path, body_keyword]) when is_list(body_keyword) do
    case fetch_keyword(body_keyword, :alias) do
      :error -> :none
      {:ok, alias_ast} -> module_from_ast(alias_ast)
    end
  end

  defp scope_alias(_args), do: :error

  defp module_parts({:__aliases__, _, parts}), do: {:ok, Enum.map(parts, &to_string/1)}
  defp module_parts(module) when is_atom(module), do: {:ok, Module.split(module)}
  defp module_parts(_module), do: :error

  defp module_from_ast({:__aliases__, _, parts}), do: {:ok, Module.concat(parts)}

  defp module_from_ast(module) when is_atom(module) and module not in [false, nil],
    do: {:ok, module}

  defp module_from_ast(module) when module in [false, nil], do: :none
  defp module_from_ast(_module), do: :error

  defp append_expression({:__block__, meta, expressions}, expression),
    do: {:__block__, meta, expressions ++ [expression]}

  defp append_expression(body, expression), do: {:__block__, [], [body, expression]}

  defp module_ast?({:__aliases__, _, parts}, module), do: Module.concat(parts) == module
  defp module_ast?(module, module) when is_atom(module), do: true
  defp module_ast?(_ast, _module), do: false

  defp apply_html_import_update(helper, helper_node, []) do
    updated_helper = put_import_in_helper(helper_node)
    {:ok, Common.replace_code(helper, updated_helper)}
  end

  defp apply_html_import_update(helper, _helper_node, [{:import, _, [_module]}]),
    do: {:ok, helper}

  defp apply_html_import_update(_helper, _helper_node, [_restricted]) do
    {:error,
     "The selected Phoenix html_helpers/0 already imports LiveViewReact with options; " <>
       "refusing to change its import contract"}
  end

  defp apply_html_import_update(_helper, _helper_node, _duplicates) do
    {:error, "The selected Phoenix html_helpers/0 contains duplicate LiveViewReact imports"}
  end

  defp update_demo_route(_zipper, [], scope, demo_module),
    do: add_route_to_browser_scope(scope, demo_module)

  defp update_demo_route(zipper, [route], scope, demo_module) do
    case desired_demo_route?(route.node, demo_module, scope.node) do
      true -> {:ok, zipper}
      false -> {:error, "The selected router already has a conflicting /liveview-react route"}
    end
  end

  defp update_demo_route(_zipper, _routes, _scope, _demo_module),
    do: {:error, "The selected router contains duplicate /liveview-react routes"}

  defp fetch_keyword(keyword, key) do
    Enum.find_value(keyword, :error, fn
      {raw_key, value} -> if literal(raw_key) == key, do: {:ok, value}, else: false
      _entry -> false
    end)
  end

  defp put_keyword(keyword, key, value) do
    Enum.map(keyword, fn
      {raw_key, _old_value} = entry ->
        if literal(raw_key) == key, do: {raw_key, value}, else: entry

      entry ->
        entry
    end)
  end

  defp literal({:__block__, _, [value]}), do: literal(value)
  defp literal(value), do: value
end
