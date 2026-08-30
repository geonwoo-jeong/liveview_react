defmodule LiveViewReact.ExDocLinkChecker do
  @moduledoc false

  @link_attributes ["href", "src"]
  @allowed_missing_files MapSet.new(["docs_config.js"])

  @type validation_counts :: %{
          html_files: non_neg_integer(),
          epub_files: non_neg_integer(),
          epub_xhtml_files: non_neg_integer()
        }

  @spec validate(String.t()) :: {:ok, validation_counts()} | {:error, [String.t()]}
  def validate(output_dir) when is_binary(output_dir) do
    root = Path.expand(output_dir)

    if File.dir?(root) do
      validate_output(root)
    else
      {:error, ["documentation output directory does not exist: #{inspect(output_dir)}"]}
    end
  end

  def validate(output_dir) do
    {:error, ["documentation output directory must be a path: #{inspect(output_dir)}"]}
  end

  @spec main([String.t()], keyword()) :: 0 | 1 | 2
  def main(args, opts \\ [])

  def main([output_dir], opts) do
    case validate(output_dir) do
      {:ok, counts} ->
        unless Keyword.get(opts, :quiet, false) do
          IO.puts(
            "Validated #{counts.html_files} ExDoc HTML files and " <>
              "#{counts.epub_xhtml_files} XHTML files in #{counts.epub_files} EPUB archives"
          )
        end

        0

      {:error, errors} ->
        Enum.each(errors, &IO.puts(:stderr, &1))
        1
    end
  end

  def main(_args, _opts) do
    IO.puts(:stderr, "usage: mix run scripts/check_exdoc_links.exs EXDOC_OUTPUT_DIR")
    2
  end

  defp validate_output(root) do
    html_files = discover_files(root, "html")
    epub_files = discover_epubs(root)

    cond do
      html_files == [] ->
        {:error, ["no HTML files found under #{inspect(root)}"]}

      epub_files == [] ->
        {:error, ["no EPUB archives found under #{inspect(root)}"]}

      true ->
        validate_output_files(root, html_files, epub_files)
    end
  end

  defp discover_files(root, extension) do
    root
    |> Path.join("**/*.#{extension}")
    |> Path.wildcard(match_dot: true)
    |> Enum.filter(&File.regular?/1)
    |> Enum.sort()
  end

  defp discover_epubs(root) do
    root
    |> discover_files("epub")
    |> Enum.reject(&String.starts_with?(Path.basename(&1), "."))
  end

  defp validate_output_files(root, html_files, epub_files) do
    {html_documents, html_read_errors} = load_html_documents(root, html_files)
    html_link_errors = validate_html_links(root, html_documents)
    {epub_xhtml_count, epub_errors} = validate_epubs(root, epub_files)

    errors =
      html_read_errors
      |> Enum.concat(html_link_errors)
      |> Enum.concat(epub_errors)
      |> Enum.uniq()
      |> Enum.sort()

    counts = %{
      html_files: length(html_files),
      epub_files: length(epub_files),
      epub_xhtml_files: epub_xhtml_count
    }

    case errors do
      [] -> {:ok, counts}
      _errors -> {:error, errors}
    end
  end

  defp load_html_documents(root, html_files) do
    Enum.reduce(html_files, {%{}, []}, fn html_file, {documents, errors} ->
      case read_html_document(root, html_file) do
        {:ok, document} ->
          {Map.put(documents, html_file, document), errors}

        {:error, error} ->
          {documents, [error | errors]}
      end
    end)
  end

  defp read_html_document(root, html_file) do
    relative_file = relative_path(html_file, root)

    case File.read(html_file) do
      {:ok, html} ->
        parse_document(html, relative_file, "HTML")

      {:error, reason} ->
        {:error, "#{relative_file}: could not read HTML: #{:file.format_error(reason)}"}
    end
  end

  defp parse_document(markup, label, kind) do
    case Floki.parse_document(markup) do
      {:ok, tree} -> {:ok, document(tree)}
      {:error, reason} -> {:error, "#{label}: could not parse #{kind}: #{reason}"}
    end
  end

  defp document(tree) do
    anchors =
      tree
      |> Floki.attribute("[id]", "id")
      |> Enum.concat(Floki.attribute(tree, "a[name]", "name"))
      |> MapSet.new()

    %{anchors: anchors, tree: tree}
  end

  defp validate_html_links(root, documents) do
    Enum.flat_map(documents, fn {source_file, document} ->
      document.tree
      |> references()
      |> Enum.flat_map(fn reference ->
        case validate_html_reference(root, source_file, documents, reference) do
          nil -> []
          error -> [error]
        end
      end)
    end)
  end

  defp validate_html_reference(root, source_file, documents, {attribute, raw_value}) do
    value = String.trim(raw_value)

    if ignored_reference?(value) do
      nil
    else
      validate_local_html_reference(root, source_file, documents, attribute, value)
    end
  rescue
    error in [ArgumentError, URI.Error] ->
      source = relative_path(source_file, root)
      "#{source}: invalid #{attribute} #{inspect(raw_value)}: #{Exception.message(error)}"
  end

  defp validate_local_html_reference(root, source_file, documents, attribute, value) do
    uri = URI.parse(value)
    target_file = resolve_html_target(source_file, uri.path)

    cond do
      not inside_root?(target_file, root) ->
        source = relative_path(source_file, root)
        "#{source}: #{attribute} #{inspect(value)} resolves outside documentation output"

      allowed_missing_file?(target_file, root) and not File.exists?(target_file) ->
        nil

      true ->
        validate_html_target(root, source_file, documents, attribute, value, uri, target_file)
    end
  end

  defp validate_html_target(root, source_file, documents, attribute, value, uri, target_file) do
    browser_target = html_browser_target(target_file)

    cond do
      not File.regular?(browser_target) ->
        source = relative_path(source_file, root)
        target = relative_path(browser_target, root)
        "#{source}: #{attribute} #{inspect(value)} points to missing file #{inspect(target)}"

      is_nil(uri.fragment) or uri.fragment == "" ->
        nil

      html_file?(browser_target) ->
        validate_html_fragment(
          root,
          source_file,
          documents,
          browser_target,
          attribute,
          value,
          uri.fragment
        )

      true ->
        nil
    end
  end

  defp validate_html_fragment(
         root,
         source_file,
         documents,
         target_file,
         attribute,
         value,
         encoded_fragment
       ) do
    fragment = fragment_anchor(encoded_fragment)
    target_document = Map.get(documents, target_file)

    cond do
      is_nil(fragment) or is_nil(target_document) ->
        nil

      MapSet.member?(target_document.anchors, fragment) ->
        nil

      true ->
        source = relative_path(source_file, root)
        target = relative_path(target_file, root)

        "#{source}: #{attribute} #{inspect(value)} points to missing fragment " <>
          "#{inspect("##{fragment}")} in #{inspect(target)}"
    end
  end

  defp resolve_html_target(source_file, path) when path in [nil, ""], do: source_file

  defp resolve_html_target(source_file, path) do
    path
    |> URI.decode()
    |> Path.expand(Path.dirname(source_file))
  end

  defp html_browser_target(target_file) do
    index_file = Path.join(target_file, "index.html")

    if File.dir?(target_file) and File.regular?(index_file) do
      index_file
    else
      target_file
    end
  end

  defp validate_epubs(root, epub_files) do
    Enum.reduce(epub_files, {0, []}, fn epub_file, {xhtml_count, errors} ->
      {current_count, current_errors} = validate_epub(root, epub_file)
      {xhtml_count + current_count, errors ++ current_errors}
    end)
  end

  defp validate_epub(root, epub_file) do
    epub = relative_path(epub_file, root)

    case extract_epub(epub_file, epub) do
      {:ok, raw_entries} ->
        {entries, entry_errors} = load_epub_entries(epub, raw_entries)
        {documents, document_errors, xhtml_count} = load_epub_documents(epub, entries)
        link_errors = validate_epub_links(epub, entries, documents)

        empty_errors =
          if xhtml_count == 0, do: ["#{epub}: contains no XHTML files"], else: []

        {xhtml_count, entry_errors ++ document_errors ++ link_errors ++ empty_errors}

      {:unsafe, entry_errors} ->
        {0, entry_errors}

      {:error, reason} ->
        {0, ["#{epub}: could not read EPUB archive: #{inspect(reason)}"]}
    end
  end

  defp extract_epub(epub_file, epub) do
    archive = String.to_charlist(epub_file)

    case :zip.table(archive) do
      {:ok, table} ->
        case epub_table_errors(epub, table) do
          [] -> :zip.extract(archive, [:memory])
          errors -> {:unsafe, errors}
        end

      {:error, reason} ->
        {:error, reason}
    end
  catch
    kind, reason -> {:error, {kind, reason}}
  end

  defp epub_table_errors(epub, table) do
    table
    |> Enum.flat_map(fn
      {:zip_file, raw_name, _info, _comment, _offset, _compressed_size} ->
        case epub_table_entry_error(epub, raw_name) do
          nil -> []
          error -> [error]
        end

      _entry ->
        []
    end)
    |> Enum.sort()
  end

  defp epub_table_entry_error(epub, raw_name) do
    name = IO.chardata_to_string(raw_name)

    case normalize_archive_path([], name) do
      :outside ->
        "#{epub}: EPUB entry #{inspect(name)} resolves outside the archive"

      {:ok, _normalized_name} ->
        nil
    end
  rescue
    error in [ArgumentError, UnicodeConversionError] ->
      "#{epub}: invalid EPUB entry #{inspect(raw_name)}: #{Exception.message(error)}"
  end

  defp load_epub_entries(epub, raw_entries) do
    Enum.reduce(raw_entries, {%{}, []}, fn raw_entry, {entries, errors} ->
      load_epub_entry(epub, raw_entry, entries, errors)
    end)
  end

  defp load_epub_entry(epub, {raw_name, contents}, entries, errors) do
    name = IO.chardata_to_string(raw_name)

    cond do
      String.ends_with?(name, "/") ->
        {entries, errors}

      true ->
        put_epub_entry(epub, entries, errors, name, IO.iodata_to_binary(contents))
    end
  rescue
    error in [ArgumentError, UnicodeConversionError] ->
      message = "#{epub}: invalid EPUB entry #{inspect(raw_name)}: #{Exception.message(error)}"
      {entries, [message | errors]}
  end

  defp put_epub_entry(epub, entries, errors, name, contents) do
    case normalize_archive_path([], name) do
      {:ok, ""} ->
        {entries, ["#{epub}: contains an empty EPUB entry path" | errors]}

      {:ok, normalized_name} when is_map_key(entries, normalized_name) ->
        error = "#{epub}: contains duplicate EPUB entry #{inspect(normalized_name)}"
        {entries, [error | errors]}

      {:ok, normalized_name} ->
        {Map.put(entries, normalized_name, contents), errors}

      :outside ->
        error = "#{epub}: EPUB entry #{inspect(name)} resolves outside the archive"
        {entries, [error | errors]}
    end
  end

  defp load_epub_documents(epub, entries) do
    xhtml_entries =
      entries
      |> Enum.filter(fn {name, _contents} -> xhtml_file?(name) end)
      |> Enum.sort_by(&elem(&1, 0))

    {documents, errors} =
      Enum.reduce(xhtml_entries, {%{}, []}, fn {name, contents}, {documents, errors} ->
        case parse_document(contents, "#{epub}!#{name}", "XHTML") do
          {:ok, document} -> {Map.put(documents, name, document), errors}
          {:error, error} -> {documents, [error | errors]}
        end
      end)

    {documents, errors, length(xhtml_entries)}
  end

  defp validate_epub_links(epub, entries, documents) do
    Enum.flat_map(documents, fn {source_entry, document} ->
      document.tree
      |> references()
      |> Enum.flat_map(fn reference ->
        case validate_epub_reference(epub, entries, documents, source_entry, reference) do
          nil -> []
          error -> [error]
        end
      end)
    end)
  end

  defp validate_epub_reference(
         epub,
         entries,
         documents,
         source_entry,
         {attribute, raw_value}
       ) do
    value = String.trim(raw_value)

    if ignored_reference?(value) do
      nil
    else
      validate_local_epub_reference(
        epub,
        entries,
        documents,
        source_entry,
        attribute,
        value
      )
    end
  rescue
    error in [ArgumentError, URI.Error] ->
      "#{epub}!#{source_entry}: invalid #{attribute} #{inspect(raw_value)}: " <>
        Exception.message(error)
  end

  defp validate_local_epub_reference(
         epub,
         entries,
         documents,
         source_entry,
         attribute,
         value
       ) do
    uri = URI.parse(value)

    case resolve_epub_target(source_entry, uri.path) do
      :outside ->
        "#{epub}!#{source_entry}: #{attribute} #{inspect(value)} resolves outside the EPUB archive"

      {:ok, target_entry} ->
        validate_epub_target(
          epub,
          entries,
          documents,
          source_entry,
          target_entry,
          attribute,
          value,
          uri.fragment
        )
    end
  end

  defp validate_epub_target(
         epub,
         entries,
         documents,
         source_entry,
         target_entry,
         attribute,
         value,
         encoded_fragment
       ) do
    browser_target = epub_browser_target(target_entry, entries)

    cond do
      not Map.has_key?(entries, browser_target) ->
        "#{epub}!#{source_entry}: #{attribute} #{inspect(value)} points to missing EPUB entry " <>
          inspect(browser_target)

      is_nil(encoded_fragment) or encoded_fragment == "" ->
        nil

      xhtml_file?(browser_target) ->
        validate_epub_fragment(
          epub,
          documents,
          source_entry,
          browser_target,
          attribute,
          value,
          encoded_fragment
        )

      true ->
        nil
    end
  end

  defp validate_epub_fragment(
         epub,
         documents,
         source_entry,
         target_entry,
         attribute,
         value,
         encoded_fragment
       ) do
    fragment = fragment_anchor(encoded_fragment)
    target_document = Map.get(documents, target_entry)

    cond do
      is_nil(fragment) or is_nil(target_document) ->
        nil

      MapSet.member?(target_document.anchors, fragment) ->
        nil

      true ->
        "#{epub}!#{source_entry}: #{attribute} #{inspect(value)} points to missing fragment " <>
          "#{inspect("##{fragment}")} in EPUB entry #{inspect(target_entry)}"
    end
  end

  defp resolve_epub_target(source_entry, path) when path in [nil, ""],
    do: {:ok, source_entry}

  defp resolve_epub_target(source_entry, path) do
    base_segments = source_entry |> String.split("/", trim: true) |> Enum.drop(-1)
    normalize_archive_path(base_segments, URI.decode(path))
  end

  defp normalize_archive_path(base_segments, path) do
    if String.starts_with?(path, "/") do
      :outside
    else
      path
      |> String.split("/", trim: false)
      |> Enum.reduce_while(base_segments, &normalize_archive_segment/2)
      |> case do
        :outside -> :outside
        segments -> {:ok, Enum.join(segments, "/")}
      end
    end
  end

  defp normalize_archive_segment(segment, segments) when segment in ["", "."],
    do: {:cont, segments}

  defp normalize_archive_segment("..", []), do: {:halt, :outside}

  defp normalize_archive_segment("..", segments) do
    {:cont, Enum.drop(segments, -1)}
  end

  defp normalize_archive_segment(segment, segments) do
    {:cont, segments ++ [segment]}
  end

  defp epub_browser_target(target_entry, entries) do
    index_entry =
      case target_entry do
        "" -> "index.xhtml"
        _entry -> target_entry <> "/index.xhtml"
      end

    if Map.has_key?(entries, index_entry), do: index_entry, else: target_entry
  end

  defp references(tree) do
    Enum.flat_map(@link_attributes, fn attribute ->
      tree
      |> Floki.find("[#{attribute}]")
      |> Enum.flat_map(fn node ->
        node
        |> Floki.attribute(attribute)
        |> Enum.map(&{attribute, &1})
      end)
    end)
  end

  defp ignored_reference?(""), do: true
  defp ignored_reference?(<<"/", _rest::binary>>), do: true

  defp ignored_reference?(value) do
    uri = URI.parse(value)
    not is_nil(uri.scheme) or not is_nil(uri.host)
  end

  defp allowed_missing_file?(target_file, root) do
    target_file
    |> relative_path(root)
    |> then(&MapSet.member?(@allowed_missing_files, &1))
  end

  defp inside_root?(path, root) do
    case path |> Path.relative_to(root) |> Path.split() do
      [".." | _parts] -> false
      parts -> Path.type(Path.join(parts)) == :relative
    end
  end

  defp fragment_anchor(encoded_fragment) do
    case encoded_fragment |> URI.decode() |> String.split(":~:text=", parts: 2) do
      [""] -> nil
      ["", _text_directive] -> nil
      [fragment | _rest] -> fragment
    end
  end

  defp html_file?(path), do: String.downcase(Path.extname(path)) == ".html"
  defp xhtml_file?(path), do: String.downcase(Path.extname(path)) == ".xhtml"

  defp relative_path(path, root) do
    path
    |> Path.relative_to(root)
    |> Path.split()
    |> Enum.join("/")
  end
end

if Mix.env() != :test do
  System.halt(LiveViewReact.ExDocLinkChecker.main(System.argv()))
end
