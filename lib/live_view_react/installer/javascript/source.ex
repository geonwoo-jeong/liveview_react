defmodule LiveViewReact.Installer.JavaScript.Source do
  @moduledoc false

  @spec insert_collection_member(binary(), struct(), struct(), [struct()], binary()) :: binary()
  def insert_collection_member(source, open, close, tokens, member) do
    significant = Enum.reject(tokens, &(&1.value == ","))
    between = binary_part(source, open.stop, close.start - open.stop)
    multiline? = String.contains?(between, ["\n", "\r"])
    close_indent = indentation_at(source, close.start)
    member_indent = member_indentation(source, significant, close_indent)
    newline = line_break(source)

    cond do
      significant == [] and String.trim(between) == "" and multiline? ->
        replace(
          source,
          open.stop,
          close.start,
          newline <> member_indent <> member <> "," <> newline <> close_indent
        )

      significant == [] and String.trim(between) == "" ->
        replace(source, open.stop, close.start, " #{member} ")

      significant == [] ->
        insert_after_comments(
          source,
          open,
          close,
          between,
          member,
          member_indent,
          close_indent
        )

      true ->
        insert_after_members(source, close, tokens, member, member_indent, close_indent)
    end
  end

  @spec ends_in_whitespace?(binary()) :: boolean()
  def ends_in_whitespace?(source) when source != "" do
    source |> :binary.last() |> then(&(&1 in [9, 10, 11, 12, 13, 32]))
  end

  def ends_in_whitespace?(""), do: false

  @spec line_break(binary()) :: binary()
  def line_break(source) do
    cond do
      String.contains?(source, "\r\n") -> "\r\n"
      String.contains?(source, "\n") -> "\n"
      String.contains?(source, "\r") -> "\r"
      true -> "\n"
    end
  end

  @spec replace(binary(), non_neg_integer(), non_neg_integer(), binary()) :: binary()
  def replace(source, start_offset, stop_offset, replacement) do
    prefix = binary_part(source, 0, start_offset)
    suffix = binary_part(source, stop_offset, byte_size(source) - stop_offset)
    prefix <> replacement <> suffix
  end

  defp insert_after_comments(
         source,
         open,
         close,
         between,
         member,
         member_indent,
         close_indent
       ) do
    newline = line_break(source)
    separator = if String.contains?(between, ["\n", "\r"]), do: newline, else: " "

    replacement =
      between <> separator <> member_indent <> member <> "," <> newline <> close_indent

    replace(source, open.stop, close.start, replacement)
  end

  defp insert_after_members(source, close, tokens, member, member_indent, close_indent) do
    last = List.last(tokens)
    trailing_comma? = last.value == ","
    gap = binary_part(source, last.stop, close.start - last.stop)
    whitespace_only? = String.trim(gap) == ""
    multiline? = String.contains?(gap, ["\n", "\r"])
    newline = line_break(source)

    replacement =
      member_replacement(
        whitespace_only?,
        multiline?,
        trailing_comma?,
        gap,
        newline,
        member_indent,
        member,
        close_indent
      )

    replace(source, last.stop, close.start, replacement)
  end

  defp member_replacement(true, true, trailing?, _gap, newline, indent, member, close_indent),
    do: separator(trailing?) <> newline <> indent <> member <> "," <> newline <> close_indent

  defp member_replacement(true, false, trailing?, gap, _newline, _indent, member, _close),
    do: separator(trailing?) <> " " <> member <> gap

  defp member_replacement(false, true, trailing?, gap, newline, indent, member, close_indent),
    do:
      separator(trailing?) <>
        gap <> newline <> indent <> member <> "," <> newline <> close_indent

  defp member_replacement(false, false, trailing?, gap, _newline, _indent, member, _close),
    do: separator(trailing?) <> gap <> " " <> member <> " "

  defp separator(true), do: ""
  defp separator(false), do: ","

  defp member_indentation(source, [first | _rest], close_indent) do
    case indentation_at(source, first.start) do
      "" -> close_indent <> "  "
      indent -> indent
    end
  end

  defp member_indentation(_source, [], close_indent), do: close_indent <> "  "

  defp indentation_at(source, offset) do
    prefix = binary_part(source, 0, offset)

    line_start =
      case :binary.matches(prefix, "\n") do
        [] -> 0
        matches -> matches |> List.last() |> elem(0) |> Kernel.+(1)
      end

    indentation = binary_part(source, line_start, offset - line_start)
    if String.trim(indentation) == "", do: indentation, else: ""
  end
end
