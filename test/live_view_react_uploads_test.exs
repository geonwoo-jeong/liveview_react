defmodule LiveViewReact.UploadsTest do
  use ExUnit.Case, async: true

  alias LiveViewReact.Uploads
  alias Phoenix.LiveView.{UploadConfig, UploadEntry}

  test "encodes the public upload contract without Phoenix internals" do
    entry = %UploadEntry{
      cancelled?: false,
      client_last_modified: 1_725_000_000_000,
      client_name: "avatar.png",
      client_relative_path: "photos/avatar.png",
      client_size: 128,
      client_type: "image/png",
      done?: false,
      preflighted?: true,
      progress: 45,
      ref: "entry-1",
      upload_ref: "upload-1",
      uuid: "private-uuid",
      valid?: false
    }

    config =
      UploadConfig.build(:avatar, "upload-1",
        accept: [".png", "image/jpeg"],
        auto_upload: true,
        max_entries: 2,
        max_entries_mode: :total,
        max_file_size: 512
      )
      |> Map.put(:entries, [entry])
      |> Map.put(:errors, [{"entry-1", :too_large}, {"upload-1", :too_many_files}])

    assert Uploads.encode_config(config, []) == %{
             accept: [".png", "image/jpeg"],
             auto_upload: true,
             entries: [
               %{
                 cancelled: false,
                 client_last_modified: 1_725_000_000_000,
                 client_name: "avatar.png",
                 client_relative_path: "photos/avatar.png",
                 client_size: 128,
                 client_type: "image/png",
                 done: false,
                 errors: [:too_large],
                 preflighted: true,
                 progress: 45,
                 ref: "entry-1",
                 valid: false
               }
             ],
             errors: [
               %{error: :too_large, ref: "entry-1"},
               %{error: :too_many_files, ref: "upload-1"}
             ],
             max_entries: 2,
             max_entries_mode: "total",
             max_file_size: 512,
             name: "avatar",
             ref: "upload-1"
           }

    refute Map.has_key?(Uploads.encode_config(config, []), :writer)
    refute Map.has_key?(hd(Uploads.encode_config(config, []).entries), :uuid)
  end

  test "encodes accept any and cancelled entries" do
    entry = %UploadEntry{
      cancelled?: true,
      client_name: "notes.txt",
      client_size: 0,
      client_type: "text/plain",
      done?: false,
      preflighted?: false,
      progress: 0,
      ref: "entry-2",
      valid?: true
    }

    config =
      UploadConfig.build(:documents, "upload-2", accept: :any)
      |> Map.put(:entries, [entry])

    encoded = Uploads.encode_config(config, [])

    assert encoded.accept == "any"

    assert encoded.entries == [
             %{
               cancelled: true,
               client_last_modified: 0,
               client_name: "notes.txt",
               client_relative_path: "",
               client_size: 0,
               client_type: "text/plain",
               done: false,
               errors: [],
               preflighted: false,
               progress: 0,
               ref: "entry-2",
               valid: true
             }
           ]

    assert Uploads.encode_entry(entry, []) == %{
             cancelled: true,
             client_last_modified: 0,
             client_name: "notes.txt",
             client_relative_path: "",
             client_size: 0,
             client_type: "text/plain",
             done: false,
             errors: [],
             preflighted: false,
             progress: 0,
             ref: "entry-2",
             valid: true
           }
  end

  test "rejects upload configs with foreign error refs, invalid accept entries, and invalid mode" do
    config =
      UploadConfig.build(:avatar, "upload-1",
        accept: [".png"],
        max_entries: 1,
        max_entries_mode: :selected,
        max_file_size: 512
      )
      |> Map.put(:entries, [])
      |> Map.put(:errors, [{"foreign-ref", :too_large}])

    assert_raise ArgumentError, ~r/upload error ref must match/, fn ->
      Uploads.encode_config(config, [])
    end

    invalid_mode = %{config | errors: [], max_entries_mode: :invalid}

    assert_raise ArgumentError, ~r/max_entries_mode/, fn ->
      Uploads.encode_config(invalid_mode, [])
    end

    invalid_accept = %{config | errors: [], accept: [".png", " "]}

    assert_raise ArgumentError, ~r/accept entries must be non-empty strings/, fn ->
      Uploads.encode_config(invalid_accept, [])
    end
  end
end
