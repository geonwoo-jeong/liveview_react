defmodule LiveViewReact.ReleaseVersionTest do
  use ExUnit.Case, async: true

  @project_root Path.expand("..", __DIR__)

  test "release metadata versions stay synchronized" do
    project_version = Mix.Project.config() |> Keyword.fetch!(:version)
    manifest = read_json!(".release-please-manifest.json")
    package = read_json!("package.json")
    lock = read_json!("package-lock.json")
    example_lock = read_json!("liveview_react_examples/assets/package-lock.json")

    assert manifest["."] == project_version
    assert package["version"] == project_version
    assert lock["version"] == project_version
    assert get_in(lock, ["packages", "", "version"]) == project_version
    assert get_in(example_lock, ["packages", "../..", "version"]) == project_version
  end

  defp read_json!(relative_path) do
    @project_root
    |> Path.join(relative_path)
    |> File.read!()
    |> Jason.decode!()
  end
end
