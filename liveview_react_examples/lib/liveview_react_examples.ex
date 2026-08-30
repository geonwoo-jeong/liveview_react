defmodule LiveViewReactExamples do
  @moduledoc """
  Central catalog for the example application.

  This module is the single place that describes which demo routes exist and
  which runtime capability each page highlights.
  """

  @type demo_id ::
          :all_features
          | :simple
          | :simple_props
          | :typescript
          | :lazy
          | :counter
          | :log_list
          | :flash_sonner
          | :ssr
          | :hybrid_form
          | :slot
          | :context
          | :link_demo
          | :link_usage
          | :stream_demo

  @type demo :: %{
          id: demo_id(),
          path: String.t(),
          section: String.t(),
          title: String.t(),
          view: module()
        }

  @demos [
    %{
      id: :all_features,
      path: "/sample",
      section: "Overview",
      title: "All Features",
      view: LiveViewReactExamplesWeb.LiveAllFeatures
    },
    %{
      id: :simple,
      path: "/simple",
      section: "Basics",
      title: "Simple",
      view: LiveViewReactExamplesWeb.LiveSimple
    },
    %{
      id: :simple_props,
      path: "/simple-props",
      section: "Basics",
      title: "Simple Props",
      view: LiveViewReactExamplesWeb.LiveSimpleProps
    },
    %{
      id: :typescript,
      path: "/typescript",
      section: "Basics",
      title: "TypeScript",
      view: LiveViewReactExamplesWeb.LiveTypescript
    },
    %{
      id: :lazy,
      path: "/lazy",
      section: "Basics",
      title: "Lazy",
      view: LiveViewReactExamplesWeb.LiveLazy
    },
    %{
      id: :counter,
      path: "/live-counter",
      section: "LiveViews",
      title: "Live Counter",
      view: LiveViewReactExamplesWeb.LiveCounter
    },
    %{
      id: :log_list,
      path: "/log-list",
      section: "LiveViews",
      title: "Log List",
      view: LiveViewReactExamplesWeb.LiveLogList
    },
    %{
      id: :flash_sonner,
      path: "/flash-sonner",
      section: "LiveViews",
      title: "Flash With Sonner",
      view: LiveViewReactExamplesWeb.LiveFlashSonner
    },
    %{
      id: :ssr,
      path: "/ssr",
      section: "LiveViews",
      title: "SSR",
      view: LiveViewReactExamplesWeb.LiveSSR
    },
    %{
      id: :hybrid_form,
      path: "/hybrid-form",
      section: "LiveViews",
      title: "Hybrid Form",
      view: LiveViewReactExamplesWeb.LiveHybridForm
    },
    %{
      id: :slot,
      path: "/slot",
      section: "LiveViews",
      title: "Slot",
      view: LiveViewReactExamplesWeb.LiveSlot
    },
    %{
      id: :context,
      path: "/context",
      section: "LiveViews",
      title: "Context",
      view: LiveViewReactExamplesWeb.LiveContext
    },
    %{
      id: :link_demo,
      path: "/link-demo",
      section: "LiveViews",
      title: "Link Demo",
      view: LiveViewReactExamplesWeb.LiveLinkDemo
    },
    %{
      id: :link_usage,
      path: "/link-usage",
      section: "LiveViews",
      title: "Link Usage",
      view: LiveViewReactExamplesWeb.LiveLinkUsage
    },
    %{
      id: :stream_demo,
      path: "/stream-demo",
      section: "LiveViews",
      title: "Streams",
      view: LiveViewReactExamplesWeb.LiveStreamDemo
    }
  ]

  @section_order @demos |> Enum.map(& &1.section) |> Enum.uniq()

  @sample_sections [
    %{
      id: "root",
      title: "Root contract and registry",
      summary:
        "Explicit id, component, and socket assigns mount one bounded React root through the Vite-discovered registry."
    },
    %{
      id: "ssr",
      title: "SSR and hydration",
      summary:
        "Disconnected HTML renders on the server and hydrates into the same React tree while prop updates stay diff-driven."
    },
    %{
      id: "events",
      title: "Events and replies",
      summary:
        "The sample mixes r-on callbacks, pushEvent, push_event subscriptions, useEventReply, and native phx-* bindings."
    },
    %{
      id: "streams",
      title: "Streams, slots, and updates",
      summary:
        "Phoenix Streams cover insert, update-only, delete, and reset while HEEx slots arrive as inert React content."
    },
    %{
      id: "forms",
      title: "Forms and uploads",
      summary:
        "useLiveForm and useLiveUpload stay aligned with validation, submission, cancellation, and live_file_input uploads."
    },
    %{
      id: "navigation",
      title: "Navigation and connection state",
      summary:
        "Link, useLiveNavigation, and useLiveConnection show patch, navigate, and full href reload boundaries."
    },
    %{
      id: "lifecycle",
      title: "Lazy loading and portals",
      summary:
        "The registry lazy-loads the root, while portals and React 19 lifecycle options stay within LiveView ownership."
    }
  ]

  @sample_form_values %{
    "notes" => "One screen, one bridge, multiple runtime features.",
    "title" => "LiveViewReact sample"
  }

  @initial_items [
    %{id: "intro", label: "Explicit root mounted with SSR"},
    %{id: "events", label: "Events and replies ready"},
    %{id: "streams", label: "Streams patch by __dom_id"}
  ]

  @replacement_items [
    %{id: "forms", label: "Forms keep local drafts"},
    %{id: "uploads", label: "Uploads stay on Phoenix transport"},
    %{id: "navigation", label: "Link and patch navigation updated"}
  ]

  @spec demos() :: [demo()]
  def demos, do: @demos

  @spec demo_sections() :: [%{section: String.t(), demos: [demo()]}]
  def demo_sections do
    grouped = Enum.group_by(@demos, & &1.section)

    Enum.map(@section_order, fn section ->
      %{section: section, demos: Map.fetch!(grouped, section)}
    end)
  end

  @spec demo_id_for_view(module()) :: demo_id() | nil
  def demo_id_for_view(view) when is_atom(view) do
    case Enum.find(@demos, &(&1.view == view)) do
      %{id: id} -> id
      nil when view == LiveViewReactExamplesWeb.LiveSampleDestination -> :all_features
      nil -> nil
    end
  end

  @spec sample_sections() :: [map()]
  def sample_sections, do: @sample_sections

  @spec sample_form_values() :: map()
  def sample_form_values, do: @sample_form_values

  @spec initial_items() :: [map()]
  def initial_items, do: @initial_items

  @spec replacement_items() :: [map()]
  def replacement_items, do: @replacement_items
end
