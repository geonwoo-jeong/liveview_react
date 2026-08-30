defmodule LiveViewReact.ExDocLinkCheckerTest do
  use ExUnit.Case, async: true

  import ExUnit.CaptureIO

  Code.require_file(Path.expand("../scripts/check_exdoc_links.exs", __DIR__))

  setup do
    fixture_dir =
      Path.join(
        System.tmp_dir!(),
        "live_view_react-exdoc-links-#{System.unique_integer([:positive])}"
      )

    File.mkdir_p!(fixture_dir)
    on_exit(fn -> File.rm_rf!(fixture_dir) end)

    %{fixture_dir: fixture_dir}
  end

  test "accepts valid relative targets and HTML fragments", %{fixture_dir: fixture_dir} do
    write_fixture!(fixture_dir, %{
      ".build.epub" => "",
      "assets/site.css" => "body {}",
      "guide.html" => ~s(<main id="install"><a name="legacy"></a></main>),
      "index.html" => """
      <html>
        <head>
          <link href="assets/site.css?version=1" rel="stylesheet">
          <script src="docs_config.js"></script>
        </head>
        <body id="home">
          <a href="#home">Home</a>
          <a href="guide.html#install">Install</a>
          <a href="guide.html#legacy">Legacy anchor</a>
          <a href="https://hexdocs.pm/ex_doc">External</a>
          <a href="/root-relative">Root relative</a>
        </body>
      </html>
      """
    })

    write_valid_epub!(fixture_dir)

    assert {:ok, %{html_files: 2, epub_files: 1, epub_xhtml_files: 2}} =
             LiveViewReact.ExDocLinkChecker.validate(fixture_dir)

    assert LiveViewReact.ExDocLinkChecker.main([fixture_dir], quiet: true) == 0
  end

  test "accepts valid EPUB XHTML targets and fragments", %{fixture_dir: fixture_dir} do
    write_fixture!(fixture_dir, %{"index.html" => ~s(<main id="content"></main>)})

    write_epub_fixture!(fixture_dir, "bundle.epub", %{
      "OPS/guide.xhtml" => ~s(<section id="install"><a name="legacy"></a></section>),
      "OPS/index.xhtml" => """
      <html>
        <head><link href="styles/book.css" rel="stylesheet"></head>
        <body id="home">
          <a href="#home">Home</a>
          <a href="guide.xhtml#install">Install</a>
          <a href="guide.xhtml#legacy">Legacy anchor</a>
          <a href="https://hexdocs.pm/ex_doc">External</a>
          <a href="/root-relative">Root relative</a>
        </body>
      </html>
      """,
      "OPS/styles/book.css" => "body {}"
    })

    assert {:ok, %{html_files: 1, epub_files: 1, epub_xhtml_files: 2}} =
             LiveViewReact.ExDocLinkChecker.validate(fixture_dir)

    assert LiveViewReact.ExDocLinkChecker.main([fixture_dir], quiet: true) == 0
  end

  test "reports missing files in sorted order and returns a nonzero status", %{
    fixture_dir: fixture_dir
  } do
    write_fixture!(fixture_dir, %{
      "index.html" => """
      <a href="z-missing.html">Z</a>
      <script src="assets/a-missing.js"></script>
      """
    })

    write_valid_epub!(fixture_dir)

    assert {:error, errors} = LiveViewReact.ExDocLinkChecker.validate(fixture_dir)

    assert errors == [
             ~s(index.html: href "z-missing.html" points to missing file "z-missing.html"),
             ~s(index.html: src "assets/a-missing.js" points to missing file "assets/a-missing.js")
           ]

    assert_failure_status(fixture_dir, errors)
  end

  test "reports missing fragments in sorted order and returns a nonzero status", %{
    fixture_dir: fixture_dir
  } do
    write_fixture!(fixture_dir, %{
      "guide.html" => ~s(<main id="present"></main>),
      "index.html" => """
      <a href="guide.html#z-missing">Z</a>
      <a href="guide.html#a-missing">A</a>
      """
    })

    write_valid_epub!(fixture_dir)

    assert {:error, errors} = LiveViewReact.ExDocLinkChecker.validate(fixture_dir)

    assert errors == [
             ~s(index.html: href "guide.html#a-missing" points to missing fragment "#a-missing" in "guide.html"),
             ~s(index.html: href "guide.html#z-missing" points to missing fragment "#z-missing" in "guide.html")
           ]

    assert_failure_status(fixture_dir, errors)
  end

  test "reports missing EPUB entries and fragments in sorted order", %{
    fixture_dir: fixture_dir
  } do
    write_fixture!(fixture_dir, %{"index.html" => ~s(<main id="content"></main>)})

    write_epub_fixture!(fixture_dir, "broken.epub", %{
      "OEBPS/guide.xhtml" => ~s(<main id="present"></main>),
      "OEBPS/index.xhtml" => """
      <a href="missing.xhtml">Missing entry</a>
      <a href="guide.xhtml#absent">Missing fragment</a>
      """
    })

    assert {:error, errors} = LiveViewReact.ExDocLinkChecker.validate(fixture_dir)

    assert errors == [
             ~s(broken.epub!OEBPS/index.xhtml: href "guide.xhtml#absent" points to missing fragment "#absent" in EPUB entry "OEBPS/guide.xhtml"),
             ~s(broken.epub!OEBPS/index.xhtml: href "missing.xhtml" points to missing EPUB entry "OEBPS/missing.xhtml")
           ]

    assert_failure_status(fixture_dir, errors)
  end

  test "requires an EPUB archive and ignores ExDoc marker files", %{fixture_dir: fixture_dir} do
    write_fixture!(fixture_dir, %{
      ".build.epub" => "",
      "index.html" => ~s(<main id="content"></main>)
    })

    assert {:error, [error]} = LiveViewReact.ExDocLinkChecker.validate(fixture_dir)
    assert error == "no EPUB archives found under #{inspect(Path.expand(fixture_dir))}"
  end

  test "rejects EPUB entry paths that escape the archive", %{
    fixture_dir: fixture_dir
  } do
    write_fixture!(fixture_dir, %{"index.html" => ~s(<main id="content"></main>)})

    write_epub_fixture!(fixture_dir, "unsafe.epub", %{
      "../" => "",
      "../escape.xhtml" => ~s(<main id="escape"></main>),
      "OPS/index.xhtml" => ~s(<main id="content"></main>),
      "xabsolute/" => "",
      "xabsolute.xhtml" => ~s(<main id="absolute"></main>)
    })

    replace_epub_entry_name!(fixture_dir, "unsafe.epub", "xabsolute.xhtml", "/absolute.xhtml")
    replace_epub_entry_name!(fixture_dir, "unsafe.epub", "xabsolute/", "/absolute/")

    assert {:error, errors} = LiveViewReact.ExDocLinkChecker.validate(fixture_dir)

    assert errors == [
             ~s(unsafe.epub: EPUB entry "../" resolves outside the archive),
             ~s(unsafe.epub: EPUB entry "../escape.xhtml" resolves outside the archive),
             ~s(unsafe.epub: EPUB entry "/absolute.xhtml" resolves outside the archive),
             ~s(unsafe.epub: EPUB entry "/absolute/" resolves outside the archive)
           ]
  end

  test "rejects EPUB links that escape the archive", %{fixture_dir: fixture_dir} do
    write_fixture!(fixture_dir, %{"index.html" => ~s(<main id="content"></main>)})

    write_epub_fixture!(fixture_dir, "outside.epub", %{
      "OPS/index.xhtml" => ~s(<a href="../../outside.xhtml">Outside</a>)
    })

    assert {:error, [error]} = LiveViewReact.ExDocLinkChecker.validate(fixture_dir)

    assert error ==
             ~s(outside.epub!OPS/index.xhtml: href "../../outside.xhtml" resolves outside the EPUB archive)
  end

  defp assert_failure_status(fixture_dir, errors) do
    output =
      capture_io(:stderr, fn ->
        assert LiveViewReact.ExDocLinkChecker.main([fixture_dir], quiet: true) == 1
      end)

    assert output == Enum.map_join(errors, "", &"#{&1}\n")
  end

  defp write_fixture!(fixture_dir, files) do
    Enum.each(files, fn {relative_path, contents} ->
      path = Path.join(fixture_dir, relative_path)
      File.mkdir_p!(Path.dirname(path))
      File.write!(path, contents)
    end)
  end

  defp write_valid_epub!(fixture_dir) do
    write_epub_fixture!(fixture_dir, "book.epub", %{
      "OEBPS/guide.xhtml" => ~s(<main id="chapter"></main>),
      "OEBPS/index.xhtml" => ~s(<a href="guide.xhtml#chapter">Chapter</a>)
    })
  end

  defp write_epub_fixture!(fixture_dir, archive_name, files) do
    entries =
      files
      |> Enum.sort_by(&elem(&1, 0))
      |> Enum.map(fn {name, contents} -> {String.to_charlist(name), contents} end)

    assert {:ok, {_archive_name, archive}} =
             :zip.create(String.to_charlist(archive_name), entries, [:memory])

    File.write!(Path.join(fixture_dir, archive_name), archive)
  end

  defp replace_epub_entry_name!(fixture_dir, archive_name, old_name, new_name)
       when byte_size(old_name) == byte_size(new_name) do
    archive_path = Path.join(fixture_dir, archive_name)

    archive =
      archive_path
      |> File.read!()
      |> :binary.replace(old_name, new_name, [:global])

    File.write!(archive_path, archive)
  end
end
